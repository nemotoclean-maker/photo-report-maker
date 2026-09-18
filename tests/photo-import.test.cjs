const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../ai-core.js');
const Pack = require('../photo-package.js');
const JSZip = require('../jszip.min.js');
const Docx = require('../docxgen.js');
const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1EAAAAASUVORK5CYII=', 'base64'));
const row = (id, disposition='include', parentId=null) => ({ id, filename:`photos/${id}.png`, sha256:id.padEnd(64,'0'), place:'厨房', description:`${id}のゴミが見られました。`, disposition, parentId, reason:'' });
const manifest = photos => ({ format:'cleanlife-photo-report', version:1, photos });
const photo = r => Core.ensurePhoto({ id:r.id, sourceSha256:r.sha256, place:'', desc:'', dataUrl:'', w:1, h:1, shapes:[] });

test('pair numbers follow reordering, exclusion and removal; exclusions never enter DOCX', async () => {
  const rows = [row('a'),row('b','include','a'),row('c','exclude'),row('d','review')];
  const photos = rows.map(photo);
  Core.applyManifest(photos, manifest(rows));
  assert.equal(Core.description(photos[1], photos),'写真1の拡大');
  photos.reverse();
  assert.equal(Core.description(photos.find(p=>p.id==='b'),photos),'写真2の拡大');
  const doc = Docx.buildReportZip({store:'試験',y:2026,m:9,d:11,reporter:'試験',overview:'',leak:null,
    photos:Core.included(photos).map(p=>({data:image,wPx:1,hPx:1,place:p.place,desc:Core.description(p,photos)}))},JSZip);
  const xml = await doc.file('word/document.xml').async('string');
  assert.match(xml,/写真2の拡大/);
  assert.doesNotMatch(xml,/cのゴミ|dのゴミ/);
  assert.equal(Object.keys(doc.files).filter(n=>n.startsWith('word/media/')&&!doc.files[n].dir).length,2);
  photos.find(p=>p.id==='a').included=false;
  assert.equal(Core.description(photos.find(p=>p.id==='b'),photos),'bのゴミが見られました。');
  photos.splice(photos.findIndex(p=>p.id==='a'),1);
  assert.equal(Core.description(photos.find(p=>p.id==='b'),photos),'bのゴミが見られました。');
});

test('manual changes survive re-import; checksum, not filename, identifies photos', () => {
  const r=row('a'), p=photo(r); p.filename='renamed.png';
  Core.applyManifest([p],manifest([r]));
  Core.markEdited(p,'desc','確認済みの説明');
  assert.deepEqual(Core.applyManifest([p],manifest([{...r,description:'別の説明'}])),{applied:0,preserved:1});
  assert.equal(p.desc,'確認済みの説明');
  assert.throws(()=>Core.applyManifest([p],manifest([row('b')])),/対応する写真/);
});

test('malformed/cyclic references and path traversal fail before applying', () => {
  for (const rows of [[row('a','include','a')],[row('a','include','b'),row('b','include','a')],[row('a','include','b'),row('b','exclude')]]) {
    assert.throws(()=>Core.validateManifest(manifest(rows)),/全景と拡大/);
  }
  assert.throws(()=>Core.validateManifest(manifest([{...row('a'),filename:'../outside.png'}])),/写真名/);
  const p=photo(row('a'));
  assert.throws(()=>Core.applyManifest([p],manifest([row('a'),row('b')])),/対応する写真/);
  assert.equal(p.desc,'');
});

test('exported-byte hash can match a photo already in the browser', () => {
  const r=row('a'), p=photo(row('b'));
  p.exportHashes=[r.sha256];
  Core.applyManifest([p],manifest([r]));
  assert.equal(p.desc,r.description);
});

test('ZIP import validates image contents and retains manifest order', async () => {
  const r={...row('a'),sha256:await Pack.sha256(image)};
  const zip = new JSZip(); zip.file(r.filename,image); zip.file('captions.json',JSON.stringify(manifest([r])));
  const result=await Pack.readZip(await zip.generateAsync({type:'uint8array'}),JSZip);
  assert.equal(result.images[0].name,r.filename);
  assert.equal(result.manifest.photos[0].sha256,r.sha256);
  zip.file(r.filename,Uint8Array.of(1,2,3));
  await assert.rejects(async()=>Pack.readZip(await zip.generateAsync({type:'uint8array'}),JSZip),/照合に失敗/);
});

test('ZIP traversal and oversized inflate are rejected', async () => {
  const zip=new JSZip(); zip.file('../outside.png',image);
  await assert.rejects(async()=>Pack.readZip(await zip.generateAsync({type:'uint8array'}),JSZip),/ファイル名/);
  const compressed=new JSZip(); compressed.file('large.bin',new Uint8Array(10000));
  const loaded=await JSZip.loadAsync(await compressed.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  await assert.rejects(()=>Pack.readEntry(loaded.file('large.bin'),100),/大きすぎ/);
});

test('camera ordering ignores classifier prefixes and sorts naturally', () => {
  const files=[{name:'2_IMG_10.jpg'},{name:'7_IMG_2.jpg'},{name:'1_IMG_3.jpg'}];
  assert.deepEqual(Core.sortFiles(files).map(f=>f.name),['7_IMG_2.jpg','1_IMG_3.jpg','2_IMG_10.jpg']);
});

test('static page has valid JS and every local script exists', () => {
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const match of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(__dirname,'..',match[1])));
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  for(const name of ['ai-core.js','photo-package.js','photo-import.js']) new vm.Script(fs.readFileSync(path.join(__dirname,'..',name),'utf8'));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../photo-import.js'),'utf8'),/fetch\s*\(|XMLHttpRequest|apiKey|GEMINI_API_KEY/);
});
