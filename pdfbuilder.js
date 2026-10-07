// PDF processing (runs fully in the browser, uses pdf-lib)
(function (root) {
  const A4 = [595.28, 841.89];
  const FOOT = 28; // footer strip height (pt) added below each document page

  const lib = () => root.PDFLib;

  // Helvetica only supports Latin text: convert smart punctuation, replace others
  function ascii(s) {
    return String(s ?? '')
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
      .replace(/[^\x20-\x7E]/g, '?');
  }

  function fit(text, font, size, maxW) {
    text = ascii(text);
    if (font.widthOfTextAtSize(text, size) <= maxW) return text;
    while (text.length > 1 && font.widthOfTextAtSize(text + '...', size) > maxW) text = text.slice(0, -1);
    return text + '...';
  }

  function wrap(text, font, size, maxW) {
    const words = ascii(text).split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else { if (line) lines.push(line); line = fit(w, font, size, maxW); }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // Check a PDF: page count, password protection, damage
  async function inspect(bytes) {
    if (!lib()) return { error: 'nolib' };
    try {
      const doc = await lib().PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
      const n = doc.getPageCount();
      if (!n) return { error: 'damaged' };
      return { pages: n };
    } catch (e) {
      if (/encrypt/i.test(String(e && e.message))) return { error: 'encrypted' };
      return { error: 'damaged' };
    }
  }

  function header(page, fonts, title, subtitle) {
    const { rgb } = lib();
    const [w, h] = [page.getWidth(), page.getHeight()];
    page.drawRectangle({ x: 0, y: h - 120, width: w, height: 120, color: rgb(0.11, 0.25, 0.22) });
    page.drawRectangle({ x: 0, y: h - 124, width: w, height: 4, color: rgb(0.80, 0.62, 0.25) });
    page.drawText(title, { x: 50, y: h - 62, size: 22, font: fonts.bold, color: rgb(1, 1, 1) });
    if (subtitle) page.drawText(fit(subtitle, fonts.reg, 11, w - 100), { x: 50, y: h - 88, size: 11, font: fonts.reg, color: rgb(0.85, 0.92, 0.89) });
  }

  function drawCover(page, fonts, tender, docs, createdDate) {
    const { rgb } = lib();
    const ink = rgb(0.10, 0.13, 0.17), mute = rgb(0.38, 0.42, 0.47), line = rgb(0.82, 0.84, 0.86);
    const w = page.getWidth(), h = page.getHeight();
    header(page, fonts, 'Tender Submission Package', `Tender ID: ${tender.tender_id}`);

    let y = h - 165;
    const rows = [
      ['Tender ID', tender.tender_id],
      ['Tender title', tender.title],
      ['Procuring entity', tender.procuring_entity],
      ['Bidder', tender.bidder],
      ['Submission deadline', tender.submission_deadline],
      ['Package created on', createdDate]
    ];
    for (const [k, v] of rows) {
      page.drawText(k, { x: 50, y, size: 10, font: fonts.reg, color: mute });
      const lines = wrap(v || '-', fonts.bold, 11, w - 230);
      lines.forEach((ln, i) => page.drawText(ln, { x: 190, y: y - i * 14, size: 11, font: fonts.bold, color: ink }));
      y -= Math.max(1, lines.length) * 14 + 10;
    }

    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: w - 50, y }, thickness: 1, color: line });
    y -= 26;
    page.drawText('Included documents (in submission order)', { x: 50, y, size: 13, font: fonts.bold, color: ink });
    y -= 22;

    const bottom = 70;
    const rowH = Math.max(11, Math.min(20, (y - bottom) / Math.max(1, docs.length + 1)));
    const size = rowH >= 16 ? 10 : 8.5;
    page.drawText('No.', { x: 50, y, size: 9, font: fonts.bold, color: mute });
    page.drawText('Document', { x: 85, y, size: 9, font: fonts.bold, color: mute });
    page.drawText('Pages', { x: w - 95, y, size: 9, font: fonts.bold, color: mute });
    y -= rowH;
    docs.forEach((d, i) => {
      page.drawText(String(i + 1) + '.', { x: 50, y, size, font: fonts.reg, color: ink });
      page.drawText(fit(d.title, fonts.reg, size, w - 200), { x: 85, y, size, font: fonts.reg, color: ink });
      page.drawText(String(d.pages), { x: w - 95, y, size, font: fonts.reg, color: ink });
      y -= rowH;
    });
  }

  function drawIndex(page, fonts, tender, docs) {
    const { rgb } = lib();
    const ink = rgb(0.10, 0.13, 0.17), mute = rgb(0.38, 0.42, 0.47), line = rgb(0.86, 0.88, 0.90);
    const w = page.getWidth(), h = page.getHeight();
    header(page, fonts, 'Index', `${tender.tender_id} - ${tender.title}`);
    let y = h - 165;
    const rowH = Math.max(12, Math.min(24, (y - 70) / Math.max(1, docs.length + 1)));
    const size = rowH >= 18 ? 11 : 9;
    page.drawText('No.', { x: 50, y, size: 9, font: fonts.bold, color: mute });
    page.drawText('Document', { x: 85, y, size: 9, font: fonts.bold, color: mute });
    page.drawText('Pages', { x: w - 160, y, size: 9, font: fonts.bold, color: mute });
    page.drawText('Starts on page', { x: w - 115, y, size: 9, font: fonts.bold, color: mute });
    y -= rowH;
    docs.forEach((d, i) => {
      page.drawText(String(i + 1) + '.', { x: 50, y, size, font: fonts.reg, color: ink });
      page.drawText(fit(d.title, fonts.reg, size, w - 260), { x: 85, y, size, font: fonts.reg, color: ink });
      page.drawText(String(d.pages), { x: w - 160, y, size, font: fonts.reg, color: ink });
      page.drawText(String(d.start), { x: w - 115, y, size, font: fonts.bold, color: ink });
      page.drawLine({ start: { x: 50, y: y - 5 }, end: { x: w - 50, y: y - 5 }, thickness: 0.5, color: line });
      y -= rowH;
    });
  }

  // Footer on our own pages (cover/index): bottom margin is already empty
  function footerOwn(page, fonts, text) {
    const { rgb } = lib();
    const w = page.getWidth(), size = 9;
    const tw = fonts.reg.widthOfTextAtSize(text, size);
    page.drawLine({ start: { x: 50, y: 34 }, end: { x: w - 50, y: 34 }, thickness: 0.5, color: rgb(0.75, 0.77, 0.80) });
    page.drawText(text, { x: (w - tw) / 2, y: 18, size, font: fonts.reg, color: rgb(0.2, 0.22, 0.25) });
  }

  // Footer on document pages: the page is made taller with a blank strip
  // below the original content, so the footer never covers anything.
  function footerExtend(out, page, fonts, text) {
    const { rgb, degrees, pushGraphicsState, popGraphicsState } = lib();
    // isolate original content so its graphics state can't move our footer
    try {
      const ctx = out.context;
      const s = ctx.register(ctx.contentStream([pushGraphicsState()]));
      const e = ctx.register(ctx.contentStream([popGraphicsState()]));
      page.node.wrapContentStreams(s, e);
    } catch (err) { /* older content structure, continue */ }

    const cb = page.getCropBox();
    const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    const size = 9, tw = fonts.reg.widthOfTextAtSize(text, size);
    const white = rgb(1, 1, 1), grey = rgb(0.75, 0.77, 0.80), ink = rgb(0.2, 0.22, 0.25);
    let box;

    if (rot === 90) { // shown bottom = original right edge
      box = { x: cb.x, y: cb.y, width: cb.width + FOOT, height: cb.height };
      const sx = cb.x + cb.width;
      page.drawRectangle({ x: sx, y: cb.y, width: FOOT, height: cb.height, color: white });
      page.drawLine({ start: { x: sx, y: cb.y }, end: { x: sx, y: cb.y + cb.height }, thickness: 0.5, color: grey });
      page.drawText(text, { x: sx + FOOT - 10, y: cb.y + (cb.height - tw) / 2, size, font: fonts.reg, color: ink, rotate: degrees(90) });
    } else if (rot === 180) { // shown bottom = original top edge
      box = { x: cb.x, y: cb.y, width: cb.width, height: cb.height + FOOT };
      const sy = cb.y + cb.height;
      page.drawRectangle({ x: cb.x, y: sy, width: cb.width, height: FOOT, color: white });
      page.drawLine({ start: { x: cb.x, y: sy }, end: { x: cb.x + cb.width, y: sy }, thickness: 0.5, color: grey });
      page.drawText(text, { x: cb.x + (cb.width + tw) / 2, y: sy + FOOT - 10, size, font: fonts.reg, color: ink, rotate: degrees(180) });
    } else if (rot === 270) { // shown bottom = original left edge
      box = { x: cb.x - FOOT, y: cb.y, width: cb.width + FOOT, height: cb.height };
      const sx = cb.x - FOOT;
      page.drawRectangle({ x: sx, y: cb.y, width: FOOT, height: cb.height, color: white });
      page.drawLine({ start: { x: cb.x, y: cb.y }, end: { x: cb.x, y: cb.y + cb.height }, thickness: 0.5, color: grey });
      page.drawText(text, { x: sx + 10, y: cb.y + (cb.height + tw) / 2, size, font: fonts.reg, color: ink, rotate: degrees(270) });
    } else {
      box = { x: cb.x, y: cb.y - FOOT, width: cb.width, height: cb.height + FOOT };
      const sy = cb.y - FOOT;
      page.drawRectangle({ x: cb.x, y: sy, width: cb.width, height: FOOT, color: white });
      page.drawLine({ start: { x: cb.x, y: cb.y }, end: { x: cb.x + cb.width, y: cb.y }, thickness: 0.5, color: grey });
      page.drawText(text, { x: cb.x + (cb.width - tw) / 2, y: sy + 10, size, font: fonts.reg, color: ink });
    }
    page.setMediaBox(box.x, box.y, box.width, box.height);
    page.setCropBox(box.x, box.y, box.width, box.height);
    try { page.setTrimBox(box.x, box.y, box.width, box.height); page.setBleedBox(box.x, box.y, box.width, box.height); page.setArtBox(box.x, box.y, box.width, box.height); } catch (e) {}
  }

  // items: [{ title, file: { name, bytes } }] already sorted by order
  async function buildPackage({ tender, items, includeIndex, createdDate }) {
    const { PDFDocument, StandardFonts } = lib();
    const out = await PDFDocument.create();
    out.setTitle(ascii(`${tender.tender_id} - Tender Package`));
    out.setSubject(ascii(tender.title));
    out.setAuthor(ascii(tender.bidder));
    out.setCreator('Tender Package Builder');
    const fonts = {
      reg: await out.embedFont(StandardFonts.Helvetica),
      bold: await out.embedFont(StandardFonts.HelveticaBold)
    };

    const docs = [];
    for (const it of items) {
      let src;
      try { src = await PDFDocument.load(new Uint8Array(it.file.bytes)); }
      catch (e) { throw new Error(`${it.file.name}: ${e.message}`); }
      docs.push({ title: it.title, src, pages: src.getPageCount(), name: it.file.name });
    }

    const front = includeIndex ? 2 : 1;
    let p = front + 1;
    docs.forEach(d => { d.start = p; p += d.pages; });
    const total = p - 1;

    drawCover(out.addPage(A4), fonts, tender, docs, createdDate);
    if (includeIndex) drawIndex(out.addPage(A4), fonts, tender, docs);

    for (const d of docs) {
      let copied;
      try { copied = await out.copyPages(d.src, d.src.getPageIndices()); }
      catch (e) { throw new Error(`${d.name}: ${e.message}`); }
      copied.forEach(pg => out.addPage(pg));
    }

    const tid = ascii(tender.tender_id);
    out.getPages().forEach((pg, i) => {
      const text = `${tid} | Page ${i + 1} of ${total}`;
      if (i < front) footerOwn(pg, fonts, text);
      else footerExtend(out, pg, fonts, text);
    });

    const bytes = await out.save();
    return { bytes, totalPages: total };
  }

  root.PdfTools = { inspect, buildPackage };
})(typeof window !== 'undefined' ? window : globalThis);
