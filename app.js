(() => {
  'use strict';

  const MAX_FILES = 30, MAX_BYTES = 50 * 1024 * 1024;
  const STATUS = {
    OK: { cls: 'ok', block: false },
    MISSING: { cls: 'missing', block: true },
    EXPIRY_NEEDED: { cls: 'needed', block: true },
    EXPIRED: { cls: 'expired', block: true },
    NOT_PROVIDED: { cls: 'skip', block: false }
  };

  const S = {
    lang: getLS('lang') || 'en',
    tender: null, reqs: [], reqFileName: '',
    files: [],      // {id,name,size,bytes,pages,hash,error}
    matches: {},    // reqId -> fileId
    expiry: {},     // reqId -> 'YYYY-MM-DD'
    includeIndex: true
  };
  let pkgUrl = null, seq = 0;

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const t = (k, v) => window.tr(S.lang, k, v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => S.lang === 'bn' ? String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]) : String(n);
  const fmtSize = b => num(b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
  const bool = v => v === true || v === 'true' || v === 1 || v === '1';
  const uid = () => 'f' + Date.now().toString(36) + (seq++);
  const reqTitle = r => S.lang === 'bn' ? (r.title_bn || r.title_en || r.id) : (r.title_en || r.title_bn || r.id);
  const reqById = id => S.reqs.find(r => r.id === id);
  const fileById = id => S.files.find(f => f.id === id);
  const reqOfFile = fid => Object.keys(S.matches).find(k => S.matches[k] === fid);
  const pad = n => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const pkgName = () => `${String(S.tender?.tender_id || 'Tender').replace(/[\\/:*?"<>|]/g, '_')}_Package.pdf`;
  function getLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function normDate(v) {
    const s = String(v ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00'))) return s;
    const d = new Date(s);
    return isNaN(d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${esc(msg)}</span><button type="button" aria-label="Close">×</button>`;
    el.querySelector('button').onclick = () => el.remove();
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 10000 : 6000);
  }

  async function hashBytes(buf) {
    try {
      if (window.crypto && crypto.subtle) {
        const h = await crypto.subtle.digest('SHA-256', buf);
        return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {}
    const a = new Uint8Array(buf); let h = 0x811c9dc5;
    for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; }
    return 'fnv' + h.toString(16) + '-' + a.length;
  }

  const dupsOf = f => S.files.filter(x => x.id !== f.id && x.hash === f.hash);

  // ---------- status ----------
  function statusOf(r) {
    const fid = S.matches[r.id];
    if (!fid) return r.mandatory ? 'MISSING' : 'NOT_PROVIDED';
    if (r.has_expiry) {
      const d = S.expiry[r.id];
      if (!d) return 'EXPIRY_NEEDED';
      if (d < S.tender.submission_deadline) return 'EXPIRED';
    }
    return 'OK';
  }

  function blockers() {
    if (!S.reqs.length) return [t('r_loadReq')];
    const out = [];
    if (!window.PDFLib) out.push(t('r_lib'));
    S.reqs.forEach(r => {
      const st = statusOf(r);
      if (STATUS[st].block) out.push(t('r_' + st, { doc: reqTitle(r), date: S.expiry[r.id], deadline: S.tender.submission_deadline }));
    });
    return out;
  }

  // ---------- requirements ----------
  async function onReqFile(file) {
    try {
      const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      applyRequirements(data, file.name);
      toast(t('reqLoaded'), 'success');
    } catch (e) {
      toast(t('invalidJson', { msg: e.message }), 'error');
    }
  }

  function applyRequirements(data, name) {
    if (!data || typeof data !== 'object' || !data.tender || !Array.isArray(data.requirements)) throw new Error(t('jsonShape'));
    const tn = data.tender;
    const deadline = normDate(tn.submission_deadline);
    if (!deadline) throw new Error(t('badDeadline'));
    const ids = new Set();
    const reqs = data.requirements.map((r, i) => {
      let id = String(r.id ?? `R${i + 1}`).trim();
      if (ids.has(id)) id = `${id}_${i + 1}`;
      ids.add(id);
      const order = Number(r.order);
      return {
        id, order: Number.isFinite(order) ? order : 9999, _i: i,
        title_en: String(r.title_en ?? '').trim(), title_bn: String(r.title_bn ?? '').trim(),
        mandatory: bool(r.mandatory), has_expiry: bool(r.has_expiry)
      };
    }).sort((a, b) => a.order - b.order || a._i - b._i);

    S.tender = {
      tender_id: String(tn.tender_id ?? '').trim(),
      title: String(tn.title ?? '').trim(),
      procuring_entity: String(tn.procuring_entity ?? '').trim(),
      bidder: String(tn.bidder ?? '').trim(),
      submission_deadline: deadline
    };
    S.reqs = reqs; S.reqFileName = name; S.matches = {}; S.expiry = {};
    changed(true);
  }

  // ---------- files ----------
  async function addFiles(list) {
    const arr = [...list];
    if (!arr.length) return;
    let total = S.files.reduce((s, f) => s + f.size, 0);
    const hashesBefore = new Set(S.files.map(f => f.hash));
    let newDup = false;
    $('drop').classList.add('busy');

    for (const file of arr) {
      // PDF is detected by its content (%PDF- header), not by the file name
      if (S.files.length >= MAX_FILES) { toast(t('tooMany', { max: num(MAX_FILES) }), 'error'); break; }
      if (total + file.size > MAX_BYTES) { toast(t('tooBig', { name: file.name }), 'error'); continue; }

      const bytes = await file.arrayBuffer();
      const head = new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength)));
      if (!head.includes('%PDF-')) { toast(t('notPdf', { name: file.name }), 'error'); continue; }

      const f = { id: uid(), name: file.name, size: file.size, bytes, pages: 0, hash: await hashBytes(bytes), error: null };
      const info = window.PdfTools ? await PdfTools.inspect(bytes) : { error: 'nolib' };
      if (info.error === 'nolib') { toast(t('libMissing'), 'error'); }
      if (info.error === 'encrypted' || info.error === 'damaged') {
        f.error = info.error;
        toast(t(info.error, { name: f.name }), 'error');
      }
      f.pages = info.pages || 0;
      if (hashesBefore.has(f.hash) || S.files.some(x => x.hash === f.hash)) newDup = true;
      S.files.push(f); total += f.size;
    }
    $('drop').classList.remove('busy');
    if (newDup) toast(t('dupFound'), 'warn');
    changed(true);
  }

  function removeFile(fid) {
    const f = fileById(fid); if (!f) return;
    const r = reqOfFile(fid);
    if (r) { delete S.matches[r]; delete S.expiry[r]; }
    S.files = S.files.filter(x => x.id !== fid);
    toast(t('removed', { name: f.name }));
    changed(true);
  }

  function viewFile(fid) {
    const f = fileById(fid); if (!f) return;
    const url = URL.createObjectURL(new Blob([f.bytes], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- matching ----------
  function dupConflict(f, reqId) {
    for (const d of dupsOf(f)) {
      const r = reqOfFile(d.id);
      if (r && r !== reqId) return { other: d, req: reqById(r) };
    }
    return null;
  }

  function setMatch(reqId, fileId, quiet) {
    const prev = S.matches[reqId] || '';
    if (fileId === prev) return true;
    if (fileId) {
      const f = fileById(fileId);
      if (!f || f.error) return false;
      const c = dupConflict(f, reqId);
      if (c) {
        if (!quiet) toast(t('dupBlock', { name: f.name, other: c.other.name, doc: reqTitle(c.req) }), 'error');
        return false;
      }
      const from = reqOfFile(fileId);
      if (from && from !== reqId) {
        delete S.matches[from]; delete S.expiry[from];
        if (!quiet) toast(t('moved', { name: f.name, from: reqTitle(reqById(from)), to: reqTitle(reqById(reqId)) }), 'warn');
      }
      S.matches[reqId] = fileId;
    } else {
      delete S.matches[reqId];
    }
    delete S.expiry[reqId];
    if (!quiet) changed(true);
    return true;
  }

  const SYN = { licence: 'license', lic: 'license', cert: 'certificate', certificates: 'certificate', proposals: 'proposal', tin: 'tin', etin: 'tin', bin: 'vat', solvent: 'solvency', exp: 'experience', tech: 'technical', fin: 'financial' };
  const STOP = new Set(['of', 'the', 'and', 'for', 'a', 'an', 'to', 'in', 'pdf', 'copy', 'scan', 'final', 'doc', 'document']);
  const tokens = s => String(s).toLowerCase().replace(/\.pdf$/i, '').split(/[^a-z0-9]+/).filter(Boolean).map(w => SYN[w] || w).filter(w => !STOP.has(w));

  function autoMatch() {
    if (!S.reqs.length) { toast(t('r_loadReq'), 'error'); return; }
    const pairs = [];
    S.files.filter(f => !f.error && !reqOfFile(f.id)).forEach(f => {
      const ft = new Set(tokens(f.name));
      S.reqs.filter(r => !S.matches[r.id]).forEach(r => {
        const rt = [...new Set(tokens(r.title_en))];
        if (!rt.length) return;
        let score = rt.filter(w => ft.has(w)).length;
        if (ft.has(r.id.toLowerCase())) score += 3;
        const ratio = score / rt.length;
        const years = (f.name.match(/(19|20)\d{2}/g) || []).map(Number);
        const year = years.length ? Math.max(...years) : 0;
        if (score >= 2 || ratio >= 0.5) pairs.push({ f, r, score, ratio, year });
      });
    });
    pairs.sort((a, b) => b.ratio - a.ratio || b.score - a.score || b.year - a.year);
    let n = 0;
    for (const p of pairs) {
      if (S.matches[p.r.id] || reqOfFile(p.f.id)) continue;
      if (setMatch(p.r.id, p.f.id, true)) n++;
    }
    toast(n ? t('autoDone', { n: num(n) }) : t('autoNone'), n ? 'success' : 'info');
    changed(true);
  }

  // ---------- CSV ----------
  function exportCsv() {
    if (!S.reqs.length) { toast(t('r_loadReq'), 'error'); return; }
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [[t('csvOrder'), 'ID', t('csvDoc'), t('csvType'), t('csvFile'), t('csvPages'), t('csvExpiry'), t('csvStatus')]];
    S.reqs.forEach(r => {
      const f = fileById(S.matches[r.id]);
      rows.push([r.order, r.id, reqTitle(r), t(r.mandatory ? 'mandatory' : 'optional'), f ? f.name : '', f ? f.pages : '', r.has_expiry ? (S.expiry[r.id] || '') : '', t('st_' + statusOf(r))]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${String(S.tender.tender_id).replace(/[\\/:*?"<>|]/g, '_')}_Checklist.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- generate ----------
  function invalidatePackage() {
    if (pkgUrl) { URL.revokeObjectURL(pkgUrl); pkgUrl = null; }
    $('lnkDownload').classList.add('hidden');
    $('genInfo').textContent = '';
  }

  async function generate() {
    if (blockers().length) return;
    const btn = $('btnGen');
    btn.disabled = true; btn.textContent = t('generating');
    try {
      const items = S.reqs.filter(r => S.matches[r.id]).map(r => ({ title: r.title_en || r.title_bn || r.id, file: fileById(S.matches[r.id]) }));
      const res = await PdfTools.buildPackage({ tender: S.tender, items, includeIndex: S.includeIndex, createdDate: todayISO() });
      invalidatePackage();
      pkgUrl = URL.createObjectURL(new Blob([res.bytes], { type: 'application/pdf' }));
      const a = $('lnkDownload');
      a.href = pkgUrl; a.download = pkgName();
      a.textContent = t('download', { name: pkgName() });
      a.classList.remove('hidden');
      a.click();
      $('genInfo').textContent = t('generated', { name: pkgName(), pages: num(res.totalPages) });
      toast(t('generated', { name: pkgName(), pages: num(res.totalPages) }), 'success');
    } catch (e) {
      console.error(e);
      toast(t('genFail', { msg: e.message }), 'error');
    } finally {
      btn.textContent = t('generate');
      btn.disabled = blockers().length > 0;
    }
  }

  // ---------- rendering ----------
  function applyStatic() {
    document.documentElement.lang = S.lang;
    document.body.classList.toggle('bn', S.lang === 'bn');
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $('btnLang').textContent = t('langBtn');
    document.title = t('appTitle');
  }

  function renderTender() {
    const box = $('tenderBox');
    $('reqFileName').textContent = S.reqFileName || '';
    if (!S.tender) { box.innerHTML = ''; return; }
    const tn = S.tender, m = S.reqs.filter(r => r.mandatory).length;
    const field = (k, v, cls = '') => `<div class="tf ${cls}"><span>${esc(t(k))}</span><strong>${esc(v || '—')}</strong></div>`;
    box.innerHTML = `<div class="tender">
      ${field('tenderId', tn.tender_id)}${field('tenderTitle', tn.title, 'wide')}
      ${field('entity', tn.procuring_entity)}${field('bidder', tn.bidder)}
      ${field('deadline', tn.submission_deadline, 'deadline')}
    </div><p class="muted small">${esc(t('reqCount', { n: num(S.reqs.length), m: num(m), o: num(S.reqs.length - m) }))}</p>`;
  }

  function renderFiles() {
    const ul = $('fileList');
    const total = S.files.reduce((s, f) => s + f.size, 0);
    $('fileStats').textContent = S.files.length ? t('fileStats', { n: num(S.files.length), size: fmtSize(total) }) : '';
    if (!S.files.length) { ul.innerHTML = `<li class="empty">${esc(t('noFiles'))}</li>`; return; }
    ul.innerHTML = S.files.map(f => {
      const dups = dupsOf(f);
      const r = reqOfFile(f.id);
      const badges = [];
      if (f.error) badges.push(`<span class="badge bad">${esc(t(f.error === 'encrypted' ? 'errEncrypted' : 'errDamaged'))}</span>`);
      if (dups.length) badges.push(`<span class="badge dup" title="${esc(t('dupOf', { names: dups.map(d => d.name).join(', ') }))}">${esc(t('duplicate'))}</span>`);
      const use = f.error ? t('unusable') : r ? t('matchedTo', { doc: reqTitle(reqById(r)) }) : t('notMatched');
      return `<li class="file ${f.error ? 'is-bad' : ''} ${dups.length ? 'is-dup' : ''} ${r ? 'is-used' : ''}">
        <div class="file-ico" aria-hidden="true">PDF</div>
        <div class="file-body">
          <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="file-meta">${f.pages ? esc(t('pagesN', { n: num(f.pages) })) + ' · ' : ''}${esc(fmtSize(f.size))} ${badges.join(' ')}</div>
          ${dups.length ? `<div class="file-dup">${esc(t('dupOf', { names: dups.map(d => d.name).join(', ') }))}</div>` : ''}
          <div class="file-use">${esc(use)}</div>
        </div>
        <div class="file-act">
          ${f.error ? '' : `<button class="btn ghost sm" data-act="view" data-id="${f.id}">${esc(t('view'))}</button>`}
          <button class="btn ghost sm danger" data-act="remove" data-id="${f.id}">${esc(t('remove'))}</button>
        </div>
      </li>`;
    }).join('');
  }

  function renderChecklist() {
    const box = $('checklist');
    const has = S.reqs.length > 0;
    $('btnAuto').disabled = !has || !S.files.length;
    $('btnCsv').disabled = !has;
    if (!has) { box.innerHTML = `<div class="empty">${esc(t('noReq'))}</div>`; updateStatuses(); return; }

    box.innerHTML = S.reqs.map(r => {
      const fid = S.matches[r.id] || '';
      const f = fid && fileById(fid);
      const opts = [`<option value="">${esc(t('selectFile'))}</option>`].concat(S.files.map(x => {
        const used = reqOfFile(x.id);
        let label = x.name, dis = '';
        if (x.error) { label += ' — ' + t('unusable'); dis = 'disabled'; }
        else if (used && used !== r.id) label += ' — ' + t('usedFor', { doc: reqTitle(reqById(used)) });
        else if (dupConflict(x, r.id)) { label += ' — ' + t('dupLabel'); dis = 'disabled'; }
        return `<option value="${x.id}" ${x.id === fid ? 'selected' : ''} ${dis}>${esc(label)}</option>`;
      })).join('');
      const other = S.lang === 'bn' ? r.title_en : r.title_bn;

      let exp = `<span class="muted small">${esc(t('noExpiry'))}</span>`;
      if (r.has_expiry) {
        exp = f
          ? `<label class="lbl" for="exp-${esc(r.id)}">${esc(t('expiryDate'))}</label>
             <input type="date" id="exp-${esc(r.id)}" data-act="expiry" data-req="${esc(r.id)}" value="${esc(S.expiry[r.id] || '')}" max="9999-12-31">`
          : `<span class="muted small">${esc(t('expiryAfterMatch'))}</span>`;
      }

      return `<div class="req" data-req="${esc(r.id)}">
        <div class="req-order" title="Order">${num(r.order)}</div>
        <div class="req-main">
          <div class="req-title">${esc(reqTitle(r))}</div>
          ${other ? `<div class="req-alt">${esc(other)}</div>` : ''}
          <div class="req-tags"><span class="tag ${r.mandatory ? 'tag-m' : 'tag-o'}">${esc(t(r.mandatory ? 'mandatory' : 'optional'))}</span>${r.has_expiry ? `<span class="tag tag-e">${esc(t('hasExpiry'))}</span>` : ''}<span class="req-id">${esc(r.id)}</span></div>
        </div>
        <div class="req-file">
          <label class="lbl" for="sel-${esc(r.id)}">${esc(t('matchedFile'))}</label>
          <div class="sel-row">
            <select id="sel-${esc(r.id)}" data-act="match" data-req="${esc(r.id)}">${opts}</select>
            ${f ? `<button class="icon-btn" data-act="unmatch" data-req="${esc(r.id)}" title="${esc(t('undoMatch'))}" aria-label="${esc(t('undoMatch'))}">✕</button>` : ''}
          </div>
          ${f ? `<div class="small muted">${esc(t('pagesN', { n: num(f.pages) }))}</div>` : ''}
        </div>
        <div class="req-exp">${exp}</div>
        <div class="req-status" data-status-for="${esc(r.id)}"></div>
      </div>`;
    }).join('');
    updateStatuses();
  }

  function updateStatuses() {
    const counts = { OK: 0, MISSING: 0, EXPIRY_NEEDED: 0, EXPIRED: 0, NOT_PROVIDED: 0 };
    S.reqs.forEach(r => {
      const st = statusOf(r); counts[st]++;
      const el = document.querySelector(`[data-status-for="${CSS.escape(r.id)}"]`);
      if (el) {
        el.innerHTML = `<span class="pill ${STATUS[st].cls}">${esc(t('st_' + st))}</span>
          <span class="hint">${esc(t('hint_' + st, { date: S.expiry[r.id], deadline: S.tender.submission_deadline }))}</span>`;
        el.closest('.req').dataset.st = STATUS[st].cls;
      }
    });

    const sum = $('summary');
    if (S.reqs.length) {
      const ready = counts.OK + counts.NOT_PROVIDED, all = S.reqs.length;
      sum.innerHTML = `<div class="progress"><div class="bar" style="width:${Math.round(ready / all * 100)}%"></div></div>
        <div class="progress-label">${esc(t('readyCount', { a: num(ready), b: num(all) }))}</div>
        <div class="chips">${Object.keys(counts).map(k => `<span class="chip ${STATUS[k].cls} ${counts[k] ? '' : 'zero'}">${esc(t('st_' + k))} <b>${num(counts[k])}</b></span>`).join('')}</div>`;
    } else sum.innerHTML = '';

    const bl = blockers();
    const btn = $('btnGen');
    if (btn.textContent !== t('generating')) btn.disabled = bl.length > 0;
    $('blockers').innerHTML = bl.length
      ? `<div class="notice block"><strong>${esc(t('blockedTitle'))}</strong><ul>${bl.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>`
      : `<div class="notice ready">${esc(t('readyMsg'))}</div>`;
  }

  function renderAll() {
    applyStatic();
    renderTender();
    renderFiles();
    renderChecklist();
    $('chkIndex').checked = S.includeIndex;
  }

  function changed(full) {
    invalidatePackage();
    if (full) renderAll(); else updateStatuses();
    scheduleSave();
  }

  // ---------- save / restore (IndexedDB, stays in this browser) ----------
  const DB = {
    open() {
      return new Promise((res, rej) => {
        const q = indexedDB.open('tender-package-builder', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('kv');
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', mode), st = tx.objectStore('kv');
        const req = fn(st);
        tx.oncomplete = () => { db.close(); res(req && req.result); };
        tx.onerror = () => { db.close(); rej(tx.error); };
      });
    },
    put(k, v) { return this.run('readwrite', s => s.put(v, k)); },
    get(k) { return this.run('readonly', s => s.get(k)); },
    del(k) { return this.run('readwrite', s => s.delete(k)); }
  };
  let saveTimer;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      DB.put('project', {
        v: 1, tender: S.tender, reqs: S.reqs, reqFileName: S.reqFileName,
        files: S.files, matches: S.matches, expiry: S.expiry, includeIndex: S.includeIndex
      }).catch(e => console.warn('save failed', e));
    }, 400);
  }
  async function restore() {
    try {
      const p = await DB.get('project');
      if (p && p.v === 1 && ((p.reqs && p.reqs.length) || (p.files && p.files.length))) {
        Object.assign(S, {
          tender: p.tender, reqs: p.reqs || [], reqFileName: p.reqFileName || '',
          files: p.files || [], matches: p.matches || {}, expiry: p.expiry || {},
          includeIndex: p.includeIndex !== false
        });
        renderAll();
        toast(t('restored'), 'success');
      }
    } catch (e) { console.warn('restore failed', e); }
  }
  async function resetAll() {
    if (!confirm(t('confirmReset'))) return;
    Object.assign(S, { tender: null, reqs: [], reqFileName: '', files: [], matches: {}, expiry: {}, includeIndex: true });
    try { await DB.del('project'); } catch (e) {}
    changed(true);
  }

  // ---------- events ----------
  function bind() {
    $('btnLang').onclick = () => { S.lang = S.lang === 'en' ? 'bn' : 'en'; setLS('lang', S.lang); renderAll(); };
    $('btnReset').onclick = resetAll;
    $('inpReq').onchange = e => { const f = e.target.files[0]; if (f) onReqFile(f); e.target.value = ''; };

    const drop = $('drop'), inp = $('inpPdf');
    drop.onclick = () => inp.click();
    drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    $('fileList').onclick = e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      if (b.dataset.act === 'remove') removeFile(b.dataset.id);
      if (b.dataset.act === 'view') viewFile(b.dataset.id);
    };

    const cl = $('checklist');
    cl.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.act === 'match') {
        if (!setMatch(el.dataset.req, el.value)) el.value = S.matches[el.dataset.req] || '';
      } else if (el.dataset.act === 'expiry') {
        const v = normDate(el.value);
        if (v) S.expiry[el.dataset.req] = v; else delete S.expiry[el.dataset.req];
        changed(false);
      }
    });
    cl.addEventListener('click', e => {
      const b = e.target.closest('button[data-act="unmatch"]');
      if (b) setMatch(b.dataset.req, '');
    });

    $('btnAuto').onclick = autoMatch;
    $('btnCsv').onclick = exportCsv;
    $('btnGen').onclick = generate;
    $('chkIndex').onchange = e => { S.includeIndex = e.target.checked; changed(false); };
  }

  bind();
  renderAll();
  restore();
})();
