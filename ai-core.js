(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoCaptionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function ensurePhoto(photo) {
    if (!photo.id) photo.id = globalThis.crypto.randomUUID();
    if (!photo.ai) photo.ai = { status: 'idle', reason: '', parentId: null, fallback: '', revision: 0 };
    if (photo.included === undefined) photo.included = true;
    return photo;
  }

  function included(photos) { return photos.filter(p => p.included !== false); }

  function description(photo, photos) {
    if (!photo.ai?.parentId) return photo.desc || '';
    const printable = included(photos);
    const parent = printable.find(p => p.id === photo.ai.parentId && !p.ai?.parentId);
    if (!parent || parent.id === photo.id) return photo.ai.fallback || '';
    return `写真${printable.indexOf(parent) + 1}の拡大`;
  }

  const LIMITS = { photos: 100, imageBytes: 20 * 1024 * 1024, zipBytes: 80 * 1024 * 1024, totalBytes: 160 * 1024 * 1024, jsonBytes: 1024 * 1024 };
  function safePath(name) {
    return typeof name === 'string' && name.length <= 240 && !/[\\\u0000-\u001f:]/.test(name) && !name.startsWith('/') && !name.split('/').some(p => p === '..' || p === '.' || p === '');
  }
  function validateManifest(data) {
    const fail = message => { throw new Error(`説明データ：${message}`); };
    if (!data || data.format !== 'cleanlife-photo-report' || data.version !== 1) fail('対応していない形式です。');
    if (!Array.isArray(data.photos) || !data.photos.length || data.photos.length > LIMITS.photos) fail('写真は1〜100枚にしてください。');
    const ids = new Set(), hashes = new Set(), filenames = new Set();
    for (const p of data.photos) {
      if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id) || ids.has(p.id)) fail('写真IDが不正または重複しています。');
      if (!safePath(p.filename) || !/\.(jpe?g|png|webp)$/i.test(p.filename) || filenames.has(p.filename)) fail('写真名が不正または重複しています。');
      if (typeof p.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.sha256) || hashes.has(p.sha256)) fail('画像の照合情報が不正または重複しています。');
      if (!['include','exclude','review','pending'].includes(p.disposition)) fail('掲載判定が不正です。');
      for (const [key, max] of [['place', 120], ['description', 1500], ['reason', 500]]) {
        if (typeof p[key] !== 'string' || p[key].length > max) fail(`${key}の長さ・形式が不正です。`);
      }
      if (p.parentId !== null && typeof p.parentId !== 'string') fail('拡大写真の対応が不正です。');
      ids.add(p.id); hashes.add(p.sha256); filenames.add(p.filename);
    }
    const byId = new Map(data.photos.map(p => [p.id, p]));
    for (const p of data.photos) {
      if (p.parentId !== null) {
        const parent = byId.get(p.parentId);
        if (!parent || parent === p || parent.parentId !== null || parent.disposition !== 'include' || p.disposition !== 'include') fail('全景と拡大の対応を確認してください。');
        if (!p.description.trim()) fail('拡大写真には単独でも使える説明文が必要です。');
      }
    }
    return data;
  }

  function applyManifest(photos, manifest) {
    validateManifest(manifest);
    const byHash = new Map();
    for (const p of photos) {
      ensurePhoto(p);
      for (const hash of [p.sourceSha256, ...(p.exportHashes || [])]) if (hash) byHash.set(hash, p);
    }
    const targets = new Map(), missing = [];
    for (const row of manifest.photos) {
      const p = byHash.get(row.sha256);
      if (!p) missing.push(row.filename);
      else targets.set(row.id, p);
    }
    if (missing.length) throw new Error(`対応する写真が${missing.length}枚ありません。写真入りZIPを読み込むか、先に同じ写真を追加してください。`);
    let applied = 0, preserved = 0;
    for (const row of manifest.photos) {
      const p = targets.get(row.id);
      // Preserve hand-entered text and deliberate inclusion decisions on repeat imports.
      if (p.ai.status === 'manual' || ((p.place.trim() || p.desc.trim()) && p.ai.status === 'idle')) { preserved++; continue; }
      p.place = row.place;
      p.desc = row.description;
      p.included = row.disposition === 'include' || row.disposition === 'pending';
      p.ai = { status: row.disposition === 'include' ? 'done' : row.disposition === 'pending' ? 'idle' : row.disposition,
        reason: row.reason, parentId: targets.get(row.parentId)?.id || null, fallback: row.description, revision: p.ai.revision + 1 };
      applied++;
    }
    return { applied, preserved };
  }

  function markEdited(photo, field, value) {
    ensurePhoto(photo);
    photo.ai.revision++;
    photo.ai.status = 'manual';
    if (field === 'desc') {
      photo.ai.parentId = null;
      photo.ai.fallback = '';
    }
    photo[field] = value;
  }

  function sortFiles(files) {
    const key = f => f.name.replace(/^\d+_(?=IMG_)/i, '');
    return [...files].sort((a, b) => key(a).localeCompare(key(b), 'ja', { numeric: true }));
  }

  return { ensurePhoto, included, description, applyManifest, validateManifest, safePath, LIMITS, markEdited, sortFiles };
});
