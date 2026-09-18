(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ai-core.js'));
  else root.PhotoPackage = factory(root.PhotoCaptionCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const L = Core.LIMITS;
  const IMAGE = /\.(jpe?g|png|webp)$/i;

  async function sha256(bytes) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }

  function parseManifest(text) {
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('説明文JSONが読み取れません。'); }
    return Core.validateManifest(value);
  }

  // Bound actual decompressed bytes, not just the untrusted ZIP size header.
  function readEntry(entry, max) {
    return new Promise((resolve, reject) => {
      let size = 0, failed = false;
      const chunks = [], stream = entry.internalStream('uint8array');
      stream.on('data', chunk => {
        if (failed) return;
        size += chunk.length;
        if (size > max) {
          failed = true; stream.pause(); chunks.length = 0;
          reject(new Error('ZIP内のファイルが大きすぎます。')); return;
        }
        chunks.push(chunk);
      }).on('error', reject).on('end', () => {
        if (failed) return;
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
        resolve(bytes);
      }).resume();
    });
  }

  async function readZip(bytes, JSZip) {
    if (bytes.byteLength > L.zipBytes) throw new Error('ZIPは80MB以下にしてください。');
    let zip;
    try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('ZIPが壊れているか、暗号化されています。'); }
    const entries = Object.values(zip.files).filter(e => !e.dir && !e.name.startsWith('__MACOSX/') && !e.name.split('/').pop().startsWith('.'));
    if (entries.length > L.photos + 10) throw new Error('ZIP内のファイルが多すぎます。写真は100枚までです。');
    for (const e of entries) if (!Core.safePath(e.unsafeOriginalName || e.name)) throw new Error('ZIP内のファイル名が不正です。');
    const manifests = entries.filter(e => e.name === 'captions.json' || e.name.endsWith('/captions.json'));
    if (manifests.length > 1) throw new Error('説明文データはZIPに1つだけ入れてください。');
    let manifest = null, prefix = '';
    if (manifests.length) {
      const entry = manifests[0];
      prefix = entry.name.slice(0, -'captions.json'.length);
      manifest = parseManifest(new TextDecoder().decode(await readEntry(entry, L.jsonBytes)));
    }
    const images = [], selected = manifest ? manifest.photos.map(p => {
      const name = prefix + p.filename;
      const entry = zip.files[name];
      if (!entry || entry.dir) throw new Error(`写真がZIPにありません：${p.filename}`);
      return { entry, row: p };
    }) : entries.filter(e => IMAGE.test(e.name)).map(entry => ({ entry }));
    if (!selected.length || selected.length > L.photos) throw new Error('ZIPにはJPEG・PNG・WebPを1〜100枚入れてください。');
    let total = 0;
    for (const { entry, row } of selected) {
      const data = await readEntry(entry, Math.min(L.imageBytes, L.totalBytes - total));
      total += data.length;
      const hash = await sha256(data);
      if (row && hash !== row.sha256) throw new Error(`写真と説明文の照合に失敗しました：${row.filename}`);
      images.push({ name: row?.filename || entry.name, bytes: data, sha256: hash });
    }
    return { images, manifest, bytes: total };
  }

  return { sha256, parseManifest, readZip, readEntry };
});
