/* OpenMindstorms usage counters.
 *
 * Sends small anonymous events (page view, connect, compile, program sent, run,
 * firmware install, file operation, editor mode, example loaded, session length)
 * to /api/stats/event on the server the page came from.  What is sent: the event
 * name, which app, a short detail word (e.g. the link type), whether it worked,
 * the browser and OS family, a random visitor id kept in this browser's
 * localStorage, and a random per-tab session id.  No IP address is stored by
 * the server, no cookies are used, and program contents never leave the page.
 *
 * Off when: the page is opened from a local file, the browser sends Do Not
 * Track / Global Privacy Control, or localStorage has om.stats = "off"
 * (append ?stats=off to any page once to set it, ?stats=on to clear it).
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  try { if (q.get('stats') === 'off') localStorage.setItem('om.stats', 'off'); if (q.get('stats') === 'on') localStorage.removeItem('om.stats'); } catch (e) { /* ignore */ }
  const local = location.protocol === 'file:';
  const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  let optOut = false; try { optOut = localStorage.getItem('om.stats') === 'off'; } catch (e) { /* ignore */ }
  const enabled = !local && !dnt && !optOut;
  const url = (q.get('statsApi') || '/api/stats') + '/event';

  const rnd = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  let vid = ''; try { vid = localStorage.getItem('om.vid') || ''; if (!vid) { vid = rnd(); localStorage.setItem('om.vid', vid); } } catch (e) { vid = rnd(); }
  let sid = ''; try { sid = sessionStorage.getItem('om.sid') || ''; if (!sid) { sid = rnd(); sessionStorage.setItem('om.sid', sid); } } catch (e) { sid = rnd(); }

  function family() {
    const ua = navigator.userAgent || '';
    let browser = 'other';
    if (/Edg\//.test(ua)) browser = 'edge'; else if (/OPR\//.test(ua)) browser = 'opera'; else if (/Chrome\//.test(ua)) browser = 'chrome';
    else if (/Firefox\//.test(ua)) browser = 'firefox'; else if (/Safari\//.test(ua)) browser = 'safari';
    let os = 'other';
    if (/Windows/.test(ua)) os = 'windows'; else if (/Android/.test(ua)) os = 'android'; else if (/CrOS/.test(ua)) os = 'chromeos';
    else if (/iPhone|iPad/.test(ua)) os = 'ios'; else if (/Mac OS/.test(ua)) os = 'macos'; else if (/Linux/.test(ua)) os = 'linux';
    return { browser, os };
  }
  const fam = family();
  const app = document.body.dataset.app || (location.pathname.split('/').filter(Boolean)[0] || 'home');
  const t0 = Date.now();

  function send(body, beacon) {
    if (!enabled) return;
    const json = JSON.stringify(body);
    try {
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([json], { type: 'text/plain' })); return; }
      fetch(url, { method: 'POST', body: json, headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'omit' }).catch(() => {});
    } catch (e) { /* never let counters break the app */ }
  }
  /* hit('connect', 'usb', true) */
  function hit(event, detail, ok, dur) {
    send({ v: 1, vid, sid, app, event: String(event).slice(0, 24), detail: detail == null ? '' : String(detail).slice(0, 32), ok: ok === false ? 0 : 1, dur: dur == null ? null : Math.round(dur), browser: fam.browser, os: fam.os, w: screen.width || 0 }, false);
  }
  let ended = false;
  function endSession() {
    if (ended) return; ended = true;
    send({ v: 1, vid, sid, app, event: 'session', detail: '', ok: 1, dur: Math.round((Date.now() - t0) / 1000), browser: fam.browser, os: fam.os, w: screen.width || 0 }, true);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') endSession(); else ended = false; });
  window.addEventListener('pagehide', endSession);

  window.OMStats = { hit, enabled, app, vid: vid.slice(0, 4) + '…' };
  // detail: the hash, or the sub-page inside the app (e.g. rcx/tower -> 'tower')
  hit('page_view', (location.hash || '').slice(1, 17) || (location.pathname.split('/').filter(Boolean)[1] || '').replace(/\.html$/, '').slice(0, 17));
})();
