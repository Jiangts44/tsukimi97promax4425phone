/* ═══════════════════════════════════════════════════════════════
   TsukiTheme.js · 视觉引擎 v1.1
   ─────────────────────────────────────────────────────────────
   所有页面：只执行 applyGlobalTheme()，注入壁纸 + CSS。

   只有 index.html 需要实时监听（BroadcastChannel / storage），
   通过 script 标签的 data-listen 属性声明开启：

     子 iframe（只应用美化，不监听）：
       <script src="TsukiTheme.js"></script>

     index.html（应用美化 + 实时同步）：
       <script src="TsukiTheme.js" data-listen="true"></script>

   依赖（须在本文件之前定义）：
     - getDbAsync()              ← IndexedDB 读取
     - tsukiChannel              ← BroadcastChannel（仅 data-listen 模式需要）
     - DOM: #tsuki-dynamic-style
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── 判断当前 script 标签是否声明了 data-listen ── */
  const thisScript = document.currentScript;
  const withListeners = thisScript?.dataset?.listen === 'true';

  /* ── 核心：读取 DB → 注入壁纸 + CSS ── */
  async function applyGlobalTheme() {
    try {
      const db = await getDbAsync();
      const globalTheme = db.theme?.global || { css: '', wallpaper: '' };

      // 壁纸：查找页面内所有需要应用壁纸的屏幕容器
      ['.screen-home', '.screen-music'].forEach(sel => {
        const el = document.querySelector(sel);
        if (!el) return;
        if (globalTheme.wallpaper) {
          el.style.backgroundImage = `url(${globalTheme.wallpaper})`;
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
        } else {
          el.style.backgroundImage = 'none';
        }
      });

      // CSS（字体、颜色等）：注入到 #tsuki-dynamic-style 标签
      const styleTag = document.getElementById('tsuki-dynamic-style');
      if (styleTag) styleTag.innerHTML = globalTheme.css || '';

      console.log('%c[TsukiTheme] 注入成功' + (withListeners ? ' (with listeners)' : ''), 'color:#43d9a0;font-weight:600');
    } catch (e) {
      console.error('[TsukiTheme] 样式加载失败', e);
    }
  }

  /* ── 暴露到全局，供 openApp/返回桌面等处手动调用 ── */
  window.applyGlobalTheme = applyGlobalTheme;

  /* ── 仅 index.html（data-listen="true"）才挂载监听 ── */
  if (withListeners) {
    // BroadcastChannel：settings 保存后实时刷新
    // tsukiChannel 由 index.html 的 DB 初始化块创建，这里直接复用
    const attachChannel = () => {
      if (typeof tsukiChannel !== 'undefined') {
        tsukiChannel.onmessage = e => {
          if (e.data === 'update_theme') applyGlobalTheme();
        };
      }
    };
    if (typeof tsukiChannel !== 'undefined') {
      attachChannel();
    } else {
      setTimeout(attachChannel, 0);
    }

    // storage 事件：跨标签页兼容
    window.addEventListener('storage', e => {
      if (e.key === 'tsuki_config_shadow') applyGlobalTheme();
    });
  }

  /* ── DOMContentLoaded：首次执行 ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyGlobalTheme);
  } else {
    applyGlobalTheme();
  }
})();