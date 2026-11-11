/* OpenMindstorms accounts: optional sign-in and an online program library.
 *
 * Each Workbench calls OMAccount.init({...}) once with the hooks it needs:
 *   app     'rcx' | 'nxt' | 'ev3'
 *   get()   -> { name, mode, blocks (JSON string or ''), src }   the program in the editor
 *   set(p)  load a library program into the editor (same fields)
 *   store   the app's localStorage helper { get(k, d), set(k, v) }
 *   toast   (msg, kind) the app's toast
 * and calls OMAccount.changed() whenever the program in the editor changes, and
 * OMAccount.unlink() when it replaces the program with something that is not the
 * library copy (an example, New, a file from disk).
 *
 * Everything here is optional: if /api/auth/me cannot be reached, or no sign-in
 * provider is configured on the server, nothing is shown and the page behaves as
 * it does without this script.  Program contents only leave the page when the
 * person presses Save (or autosave after a named save).
 */
(function () {
  'use strict';
  const H = { 'X-Requested-With': 'OpenMindstorms' };
  const AUTOSAVE_MS = 5000;
  let cfg = null, user = null, providers = [], cloud = null;  // cloud = {id, name, updated}
  let dirty = false, conflict = false, applying = false, timer = null, saving = false;
  let strip = null, pill = null, menu = null, dlg = null;

  const hit = (e, d, ok) => { if (window.OMStats) OMStats.hit(e, d, ok); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ago = t => { const s = Math.max(0, Math.round(Date.now() / 1000 - t)); return s < 5 ? 'just now' : s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t * 1000).toLocaleDateString(); };
  const fmtSize = n => n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';

  async function api(method, path, body, keepalive) {
    const r = await fetch(path, { method, headers: body ? Object.assign({ 'Content-Type': 'application/json' }, H) : H, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', keepalive: !!keepalive });
    if (r.status === 204) return null;
    let data = null;
    try { data = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok) { const err = new Error((data && data.error) || ('HTTP ' + r.status)); err.status = r.status; err.data = data; throw err; }
    return data;
  }

  /* ------------------------------------------------------------- cloud link */
  function loadCloud() { try { const c = JSON.parse(cfg.store.get('cloud', 'null')); cloud = c && c.id ? c : null; } catch (e) { cloud = null; } }
  function setCloud(c) { cloud = c; cfg.store.set('cloud', JSON.stringify(c)); render(); }

  function changed() {
    if (applying) return;
    dirty = true;
    render();
    if (user && cloud && !conflict) { clearTimeout(timer); timer = setTimeout(() => save(true), AUTOSAVE_MS); }
  }
  function unlink() { if (applying) return; if (cloud) setCloud(null); dirty = true; conflict = false; clearTimeout(timer); render(); }

  async function save(auto) {
    if (!user) { openMenu(); return; }
    const p = cfg.get();
    if (!cloud) {
      const name = window.prompt('Name for this program in your library:', p.name || 'Program');
      if (name == null) return;
      p.name = name.trim() || 'Program';
    }
    if (saving) { if (!auto) cfg.toast('Still saving…'); return; }
    saving = true; clearTimeout(timer); render();
    try {
      if (cloud) {
        const r = await api('PUT', '/api/programs/' + cloud.id, { app: cfg.app, name: cloud.name, mode: p.mode, blocks: p.blocks || '', src: p.src || '', updated: cloud.updated });
        setCloud({ id: cloud.id, name: cloud.name, updated: r.updated });
      } else {
        const r = await api('POST', '/api/programs', { app: cfg.app, name: p.name, mode: p.mode, blocks: p.blocks || '', src: p.src || '' });
        setCloud({ id: r.id, name: p.name, updated: r.updated });
        cfg.toast('Saved "' + p.name + '" to your library', 'good');
      }
      dirty = false; conflict = false;
      hit('save', auto ? 'auto' : 'manual');
    } catch (e) {
      if (e.status === 409) { conflict = true; cfg.toast('This program was saved elsewhere more recently. Open the library copy, or use Save as to keep this one.', 'bad', 8000); }
      else if (e.status === 401) { user = null; cfg.toast('Signed out. Sign in again to save.', 'bad'); }
      else cfg.toast('Save failed: ' + e.message, 'bad');
      hit('save', auto ? 'auto' : 'manual', false);
    }
    saving = false; render();
  }

  async function saveAs() {
    if (!user) { openMenu(); return; }
    const p = cfg.get();
    const name = window.prompt('Save a copy as:', cloud ? cloud.name + ' copy' : (p.name || 'Program'));
    if (name == null) return;
    try {
      const r = await api('POST', '/api/programs', { app: cfg.app, name: name.trim() || 'Program', mode: p.mode, blocks: p.blocks || '', src: p.src || '' });
      setCloud({ id: r.id, name: name.trim() || 'Program', updated: r.updated });
      dirty = false; conflict = false; cfg.toast('Saved "' + cloud.name + '"', 'good'); hit('save', 'as');
    } catch (e) { cfg.toast('Save failed: ' + e.message, 'bad'); }
    render();
  }

  async function openProgram(id) {
    try {
      const p = await api('GET', '/api/programs/' + id);
      applying = true;
      try { cfg.set({ name: p.name, mode: p.mode, blocks: p.blocks, src: p.src }); } finally { applying = false; }
      setCloud({ id: p.id, name: p.name, updated: p.updated });
      dirty = false; conflict = false; closeDialog(); cfg.toast('Opened "' + p.name + '"'); hit('open', 'library');
    } catch (e) { cfg.toast('Could not open: ' + e.message, 'bad'); }
  }

  /* ------------------------------------------------------------- library dialog */
  async function showLibrary() {
    if (!user) { openMenu(); return; }
    if (!dlg) {
      dlg = el('dialog', 'library-dlg');
      dlg.innerHTML = '<div class="row"><h2 style="margin-right:auto">My programs</h2><input type="search" id="libSearch" placeholder="Search" aria-label="Search programs"><button class="btn sm" id="libClose">Close</button></div><div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Name</th><th>Brick</th><th>Editor</th><th>Size</th><th>Saved</th><th></th></tr></thead><tbody id="libRows"></tbody></table></div><p class="hint" id="libEmpty" hidden>Nothing saved yet. Press Save in the Program view to add the program you are working on.</p>';
      document.body.appendChild(dlg);
      dlg.querySelector('#libClose').addEventListener('click', closeDialog);
      dlg.querySelector('#libSearch').addEventListener('input', e => { const q = e.target.value.toLowerCase(); dlg.querySelectorAll('#libRows tr').forEach(tr => { tr.hidden = q && !tr.dataset.name.includes(q); }); });
      dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });
    }
    const rows = dlg.querySelector('#libRows'); rows.innerHTML = '<tr><td colspan="6" class="muted">Loading…</td></tr>';
    dlg.showModal();
    let list;
    try { list = await api('GET', '/api/programs'); } catch (e) { rows.innerHTML = '<tr><td colspan="6" class="muted">Could not load: ' + esc(e.message) + '</td></tr>'; return; }
    rows.innerHTML = '';
    dlg.querySelector('#libEmpty').hidden = list.length > 0;
    list.forEach(p => {
      const tr = el('tr'); tr.dataset.name = p.name.toLowerCase();
      const here = p.app === cfg.app;
      tr.innerHTML = '<td><b>' + esc(p.name) + '</b>' + (cloud && cloud.id === p.id ? ' <span class="muted small">(open)</span>' : '') + '</td><td>' + p.app.toUpperCase() + '</td><td>' + esc(p.mode) + '</td><td>' + fmtSize(p.size) + '</td><td title="' + new Date(p.updated * 1000).toLocaleString() + '">' + ago(p.updated) + '</td><td class="row tight" style="justify-content:flex-end"></td>';
      const acts = tr.lastElementChild;
      if (here) {
        const b = el('button', 'btn sm primary', 'Open'); b.addEventListener('click', () => { if ((dirty && cloud && cloud.id !== p.id) || (dirty && !cloud)) { if (!window.confirm('Replace the program in the editor with "' + p.name + '"? Unsaved changes here will be lost.')) return; } openProgram(p.id); }); acts.appendChild(b);
      } else {
        const a = el('a', 'btn sm', 'Open in Open' + p.app.toUpperCase()); a.href = '../' + p.app + '/?open=' + p.id; acts.appendChild(a);
      }
      const rn = el('button', 'btn sm', 'Rename'); rn.addEventListener('click', async () => {
        const name = window.prompt('New name:', p.name); if (name == null || !name.trim()) return;
        try { const full = await api('GET', '/api/programs/' + p.id); const r = await api('PUT', '/api/programs/' + p.id, { app: full.app, name: name.trim(), mode: full.mode, blocks: full.blocks, src: full.src }); if (cloud && cloud.id === p.id) setCloud({ id: p.id, name: name.trim(), updated: r.updated }); showLibrary(); } catch (e) { cfg.toast('Rename failed: ' + e.message, 'bad'); }
      }); acts.appendChild(rn);
      const del = el('button', 'btn sm danger', 'Delete'); del.addEventListener('click', async () => {
        if (!window.confirm('Delete "' + p.name + '" from your library? This cannot be undone.')) return;
        try { await api('DELETE', '/api/programs/' + p.id); if (cloud && cloud.id === p.id) { setCloud(null); dirty = true; } showLibrary(); } catch (e) { cfg.toast('Delete failed: ' + e.message, 'bad'); }
      }); acts.appendChild(del);
      rows.appendChild(tr);
    });
  }
  function closeDialog() { if (dlg && dlg.open) dlg.close(); }

  /* ------------------------------------------------------------- top bar */
  function openMenu() {
    if (!menu) {
      menu = el('div', 'account-menu'); pill.parentNode.appendChild(menu);
      document.addEventListener('click', e => { if (menu && !menu.hidden && !menu.contains(e.target) && e.target !== pill) menu.hidden = true; });
    }
    menu.innerHTML = '';
    if (user) {
      menu.appendChild(el('div', 'who', 'Signed in as ' + user.name + (user.email ? ' (' + user.email + ')' : '') + ' via ' + user.provider));
      const lib = el('button', 'btn', 'My programs'); lib.addEventListener('click', () => { menu.hidden = true; showLibrary(); }); menu.appendChild(lib);
      const ex = el('a', 'btn', 'Export all programs (JSON)'); ex.href = '/api/auth/export'; menu.appendChild(ex);
      const out = el('button', 'btn', 'Sign out'); out.addEventListener('click', async () => { try { await api('POST', '/api/auth/logout'); } catch (e) { /* ignore */ } user = null; menu.hidden = true; render(); cfg.toast('Signed out'); }); menu.appendChild(out);
      const del = el('button', 'btn danger', 'Delete account…'); del.addEventListener('click', async () => {
        if (!window.confirm('Delete your account and every program in your library? This cannot be undone.')) return;
        if (!window.confirm('Really delete everything? Export first if you want a copy.')) return;
        try { await api('DELETE', '/api/auth/me'); user = null; setCloud(null); menu.hidden = true; render(); cfg.toast('Account deleted'); } catch (e) { cfg.toast('Delete failed: ' + e.message, 'bad'); }
      }); menu.appendChild(del);
    } else {
      menu.appendChild(el('div', 'who', 'Sign in to keep your programs online and open them from any computer.'));
      const back = location.pathname + location.search;
      const label = { google: 'Continue with Google', github: 'Continue with GitHub', dev: 'Test sign-in (development)' };
      providers.forEach(p => { const a = el('a', 'btn', label[p] || p); a.href = '/api/auth/login/' + p + '?back=' + encodeURIComponent(back); menu.appendChild(a); });
      menu.appendChild(el('div', 'who small', 'Stored: your name and e-mail from the provider, and the programs you save. No mail is ever sent. You can export or delete everything from this menu.'));
    }
    menu.hidden = false;
  }

  function render() {
    if (!pill) return;
    pill.textContent = user ? '👤 ' + user.name : 'Sign in';
    pill.title = user ? 'Account and library' : 'Sign in to save programs online';
    if (!strip) return;
    strip.innerHTML = '';
    strip.className = 'library' + (conflict ? ' conflict' : cloud ? (dirty || saving ? ' dirty' : ' saved') : '');
    if (!user) {
      strip.appendChild(el('span', 'muted', 'Sign in to keep programs online and open them from any computer.'));
      const b = el('button', 'btn sm', 'Sign in'); b.addEventListener('click', openMenu); strip.appendChild(b);
      return;
    }
    strip.appendChild(el('span', 'dot'));
    const lbl = el('span');
    if (cloud) { lbl.innerHTML = '<b>' + esc(cloud.name) + '</b> <span class="muted small">' + (conflict ? 'conflict' : saving ? 'saving…' : dirty ? 'unsaved changes' : 'saved ' + ago(cloud.updated)) + '</span>'; }
    else lbl.innerHTML = '<span class="muted">Not in your library yet</span>';
    strip.appendChild(lbl);
    const sp = el('span', 'spacer'); strip.appendChild(sp);
    const bs = el('button', 'btn sm' + (cloud ? '' : ' primary'), cloud ? 'Save' : 'Save to library'); bs.addEventListener('click', () => save(false)); strip.appendChild(bs);
    const ba = el('button', 'btn sm', 'Save as'); ba.addEventListener('click', saveAs); strip.appendChild(ba);
    const bo = el('button', 'btn sm', 'My programs'); bo.addEventListener('click', showLibrary); strip.appendChild(bo);
  }

  /* ------------------------------------------------------------- init */
  async function init(options) {
    cfg = options;
    loadCloud();
    let me;
    try { me = await api('GET', '/api/auth/me'); } catch (e) { return; }   // no service: stay invisible
    user = me.user; providers = me.providers || [];
    dirty = false;   // the draft in localStorage is what the last autosave or pagehide sent
    if (!user && !providers.length) return;
    const bar = document.querySelector('.topbar');
    const wrap = el('div', 'account'); pill = el('button', 'pill', ''); wrap.appendChild(pill); bar.appendChild(wrap);
    pill.addEventListener('click', e => { e.stopPropagation(); if (menu && !menu.hidden) menu.hidden = true; else openMenu(); });
    const hdr = document.querySelector('#view-program > header');
    if (hdr) { strip = el('div', 'library'); hdr.insertAdjacentElement('afterend', strip); }
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && strip) { e.preventDefault(); save(false); } });
    window.addEventListener('pagehide', () => { if (user && cloud && dirty && !conflict && !saving) { const p = cfg.get(); fetch('/api/programs/' + cloud.id, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ app: cfg.app, name: cloud.name, mode: p.mode, blocks: p.blocks || '', src: p.src || '', updated: cloud.updated }), credentials: 'same-origin', keepalive: true }).catch(() => {}); } });
    setInterval(() => { if (cloud && !dirty) render(); }, 30000);
    const q = new URLSearchParams(location.search);
    if (q.get('signin') === 'ok') { cfg.toast('Signed in as ' + (user ? user.name : '?'), 'good'); hit('sign_in', user ? user.provider : ''); }
    else if (q.get('signin') === 'failed') { cfg.toast('Sign-in did not complete. Try again.', 'bad'); hit('sign_in', '', false); }
    if (q.has('signin')) { q.delete('signin'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }
    render();
    if (q.get('open') && user) { await openProgram(q.get('open')); q.delete('open'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }
    else if (user && cloud) {
      // the library copy may be newer than this browser's draft (edited on another PC)
      try { const p = await api('GET', '/api/programs/' + cloud.id); if (p.updated > cloud.updated) { if (window.confirm('"' + p.name + '" was saved more recently from another computer. Load that version?')) await openProgram(p.id); else { setCloud({ id: p.id, name: p.name, updated: p.updated }); dirty = true; } } else if (p.name !== cloud.name) setCloud({ id: p.id, name: p.name, updated: p.updated }); }
      catch (e) { if (e.status === 404) setCloud(null); }
    }
  }

  window.OMAccount = { init, changed, unlink, save: () => save(false), library: showLibrary };
})();
