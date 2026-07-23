// docxgen.js — 写真報告書 .docx 生成エンジン（ブラウザ/Node 両対応）
// Python版 report_builder.py と同じ体裁の OOXML を直接組み立てる。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DocxGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MINCHO = 'ＭＳ 明朝';
  const CELL_W_DXA = 4634;      // 231.7pt * 20
  const GRID_W_DXA = 4535;
  const HEADER_H_DXA = 567;     // 28.35pt * 20
  const ROW_H_DXA = 3402;       // 170.1pt * 20
  const IMG_MAX_W_PT = 205.0;
  const IMG_MAX_H_PT = 150.0;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function zen(n) {
    return String(n).replace(/[0-9]/g, d => '０１２３４５６７８９'[+d]);
  }

  function rpr(sz) {
    return `<w:rPr><w:rFonts w:ascii="${MINCHO}" w:hAnsi="${MINCHO}" w:eastAsia="${MINCHO}"/>` +
      `<w:color w:val="000000"/><w:sz w:val="${sz}"/></w:rPr>`;
  }

  // 段落。opts: {sz, before(twips), jc, border(下線), lineExact(twips), text}
  function para(text, opts) {
    const o = Object.assign({ sz: 21, before: 0, jc: 'center', border: false, lineExact: null }, opts);
    let ppr = '<w:pPr>';
    if (o.border) ppr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>';
    if (o.lineExact) ppr += `<w:spacing w:lineRule="exact" w:line="${o.lineExact}" w:before="${o.before}" w:after="0"/>`;
    else ppr += `<w:spacing w:before="${o.before}" w:after="0"/>`;
    ppr += `<w:jc w:val="${o.jc}"/></w:pPr>`;
    const t = text ? `<w:t xml:space="preserve">${esc(text)}</w:t>` : '';
    return `<w:p>${ppr}<w:r>${rpr(o.sz)}${t}</w:r></w:p>`;
  }

  function pageBreak() {
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  function photoDrawing(relId, docPrId, cxEmu, cyEmu) {
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr>' +
      `<w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing>` +
      '<wp:inline xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<wp:extent cx="${cxEmu}" cy="${cyEmu}"/>` +
      `<wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr>' +
      `<pic:cNvPr id="0" name="image${docPrId}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  function cell(vAlign, content) {
    return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${CELL_W_DXA}"/><w:vAlign w:val="${vAlign}"/></w:tcPr>` +
      (content || '<w:p/>') + '</w:tc>';
  }

  function descCellContent(lines) {
    if (!lines.length) return '<w:p/>';
    // 行送り18pt(360twips) = KollaBo実物と同じ行間
    return lines.map(ln =>
      `<w:p><w:pPr><w:spacing w:lineRule="atLeast" w:line="360" w:before="0" w:after="0"/><w:jc w:val="both"/></w:pPr>` +
      `<w:r>${rpr(21)}${ln ? `<w:t xml:space="preserve">${esc(ln)}</w:t>` : ''}</w:r></w:p>`
    ).join('');
  }

  function row(heightDxa, photoContent, descContent, descVAlign) {
    return `<w:tr><w:trPr><w:trHeight w:val="${heightDxa}" w:hRule="atLeast"/></w:trPr>` +
      cell('center', photoContent) + cell(descVAlign || 'top', descContent) + '</w:tr>';
  }

  function headerRow() {
    const hc = label =>
      `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${CELL_W_DXA}"/><w:vAlign w:val="center"/></w:tcPr>` +
      para(label, { sz: 24, jc: 'center', lineExact: 280 }) + '</w:tc>';
    return `<w:tr><w:trPr><w:trHeight w:val="${HEADER_H_DXA}" w:hRule="atLeast"/></w:trPr>` +
      hc('写　真') + hc('説　明') + '</w:tr>';
  }

  function table(rowsXml) {
    return '<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(e =>
        `<w:${e} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('') +
      '</w:tblBorders></w:tblPr>' +
      `<w:tblGrid><w:gridCol w:w="${GRID_W_DXA}"/><w:gridCol w:w="${GRID_W_DXA}"/></w:tblGrid>` +
      rowsXml + '</w:tbl>';
  }

  // photos: [{data: Uint8Array(JPEG), wPx, hPx, place, desc}]
  function buildDocumentXml(opts) {
    const { store, y, m, d, reporter, overview, photos } = opts;
    const body = [];

    // ===== 表紙 =====
    body.push(para('', { sz: 21, border: true }));
    body.push(para(store, { sz: 32, before: 2100 }));
    body.push(para('写 真 報 告 書', { sz: 96, before: 1200 }));
    body.push(para(`施工日　${zen(y)}年　${zen(m)}月　${zen(d)}日`, { sz: 32, before: 1300 }));
    body.push(para('株式会社クリーンライフ', { sz: 28, before: 4600 }));
    body.push(para(`報告者　${reporter}`, { sz: 32, before: 300 }));
    body.push(para('', { sz: 21, before: 1100, border: true }));
    body.push(pageBreak());

    // ===== 写真ページ =====
    let photoNo = 0, pageIdx = 0, idx = 0;
    const rels = [];  // {relId, docPrId}
    while (true) {
      pageIdx++;
      const rows = [headerRow()];
      for (let r = 1; r <= 4; r++) {
        if (pageIdx === 1 && r === 1) {
          const lines = ['【概要】'];
          if (overview) overview.split(/\r?\n/).forEach(ln => lines.push(ln));
          rows.push(row(ROW_H_DXA, '<w:p/>', descCellContent(lines)));
          continue;
        }
        if (idx < photos.length) {
          const ph = photos[idx++];
          photoNo++;
          const relId = 'rIdImg' + photoNo;
          rels.push({ relId, n: photoNo });
          const scale = Math.min(IMG_MAX_W_PT / ph.wPx, IMG_MAX_H_PT / ph.hPx);
          const cx = Math.round(ph.wPx * scale * 12700);
          const cy = Math.round(ph.hPx * scale * 12700);
          const lines = [`【写真${zen(photoNo)}】`];
          if (ph.place) lines.push(ph.place);
          if (ph.desc) { lines.push(''); ph.desc.split(/\r?\n/).forEach(ln => lines.push(ln)); }
          rows.push(row(ROW_H_DXA, photoDrawing(relId, photoNo, cx, cy), descCellContent(lines)));
        } else {
          rows.push(row(ROW_H_DXA, '<w:p/>', '<w:p/>'));
        }
      }
      body.push(table(rows.join('')));
      body.push(para('株式会社クリーンライフ', { sz: 21 }));
      if (idx >= photos.length) break;
      body.push(pageBreak());
    }

    const sectPr = '<w:sectPr><w:pgSz w:w="11907" w:h="16839"/>' +
      '<w:pgMar w:top="720" w:right="1418" w:bottom="720" w:left="1418" w:header="720" w:footer="720" w:gutter="0"/>' +
      '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';

    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14">' +
      '<w:body>' + body.join('') + sectPr + '</w:body></w:document>';
    return { xml, imageCount: photoNo };
  }

  const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    `<w:rFonts w:ascii="${MINCHO}" w:hAnsi="${MINCHO}" w:eastAsia="${MINCHO}"/>` +
    '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/>' +
    '</w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '</w:styles>';

  function contentTypes() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>';
  }

  const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  function documentRels(imageCount) {
    let rels = '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    for (let i = 1; i <= imageCount; i++) {
      rels += `<Relationship Id="rIdImg${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i}.jpg"/>`;
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>';
  }

  // JSZipClass を注入して zip を構築（ブラウザ: window.JSZip / Node: require）
  function buildReportZip(opts, JSZipClass) {
    const { xml, imageCount } = buildDocumentXml(opts);
    const zip = new JSZipClass();
    zip.file('[Content_Types].xml', contentTypes());
    zip.file('_rels/.rels', ROOT_RELS);
    zip.file('word/document.xml', xml);
    zip.file('word/styles.xml', STYLES_XML);
    zip.file('word/_rels/document.xml.rels', documentRels(imageCount));
    opts.photos.forEach((ph, i) => {
      zip.file(`word/media/image${i + 1}.jpg`, ph.data);
    });
    return zip;
  }

  return { buildReportZip, buildDocumentXml, zen };
});
