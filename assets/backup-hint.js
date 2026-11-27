/* backup-hint.js \u2014 /progress/ \u7684\u300c\u4eca\u65e5\u96f2\u7aef\u5099\u4efd\u300d\u5c0f\u63d0\u793a
 *
 * \u76ee\u7684\uff1a\u5728\u8cc7\u6599\u9032\u5ea6\u9801\u9802\u7aef\u986f\u793a\u4e00\u884c\u4f4e\u8abf\u7684\u5099\u4efd\u72c0\u614b\uff0c\u8b93\u4f7f\u7528\u8005\u4e0d\u5fc5\u9032\u8a2d\u5b9a\u9801\u5c31\u77e5\u9053
 *       \u4eca\u5929\u5099\u4efd\u4e86\u6c92\u3002\u4e0d\u4fee\u6539\u4efb\u4f55\u65e2\u6709\u6a21\u7d44\u3001\u4e0d\u52d5\u65e2\u6709\u7248\u9762\u8207\u64cd\u4f5c\u3002
 *
 * \u4e09\u7a2e\u72c0\u614b\uff08\uff0b\u9032\u884c\u4e2d\uff0f\u5931\u6557\uff09\uff1a
 *   1. \u4eca\u65e5\u5df2\u5099\u4efd   \u2192 \u986f\u793a\u6642\u9593\u8207\u7b46\u6578
 *   2. \u4eca\u65e5\u5c1a\u672a\u5099\u4efd \u2192 \u63d0\u793a\u958b\u555f\u672c\u9801\u5f8c\u6703\u81ea\u52d5\u88dc\u4e0a
 *   3. \u672a\u6388\u6b0a Google\uff0c\u7121\u6cd5\u5099\u4efd \u2192 \u5f15\u5c0e\u5230\u8a2d\u5b9a\u9801
 *
 * \u72c0\u614b\u4f86\u6e90\uff0c\u4f9d\u5e8f\uff1a
 *   a. window.DailyBackup.info()\uff08\u5099\u4efd\u6a21\u7d44\u5df2\u8f09\u5165\u6642\u6700\u6e96\uff09
 *   b. localStorage 'backup-daily-state-v1'\uff08\u5099\u4efd\u7d00\u9304\uff0c\u88dd\u7f6e\u5c08\u5c6c\uff09
 *   c. window.GDrive \u7684 restoreToken / hasToken / isSignedOut\uff08\u6388\u6b0a\u72c0\u614b\uff09
 *
 * \u672c\u6a94\u53ea\u7528\u53ef\u516c\u958b\u7684\u8cc7\u8a0a\uff0c\u4e0d\u6d89\u53ca\u4efb\u4f55 secret\u3002
 */
(function (global) {
  'use strict';

  var STATE_KEY = 'backup-daily-state-v1';
  var POLL_MS = 3000;
  var POLL_MAX = 20;          /* \u6700\u591a\u7b49 60 \u79d2\u8b93 DailyBackup \u51fa\u73fe */
  var polls = 0, pollTimer = null;

  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate())
      + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function readBackupState() {
    try {
      var o = JSON.parse(global.localStorage.getItem(STATE_KEY) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  /* \u6388\u6b0a\u72c0\u614b\uff1a\u5148\u6cbf\u7528\u65e2\u6709\u6b0a\u6756\uff0c\u518d\u770b\u662f\u5426\u660e\u78ba\u767b\u51fa */
  function authState() {
    var g = global.GDrive;
    if (!g) return { known: false, ok: false };
    try {
      if (g.hasToken && g.hasToken()) return { known: true, ok: true };
      if (g.restoreToken && g.restoreToken()) return { known: true, ok: true };
      if (g.isSignedOut && g.isSignedOut()) return { known: true, ok: false };
      if (g.isConfigured && !g.isConfigured()) return { known: true, ok: false };
    } catch (e) {}
    return { known: false, ok: false };
  }

  /* \u7d9c\u5408\u51fa\u8981\u986f\u793a\u7684\u72c0\u614b */
  function computeInfo() {
    var db = global.DailyBackup;
    if (db && db.info) {
      try {
        var i = db.info() || {};
        i.authKnown = true;
        return i;
      } catch (e) {}
    }
    var st = readBackupState();
    var a = authState();
    return {
      running: false,
      lastDate: st.lastDate || '',
      lastRunAt: st.lastRunAt || '',
      lastCounts: st.lastCounts || null,
      lastError: st.lastError || '',
      authorized: a.ok,
      authKnown: a.known,
      backedUpToday: (st.lastDate || '') === todayISO()
    };
  }

  var CSS = ''
    + '.bkh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;'
    + 'padding:8px 14px;background:#fff;border:1px solid #dcd8d4;border-radius:999px;'
    + 'font-size:12.5px;line-height:1.5;box-shadow:0 1px 2px rgba(27,36,48,.04);}'
    + '.bkh .bkh-d{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:#93939b;}'
    + '.bkh .bkh-t{font-weight:700;color:#3a3a3e;white-space:nowrap;}'
    + '.bkh .bkh-m{color:#6e6e74;font-size:11.5px;}'
    + '.bkh .bkh-a{margin-left:auto;color:#6e6e74;text-decoration:none;font-size:11.5px;'
    + 'padding:3px 10px;border-radius:999px;border:1px solid #eae7e3;white-space:nowrap;}'
    + '.bkh .bkh-a:hover{background:#f8f6f4;color:#3a3a3e;}'
    + '@media(max-width:560px){.bkh{border-radius:10px;padding:7px 12px;gap:6px;}'
    + '.bkh .bkh-a{margin-left:0;}}';

  function injectStyle(doc) {
    if (doc.getElementById('bkh-style')) return;
    var s = doc.createElement('style');
    s.id = 'bkh-style';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function mount() {
    var doc = global.document;
    if (!doc || !doc.body) return null;
    if (String(global.location.pathname || '').indexOf('/progress') < 0) return null;
    if (doc.getElementById('bkHint')) return doc.getElementById('bkHint');

    var stats = doc.getElementById('stats');
    var wrap = doc.querySelector('.wrap');
    if (!stats && !wrap) return null;

    injectStyle(doc);

    var el = doc.createElement('div');
    el.className = 'bkh';
    el.id = 'bkHint';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="bkh-d"></span><span class="bkh-t">\u2014</span>'
      + '<span class="bkh-m"></span>'
      + '<a class="bkh-a" href="../settings/index.html">\u5099\u4efd\u8a2d\u5b9a</a>';

    if (stats && stats.parentNode) stats.parentNode.insertBefore(el, stats);
    else wrap.insertBefore(el, wrap.firstChild);

    var dot = el.querySelector('.bkh-d');
    var tEl = el.querySelector('.bkh-t');
    var mEl = el.querySelector('.bkh-m');

    function render() {
      var i = computeInfo() || {};
      var txt = '\u2014', col = '#93939b', msg = '';

      if (i.running) {
        txt = '\u5099\u4efd\u4e2d\u2026'; col = '#7a4f4e';
        msg = '\u6b63\u5728\u628a\u96f2\u7aef\u8cc7\u6599\u532f\u51fa\u5230 Google Drive';
      } else if (i.backedUpToday && !i.lastError) {
        txt = '\u4eca\u65e5\u5df2\u5099\u4efd'; col = '#5f7a63';
        msg = fmtTime(i.lastRunAt);
        if (i.lastCounts && i.lastCounts.keys != null) {
          var sc = i.lastCounts.scopes || {};
          msg += (msg ? '\u3000\u00b7\u3000' : '') + i.lastCounts.keys + ' \u500b\u9375'
            + '\uff08\u71df\u9020 ' + (sc.build || 0) + '\uff0f\u67e5\u9a57 ' + (sc.inspection || 0) + '\uff09';
        }
      } else if (i.lastError) {
        txt = '\u5099\u4efd\u5931\u6557'; col = '#a34a45';
        msg = String(i.lastError).slice(0, 60);
      } else if (i.authKnown && !i.authorized) {
        txt = '\u672a\u6388\u6b0a Google\uff0c\u7121\u6cd5\u5099\u4efd'; col = '#93939b';
        msg = '\u5230\u8a2d\u5b9a\u9805\u5b8c\u6210\u6388\u6b0a\u5f8c\u5373\u53ef\u81ea\u52d5\u5099\u4efd';
      } else if (i.backedUpToday) {
        txt = '\u4eca\u65e5\u5df2\u5099\u4efd'; col = '#5f7a63';
        msg = fmtTime(i.lastRunAt);
      } else {
        txt = '\u4eca\u65e5\u5c1a\u672a\u5099\u4efd'; col = '#c47f17';
        msg = '\u958b\u555f\u672c\u9805\u5f8c\u6703\u81ea\u52d5\u88dc\u4e0a';
      }

      dot.style.background = col;
      tEl.textContent = txt;
      tEl.style.color = col;
      mEl.textContent = msg;
    }

    render();

    /* \u5099\u4efd\u6a21\u7d44\u8207\u540c\u6b65\u5c64\u7684\u4e8b\u4ef6\u90fd\u6703\u6539\u8b8a\u72c0\u614b */
    try {
      global.addEventListener('daily-backup', function () { render(); });
      global.addEventListener('supabase-sync', function () { render(); });
    } catch (e) {}

    /* \u5099\u4efd\u6a21\u7d44\u662f\u975e\u540c\u6b65\u8f09\u5165\u7684\uff1b\u7b49\u5b83\u51fa\u73fe\u5f8c\u6539\u7528\u5b83\u7684 info() \u4e26\u505c\u6b62\u8f2a\u8a62 */
    if (!global.DailyBackup) {
      pollTimer = setInterval(function () {
        polls++;
        render();
        if (global.DailyBackup || polls >= POLL_MAX) {
          clearInterval(pollTimer);
          pollTimer = null;
          render();
        }
      }, POLL_MS);
    }

    /* \u5207\u56de\u524d\u666f\u6642\u91cd\u756b\u4e00\u6b21\uff08\u53e6\u4e00\u53f0\u53ef\u80fd\u525b\u5099\u4efd\u5b8c\uff09 */
    try {
      global.addEventListener('focus', render);
      doc.addEventListener('visibilitychange', function () {
        if (!doc.hidden) render();
      });
    } catch (e) {}

    return el;
  }

  global.BackupHint = { mount: mount, refresh: function () { mount(); } };

  if (doc$ready()) mount();
  else global.document.addEventListener('DOMContentLoaded', mount);

  function doc$ready() {
    try { return global.document.readyState !== 'loading'; } catch (e) { return false; }
  }
})(typeof window !== 'undefined' ? window : this);
