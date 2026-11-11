/* OpenRCX Workbench - UI wiring. */
(function () {
  'use strict';
  const P = OpenRCX.protocol, T = OpenRCX.transports, L = OpenRCX.link, S = OpenRCX.sim;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let transport = null, link = null, rcx = null, simT = null;
  let compiled = null, compiledBytes = null, fwImage = null, dlRows = [];
  let pollTimer = null, packetCount = 0, hasFirmware = false;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('openrcx.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('openrcx.' + k, v); } catch (e) { /* private mode */ } },
  };

  /* ------------------------------------------------------------- views */
  const VIEWS = ['connect', 'program', 'control', 'firmware', 'datalog', 'console'];
  function showView(name) {
    if (!VIEWS.includes(name)) name = 'connect';
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.rail button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    store.set('view', name);
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'program' && typeof Blockly !== 'undefined' && bws && editorMode === 'blocks') setTimeout(() => Blockly.svgResize(bws), 0);
  }
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (VIEWS.includes(h)) showView(h); });
  document.querySelectorAll('.rail button[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key >= '1' && e.key <= '6') showView(VIEWS[e.key - 1]);
  });

  /* ------------------------------------------------------------- toasts */
  function toast(msg, kind, ms) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms || (kind === 'bad' ? 6000 : 3000));
  }

  /* ------------------------------------------------------------- console */
  const con = $('con');
  function conLine(cls, text) {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    con.appendChild(d);
    while (con.childElementCount > 1500) con.removeChild(con.firstChild);
    if ($('conAuto').checked) con.scrollTop = con.scrollHeight;
  }
  const stamp = () => new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0');
  function logPacket(dir, bytes, note) {
    packetCount++;
    $('conStats').textContent = packetCount + ' packets' + (link ? ', ' + link.stats.retries + ' retries, ' + link.stats.failed + ' failed' : '');
    conLine(dir, stamp() + ' ' + dir.toUpperCase() + ' ' + P.hex(bytes) + (note ? '   ; ' + note : ''));
  }
  const logNote = (t, cls) => conLine(cls || 'note', stamp() + ' -- ' + t);
  $('btnConClear').addEventListener('click', () => { con.textContent = ''; });
  $('btnConCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(con.innerText).then(() => toast('Console copied'), () => toast('Copy blocked by the browser', 'bad'));
  });

  /* ------------------------------------------------------------- link state */
  function setLink(state, text) {
    const pill = $('pillLink');
    pill.className = 'pill ' + state;
    if (text) $('linkText').textContent = text;
  }

  function errorText(e) {
    if (e && e.name === 'NoReply') return 'No reply from the RCX (' + e.message.replace('no reply to ', '') + '). Is it switched on, facing the tower within ~50 cm, and out of bright light?';
    if (e && e.name === 'NotFoundError') return 'No port chosen.';
    return (e && e.message) || String(e);
  }

  async function run(label, fn) {
    if (!rcx) { toast('Connect to the brick first.', 'bad'); showView('connect'); return false; }
    if (link.busy) { toast('The link is busy, wait a moment.'); return false; }
    setLink('busy', label || 'Working…');
    try { await fn(); setLink('on', transport.name); return true; }
    catch (e) { logNote(label + ': ' + errorText(e), 'err'); toast(errorText(e), 'bad'); setLink('on', transport.name); return false; }
  }

  /* ------------------------------------------------------------- connect */
  function towerKind() { return document.querySelector('input[name=tower]:checked').value; }
  document.querySelectorAll('input[name=tower]').forEach(r => r.addEventListener('change', () => {
    $('usbRangeWrap').hidden = towerKind() !== 'usb';
    store.set('tower', towerKind());
  }));

  async function connect() {
    const kind = towerKind();
    try {
      if (kind === 'sim') { simT = new S.SimTransport({ firmware: true }); transport = simT; }
      else if (kind === 'usb') transport = new T.UsbTowerTransport($('usbRange').value);
      else transport = new T.SerialTransport(kind);
      setLink('busy', 'Opening…');
      await transport.open();
    } catch (e) {
      transport = null; setLink('off', 'Not connected');
      if (e && e.name === 'NotFoundError') { toast('No port chosen.'); return; }
      toast('Could not open the tower: ' + errorText(e), 'bad');
      return;
    }
    link = new L.RcxLink(transport, { log: logPacket });
    rcx = new L.RCX(link);
    document.body.classList.remove('disconnected');
    document.body.classList.toggle('sim', kind === 'sim');
    $('btnRefresh').hidden = false; $('btnDisconnect').hidden = false; $('btnConnect').disabled = true;
    $('infoLink').textContent = transport.name + ' (' + (transport.portLabel || 'port') + ')';
    logNote('connected: ' + transport.name);
    setLink('on', transport.name);
    const ok = await run('Reading brick', refreshInfo);
    if (ok) toast('Connected to ' + transport.name, 'good');
  }

  async function refreshInfo() {
    await rcx.ping();
    const v = await rcx.versions();
    hasFirmware = v.hasFirmware;
    $('infoRom').textContent = v.romText + ' (' + v.raw.split('/')[0] + ')';
    $('infoFw').textContent = v.hasFirmware ? v.firmwareText + ' (' + v.raw.split('/')[1] + ')' : 'none - load firmware first';
    $('romText').textContent = v.romText; $('fwText').textContent = v.firmwareText;
    $('pillFw').hidden = false;
    if (v.hasFirmware) {
      // Battery, program slot and memory map are firmware commands; the bare
      // ROM answers them with a stale reply, so only ask once firmware is in.
      const mv = await rcx.batteryMv();
      $('infoBatt').textContent = (mv / 1000).toFixed(2) + ' V' + (mv < 7000 ? '  (low)' : '');
      $('battText').textContent = (mv / 1000).toFixed(2) + ' V';
      $('pillBatt').hidden = false;
      $('infoProg').textContent = String((await rcx.currentProgram()) + 1);
      const m = await rcx.memoryMap();
      $('infoMem').textContent = (m[93] - m[92]) + ' bytes';
    } else {
      $('infoBatt').textContent = 'needs firmware'; $('pillBatt').hidden = true;
      $('infoProg').textContent = '-'; $('infoMem').textContent = '-';
      toast('Connected. The brick has no firmware yet: open the Firmware section and install it.', 'bad', 9000);
    }
    $('infoStats').textContent = link.stats.sent + ' sent, ' + link.stats.retries + ' retries, ' + link.stats.failed + ' failed';
  }

  async function disconnect() {
    stopPolling();
    if (transport) { try { await transport.close(); } catch (e) { /* ignore */ } }
    transport = link = rcx = simT = null;
    document.body.classList.add('disconnected'); document.body.classList.remove('sim');
    $('btnRefresh').hidden = true; $('btnDisconnect').hidden = true; $('btnConnect').disabled = false;
    $('pillFw').hidden = true; $('pillBatt').hidden = true;
    ['infoLink', 'infoRom', 'infoFw', 'infoBatt', 'infoProg', 'infoMem', 'infoStats'].forEach(id => { $(id).textContent = '-'; });
    setLink('off', 'Not connected');
    logNote('disconnected');
  }
  $('btnConnect').addEventListener('click', connect);
  $('btnDisconnect').addEventListener('click', disconnect);
  $('btnRefresh').addEventListener('click', () => run('Reading brick', refreshInfo));
  $('btnPing').addEventListener('click', () => run('Ping', async () => { const t0 = performance.now(); await rcx.ping(); toast('Alive, ' + Math.round(performance.now() - t0) + ' ms round trip', 'good'); }));
  $('btnBeep').addEventListener('click', () => run('Beep', () => rcx.playSound(1)));
  $('btnSelfTest').addEventListener('click', () => run('Self test', async () => {
    await rcx.playSound(3);
    for (const d of [1, 2, 3, 4, 5, 6, 0]) { await rcx.setDisplay(d); await sleep(250); }
    await refreshInfo();
    await rcx.playSound(5);
    toast('Self test finished: ' + link.stats.sent + ' packets, ' + link.stats.retries + ' retries', 'good');
  }));

  // simulator sensor sliders
  [1, 2, 3].forEach(n => $('simS' + n).addEventListener('input', e => {
    $('simS' + n + 'v').textContent = e.target.value;
    if (simT) simT.rcx.sensorValues[n - 1] = Number(e.target.value);
  }));

  /* ------------------------------------------------------------- program: editor */
  const src = $('src'), gutter = $('gutter');
  let errLine = null;
  function renderGutter() {
    const n = src.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= n; i++) html += (i === errLine ? '<span class="err">' + i + '</span>' : i) + '\n';
    gutter.innerHTML = html;
    gutter.scrollTop = src.scrollTop;
  }
  src.addEventListener('input', () => { errLine = null; renderGutter(); store.set('src', src.value); });
  src.addEventListener('scroll', () => { gutter.scrollTop = src.scrollTop; });
  src.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const s = src.selectionStart; src.setRangeText('    ', s, src.selectionEnd, 'end'); src.dispatchEvent(new Event('input')); }
  });
  OpenRCX.examples.forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; $('exampleSel').appendChild(o); });
  $('exampleSel').addEventListener('change', e => {
    if (e.target.value === '') return;
    src.value = OpenRCX.examples[e.target.value].source;
    src.dispatchEvent(new Event('input'));
    e.target.value = '';
  });
  $('btnOpenSrc').addEventListener('click', () => $('fileSrc').click());
  $('fileSrc').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    src.value = await f.text(); src.dispatchEvent(new Event('input'));
    toast('Opened ' + f.name); e.target.value = '';
  });
  function saveBlob(name, data, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('btnSaveSrc').addEventListener('click', () => saveBlob('program.nqc', src.value, 'text/plain'));

  /* ------------------------------------------------------------- program: API reference */
  function insertSnippet(text) {
    const s = src.selectionStart, e = src.selectionEnd;
    // statements go on their own line at the current indentation
    let snippet = text;
    if (text.endsWith('\n')) {
      const lineStart = src.value.lastIndexOf('\n', s - 1) + 1;
      const indent = (/^[ \t]*/.exec(src.value.slice(lineStart, s)) || [''])[0];
      const atLineStart = src.value.slice(lineStart, s).trim() === '';
      snippet = text.replace(/\n(?=.)/g, '\n' + indent);
      if (!atLineStart) snippet = '\n' + indent + snippet;
      snippet = snippet.replace(/\n$/, '\n' + indent);
    }
    src.setRangeText(snippet, s, e, 'end');
    // put the caret inside the first empty body line, if the snippet has one
    const bodyAt = snippet.indexOf('{\n');
    if (bodyAt >= 0) {
      const nl = snippet.indexOf('\n', bodyAt + 2);
      src.selectionStart = src.selectionEnd = s + (nl >= 0 ? nl : bodyAt + 2);
    }
    src.dispatchEvent(new Event('input'));
    src.focus();
  }
  function renderApi(filter) {
    const list = $('apiList');
    list.innerHTML = '';
    const q = (filter || '').trim().toLowerCase();
    let group = null, shown = 0;
    OpenRCX.nqcApi.forEach(item => {
      if (q && !(item.n + ' ' + item.s + ' ' + item.d + ' ' + item.g).toLowerCase().includes(q)) return;
      if (item.g !== group) { group = item.g; const h = document.createElement('h4'); h.textContent = group; list.appendChild(h); }
      const b = document.createElement('button');
      b.type = 'button';
      b.title = 'Insert at the cursor';
      b.innerHTML = '<b></b><span></span>';
      b.firstChild.textContent = item.s;
      b.lastChild.textContent = item.d;
      b.addEventListener('click', () => insertSnippet(item.i));
      list.appendChild(b);
      shown++;
    });
    if (!shown) { const d = document.createElement('div'); d.className = 'none'; d.textContent = 'Nothing matches "' + filter + '".'; list.appendChild(d); }
  }
  $('apiSearch').addEventListener('input', e => renderApi(e.target.value));
  renderApi('');

  /* ------------------------------------------------------------- program: compile */
  const out = $('compileOut');
  function setOut(lines) { out.innerHTML = ''; lines.forEach(([cls, t]) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = t + '\n'; out.appendChild(s); }); }
  function setCompiled(img, bytes, origin) {
    compiled = img; compiledBytes = bytes;
    $('imgSummary').textContent = P.describeImage(img) + (origin ? ' - ' + origin : '');
    $('btnDownload').disabled = false; $('btnSaveRcx').disabled = false;
  }
  async function compile(sourceText) {
    const fromBlocks = typeof sourceText === 'string';
    const text = fromBlocks ? sourceText : src.value;
    if (typeof createWebNqc !== 'function') { setOut([['e', 'WebNQC is not loaded (vendor/webnqc/nqc.js missing).']]); return false; }
    const lines = [], errs = [];
    errLine = null;
    $('btnCompile').disabled = true;
    try {
      const nqc = await createWebNqc({ noInitialRun: true, print: t => lines.push(['', t]), printErr: t => { lines.push(['e', t]); errs.push(t); } });
      nqc.FS.writeFile('input.nqc', text + '\n');
      let rv;
      try { rv = nqc.callMain(['-Trcx2', '-Ooutput.rcx', 'input.nqc']); }
      catch (e) { rv = (e && e.name === 'ExitStatus') ? e.status : -1; if (rv === -1) lines.push(['e', 'compiler crashed: ' + e.message]); }
      if (rv === 0) {
        const bytes = nqc.FS.readFile('output.rcx');
        const img = P.parseRcx(bytes);
        setCompiled(img, bytes, fromBlocks ? 'compiled from blocks' : 'compiled just now');
        lines.push(['ok', 'Compiled: ' + P.describeImage(img)]);
        setOut(lines); renderGutter();
        if (fromBlocks) toast('Blocks compiled: ' + img.size + ' bytes', 'good');
        return true;
      }
      for (const t of errs) { const m = /line (\d+)/.exec(t); if (m) { errLine = Number(m[1]); break; } }
      lines.push(['e', 'Compilation failed' + (errLine ? ' - first error on line ' + errLine : '') + '.']);
      setOut(lines); renderGutter();
      if (fromBlocks) { errLine = null; toast('The generated NQC did not compile; see Compiler output below the blocks.', 'bad'); return false; }
      if (errLine) {
        const pre = src.value.split('\n').slice(0, errLine - 1).join('\n').length + (errLine > 1 ? 1 : 0);
        const lineLen = (src.value.split('\n')[errLine - 1] || '').length;
        src.focus(); src.setSelectionRange(pre, pre + lineLen);
      }
      return false;
    } catch (e) {
      setOut([['e', 'Compiler error: ' + (e.message || e)]]);
      return false;
    } finally { $('btnCompile').disabled = false; }
  }
  $('btnCompile').addEventListener('click', compile);
  $('btnOpenRcx').addEventListener('click', () => $('fileRcx').click());
  $('fileRcx').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const bytes = new Uint8Array(await f.arrayBuffer()); setCompiled(P.parseRcx(bytes), bytes, f.name); setOut([['ok', 'Loaded ' + f.name + ': ' + P.describeImage(compiled)]]); }
    catch (err) { setOut([['e', f.name + ': ' + err.message]]); }
    e.target.value = '';
  });
  $('btnSaveRcx').addEventListener('click', () => compiledBytes && saveBlob('program.rcx', compiledBytes));

  function progressUI(barId, textId, label) {
    const t0 = Date.now();
    return (done, total) => {
      const pct = Math.round(100 * done / Math.max(1, total));
      $(barId).style.width = pct + '%';
      const el = Date.now() - t0, rate = done / Math.max(el, 1) * 1000, eta = rate ? (total - done) / rate : 0;
      $(textId).textContent = label + ' ' + pct + '%  ' + done + '/' + total + ' B' + (done < total ? '  ETA ' + Math.ceil(eta) + ' s' : '  done in ' + (el / 1000).toFixed(1) + ' s');
    };
  }
  async function downloadProgram() {
    if (!compiled) { if (!(await compile())) return; }
    const slot = Number($('slotSel').value);
    store.set('slot', slot);
    $('progProgram').style.width = '0%';
    await run('Downloading program', async () => {
      await rcx.downloadProgram(compiled, slot, progressUI('progProgram', 'progProgramText', 'slot ' + (slot + 1)));
      toast('Program downloaded to slot ' + (slot + 1), 'good');
      $('infoProg').textContent = String(slot + 1);
    });
  }
  $('btnDownload').addEventListener('click', downloadProgram);
  $('btnRun').addEventListener('click', () => run('Run', async () => { await rcx.selectProgram(Number($('slotSel').value)); await rcx.startTask(0); }));
  $('btnStopProg').addEventListener('click', () => run('Stop', async () => { await rcx.stopAll(); await rcx.motorOff('ABC'); }));
  $('slotSel').addEventListener('change', e => { store.set('slot', e.target.value); $('slotSelBlocks').value = e.target.value; });

  /* ------------------------------------------------------------- program: blocks */
  const Bk = OpenRCX.blocks;
  let bws = null;                           // Blockly workspace, created on first use
  let editorMode = 'text';
  function blocksCode() { return bws ? Bk.generate(bws) : ''; }
  function refreshGenerated() {
    if (!bws) return;
    try { $('genCode').textContent = blocksCode(); } catch (e) { $('genCode').textContent = '// ' + e.message; }
  }
  function saveBlocksState() {
    if (!bws) return;
    try { store.set('blocks', JSON.stringify(Blockly.serialization.workspaces.save(bws))); } catch (e) { /* ignore */ }
  }
  function loadBlocks(json) {
    if (!bws) return;
    bws.clear();
    Blockly.serialization.workspaces.load(json, bws);
    refreshGenerated(); saveBlocksState();
  }
  function ensureBlockly() {
    if (bws || !Bk) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
    bws = Blockly.inject('blocklyDiv', {
      toolbox: Bk.toolbox, renderer: 'zelos', theme: Bk.themeFor(dark), trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 1.5, minScale: 0.4 },
      grid: { spacing: 24, length: 3, colour: dark ? '#2e3742' : '#d5dae2', snap: true },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    let saved = null;
    try { saved = JSON.parse(store.get('blocks', 'null')); } catch (e) { saved = null; }
    try { Blockly.serialization.workspaces.load(saved && saved.blocks ? saved : Bk.starter, bws); }
    catch (e) { bws.clear(); Blockly.serialization.workspaces.load(Bk.starter, bws); }
    bws.addChangeListener(ev => { if (ev.isUiEvent) return; refreshGenerated(); saveBlocksState(); });
    refreshGenerated();
    Bk.examples.forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; $('blockExampleSel').appendChild(o); });
  }
  function setEditorMode(mode) {
    if (mode === 'blocks' && !Bk) { toast('Blockly did not load (vendor/blockly/blockly.min.js missing).', 'bad'); mode = 'text'; }
    editorMode = mode;
    document.querySelectorAll('.mode-blocks').forEach(el => { el.hidden = mode !== 'blocks'; });
    document.querySelectorAll('.mode-text').forEach(el => { el.hidden = mode !== 'text'; });
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    store.set('mode', mode);
    if (mode === 'blocks') { ensureBlockly(); setTimeout(() => bws && Blockly.svgResize(bws), 0); }
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => setEditorMode(b.dataset.mode)));
  window.addEventListener('resize', () => { if (bws && editorMode === 'blocks') Blockly.svgResize(bws); });
  $('blockExampleSel').addEventListener('change', e => { if (e.target.value === '') return; loadBlocks(Bk.examples[e.target.value].json); e.target.value = ''; });
  $('btnBlocksNew').addEventListener('click', () => loadBlocks({ blocks: { languageVersion: 0, blocks: [{ type: 'rcx_program', x: 40, y: 40 }] } }));
  $('btnOpenBlocks').addEventListener('click', () => $('fileBlocks').click());
  $('fileBlocks').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { loadBlocks(JSON.parse(await f.text())); toast('Opened ' + f.name); } catch (err) { toast(f.name + ': not a blocks file (' + err.message + ')', 'bad'); }
    e.target.value = '';
  });
  $('btnSaveBlocks').addEventListener('click', () => bws && saveBlob('program.rcxblocks.json', JSON.stringify(Blockly.serialization.workspaces.save(bws), null, 1), 'application/json'));
  $('btnBlocksToText').addEventListener('click', () => { src.value = blocksCode(); src.dispatchEvent(new Event('input')); setEditorMode('text'); toast('Generated NQC copied to the text editor'); });
  $('btnCompileBlocks').addEventListener('click', () => { refreshGenerated(); $('genDetails').open = true; return compile(blocksCode()); });
  $('slotSelBlocks').addEventListener('change', e => { store.set('slot', e.target.value); $('slotSel').value = e.target.value; });
  $('btnDownloadBlocks').addEventListener('click', async () => {
    refreshGenerated();
    if (!(await compile(blocksCode()))) return;
    $('slotSel').value = $('slotSelBlocks').value;
    await downloadProgram();
  });
  $('btnRunBlocks').addEventListener('click', () => run('Run', async () => { await rcx.selectProgram(Number($('slotSelBlocks').value)); await rcx.startTask(0); }));
  $('btnStopBlocks').addEventListener('click', () => run('Stop', async () => { await rcx.stopAll(); await rcx.motorOff('ABC'); }));

  /* ------------------------------------------------------------- control: motors */
  async function refreshMotor(card) {
    const idx = 'ABC'.indexOf(card.dataset.motor);
    const s = await rcx.getValue(P.SRC.MOTOR_STATUS, idx);
    const mode = s & 0x80 ? 'on' : (s & 0x40 ? 'off' : 'float');
    // bit 3 set = forward (measured on a real RCX 2.0; Kekoa's notes have it inverted)
    card.querySelector('[data-state]').textContent = mode + ' · power ' + (s & 7) + ' · ' + (s & 8 ? 'fwd' : 'rev');
  }
  document.querySelectorAll('.motor').forEach(card => {
    const m = card.dataset.motor;
    card.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dir) run('Motor ' + m, async () => { await rcx.motorDirection(m, b.dataset.dir); await refreshMotor(card); });
      else if (b.dataset.m) run('Motor ' + m, async () => { await rcx['motor' + b.dataset.m[0].toUpperCase() + b.dataset.m.slice(1)](m); await refreshMotor(card); });
    });
    const pw = card.querySelector('[data-power]');
    pw.addEventListener('input', () => { card.querySelector('[data-pv]').textContent = pw.value; });
    pw.addEventListener('change', () => run('Motor ' + m, async () => { await rcx.motorPower(m, Number(pw.value)); await refreshMotor(card); }));
  });
  $('btnAllOff').addEventListener('click', () => run('Motors off', async () => { await rcx.motorOff('ABC'); for (const c of document.querySelectorAll('.motor')) await refreshMotor(c); }));
  $('btnAllFloat').addEventListener('click', () => run('Motors float', async () => { await rcx.motorFloat('ABC'); for (const c of document.querySelectorAll('.motor')) await refreshMotor(c); }));

  /* ------------------------------------------------------------- control: sensors */
  const DEFAULT_MODE = { none: 'raw', touch: 'bool', light: 'percent', rotation: 'rotation', temperature: 'celsius' };
  document.querySelectorAll('.sensor').forEach(card => {
    const idx = Number(card.dataset.sensor);
    card.querySelector('[data-apply]').addEventListener('click', () => run('Sensor ' + (idx + 1), async () => {
      const type = card.querySelector('[data-type]').value;
      const mode = card.querySelector('[data-mode]').value || DEFAULT_MODE[type];
      await rcx.setSensorType(idx, P.SENSOR_TYPES[type]);
      await rcx.setSensorMode(idx, P.SENSOR_MODES[mode]);
      card.querySelector('[data-lcd]').innerHTML = '<small>' + type.toUpperCase() + ' / ' + mode.toUpperCase() + '</small>' + await rcx.sensorValue(idx);
    }));
    card.querySelector('[data-clear]').addEventListener('click', () => run('Sensor ' + (idx + 1), () => rcx.clearSensor(idx)));
  });
  async function readSensors() {
    for (const card of document.querySelectorAll('.sensor')) {
      const idx = Number(card.dataset.sensor);
      const v = await rcx.sensorValue(idx);
      const lcd = card.querySelector('[data-lcd]');
      const label = lcd.querySelector('small') ? lcd.querySelector('small').outerHTML : '<small>VALUE</small>';
      lcd.innerHTML = label + v;
    }
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } $('pollSensors').checked = false; }
  $('pollSensors').addEventListener('change', e => {
    if (!e.target.checked) { stopPolling(); return; }
    if (!rcx) { toast('Connect first.', 'bad'); e.target.checked = false; return; }
    const tick = async () => { if (!rcx || link.busy) return; try { setLink('busy', 'Polling sensors'); await readSensors(); setLink('on', transport.name); } catch (err) { setLink('on', transport.name); } };
    tick();
    pollTimer = setInterval(tick, Number($('pollInterval').value));
  });
  $('pollInterval').addEventListener('change', () => { if (pollTimer) { $('pollSensors').checked = false; stopPolling(); $('pollSensors').click(); } });
  $('btnReadOnce').addEventListener('click', () => run('Read sensors', readSensors));

  /* ------------------------------------------------------------- control: misc */
  P.SOUNDS.forEach((name, i) => {
    const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = name;
    b.addEventListener('click', () => run('Sound', () => rcx.playSound(i)));
    $('soundBtns').appendChild(b);
  });
  $('btnTone').addEventListener('click', () => run('Tone', () => rcx.playTone(Number($('toneHz').value), Math.round(Number($('toneMs').value) / 10))));
  $('btnSelectSlot').addEventListener('click', () => run('Select slot', async () => { await rcx.selectProgram(Number($('ctlSlot').value)); $('infoProg').textContent = String(Number($('ctlSlot').value) + 1); }));
  $('btnCtlRun').addEventListener('click', () => run('Run', async () => { await rcx.selectProgram(Number($('ctlSlot').value)); await rcx.startTask(0); }));
  $('btnCtlStop').addEventListener('click', () => run('Stop', async () => { await rcx.stopAll(); await rcx.motorOff('ABC'); }));
  $('btnDisp').addEventListener('click', () => run('Display', () => rcx.setDisplay(Number($('dispSel').value))));
  $('btnClock').addEventListener('click', () => run('Clock', async () => { const d = new Date(); await rcx.setTime(d.getHours(), d.getMinutes()); toast('Clock set to ' + d.toTimeString().slice(0, 5), 'good'); }));
  $('btnRangeNear').addEventListener('click', () => run('IR range', () => rcx.setTxRange(false)));
  $('btnRangeFar').addEventListener('click', () => run('IR range', () => rcx.setTxRange(true)));
  $('btnVarSet').addEventListener('click', () => run('Variable', async () => { await rcx.setVariable(Number($('varIdx').value), Number($('varVal').value)); toast('var ' + $('varIdx').value + ' = ' + (await rcx.variable(Number($('varIdx').value)))); }));
  $('btnVarGet').addEventListener('click', () => run('Variable', async () => { const v = await rcx.variable(Number($('varIdx').value)); $('varVal').value = v; toast('var ' + $('varIdx').value + ' = ' + v); }));
  $('btnMsgSend').addEventListener('click', () => run('Message', async () => { await rcx.setMessage(Number($('msgVal').value)); $('msgOut').textContent = 'sent ' + $('msgVal').value; }));
  $('btnMsgRead').addEventListener('click', () => run('Message', async () => { $('msgOut').textContent = 'message = ' + await rcx.message(); }));
  $('btnSleep').addEventListener('click', () => run('Power-off delay', () => rcx.setPowerDownDelay(Number($('sleepMin').value))));
  $('btnOff').addEventListener('click', () => run('Power off', async () => { await rcx.powerOff(); toast('Brick switched off'); }));

  /* ------------------------------------------------------------- firmware */
  const fwSel = $('fwSel');
  Object.keys(OpenRCX.firmwareImages).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = OpenRCX.firmwareImages[k].label; fwSel.appendChild(o); });
  function showFirmware(img, name) {
    fwImage = img;
    $('fwFileName').textContent = name || '';
    $('fwTitle').textContent = img.title || '-';
    $('fwSize').textContent = img.data.length + ' bytes';
    $('fwStart').textContent = '0x' + img.start.toString(16).toUpperCase().padStart(4, '0');
    $('fwCk').textContent = '0x' + img.checksum.toString(16).toUpperCase().padStart(4, '0');
  }
  function loadBundledFirmware() { showFirmware(P.parseSrec(OpenRCX.firmwareImages[fwSel.value].text), ''); }
  fwSel.addEventListener('change', loadBundledFirmware);
  $('btnOpenLgo').addEventListener('click', () => $('fileLgo').click());
  $('fileLgo').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { showFirmware(P.parseSrec(await f.text()), f.name); } catch (err) { toast(f.name + ': ' + err.message, 'bad'); }
    e.target.value = '';
  });
  $('fwConfirm').addEventListener('change', e => { $('btnInstallFw').disabled = !e.target.checked; });
  $('btnInstallFw').addEventListener('click', async () => {
    if (!fwImage) return;
    $('progFw').style.width = '0%';
    $('fwStatus').textContent = 'Transferring ' + fwImage.data.length + ' bytes, about ' + Math.round(fwImage.data.length * 2 * 11 / 2400 * 1.15) + ' s. Do not move the brick.';
    const ok = await run('Installing firmware', async () => {
      await rcx.downloadFirmware(fwImage, progressUI('progFw', 'progFwText', 'firmware'));
      $('fwStatus').textContent = 'Firmware installed. The brick should have played its start-up sound.';
      toast('Firmware installed', 'good');
      await sleep(1000);
      await refreshInfo();
    });
    if (!ok) $('fwStatus').textContent = 'Install failed. Fresh batteries, closer tower, less light, then try again (the brick is still in download mode).';
    $('fwConfirm').checked = false; $('btnInstallFw').disabled = true;
  });
  $('btnDeleteFw').addEventListener('click', () => run('Deleting firmware', async () => { await rcx.deleteFirmware(); await sleep(300); await refreshInfo(); toast('Firmware deleted'); }));

  /* ------------------------------------------------------------- datalog */
  const kindName = k => k < 0x20 ? 'var ' + k : k < 0x24 ? 'timer ' + (k - 0x20) : (k >= 0x40 && k <= 0x42) ? 'sensor ' + (k - 0x40 + 1) : k === 0x80 ? 'clock' : 'type 0x' + k.toString(16);
  $('btnDlUpload').addEventListener('click', () => run('Datalog', async () => {
    dlRows = await rcx.uploadDatalog();
    const tb = $('dlTable').tBodies[0];
    tb.innerHTML = '';
    if (!dlRows.length) { tb.innerHTML = '<tr><td colspan="3" class="muted">The datalog is empty.</td></tr>'; }
    dlRows.forEach((r, i) => { const tr = tb.insertRow(); tr.insertCell().textContent = i + 1; tr.insertCell().textContent = kindName(r.kind); tr.insertCell().textContent = r.value; });
    $('dlInfo').textContent = dlRows.length + ' entries';
    $('btnDlCsv').disabled = !dlRows.length;
  }));
  $('btnDlCsv').addEventListener('click', () => saveBlob('datalog.csv', 'index,source,value\n' + dlRows.map((r, i) => (i + 1) + ',' + kindName(r.kind) + ',' + r.value).join('\n') + '\n', 'text/csv'));
  $('btnDlCreate').addEventListener('click', () => run('Datalog', async () => { await rcx.setDatalogSize(Number($('dlSize').value)); toast('Datalog cleared, size ' + $('dlSize').value, 'good'); }));

  /* ------------------------------------------------------------- console: raw */
  $('btnRaw').addEventListener('click', () => run('Raw', async () => {
    const bytes = $('rawHex').value.trim().split(/[\s,]+/).filter(Boolean).map(h => parseInt(h, 16));
    if (!bytes.length || bytes.some(Number.isNaN)) throw new Error('enter hex bytes like "51 03"');
    const exp = $('rawExpect').value === '' ? undefined : Number($('rawExpect').value);
    const r = await rcx.raw(bytes, exp);
    toast(P.opcodeName(bytes[0]) + ' reply: ' + (r.length ? P.hex(r) : '(none)'), 'good');
  }));

  /* ------------------------------------------------------------- init */
  function init() {
    const serialOk = T.SerialTransport.available(), usbOk = T.UsbTowerTransport.available();
    $('noSerial').hidden = serialOk;
    if (!serialOk && typeof isSecureContext !== 'undefined' && !isSecureContext && location.protocol === 'http:') {
      $('noSerial').innerHTML = 'This page is served over plain <b>http</b>, and browsers only hand out serial ports to secure pages. '
        + 'Open <a href="https://' + location.host + location.pathname + '">https://' + location.host + '</a> instead (trust its certificate once with truenas\\trust-cert.ps1), '
        + 'or add <code>http://' + location.host + '</code> to <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>. The simulator works either way.';
    }
    document.querySelectorAll('input[name=tower]').forEach(r => {
      const dis = (r.value === 'diy' || r.value === 'serial') ? !serialOk : r.value === 'usb' ? !usbOk : false;
      r.disabled = dis; r.closest('.choice').classList.toggle('disabled', dis);
    });
    const savedTower = store.get('tower', serialOk ? 'diy' : 'sim');
    const radio = document.querySelector('input[name=tower][value="' + savedTower + '"]');
    if (radio && !radio.disabled) radio.checked = true; else if (!serialOk) document.querySelector('input[name=tower][value=sim]').checked = true;
    $('usbRangeWrap').hidden = towerKind() !== 'usb';
    src.value = store.get('src', OpenRCX.examples[0].source);
    renderGutter();
    $('slotSel').value = store.get('slot', '0');
    $('slotSelBlocks').value = $('slotSel').value;
    loadBundledFirmware();
    setEditorMode(store.get('mode', 'blocks'));
    const fromHash = location.hash.slice(1);
    showView(VIEWS.includes(fromHash) ? fromHash : store.get('view', 'connect'));
    if (location.protocol === 'file:' && !serialOk) logNote('Web Serial unavailable: use Chrome or Edge', 'err');
  }
  init();
})();
