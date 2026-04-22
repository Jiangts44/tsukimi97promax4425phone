/**
 * TsukiDebug.js
 * 功能：隐藏 vConsole 原生按钮，替换为可拖动的自定义 Debug 按钮
 * 集成：vConsole 召唤 + IndexedDB 数据全量 DUMP
 */

(function () {
  'use strict';

  // 1. 初始化 vConsole (保持 dark 主题)
  window._vc = typeof VConsole !== 'undefined' ? new VConsole({ theme: 'dark' }) : null;
  console.log('🟢 [Debug System] vConsole 已接管日志输出');

  // 2. 注入 CSS (隐藏原生按钮 + 自定义按钮样式)
  const style = document.createElement('style');
  style.textContent = `
    /* 强力隐藏 vConsole 原生触发按钮 */
    .vc-switch { display: none !important; }

    /* 自定义 Debug 按钮样式 (基于你提供的设计) */
    .custom-debug-btn {
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 100000; /* 确保在所有弹窗之上 */
      padding: 6px 12px;
      border-radius: 8px;
      background: #1a1a2e;
      color: #00ff88;
      border: 1px solid rgba(0, 255, 136, 0.25);
      font-family: 'Geist Mono', monospace;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.06em;
      cursor: grab;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);
      user-select: none;
      touch-action: none; /* 禁用系统手势，确保拖拽流畅 */
      transition: opacity 0.2s, transform 0.1s;
    }
    .custom-debug-btn:active { cursor: grabbing; opacity: 0.8; transform: scale(0.96); }
    .custom-debug-btn i { font-size: 10px; }
  `;
  document.head.appendChild(style);

  // 3. 渲染自定义按钮
  const debugBtn = document.createElement('div');
  debugBtn.className = 'custom-debug-btn';
  debugBtn.id = 'tsuki-custom-debug';
  debugBtn.innerHTML = '<i class="fa-solid fa-bug"></i> CONSOLE';
  document.body.appendChild(debugBtn);

  // 4. 实现悬浮拖拽逻辑 (兼容 PC 鼠标与手机触摸)
  let isDragging = false;
  let startX, startY, initialX, initialY;
  let hasMoved = false; // 用于区分“点击”和“拖拽”

  const onStart = e => {
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    const rect = debugBtn.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    hasMoved = false;
    isDragging = true;
  };

  const onMove = e => {
    if (!isDragging) return;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    const dx = clientX - startX;
    const dy = clientY - startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
      // 更新位置
      let newX = initialX + dx;
      let newY = initialY + dy;

      // 边界限制 (防止拖出屏幕)
      newX = Math.max(0, Math.min(newX, window.innerWidth - debugBtn.offsetWidth));
      newY = Math.max(0, Math.min(newY, window.innerHeight - debugBtn.offsetHeight));

      debugBtn.style.left = newX + 'px';
      debugBtn.style.top = newY + 'px';
      debugBtn.style.right = 'auto'; // 解除右侧锚定
    }
  };

  const onEnd = () => {
    if (isDragging) {
      isDragging = false;
      // 如果没有移动，判定为点击
      if (!hasMoved) {
        handleDebugClick();
      }
    }
  };

  function handleDebugClick() {
    // 1. 弹出 vConsole 界面
    if (window._vc) window._vc.show();
    // 2. 自动执行 IDB 倾倒
    window.debugDumpAllIDB();
  }

  // 绑定事件
  debugBtn.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  debugBtn.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd);

  // 5. 集成 IndexedDB 全量数据 DUMP 函数 (适配 tsukiphone 架构)
  window.debugDumpAllIDB = async function () {
    const IDB_NAME = 'tsukiphonepromax';
    console.group('%c🔬 [TSUKIMI] IndexedDB FULL DUMP', 'color:#00ff88;font-weight:bold');

    try {
      // 优先使用 index.html 已定义的 openDb 逻辑，否则手动开启
      const db =
        typeof window.openDb === 'function'
          ? await window.openDb()
          : await new Promise((res, rej) => {
              const req = indexedDB.open(IDB_NAME);
              req.onsuccess = e => res(e.target.result);
              req.onerror = e => rej(e.target.error);
            });

      console.log('📦 Database Version:', db.version);
      const stores = [...db.objectStoreNames];

      for (const sName of stores) {
        await new Promise(resolve => {
          const tx = db.transaction(sName, 'readonly');
          const store = tx.objectStore(sName);
          const req = store.getAll();

          req.onsuccess = () => {
            const data = req.result || [];
            console.group(`📂 Store: "${sName}" (${data.length} records)`);
            if (data.length > 0) {
              // 打印表格，并对长文本内容进行切片展示，防止刷屏
              console.table(
                data.map(item => {
                  const safe = { ...item };
                  if (typeof safe.content === 'string' && safe.content.length > 50)
                    safe.content = safe.content.slice(0, 50) + '...';
                  if (typeof safe.avatar === 'string' && safe.avatar.length > 20)
                    safe.avatar = safe.avatar.slice(0, 20) + '...';
                  return safe;
                }),
              );
            } else {
              console.log('  (Empty Store)');
            }
            console.groupEnd();
            resolve();
          };
          req.onerror = () => {
            console.error(`  ❌ Failed to read store: ${sName}`);
            resolve();
          };
        });
      }
    } catch (err) {
      console.error('❌ Dump Failed:', err);
    }
    console.groupEnd();
  };
})();
