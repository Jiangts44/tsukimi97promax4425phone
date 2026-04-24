/**
 * GalleryPicker.js  v2.1
 * ─────────────────────────────────────────────────────────────────
 * 修复：
 *   · 移除所有 font-family 声明，完全继承页面字体
 *   · 修复本地上传：先触发原生 click，再关闭面板（绕过浏览器安全限制）
 *
 * 拦截规则（同时满足以下所有条件才拦截）：
 *   1. input[type="file"]
 *   2. accept 属性包含 image 相关类型（image/* / .jpg / .png 等）
 *   3. 不带 data-gp-skip 属性（手动豁免）
 *   4. id 不是 galleryInput（gallery 管理器自身上传）
 *   5. 没有被「本地放行」临时标记
 *
 * 特殊标记：
 *   data-gp-skip   → 完全不拦截
 *   data-gp-image  → 强制拦截（accept 为空也拦截）
 *
 * 引入方式（在 </body> 前）：
 *   <script src="GalleryPicker.js"></script>
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════
     §1  自包含 IndexedDB 读取
  ═══════════════════════════════════════════════════════ */
  var GP_IDB = 'tsukiphonepromax';

  function _gpOpenDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(GP_IDB);
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror   = function (e) { reject(e.target.error); };
    });
  }

  async function _gpReadGallery() {
    try {
      var db = await _gpOpenDB();
      return new Promise(function (resolve) {
        if (!db.objectStoreNames.contains('config')) { db.close(); resolve(null); return; }
        var tx  = db.transaction('config', 'readonly');
        var req = tx.objectStore('config').get('main_config');
        req.onsuccess = function () {
          db.close();
          resolve(req.result && req.result.gallery ? req.result.gallery : null);
        };
        req.onerror = function () { db.close(); resolve(null); };
      });
    } catch (e) {
      console.warn('[GalleryPicker] DB read failed:', e);
      return null;
    }
  }

  /* ═══════════════════════════════════════════════════════
     §2  拦截判断
  ═══════════════════════════════════════════════════════ */
  var _IMG_EXTS = ['.jpg','.jpeg','.png','.gif','.webp','.avif','.svg','.bmp','.ico'];

  function _shouldIntercept(inp) {
    if (inp.type !== 'file')           return false;
    if (inp.id === 'galleryInput')     return false;
    if ('gpSkip' in inp.dataset)       return false;
    if (inp.dataset.gpBypass === '1')  return false;
    if ('gpImage' in inp.dataset)      return true;

    var accept = (inp.accept || '').toLowerCase().trim();
    if (!accept) return false;
    if (accept.indexOf('image') !== -1) return true;
    var parts = accept.split(',');
    for (var i = 0; i < parts.length; i++) {
      if (_IMG_EXTS.indexOf(parts[i].trim()) !== -1) return true;
    }
    return false;
  }

  /* ═══════════════════════════════════════════════════════
     §3  注入 CSS（无任何 font-family，完全继承页面字体）
  ═══════════════════════════════════════════════════════ */
  var _CSS = `
    #gp-source-sheet {
      position: fixed; inset: 0; z-index: 2147483640;
      display: flex; align-items: flex-end; justify-content: center;
      pointer-events: none; opacity: 0; transition: opacity .22s ease;
    }
    #gp-source-sheet.gp-open { pointer-events: auto; opacity: 1; }
    #gp-source-backdrop {
      position: absolute; inset: 0;
      background: rgba(255,255,255,.55);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); cursor: pointer;
    }
    #gp-source-card {
      position: relative; z-index: 1; width: 100%;
      background: var(--paper,#fafaf7); border-radius: 28px 28px 0 0;
      padding: 10px 20px 42px;
      transform: translateY(100%);
      transition: transform .32s cubic-bezier(.22,1,.36,1);
      box-shadow: 0 -8px 40px rgba(0,0,0,.18);
    }
    #gp-source-sheet.gp-open #gp-source-card { transform: translateY(0); }
    #gp-source-handle {
      width: 36px; height: 4px; border-radius: 2px;
      background: rgba(10,10,10,.12); margin: 6px auto 20px;
    }
    #gp-source-title {
      font-size: 21px; font-style: italic;
      color: var(--ink,#0a0a0a); text-align: center; margin-bottom: 4px;
    }
    #gp-source-sub {
      font-size: 10px; color: var(--mute,#8a8a8e);
      letter-spacing: .08em; text-align: center; margin-bottom: 22px;
    }
    .gp-choice-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .gp-choice-btn {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 20px 14px; border: 1.5px solid var(--line,rgba(10,10,10,.07));
      border-radius: 18px; background: var(--card,#fff); cursor: pointer;
      transition: all .18s ease;
    }
    .gp-choice-btn:hover {
      border-color: var(--ink,#0a0a0a); transform: scale(1.02);
      box-shadow: 0 4px 20px rgba(0,0,0,.08);
    }
    .gp-choice-icon {
      width: 48px; height: 48px; border-radius: 14px;
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .gp-choice-icon.local   { background: linear-gradient(135deg,#e8eaff,#d4ddff); color: #5b7cfa; }
    .gp-choice-icon.gallery { background: linear-gradient(135deg,#fde8f0,#ffd4e8); color: #e8698a; }
    .gp-choice-label { font-size: 13px; font-weight: 600; color: var(--ink,#0a0a0a); }
    .gp-choice-desc  { font-size: 9px; color: var(--mute,#8a8a8e); letter-spacing: .05em; margin-top: 2px; }

    #gp-gallery-panel {
      position: fixed; inset: 0; z-index: 2147483641;
      display: flex; align-items: flex-end; justify-content: center;
      pointer-events: none; opacity: 0; transition: opacity .22s ease;
    }
    #gp-gallery-panel.gp-open { pointer-events: auto; opacity: 1; }
    #gp-gallery-backdrop {
      position: absolute; inset: 0;
      background: rgba(255,255,255,.55);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); cursor: pointer;
    }
    #gp-gallery-card {
      position: relative; z-index: 1;
      width: 100%; height: min(590px,84vh);
      background: var(--paper,#fafaf7); border-radius: 28px 28px 0 0;
      display: flex; flex-direction: column;
      transform: translateY(100%);
      transition: transform .36s cubic-bezier(.22,1,.36,1);
      box-shadow: 0 -10px 50px rgba(0,0,0,.22); overflow: hidden;
    }
    #gp-gallery-panel.gp-open #gp-gallery-card { transform: translateY(0); }
    #gp-gallery-handle {
      width: 36px; height: 4px; border-radius: 2px;
      background: rgba(10,10,10,.12); margin: 10px auto 0; flex-shrink: 0;
    }
    #gp-gallery-hdr {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px 10px; flex-shrink: 0;
    }
    #gp-gallery-hdr-title {
      font-size: 22px; font-style: italic; color: var(--ink,#0a0a0a);
    }
    #gp-gallery-hdr-sub {
      font-size: 9px; color: var(--mute,#8a8a8e); letter-spacing: .08em; margin-top: 2px;
    }
    #gp-gallery-close-btn {
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--paper-2,#f1f0ea); border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; color: var(--ink,#0a0a0a); flex-shrink: 0;
      transition: background .15s;
    }
    #gp-gallery-close-btn:hover { background: rgba(10,10,10,.08); }
    #gp-gallery-tabs {
      display: flex; gap: 8px; padding: 4px 18px 12px;
      overflow-x: auto; white-space: nowrap; scrollbar-width: none;
      flex-shrink: 0; border-bottom: 1px solid var(--line,rgba(10,10,10,.07));
    }
    #gp-gallery-tabs::-webkit-scrollbar { display: none; }
    .gp-tab {
      padding: 5px 14px; background: var(--paper-2,#f1f0ea);
      border-radius: 100px; font-size: 11px; cursor: pointer;
      transition: all .2s; border: 1.5px solid transparent;
      white-space: nowrap; letter-spacing: .04em;
    }
    .gp-tab:hover  { border-color: var(--ink,#0a0a0a); }
    .gp-tab.active { background: var(--ink,#0a0a0a); color: #fff; border-color: var(--ink,#0a0a0a); }
    #gp-gallery-grid {
      flex: 1; overflow-y: auto; padding: 14px 18px 20px;
      display: grid; grid-template-columns: repeat(3,1fr); gap: 9px; align-content: start;
    }
    #gp-gallery-grid::-webkit-scrollbar { display: none; }
    .gp-grid-item {
      aspect-ratio: 1; border-radius: 13px; overflow: hidden;
      background: var(--paper-2,#f1f0ea); position: relative; cursor: pointer;
      transition: all .18s; box-shadow: 0 2px 8px rgba(0,0,0,.06);
    }
    .gp-grid-item:hover {
      transform: scale(.96);
      box-shadow: 0 0 0 2.5px var(--ink,#0a0a0a), 0 4px 16px rgba(0,0,0,.15);
    }
    .gp-grid-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .gp-grid-overlay {
      position: absolute; inset: 0; background: rgba(10,10,10,0);
      display: flex; align-items: center; justify-content: center; transition: background .18s;
    }
    .gp-grid-item:hover .gp-grid-overlay { background: rgba(10,10,10,.22); }
    .gp-grid-overlay i {
      font-size: 22px; color: #fff; opacity: 0; transform: scale(.6);
      transition: all .18s; filter: drop-shadow(0 2px 6px rgba(0,0,0,.4));
    }
    .gp-grid-item:hover .gp-grid-overlay i { opacity: 1; transform: scale(1); }
    .gp-skeleton {
      aspect-ratio: 1; border-radius: 13px;
      background: linear-gradient(90deg,var(--paper-2,#f1f0ea) 25%,rgba(255,255,255,.6) 50%,var(--paper-2,#f1f0ea) 75%);
      background-size: 200% 100%; animation: gp-shimmer 1.2s infinite;
    }
    @keyframes gp-shimmer { to { background-position: -200% 0; } }
    .gp-empty { grid-column: 1/-1; padding: 44px 0; text-align: center; }
    .gp-empty i { font-size: 32px; color: var(--mute,#8a8a8e); opacity: .35; display: block; margin-bottom: 12px; }
    .gp-empty p { font-size: 11px; color: var(--mute,#8a8a8e); letter-spacing: .06em; line-height: 1.7; }
    @keyframes gp-flash { 0%,100%{opacity:1} 50%{opacity:.3} }
    .gp-selecting { animation: gp-flash .38s ease; }

    /* ── URL 库入口小字 ── */
    #gp-url-entry {
      margin-top: 18px; text-align: center;
      font-size: 10px; color: var(--mute,#8a8a8e);
      letter-spacing: .06em; cursor: pointer;
      text-decoration: underline; text-underline-offset: 3px;
      transition: color .15s;
    }
    #gp-url-entry:hover { color: var(--ink,#0a0a0a); }

    /* ── URL 库面板 ── */
    #gp-url-panel {
      position: fixed; inset: 0; z-index: 2147483642;
      display: flex; align-items: flex-end; justify-content: center;
      pointer-events: none; opacity: 0; transition: opacity .22s ease;
    }
    #gp-url-panel.gp-open { pointer-events: auto; opacity: 1; }
    #gp-url-backdrop {
      position: absolute; inset: 0;
      background: rgba(255,255,255,.55);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); cursor: pointer;
    }
    #gp-url-card {
      position: relative; z-index: 1;
      width: 100%; height: min(600px,86vh);
      background: var(--paper,#fafaf7); border-radius: 28px 28px 0 0;
      display: flex; flex-direction: column;
      transform: translateY(100%);
      transition: transform .36s cubic-bezier(.22,1,.36,1);
      box-shadow: 0 -10px 50px rgba(0,0,0,.18); overflow: hidden;
    }
    #gp-url-panel.gp-open #gp-url-card { transform: translateY(0); }
    #gp-url-handle {
      width: 36px; height: 4px; border-radius: 2px;
      background: rgba(10,10,10,.12); margin: 10px auto 0; flex-shrink: 0;
    }
    #gp-url-hdr {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px 12px; flex-shrink: 0;
      border-bottom: 1px solid var(--line,rgba(10,10,10,.07));
    }
    #gp-url-hdr-title { font-size: 22px; font-style: italic; color: var(--ink,#0a0a0a); }
    #gp-url-hdr-sub   { font-size: 9px; color: var(--mute,#8a8a8e); letter-spacing: .08em; margin-top: 2px; }
    #gp-url-close-btn {
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--paper-2,#f1f0ea); border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; color: var(--ink,#0a0a0a); flex-shrink: 0; transition: background .15s;
    }
    #gp-url-close-btn:hover { background: rgba(10,10,10,.08); }
    #gp-url-list {
      flex: 1; overflow-y: auto; padding: 10px 16px 6px;
    }
    #gp-url-list::-webkit-scrollbar { display: none; }
    .gp-url-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 0; border-bottom: 1px solid var(--line,rgba(10,10,10,.06));
    }
    .gp-url-row:last-child { border-bottom: none; }
    .gp-url-preview {
      width: 72px; flex-shrink: 0;
      background: var(--paper-2,#f1f0ea); border-radius: 10px; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      min-height: 48px; max-height: 120px;
    }
    .gp-url-preview img { width: 100%; height: auto; display: block; object-fit: contain; border-radius: 8px; }
    .gp-url-preview-empty {
      width: 72px; min-height: 56px;
      display: flex; align-items: center; justify-content: center;
      color: var(--mute,#8a8a8e); font-size: 20px; opacity: .35;
      background: var(--paper-2,#f1f0ea); border-radius: 10px; flex-shrink: 0;
    }
    .gp-url-input-wrap { flex: 1; min-width: 0; }
    .gp-url-input {
      width: 100%; padding: 9px 12px;
      border: 1.5px solid var(--line,rgba(10,10,10,.09));
      border-radius: 12px; background: var(--card,#fff);
      font-size: 11px; color: var(--ink,#0a0a0a);
      outline: none; transition: border-color .18s; box-sizing: border-box;
    }
    .gp-url-input::placeholder { color: var(--mute,#8a8a8e); }
    .gp-url-input:focus { border-color: var(--ink,#0a0a0a); }
    .gp-url-input-hint {
      font-size: 9px; color: var(--mute,#8a8a8e); letter-spacing: .04em; margin-top: 4px; padding-left: 2px;
    }
    .gp-url-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
    .gp-url-btn {
      width: 34px; height: 34px; border-radius: 10px; border: none;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 13px; transition: all .15s;
    }
    .gp-url-btn.check { background: var(--ink,#0a0a0a); color: #fff; }
    .gp-url-btn.check:hover { opacity: .8; transform: scale(1.06); }
    .gp-url-btn.del   { background: var(--paper-2,#f1f0ea); color: var(--mute,#8a8a8e); }
    .gp-url-btn.del:hover { background: #ffe0e0; color: #e05555; }
    #gp-url-footer {
      display: flex; gap: 10px; padding: 12px 16px 32px; flex-shrink: 0;
      border-top: 1px solid var(--line,rgba(10,10,10,.07));
    }
    .gp-url-footer-btn {
      flex: 1; padding: 12px 0; border-radius: 14px; border: none;
      cursor: pointer; font-size: 12px; font-weight: 600;
      transition: all .18s; display: flex; align-items: center; justify-content: center; gap: 7px;
    }
    .gp-url-footer-btn.add {
      background: var(--paper-2,#f1f0ea); color: var(--ink,#0a0a0a);
      border: 1.5px dashed rgba(10,10,10,.18);
    }
    .gp-url-footer-btn.add:hover { border-color: var(--ink,#0a0a0a); }
    .gp-url-footer-btn.save { background: var(--ink,#0a0a0a); color: #fff; }
    .gp-url-footer-btn.save:hover { opacity: .85; }
    .gp-url-save-ok { background: #43d9a0 !important; }
  `;
  var _styleEl = document.createElement('style');
  _styleEl.textContent = _CSS;
  document.head.appendChild(_styleEl);

  /* ═══════════════════════════════════════════════════════
     §4  构建 DOM
  ═══════════════════════════════════════════════════════ */
  var _srcSheet = document.createElement('div');
  _srcSheet.id = 'gp-source-sheet';
  _srcSheet.innerHTML = `
    <div id="gp-source-backdrop"></div>
    <div id="gp-source-card">
      <div id="gp-source-handle"></div>
      <div id="gp-source-title">选择图片来源</div>
      <div id="gp-source-sub">SELECT IMAGE SOURCE</div>
      <div class="gp-choice-row">
        <button class="gp-choice-btn" id="gp-btn-local">
          <div class="gp-choice-icon local"><i class="fa-solid fa-folder-open"></i></div>
          <div>
            <div class="gp-choice-label">本地上传</div>
            <div class="gp-choice-desc">FROM DEVICE</div>
          </div>
        </button>
        <button class="gp-choice-btn" id="gp-btn-gallery">
          <div class="gp-choice-icon gallery"><i class="fa-solid fa-images"></i></div>
          <div>
            <div class="gp-choice-label">Gallery</div>
            <div class="gp-choice-desc">FROM MY GALLERY</div>
          </div>
        </button>
      </div>
      <div id="gp-url-entry">或从 URL 库选择图片</div>
    </div>`;
  document.body.appendChild(_srcSheet);

  var _galPanel = document.createElement('div');
  _galPanel.id = 'gp-gallery-panel';
  _galPanel.innerHTML = `
    <div id="gp-gallery-backdrop"></div>
    <div id="gp-gallery-card">
      <div id="gp-gallery-handle"></div>
      <div id="gp-gallery-hdr">
        <div>
          <div id="gp-gallery-hdr-title">My Gallery</div>
          <div id="gp-gallery-hdr-sub">TAP A PHOTO TO USE IT ✦</div>
        </div>
        <button id="gp-gallery-close-btn"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="gp-gallery-tabs"></div>
      <div id="gp-gallery-grid"></div>
    </div>`;
  document.body.appendChild(_galPanel);

  var _urlPanel = document.createElement('div');
  _urlPanel.id = 'gp-url-panel';
  _urlPanel.innerHTML = `
    <div id="gp-url-backdrop"></div>
    <div id="gp-url-card">
      <div id="gp-url-handle"></div>
      <div id="gp-url-hdr">
        <div>
          <div id="gp-url-hdr-title">URL 库</div>
          <div id="gp-url-hdr-sub">PASTE URL · PREVIEW · APPLY ✦</div>
        </div>
        <button id="gp-url-close-btn"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="gp-url-list"></div>
      <div id="gp-url-footer">
        <button class="gp-url-footer-btn add" id="gp-url-add-btn">
          <i class="fa-solid fa-plus"></i> 新增一行
        </button>
        <button class="gp-url-footer-btn save" id="gp-url-save-btn">
          <i class="fa-solid fa-floppy-disk"></i> 保存到库
        </button>
      </div>
    </div>`;
  document.body.appendChild(_urlPanel);

  /* ═══════════════════════════════════════════════════════
     §5  状态
  ═══════════════════════════════════════════════════════ */
  var _pendingInput   = null;
  var _activeCategory = null;
  var _urlRows        = [];   // [{ url: string }]

  /* ═══════════════════════════════════════════════════════
     §6  面板开关
  ═══════════════════════════════════════════════════════ */
  function _openSource(inp) { _pendingInput = inp; _srcSheet.classList.add('gp-open'); }
  function _closeSource()   { _srcSheet.classList.remove('gp-open'); }
  function _openGallery()   { _galPanel.classList.add('gp-open'); _renderGallery(); }
  function _closeGallery()  { _galPanel.classList.remove('gp-open'); _pendingInput = null; }
  function _openUrl()       { _urlPanel.classList.add('gp-open'); _loadAndRenderUrl(); }
  function _closeUrl()      { _urlPanel.classList.remove('gp-open'); _pendingInput = null; }

  /* ═══════════════════════════════════════════════════════
     §7  渲染 Gallery
  ═══════════════════════════════════════════════════════ */
  async function _renderGallery() {
    var tabsEl = document.getElementById('gp-gallery-tabs');
    var gridEl = document.getElementById('gp-gallery-grid');
    tabsEl.innerHTML = '';
    gridEl.innerHTML = Array(6).fill('<div class="gp-skeleton"></div>').join('');

    var data = await _gpReadGallery();

    if (!data || !data.categories || Object.keys(data.categories).length === 0) {
      gridEl.innerHTML = '<div class="gp-empty"><i class="fa-regular fa-images"></i><p>Gallery 暂无图片<br>请先在主页 Gallery 中上传</p></div>';
      return;
    }

    var cats = data.categories;
    if (!_activeCategory || !cats[_activeCategory]) {
      _activeCategory = data.activeCategory || Object.keys(cats)[0];
    }

    tabsEl.innerHTML = '';
    Object.keys(cats).forEach(function (cat) {
      var count = cats[cat] ? cats[cat].length : 0;
      var tab = document.createElement('div');
      tab.className = 'gp-tab' + (cat === _activeCategory ? ' active' : '');
      tab.textContent = cat + '  ' + count;
      tab.addEventListener('click', function () { _activeCategory = cat; _renderGallery(); });
      tabsEl.appendChild(tab);
    });

    gridEl.innerHTML = '';
    var imgs = cats[_activeCategory] || [];
    if (imgs.length === 0) {
      gridEl.innerHTML = '<div class="gp-empty"><i class="fa-regular fa-image"></i><p>此分类暂无图片</p></div>';
      return;
    }
    imgs.forEach(function (src) {
      var item = document.createElement('div');
      item.className = 'gp-grid-item';
      item.innerHTML = '<img src="' + src + '" loading="lazy" decoding="async"/><div class="gp-grid-overlay"><i class="fa-solid fa-check"></i></div>';
      item.addEventListener('click', function () { _applyImage(src, item); });
      gridEl.appendChild(item);
    });
  }

  /* ═══════════════════════════════════════════════════════
     §7b  URL 库 DB 读写
  ═══════════════════════════════════════════════════════ */
  async function _gpReadUrlLib() {
    try {
      var db = await _gpOpenDB();
      return new Promise(function (resolve) {
        if (!db.objectStoreNames.contains('config')) { db.close(); resolve([]); return; }
        var tx  = db.transaction('config', 'readonly');
        var req = tx.objectStore('config').get('main_config');
        req.onsuccess = function () {
          db.close();
          var urls = req.result && req.result.urlLib ? req.result.urlLib : [];
          resolve(urls);
        };
        req.onerror = function () { db.close(); resolve([]); };
      });
    } catch (e) { return []; }
  }

  async function _gpSaveUrlLib(urls) {
    try {
      var db = await _gpOpenDB();
      return new Promise(function (resolve) {
        if (!db.objectStoreNames.contains('config')) { db.close(); resolve(); return; }
        var tx      = db.transaction('config', 'readwrite');
        var store   = tx.objectStore('config');
        var getReq  = store.get('main_config');
        getReq.onsuccess = function () {
          var rec = getReq.result || { id: 'main_config' };
          rec.urlLib = urls;
          store.put(rec).onsuccess = function () { db.close(); resolve(); };
        };
        getReq.onerror = function () { db.close(); resolve(); };
      });
    } catch (e) {}
  }

  /* ═══════════════════════════════════════════════════════
     §7c  URL 面板渲染
  ═══════════════════════════════════════════════════════ */
  async function _loadAndRenderUrl() {
    _urlRows = await _gpReadUrlLib();
    if (_urlRows.length === 0) _urlRows = [{ url: '' }];
    _renderUrlList();
  }

  function _renderUrlList() {
    var listEl = document.getElementById('gp-url-list');
    listEl.innerHTML = '';
    _urlRows.forEach(function (row, idx) {
      var rowEl = document.createElement('div');
      rowEl.className = 'gp-url-row';

      // 预览区
      var previewEl;
      if (row.url && row.url.trim()) {
        previewEl = document.createElement('div');
        previewEl.className = 'gp-url-preview';
        var img = document.createElement('img');
        img.src = row.url.trim();
        img.alt = '';
        img.onerror = function () {
          previewEl.innerHTML = '';
          previewEl.className = 'gp-url-preview-empty';
          previewEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        };
        previewEl.appendChild(img);
      } else {
        previewEl = document.createElement('div');
        previewEl.className = 'gp-url-preview-empty';
        previewEl.innerHTML = '<i class="fa-regular fa-image"></i>';
      }

      // 输入框
      var wrapEl = document.createElement('div');
      wrapEl.className = 'gp-url-input-wrap';
      var inputEl = document.createElement('input');
      inputEl.className = 'gp-url-input';
      inputEl.type = 'text';
      inputEl.placeholder = '粘贴图片 URL…';
      inputEl.value = row.url || '';

      // 输入完成后刷新预览（失焦或回车）
      function _refreshPreview() {
        _urlRows[idx].url = inputEl.value.trim();
        _renderUrlList();
      }
      inputEl.addEventListener('blur', _refreshPreview);
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); _refreshPreview(); }
      });

      var hintEl = document.createElement('div');
      hintEl.className = 'gp-url-input-hint';
      hintEl.textContent = '输入后失焦或回车可预览';
      wrapEl.appendChild(inputEl);
      wrapEl.appendChild(hintEl);

      // 右侧按钮组
      var actEl = document.createElement('div');
      actEl.className = 'gp-url-actions';

      // ✓ 应用按钮
      var checkBtn = document.createElement('button');
      checkBtn.className = 'gp-url-btn check';
      checkBtn.title = '使用此图片';
      checkBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
      checkBtn.addEventListener('click', function () {
        var url = (_urlRows[idx].url || '').trim();
        if (!url) return;
        _applyUrlImage(url);
      });

      // ✕ 删除按钮
      var delBtn = document.createElement('button');
      delBtn.className = 'gp-url-btn del';
      delBtn.title = '删除此行';
      delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      delBtn.addEventListener('click', function () {
        _urlRows.splice(idx, 1);
        if (_urlRows.length === 0) _urlRows = [{ url: '' }];
        _renderUrlList();
      });

      actEl.appendChild(checkBtn);
      actEl.appendChild(delBtn);

      rowEl.appendChild(previewEl);
      rowEl.appendChild(wrapEl);
      rowEl.appendChild(actEl);
      listEl.appendChild(rowEl);
    });
  }

  /* ═══════════════════════════════════════════════════════
     §7d  将 URL 图片转为 File 并应用
  ═══════════════════════════════════════════════════════ */
  async function _applyUrlImage(url) {
    if (!_pendingInput) return;
    var target = _pendingInput;
    try {
      var res  = await fetch(url);
      var blob = await res.blob();
      var ext  = (blob.type || 'image/jpeg').split('/')[1] || 'jpg';
      var file = new File([blob], 'url-image.' + ext, { type: blob.type || 'image/jpeg' });
      var dt = new DataTransfer();
      dt.items.add(file);
      try { Object.defineProperty(target, 'files', { value: dt.files, configurable: true, writable: true }); } catch (_) {}
      target.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(_closeUrl, 300);
    } catch (err) {
      console.error('[GalleryPicker] URL fetch failed:', err);
      alert('图片加载失败，请检查 URL 是否正确或允许跨域访问');
    }
  }


  async function _applyImage(src, itemEl) {
    if (!_pendingInput) return;
    var target = _pendingInput;
    itemEl.classList.add('gp-selecting');
    try {
      var res  = await fetch(src);
      var blob = await res.blob();
      var file = new File([blob], 'gallery-pick.jpg', { type: blob.type || 'image/jpeg' });
      var dt = new DataTransfer();
      dt.items.add(file);
      try { Object.defineProperty(target, 'files', { value: dt.files, configurable: true, writable: true }); } catch (_) {}
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      console.error('[GalleryPicker] applyImage error:', err);
    }
    setTimeout(_closeGallery, 300);
  }

  /* ═══════════════════════════════════════════════════════
     §9  面板事件
  ═══════════════════════════════════════════════════════ */
  document.getElementById('gp-source-backdrop').addEventListener('click', function () {
    _closeSource();
    _pendingInput = null;
  });

  document.getElementById('gp-btn-local').addEventListener('click', function () {
    /*
     * ⚠️  本地上传关键修复：
     * 浏览器要求 input.click() 必须在用户手势的同步调用栈内执行。
     * 如果先 _closeSource()（触发 CSS transition），再 click()，
     * 中间隔了异步/重绘，浏览器就会拒绝弹出文件选择框。
     *
     * 正确做法：先打标记 + 立即 click()，再关闭面板。
     * 顺序必须是：标记 → click → 关闭，不能反过来。
     */
    if (!_pendingInput) { _closeSource(); return; }
    var inp = _pendingInput;

    // 1. 先打放行标记
    inp.dataset.gpBypass = '1';

    // 2. 立即在用户手势调用栈内触发原生文件选择框
    inp.click();

    // 3. 之后再关面板（不影响文件对话框已弹出）
    _closeSource();

    // 4. 短暂后清除放行标记（等文件对话框完成交互）
    setTimeout(function () { delete inp.dataset.gpBypass; }, 2000);
  });

  document.getElementById('gp-btn-gallery').addEventListener('click', function () {
    _closeSource();
    _openGallery();
  });

  document.getElementById('gp-gallery-backdrop').addEventListener('click', _closeGallery);
  document.getElementById('gp-gallery-close-btn').addEventListener('click', _closeGallery);

  // URL 库入口
  document.getElementById('gp-url-entry').addEventListener('click', function () {
    _closeSource();
    _openUrl();
  });

  // URL 面板关闭
  document.getElementById('gp-url-backdrop').addEventListener('click', _closeUrl);
  document.getElementById('gp-url-close-btn').addEventListener('click', _closeUrl);

  // 新增一行
  document.getElementById('gp-url-add-btn').addEventListener('click', function () {
    _urlRows.push({ url: '' });
    _renderUrlList();
    // 滚到底让用户看到新行
    var list = document.getElementById('gp-url-list');
    setTimeout(function () { list.scrollTop = list.scrollHeight; }, 50);
  });

  // 保存到库
  document.getElementById('gp-url-save-btn').addEventListener('click', async function () {
    var btn = this;
    // 同步一次当前所有输入框的值（防止用户没失焦）
    var inputs = document.querySelectorAll('.gp-url-input');
    inputs.forEach(function (inp, i) { if (_urlRows[i]) _urlRows[i].url = inp.value.trim(); });
    // 只保存非空行
    var toSave = _urlRows.filter(function (r) { return r.url; });
    await _gpSaveUrlLib(toSave);
    // 保存成功动画
    btn.classList.add('gp-url-save-ok');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> 已保存';
    setTimeout(function () {
      btn.classList.remove('gp-url-save-ok');
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 保存到库';
    }, 1800);
  });

  /* ═══════════════════════════════════════════════════════
     §10  Hook 所有图片 input 的 click（捕获阶段）
  ═══════════════════════════════════════════════════════ */
  function _hookInput(inp) {
    if (inp._gpHooked) return;
    inp._gpHooked = true;
    inp.addEventListener('click', function (e) {
      if (!_shouldIntercept(inp)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      _openSource(inp);
    }, true);
  }

  document.querySelectorAll('input[type="file"]').forEach(_hookInput);

  new MutationObserver(function (mutations) {
    mutations.forEach(function (mut) {
      mut.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('input[type="file"]')) _hookInput(node);
        if (node.querySelectorAll) node.querySelectorAll('input[type="file"]').forEach(_hookInput);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });

  console.log('%c[GalleryPicker v2.2] ✓ 已启动', 'color:#43d9a0;font-weight:700;font-family:monospace');
})();
