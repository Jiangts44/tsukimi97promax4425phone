/**
 * DiaryFloorListener.js  v4.0
 * Chat iframe 顶部横幅 + postMessage bridge + currentChatId 广播。
 * 在 tsukiphone1_1.html </body> 前引入即可。
 *
 * 修复记录 v4.0：
 *  - 新增 currentChatId 轮询广播：每 800ms 检测 window.currentChatId 变化，
 *    变化时向 window.parent 广播 TSUKI_CHAT_ACTIVE，
 *    让 index.html 转发给隐藏 diary iframe → 触发精准 chatId 直连监听。
 */
(function () {
  'use strict';

  /* ── Banner ── */
  let _bannerEl = null, _bannerTimer = null, _bannerHideTimer = null;

  function showBanner(msg, type) {
    if (!_bannerEl) {
      _bannerEl = document.createElement('div');
      _bannerEl.id = '__diary_banner__';
      // ① 改用 opacity + display 控制显隐，彻底避免 translateY 残留导致布局偏移
      _bannerEl.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;'
        + 'padding:7px 16px;font-family:"Geist Mono",monospace,sans-serif;'
        + 'font-size:11px;font-weight:600;letter-spacing:.05em;text-align:center;'
        + 'pointer-events:none;display:none;opacity:0;'
        + 'transition:opacity .22s ease;';
      document.body.appendChild(_bannerEl);
    }
    const C = {
      warn:    ['rgba(10,10,20,.94)', '#f59e0b', 'rgba(245,158,11,.3)'],
      success: ['rgba(2,20,10,.94)',  '#43d9a0', 'rgba(67,217,160,.3)'],
      err:     ['rgba(26,2,8,.94)',   '#ff6b6b', 'rgba(255,107,107,.3)'],
    }[type] || ['rgba(10,10,20,.94)', 'rgba(255,255,255,.75)', 'rgba(255,255,255,.12)'];
    _bannerEl.style.background   = C[0];
    _bannerEl.style.color        = C[1];
    _bannerEl.style.borderBottom = '1px solid ' + C[2];
    _bannerEl.textContent        = msg;

    // 先清掉旧的隐藏 timer，再强制 display 回来 → 触发 reflow → 淡入
    clearTimeout(_bannerTimer);
    clearTimeout(_bannerHideTimer);
    _bannerEl.style.display = 'block';
    _bannerEl.style.opacity = '0';
    void _bannerEl.offsetHeight; // trigger reflow
    _bannerEl.style.opacity = '1';

    // 5s 后先淡出，transition 结束后再 display:none，防止占位
    _bannerTimer = setTimeout(function () {
      _bannerEl.style.opacity = '0';
      _bannerHideTimer = setTimeout(function () {
        if (_bannerEl) _bannerEl.style.display = 'none';
      }, 250); // 等淡出动画结束
    }, 5000);
  }

  /* ── Listen for messages from diary.html (via parent bridge) ── */
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'DIARY_STATUS_BANNER') {
      showBanner(e.data.msg, e.data.level || 'warn');
    }
    if (e.data.type === 'DIARY_FLOOR_RESULT') {
      if (e.data.success) {
        showBanner('✅ 日记已生成（' + (e.data.written || '?') + ' 篇）', 'success');
      } else {
        showBanner('❌ 日记生成失败: ' + (e.data.error || '未知'), 'err');
      }
    }
  });

  /* ── currentChatId 广播 ──────────────────────────────────────────────
     每 800ms 轮询 window.currentChatId（由 TsukiBridge.js 赋值）。
     一旦检测到变化，立即向 window.parent 发送 TSUKI_CHAT_ACTIVE，
     由 index.html 中转转发给隐藏 diary iframe（TSUKI_WATCH_CHAT）。
     这是让 diary floor poller 在 chat 页面打开时就知道要监听哪个 chatId 的核心机制。
  ── */
  let _lastBroadcastedChatId = null;

  function _pollAndBroadcastChatId() {
    const cid = window.currentChatId;
    if (cid && cid !== _lastBroadcastedChatId) {
      _lastBroadcastedChatId = cid;
      console.log('%c[DiaryFloorListener] 广播 chatId → parent:', 'color:#43d9a0;font-weight:600', cid);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'TSUKI_CHAT_ACTIVE', chatId: cid }, '*');
        }
      } catch (_) { /* cross-origin fallback */ }
    }
  }

  /* ── Init ── */
  function init() {
    console.group('%c📶 [DiaryFloorListener] v4.0', 'color:#ff6b6b;font-weight:bold');
    console.log('职责 ①：tsukiphone 内顶部横幅显示');
    console.log('职责 ②：postMessage 桥接转发');
    console.log('职责 ③：轮询 currentChatId 变化并广播给 parent (index.html)');
    console.groupEnd();

    // 立即执行一次（页面加载时可能 currentChatId 已经被设好了）
    _pollAndBroadcastChatId();
    // 持续轮询
    setInterval(_pollAndBroadcastChatId, 800);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();

/*
 ═══════ INDEX.HTML PARENT BRIDGE (v4 完整版) ═══════
 把下面这段替换掉 index.html 里旧的 window.addEventListener('message', ...) 代码块：

(function () {
  let _bannerTimer = null;

  function showIndexBanner(msg, level) {
    const el = document.getElementById('indexDiaryBanner');
    if (!el) return;
    const C = {
      warn:    ['rgba(10,10,20,.94)','#f59e0b','rgba(245,158,11,.3)'],
      success: ['rgba(2,20,10,.94)', '#43d9a0','rgba(67,217,160,.3)'],
      err:     ['rgba(26,2,8,.94)',  '#ff6b6b','rgba(255,107,107,.3)'],
    }[level] || ['rgba(10,10,20,.94)','rgba(255,255,255,.75)','rgba(255,255,255,.12)'];
    el.style.background   = C[0];
    el.style.color        = C[1];
    el.style.borderBottom = '1px solid ' + C[2];
    el.textContent        = msg;
    el.classList.add('visible');
    clearTimeout(_bannerTimer);
    _bannerTimer = setTimeout(() => el.classList.remove('visible'),
      level === 'success' ? 2500 : 4000);
  }

  window.addEventListener('message', (e) => {
    if (!e.data) return;
    const t = e.data.type;

    if (t === 'DIARY_STATUS_BANNER') {
      showIndexBanner(e.data.msg, e.data.level || 'warn');
      const cf = document.getElementById('chatFrame');
      if (cf?.contentWindow) try { cf.contentWindow.postMessage(e.data, '*'); } catch(_) {}
    }
    if (t === 'DIARY_FLOOR_RESULT') {
      const msg = e.data.success
        ? '✅ 日记已生成（' + (e.data.written || '?') + ' 篇）'
        : '❌ 日记生成失败: ' + (e.data.error || '未知');
      showIndexBanner(msg, e.data.success ? 'success' : 'err');
      const cf = document.getElementById('chatFrame');
      if (cf?.contentWindow) try { cf.contentWindow.postMessage(e.data, '*'); } catch(_) {}
    }

    if (t === 'TSUKI_CHAT_ACTIVE') {
      const df = document.getElementById('diaryFrameHidden');
      if (df?.contentWindow) {
        try { df.contentWindow.postMessage({ type: 'TSUKI_WATCH_CHAT', chatId: e.data.chatId }, '*'); } catch(_) {}
      }
      console.log('[index] TSUKI_CHAT_ACTIVE → diary hidden iframe:', e.data.chatId);
    }
  });
})();

 ════════════════════════════════════════════════════════
*/
