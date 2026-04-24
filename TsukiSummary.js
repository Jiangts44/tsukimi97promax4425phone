/**
 * TsukiSummary.js  v1.0
 * 线下剧场 · 总结模块
 * ─────────────────────────────────────────────────────────────────
 * 功能：
 *  1. 总结提示词管理（自定义 + 恢复默认）
 *  2. 自动总结开关（监测楼层变化 → 自动触发）
 *  3. 手动总结（指定楼层数，限制不超过未总结楼层数）
 *  4. 总结后标记 isSummary: true，被总结楼层标记 isSummarized: true
 *  5. 总结存入 theater_summaries ObjectStore（独立不占楼层）
 *  6. 渲染居中📁文件夹气泡（查看摘要 / 查看原文 / 删除总结）
 *  7. 暴露 getSummaryAwareHistory() 供 TsukiSend.js 的 callApi 使用
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     0. 默认提示词
  ═══════════════════════════════════════════════════════════ */

  const DEFAULT_SUMMARY_PROMPT = `你是一位专业的剧情整理助手，负责对线下剧场的对话进行精准总结。

请对以下剧场对话内容进行总结，要求：
1. 保留关键情节发展、角色互动和重要信息
2. 记录角色的情绪变化和关系动态
3. 保持叙事连贯性，使后续读者能快速了解背景
4. 总结使用第三人称，保持客观叙述
5. 重要对话可以直接引用，但需标注说话人
6. 总结长度控制在原文的 20-30%，突出核心内容

请直接输出总结内容，不需要任何前言或说明。`;

  /* ═══════════════════════════════════════════════════════════
     1. DB 辅助（直接调用 tsukistage.html 中的 openDb / dbPut / dbGetByIndex）
  ═══════════════════════════════════════════════════════════ */

  // 与 tsukistage.html 的 openDb() 共享同一个连接，避免多连接阻塞 versionchange
  async function getDb() {
    // 优先复用 tsukistage.html 里已经打开的 _db 连接
    if (typeof window !== 'undefined' && typeof openDb === 'function') {
      try { return await openDb(); } catch (e) { /* fallback below */ }
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('tsukiphonepromax');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // 标记：theater_summaries store 是否已确认存在
  let _summaryStoreReady = false;
  let _ensureStorePromise = null;

  async function ensureSummaryStore() {
    // 单例：只跑一次
    if (_summaryStoreReady) return await getDb();
    if (_ensureStorePromise) return _ensureStorePromise;

    _ensureStorePromise = (async () => {
      const db = await getDb();
      if (db.objectStoreNames.contains('theater_summaries')) {
        _summaryStoreReady = true;
        _ensureStorePromise = null;
        return db;
      }
      // store 不存在：说明 index.html 尚未完成本次升级，或用户直接打开了 tsukistage.html
      // 此时需要自己升级，但先监听 versionchange 确保不阻塞其他页面
      const ver = db.version + 1;
      db.close();
      if (typeof window._stageClearDb === 'function') window._stageClearDb();

      return new Promise((resolve, reject) => {
        const req = indexedDB.open('tsukiphonepromax', ver);
        req.onblocked = () => {
          // 有其他标签页持有旧版本连接，向它们广播 versionchange 处理请求
          console.warn('[TsukiSummary] DB 升级等待其他标签页关闭旧连接…');
        };
        req.onupgradeneeded = e => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains('theaters')) {
            const ts = d.createObjectStore('theaters', { keyPath: 'id' });
            ts.createIndex('by_created', 'createdAt');
          }
          if (!d.objectStoreNames.contains('theater_messages')) {
            const tm = d.createObjectStore('theater_messages', { keyPath: ['theaterId', 'floor'] });
            tm.createIndex('by_theater', 'theaterId');
          }
          if (!d.objectStoreNames.contains('theater_summaries')) {
            const su = d.createObjectStore('theater_summaries', { keyPath: 'id' });
            su.createIndex('by_theater', 'theaterId');
          }
        };
        req.onsuccess = () => {
          _summaryStoreReady = true;
          _ensureStorePromise = null;
          if (typeof window._stageClearDb === 'function') window._stageClearDb();
          console.log('%c[TsukiSummary] DB 升级完成，版本:', 'color:#43d9a0;font-weight:bold', req.result.version);
          resolve(req.result);
        };
        req.onerror = () => {
          _ensureStorePromise = null;
          reject(req.error);
        };
      });
    })();

    return _ensureStorePromise;
  }

  async function _dbGetByIndex(storeName, indexName, key) {
    const db = await getDb();
    return new Promise((res, rej) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).index(indexName).getAll(key);
        req.onsuccess = () => res(req.result || []);
        req.onerror = e => rej(e.target.error);
      } catch (e) { rej(e); }
    });
  }

  async function _dbPut(storeName, record) {
    const db = await getDb();
    return new Promise((res, rej) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => res();
        tx.onerror = e => rej(e.target.error);
      } catch (e) { rej(e); }
    });
  }

  async function _dbDelete(storeName, key) {
    const db = await getDb();
    return new Promise((res, rej) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => res();
        tx.onerror = e => rej(e.target.error);
      } catch (e) { rej(e); }
    });
  }

  async function _getNextFloor(theaterId) {
    const msgs = await _dbGetByIndex('theater_messages', 'by_theater', theaterId);
    const maxFloor = msgs.reduce((max, m) => Math.max(max, m.floor || 0), 0);
    return maxFloor + 1;
  }

  async function saveSummary(summaryObj) {
    const db = await ensureSummaryStore();
    return new Promise((res, rej) => {
      const tx = db.transaction('theater_summaries', 'readwrite');
      tx.objectStore('theater_summaries').put(summaryObj);
      tx.oncomplete = () => res();
      tx.onerror = e => rej(e.target.error);
    });
  }

  async function deleteSummaryById(id) {
    const db = await ensureSummaryStore();
    return new Promise((res, rej) => {
      const tx = db.transaction('theater_summaries', 'readwrite');
      tx.objectStore('theater_summaries').delete(id);
      tx.oncomplete = () => res();
      tx.onerror = e => rej(e.target.error);
    });
  }

  async function getSummariesByTheater(theaterId) {
    const db = await ensureSummaryStore();
    return new Promise((res, rej) => {
      const tx = db.transaction('theater_summaries', 'readonly');
      const req = tx.objectStore('theater_summaries').index('by_theater').getAll(theaterId);
      req.onsuccess = () => res((req.result || []).sort((a, b) => a.floorStart - b.floorStart));
      req.onerror = e => rej(e.target.error);
    });
  }

  async function getSummaryById(id) {
    const db = await ensureSummaryStore();
    return new Promise((res, rej) => {
      const tx = db.transaction('theater_summaries', 'readonly');
      const req = tx.objectStore('theater_summaries').get(id);
      req.onsuccess = () => res(req.result);
      req.onerror = e => rej(e.target.error);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     2. 配置读取 & 写入（localstorage 轻量方案）
  ═══════════════════════════════════════════════════════════ */

  const CFG_KEY = 'tsuki_summary_config';

  function loadSummaryCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      prompt: DEFAULT_SUMMARY_PROMPT,
      autoEnabled: false,
      autoFloorCount: 15,
      manualFloorCount: 15,
    };
  }

  function saveSummaryCfg(cfg) {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  let _cfg = loadSummaryCfg();

  // 同步更新内存 _cfg 并持久化
  function _saveCfgAndSync(patch) {
    _cfg = { ..._cfg, ...patch };
    saveSummaryCfg(_cfg);
  }

  /* ═══════════════════════════════════════════════════════════
     3. API 调用（复用 TsukiSend 的配置读取）
  ═══════════════════════════════════════════════════════════ */

  async function callSummaryApi(textContent, prompt) {
    // 直接读 IndexedDB main_config，与 StageSend.js 保持一致，不依赖 TsukiSend
    const db = await getDb();
    const mainConfig = await new Promise(res => {
      const tx = db.transaction('config', 'readonly');
      const req = tx.objectStore('config').get('main_config');
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });
    if (!mainConfig || !mainConfig.api) throw new Error('API 配置丢失，请在设置中填写');
    const api = mainConfig.api;
    const cfg = api.activePreset && api.presets ? api.presets[api.activePreset] : api.temp;
    if (!cfg || !cfg.url) throw new Error('未配置 API 地址，请在设置中填写');

    let apiUrl = cfg.url.trim();
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl += apiUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
    }
    const finalUrl = apiUrl;
    const apiKey = cfg.key || '';
    const model = cfg.model || 'gpt-4o';
    const temperature = parseFloat(cfg.temp) || 0.5;
    const maxTokens = parseInt(cfg.maxTokens) || 2000;

    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: textContent },
    ];

    console.group('%c📚 [TsukiSummary] 总结 API 请求', 'color:#43d9a0;font-weight:bold;font-size:13px');
    console.log('URL:', finalUrl);
    console.log('Model:', model);
    console.log('提示词（前100字）:', prompt.slice(0, 100) + '...');
    console.log('原文长度（字符）:', textContent.length);
    console.log('发送消息结构:', messages);
    console.groupEnd();

    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`API ${res.status}: ${data.error?.message || '未知错误'}`);

    const result = data.choices?.[0]?.message?.content || '';
    console.group('%c📚 [TsukiSummary] 总结 API 响应', 'color:#43d9a0;font-weight:bold;font-size:13px');
    console.log('总结结果:', result);
    console.groupEnd();

    return result;
  }

  /* ═══════════════════════════════════════════════════════════
     4. 消息格式化（构建发给 AI 的原文）
  ═══════════════════════════════════════════════════════════ */

  function formatMsgsForSummary(msgs, S) {
    return msgs.map(m => {
      let rname;
      if (m.isNarrator || m.sender === 'narrator') {
        rname = '[旁白]';
      } else if (m.isUser || m.sender === 'user') {
        const u = (S.users || []).find(u => u && u.id === m.charId) || (S.users || []).find(Boolean);
        rname = u?.name || 'User';
      } else {
        const c = (S.chars || []).find(c => c.id === m.charId) || (S.chars || [])[0];
        rname = c?.name || '?';
      }
      const txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return `F·${m.floor} ${rname}: ${txt}`;
    }).join('\n');
  }

  /* ═══════════════════════════════════════════════════════════
     5. 核心总结执行
  ═══════════════════════════════════════════════════════════ */

  /**
   * 执行一次总结
   * @param {number[]} floors  要总结的楼层号数组（按顺序）
   * @param {object}   S       tsukistage.html 的状态对象（含 theater, chars, users）
   * @param {Function} onDone  完成回调 (summaryRecord) => void
   */
  async function executeSummary(floors, S, onDone) {
    if (!floors.length || !S.theater) throw new Error('无有效楼层可总结');

    console.group('%c🗂️ [TsukiSummary] 开始执行总结', 'color:#d4ff4d;font-weight:bold;font-size:14px');
    console.log('目标楼层:', floors);
    console.log('剧场 ID:', S.theater.id);

    // 1. 读取对应楼层的消息
    let allMsgs = await _dbGetByIndex('theater_messages', 'by_theater', S.theater.id);
    allMsgs = allMsgs.sort((a, b) => a.floor - b.floor);

    const toSummarize = allMsgs.filter(m =>
      floors.includes(m.floor) &&
      m.type !== 'prologue' &&
      m.type !== 'history' &&
      !m.isSummary &&
      !(m.isSummarized === true)
    );

    if (!toSummarize.length) throw new Error('所选楼层中没有可总结的内容');

    const floorStart = toSummarize[0].floor;
    const floorEnd = toSummarize[toSummarize.length - 1].floor;

    console.log(`实际总结楼层: F·${floorStart} → F·${floorEnd}，共 ${toSummarize.length} 条`);
    console.log('待总结原文片段:', formatMsgsForSummary(toSummarize.slice(0, 3), S) + (toSummarize.length > 3 ? '\n...' : ''));

    // 2. 格式化原文
    const rawText = formatMsgsForSummary(toSummarize, S);

    // 3. 调 API
    const summaryText = await callSummaryApi(rawText, _cfg.prompt);

    // 4. 标记原消息 isSummarized: true
    for (const m of toSummarize) {
      const updated = { ...m, isSummarized: true };
      await _dbPut('theater_messages', updated);
    }
    console.log(`✅ 已标记 ${toSummarize.length} 条消息为 isSummarized: true`);

    // 5. 构建总结记录
    const summaryId = `summary_${S.theater.id}_${floorStart}_${floorEnd}_${Date.now()}`;
    const summaryRecord = {
      id: summaryId,
      theaterId: S.theater.id,
      floorStart,
      floorEnd,
      floorCount: toSummarize.length,
      rawText,
      summaryText,
      timestamp: Date.now(),
    };

    await saveSummary(summaryRecord);
    console.log('✅ 总结记录已保存到 theater_summaries:', summaryId);

    // summary_bubble 不再占用新楼层——renderMessages 会在 floorStart 位置虚拟插入文件夹气泡
    // theater 的 lastFloor 保持不变
    S.theater.updatedAt = Date.now();
    await _dbPut('theaters', S.theater);

    console.log(`✅ 总结完成，文件夹将由 renderMessages 在 F·${floorStart} 位置渲染`);
    console.groupEnd();

    // bubbleMsg 作为虚拟对象传回，供调用方使用（不存入 theater_messages）
    const bubbleMsg = {
      theaterId: S.theater.id,
      floor: floorStart, // 渲染位置 = 被总结范围的起始楼层
      type: 'summary_bubble',
      isSummary: true,
      sender: 'system',
      charId: null,
      charIds: [],
      summaryId,
      floorStart,
      floorEnd,
      floorCount: toSummarize.length,
      content: summaryText,
      timestamp: Date.now(),
    };

    if (typeof onDone === 'function') onDone(bubbleMsg, summaryRecord);
    return { bubbleMsg, summaryRecord };
  }

  /* ═══════════════════════════════════════════════════════════
     6. 文件夹气泡渲染
  ═══════════════════════════════════════════════════════════ */

  function buildSummaryFolderBubble(msg) {
    const el = document.createElement('div');
    el.className = 'tsuki-summary-folder';
    el.dataset.floor = msg.floor;
    el.dataset.summaryId = msg.summaryId;

    el.innerHTML = `
      <div class="tsf-inner">
        <div class="tsf-delete-btn" title="删除总结" data-sid="${msg.summaryId}" data-floor="${msg.floor}">
          <i class="fa-solid fa-xmark"></i>
        </div>
        <div class="tsf-icon">📁</div>
        <div class="tsf-range">F·${msg.floorStart} — F·${msg.floorEnd}</div>
        <div class="tsf-count">${msg.floorCount} 条内容已归档</div>
        <div class="tsf-actions">
          <button class="tsf-btn tsf-view-summary" data-sid="${msg.summaryId}">
            <i class="fa-solid fa-sparkles"></i>查看总结摘要
          </button>
          <button class="tsf-btn tsf-view-raw" data-sid="${msg.summaryId}">
            <i class="fa-solid fa-scroll"></i>查看总结原文
          </button>
        </div>
      </div>`;

    // 查看总结摘要
    el.querySelector('.tsf-view-summary').addEventListener('click', async () => {
      const rec = await getSummaryById(msg.summaryId);
      if (!rec) { alert('找不到总结记录'); return; }
      openSummaryModal(rec, 'summary', msg);
    });

    // 查看总结原文
    el.querySelector('.tsf-view-raw').addEventListener('click', async () => {
      const rec = await getSummaryById(msg.summaryId);
      if (!rec) { alert('找不到总结记录'); return; }
      openSummaryModal(rec, 'raw', msg);
    });

    // 删除总结
    el.querySelector('.tsf-delete-btn').addEventListener('click', async () => {
      await handleDeleteSummary(msg, el);
    });

    return el;
  }

  /* ═══════════════════════════════════════════════════════════
     7. 删除总结处理
  ═══════════════════════════════════════════════════════════ */

  async function handleDeleteSummary(msg, bubbleEl) {
    const S = window._tsukiS;
    if (!S) return;

    const confirmed = confirm(`删除 F·${msg.floorStart}—F·${msg.floorEnd} 的总结？\n将把原始楼层吐回舞台区域。`);
    if (!confirmed) return;

    console.group('%c🗑️ [TsukiSummary] 删除总结', 'color:#ff6b6b;font-weight:bold;font-size:14px');
    console.log('summaryId:', msg.summaryId);
    console.log('楼层范围:', msg.floorStart, '-', msg.floorEnd);

    try {
      // 1. 从 theater_summaries 读取完整记录，确保 floorStart/floorEnd 准确
      const summaryRecord = await getSummaryById(msg.summaryId);
      if (!summaryRecord) throw new Error('找不到总结记录，可能已被删除');
      const { floorStart, floorEnd } = summaryRecord;
      console.log(`[TsukiSummary] 总结记录：F·${floorStart}–F·${floorEnd}`);

      // 2. 删除 theater_summaries 记录
      await deleteSummaryById(msg.summaryId);
      console.log('✅ 已从 theater_summaries 删除');

      // 3. 恢复被标记的原消息 isSummarized → false（用 summaryRecord 的范围，更可靠）
      let allMsgs = await _dbGetByIndex('theater_messages', 'by_theater', S.theater.id);
      console.log(`[TsukiSummary] 全部消息共 ${allMsgs.length} 条，查找 floor ${floorStart}–${floorEnd} 内 isSummarized=true 的`);
      const toRestore = allMsgs.filter(m =>
        m.floor >= floorStart && m.floor <= floorEnd && m.isSummarized === true
      );
      console.log(`[TsukiSummary] 找到 ${toRestore.length} 条需要恢复:`, toRestore.map(m => `F·${m.floor}`));
      for (const m of toRestore) {
        const restored = { ...m, isSummarized: false };
        await _dbPut('theater_messages', restored);
        console.log(`  ✅ F·${m.floor} isSummarized → false`);
      }
      console.log(`✅ 已恢复 ${toRestore.length} 条消息的 isSummarized 标记`);

      // 4. 移除气泡 DOM，立即用 renderMessages() 重渲染（原始楼层会重新出现）
      bubbleEl.style.transition = 'opacity 0.25s, transform 0.25s';
      bubbleEl.style.opacity = '0';
      bubbleEl.style.transform = 'scale(0.9)';
      setTimeout(async () => {
        bubbleEl.remove();
        if (typeof window.renderMessages === 'function') {
          await window.renderMessages();
        }
        await updateSummaryFloorStatus(S.theater.id);

        // 询问是否立即重新总结
        const resum = confirm(`已吐出 ${toRestore.length} 条原始楼层（F·${floorStart}–F·${floorEnd}）。\n是否立即对这些楼层重新进行总结？`);
        if (resum) {
          try {
            await executeSummary(toRestore.map(m => m.floor), S);
            if (typeof window.renderMessages === 'function') await window.renderMessages();
            await updateSummaryFloorStatus(S.theater.id);
            console.log('[TsukiSummary] 重新总结完成');
          } catch (e) {
            console.error('[TsukiSummary] 重新总结失败:', e);
            alert('重新总结失败：' + e.message);
          }
        }
      }, 260);

      console.groupEnd();
    } catch (e) {
      console.error('[TsukiSummary] 删除总结失败:', e);
      alert('删除失败：' + e.message);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     8. 总结摘要弹窗（可编辑）
  ═══════════════════════════════════════════════════════════ */

  function openSummaryModal(rec, mode, bubbleMsg) {
    document.getElementById('tsuki-summary-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'tsuki-summary-modal';
    const isEdit = (mode === 'summary');
    const title = isEdit
      ? `总结摘要 · F·${rec.floorStart}–F·${rec.floorEnd}`
      : `总结原文 · F·${rec.floorStart}–F·${rec.floorEnd}`;

    modal.innerHTML = `
      <div class="tsm-bg"></div>
      <div class="tsm-sheet">
        <div class="tsm-head">
          <div class="tsm-title">${title}</div>
          <button class="tsm-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        ${isEdit ? `
        <div class="tsm-body">
          <textarea class="tsm-textarea" id="tsmEditArea">${escapeHtml(rec.summaryText)}</textarea>
        </div>
        <div class="tsm-footer">
          <button class="tsm-save-btn"><i class="fa-solid fa-check"></i> 保存修改</button>
        </div>` : `
        <div class="tsm-body tsm-body-raw" id="tsmRawBody"></div>`}
      </div>`;

    document.body.appendChild(modal);

    // 原文模式：按楼层逐条渲染迷你气泡
    if (!isEdit) {
      const rawBody = modal.querySelector('#tsmRawBody');
      // rawText 格式：每行 "F·N 角色名: 内容"
      const lines = (rec.rawText || '').split('\n').filter(l => l.trim());
      if (lines.length === 0) {
        rawBody.innerHTML = `<div style="color:rgba(255,255,255,0.3);font-family:'Geist Mono',monospace;font-size:11px;text-align:center;padding:20px">无原文记录</div>`;
      } else {
        lines.forEach(line => {
          // 解析 "F·12 角色: 内容"
          const match = line.match(/^(F·\d+)\s+(.+?):\s*([\s\S]*)$/);
          const floorTag = match ? match[1] : '';
          const sender   = match ? match[2] : '';
          const content  = match ? match[3] : line;

          // 判断角色类型
          const isNarr = sender === '[旁白]' || sender === '旁白';
          const isUser = sender === 'User' || sender === '玩家' || sender === 'user';

          const item = document.createElement('div');
          item.className = 'tsm-raw-item' + (isNarr ? ' tsm-raw-narr' : isUser ? ' tsm-raw-user' : ' tsm-raw-char');
          item.innerHTML = `
            <div class="tsm-raw-meta">
              <span class="tsm-raw-sender">${escapeHtml(isNarr ? '旁白' : sender)}</span>
              <span class="tsm-raw-floor">${floorTag}</span>
            </div>
            <div class="tsm-raw-content">${escapeHtml(content)}</div>`;
          rawBody.appendChild(item);
        });
      }
    }

    // 关闭
    const close = () => modal.remove();
    modal.querySelector('.tsm-close').addEventListener('click', close);
    modal.querySelector('.tsm-bg').addEventListener('click', close);

    // 摘要保存
    if (isEdit) {
      modal.querySelector('.tsm-save-btn').addEventListener('click', async () => {
        const newText = modal.querySelector('#tsmEditArea').value;
        const updated = { ...rec, summaryText: newText };
        await saveSummary(updated);

        // 同步更新 summary_bubble 的 content
        const db = await getDb();
        const bubbleRec = await new Promise(res => {
          const tx = db.transaction('theater_messages', 'readonly');
          const req = tx.objectStore('theater_messages').get([bubbleMsg.theaterId, bubbleMsg.floor]);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        if (bubbleRec) {
          bubbleRec.content = newText;
          await _dbPut('theater_messages', bubbleRec);
        }
        console.log('[TsukiSummary] 摘要已更新:', rec.id);
        close();
        const existingBubble = document.querySelector(`.tsuki-summary-folder[data-summary-id="${rec.id}"]`);
        if (existingBubble) {
          const newBubble = buildSummaryFolderBubble({ ...bubbleMsg, content: newText });
          existingBubble.replaceWith(newBubble);
        }
      });
    }

    requestAnimationFrame(() => modal.classList.add('open'));
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ═══════════════════════════════════════════════════════════
     9. 自动总结监控（监听楼层变化）
  ═══════════════════════════════════════════════════════════ */

  let _autoWatchInterval = null;
  let _lastCheckedFloor = 0;

  let _autoSummaryRunning = false; // 防重入锁

  function startAutoWatch(S) {
    stopAutoWatch();
    console.log('%c🤖 [TsukiSummary] 自动总结已开启，每 5s 检查楼层变化', 'color:#d4ff4d;font-weight:bold');

    // 核心检查函数，抽出来复用（立即触发 + 定时触发）
    async function checkAndSummarize() {
      if (!S.theater || !_cfg.autoEnabled) { stopAutoWatch(); return; }
      if (_autoSummaryRunning) return;
      try {
        const unsummarized = await getUnsummarizedFloors(S.theater.id);
        if (unsummarized.length < _cfg.autoFloorCount) return;

        const currentMax = Math.max(...unsummarized.map(m => m.floor));
        if (currentMax <= _lastCheckedFloor) return;

        console.log(`%c🤖 [TsukiSummary] 自动触发总结（未总结: ${unsummarized.length} ≥ ${_cfg.autoFloorCount}）`, 'color:#d4ff4d;font-weight:bold');
        _autoSummaryRunning = true;

        // 只取第一段连续楼层，不跨断点
        const firstSegment = [unsummarized[0]];
        for (let i = 1; i < unsummarized.length && firstSegment.length < _cfg.autoFloorCount; i++) {
          if (unsummarized[i].floor === firstSegment[firstSegment.length - 1].floor + 1) {
            firstSegment.push(unsummarized[i]);
          } else {
            break;
          }
        }
        if (firstSegment.length < _cfg.autoFloorCount) {
          _autoSummaryRunning = false;
          return;
        }
        const floors = firstSegment.map(m => m.floor);
        const area = document.getElementById('sArea');
        try {
          const { bubbleMsg } = await executeSummary(floors, S);
          _lastCheckedFloor = currentMax;

          if (typeof window.renderMessages === 'function') {
            await window.renderMessages();
          } else {
            const floorSet = new Set(floors);
            area?.querySelectorAll('[data-floor]').forEach(el => {
              if (floorSet.has(Number(el.dataset.floor))) el.remove();
            });
            area?.querySelector('.s-empty')?.remove();
            const folderEl = buildSummaryFolderBubble(bubbleMsg);
            area?.appendChild(folderEl);
          }
          if (area) area.scrollTop = area.scrollHeight;
          await updateSummaryFloorStatus(S.theater.id);

          // ✅ 总结完一次后立即再检查一遍（可能还有剩余楼层需要继续总结）
          _autoSummaryRunning = false;
          await checkAndSummarize();
          return; // 递归检查后不继续往下走 finally
        } catch (e) {
          console.error('[TsukiSummary] 自动总结失败:', e);
        } finally {
          _autoSummaryRunning = false;
        }
      } catch (e) {
        console.error('[TsukiSummary] 自动监控出错:', e);
        _autoSummaryRunning = false;
      }
    }

    // ✅ 立即执行一次检查（不等 5 秒）
    checkAndSummarize();

    _autoWatchInterval = setInterval(checkAndSummarize, 5000);
  }

  function stopAutoWatch() {
    if (_autoWatchInterval) {
      clearInterval(_autoWatchInterval);
      _autoWatchInterval = null;
      console.log('%c🤖 [TsukiSummary] 自动总结已关闭', 'color:#ff6b6b;font-weight:bold');
    }
  }

  /* ═══════════════════════════════════════════════════════════
     10. 楼层状态查询
  ═══════════════════════════════════════════════════════════ */

  async function getUnsummarizedFloors(theaterId) {
    let msgs = await _dbGetByIndex('theater_messages', 'by_theater', theaterId);
    return msgs
      .filter(m =>
        m.type !== 'prologue' &&
        m.type !== 'history' &&
        m.type !== 'summary_bubble' &&
        !m.isSummary &&
        !(m.isSummarized === true)
      )
      .sort((a, b) => a.floor - b.floor);
  }

  async function getSummarizedFloorCount(theaterId) {
    let msgs = await _dbGetByIndex('theater_messages', 'by_theater', theaterId);
    return msgs.filter(m => m.isSummarized === true).length;
  }

  /* ═══════════════════════════════════════════════════════════
     11. 设置面板 UI 渲染 & 绑定（由 HTML 调用）
  ═══════════════════════════════════════════════════════════ */

  async function updateSummaryFloorStatus(theaterId) {
    if (!theaterId) return;
    const unsummarized = await getUnsummarizedFloors(theaterId);
    const summarizedCount = await getSummarizedFloorCount(theaterId);

    const el = document.getElementById('tsukiSummaryFloorStatus');
    if (el) {
      let rangeStr = '无';
      if (unsummarized.length > 0) {
        // 把间断的楼层分组，连续的用 N–M，间断的用逗号隔开
        const groups = [];
        let gStart = unsummarized[0].floor, gEnd = unsummarized[0].floor;
        for (let i = 1; i < unsummarized.length; i++) {
          const f = unsummarized[i].floor;
          if (f === gEnd + 1) {
            gEnd = f;
          } else {
            groups.push(gStart === gEnd ? `F·${gStart}` : `F·${gStart}–F·${gEnd}`);
            gStart = gEnd = f;
          }
        }
        groups.push(gStart === gEnd ? `F·${gStart}` : `F·${gStart}–F·${gEnd}`);
        rangeStr = groups.join(', ');
      }
      el.innerHTML = `
        <span class="sfs-done">✓ 已总结 <strong>${summarizedCount}</strong> 条</span>
        <span class="sfs-sep">·</span>
        <span class="sfs-pending">待总结 <strong>${unsummarized.length}</strong> 条${unsummarized.length > 0 ? ' (' + rangeStr + ')' : ''}</span>`;
    }

    // 同步更新手动总结楼层上限
    const manualInput = document.getElementById('tsukiManualFloorCount');
    if (manualInput) {
      const max = Math.max(0, unsummarized.length);
      manualInput.max = max;
      if (parseInt(manualInput.value) > max) manualInput.value = max;
      const manualMax = document.getElementById('tsukiManualFloorMax');
      if (manualMax) manualMax.textContent = `/ ${max}`;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     12. 暴露给 TsukiSend.js — 构建"总结优先"的历史提示词
  ═══════════════════════════════════════════════════════════ */

  /**
   * 获取总结感知的历史记录（供 StageSend/TsukiSend 的 buildFinalPromptStream 或 callApi 使用）
   * 返回格式：数组，每项是一个段落文本
   * - 已总结的楼层 → 以摘要替代
   * - 未总结的楼层 → 原始逐条消息
   */
  async function getSummaryAwareHistory(theaterId, S) {
    if (!theaterId || !S) return [];

    console.group('%c📋 [TsukiSummary] 构建总结优先历史记录', 'color:#5b7cfa;font-weight:bold;font-size:13px');

    // 获取所有总结记录
    const summaries = await getSummariesByTheater(theaterId);
    console.log(`共 ${summaries.length} 条总结记录:`, summaries.map(s => `F·${s.floorStart}–F·${s.floorEnd}`));

    // 获取所有舞台消息
    let allMsgs = await _dbGetByIndex('theater_messages', 'by_theater', theaterId);
    allMsgs = allMsgs.sort((a, b) => a.floor - b.floor);

    // 过滤掉系统气泡
    const usableMsgs = allMsgs.filter(m =>
      m.type !== 'prologue' &&
      m.type !== 'history' &&
      m.type !== 'summary_bubble' &&
      !m.isSummary
    );

    console.log(`全部可用消息: ${usableMsgs.length} 条`);

    const segments = [];

    // 将消息分段：总结段 vs 原始段
    for (const summary of summaries) {
      segments.push({
        type: 'summary',
        floorStart: summary.floorStart,
        floorEnd: summary.floorEnd,
        text: `【剧情摘要 F·${summary.floorStart}–F·${summary.floorEnd}】\n${summary.summaryText}`,
      });
    }

    // 找出未被任何总结覆盖的消息
    const coveredFloors = new Set();
    for (const s of summaries) {
      for (let f = s.floorStart; f <= s.floorEnd; f++) coveredFloors.add(f);
    }

    const uncoveredMsgs = usableMsgs.filter(m => !coveredFloors.has(m.floor));
    if (uncoveredMsgs.length > 0) {
      segments.push({
        type: 'raw',
        floorStart: uncoveredMsgs[0].floor,
        floorEnd: uncoveredMsgs[uncoveredMsgs.length - 1].floor,
        text: formatMsgsForSummary(uncoveredMsgs, S),
      });
    }

    // 按楼层排序
    segments.sort((a, b) => a.floorStart - b.floorStart);

    const result = segments.map(seg => seg.text);

    console.log('最终历史记录段落:');
    segments.forEach((seg, i) => {
      console.log(`  [${i + 1}] ${seg.type === 'summary' ? '📚摘要' : '📝原文'} F·${seg.floorStart}–F·${seg.floorEnd}: ${seg.text.slice(0, 60)}...`);
    });
    console.groupEnd();

    return result;
  }

  /* ═══════════════════════════════════════════════════════════
     13. 注入 CSS 样式
  ═══════════════════════════════════════════════════════════ */

  function injectStyles() {
    if (document.getElementById('tsuki-summary-styles')) return;
    const style = document.createElement('style');
    style.id = 'tsuki-summary-styles';
    style.textContent = `

/* ── 总结文件夹气泡 ── */
.tsuki-summary-folder {
  display: flex;
  justify-content: center;
  padding: 6px 0;
  animation: fadeUp 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
.tsf-inner {
  position: relative;
  width: 82%;
  max-width: 320px;
  background: linear-gradient(140deg, rgba(212, 255, 77, 0.06), rgba(67, 217, 160, 0.05));
  border: 1px solid rgba(212, 255, 77, 0.2);
  border-radius: 20px 20px 16px 16px;
  padding: 16px 16px 12px;
  backdrop-filter: blur(8px);
  text-align: center;
}
.tsf-inner::before {
  content: '';
  position: absolute;
  top: 0;
  left: 15%;
  right: 15%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(212, 255, 77, 0.5), transparent);
}
.tsf-delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 107, 107, 0.12);
  color: rgba(255, 107, 107, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  cursor: pointer;
  transition: 0.18s;
  border: 1px solid rgba(255, 107, 107, 0.15);
}
.tsf-delete-btn:hover {
  background: rgba(255, 107, 107, 0.22);
  color: #ff6b6b;
}
.tsf-icon {
  font-size: 28px;
  margin-bottom: 4px;
  filter: drop-shadow(0 2px 6px rgba(212, 255, 77, 0.3));
}
.tsf-range {
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-lime, #d4ff4d);
  letter-spacing: 0.1em;
  margin-bottom: 2px;
}
.tsf-count {
  font-family: 'Geist Mono', monospace;
  font-size: 8.5px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.08em;
  margin-bottom: 10px;
}
.tsf-actions {
  display: flex;
  gap: 6px;
}
.tsf-btn {
  flex: 1;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.65);
  font-family: 'Geist Mono', monospace;
  font-size: 8.5px;
  letter-spacing: 0.06em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: 0.18s;
}
.tsf-btn:hover {
  background: rgba(212, 255, 77, 0.1);
  border-color: rgba(212, 255, 77, 0.25);
  color: var(--accent-lime, #d4ff4d);
}
.tsf-btn i { font-size: 8px; }

/* day-mode overrides */
#p-stage.day-mode .tsf-inner {
  background: linear-gradient(140deg, rgba(212, 255, 77, 0.07), rgba(67, 217, 160, 0.05));
  border-color: rgba(67, 217, 160, 0.22);
}
#p-stage.day-mode .tsf-range { color: #6a8e00; }
#p-stage.day-mode .tsf-count { color: rgba(10, 10, 10, 0.4); }
#p-stage.day-mode .tsf-btn {
  background: rgba(10, 10, 10, 0.04);
  border-color: rgba(10, 10, 10, 0.1);
  color: rgba(10, 10, 10, 0.6);
}
#p-stage.day-mode .tsf-btn:hover {
  background: rgba(10, 10, 10, 0.08);
  border-color: rgba(10, 10, 10, 0.2);
  color: var(--ink, #0a0a0a);
}

/* ── 总结摘要弹窗 ── */
#tsuki-summary-modal {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s;
}
#tsuki-summary-modal.open { opacity: 1; }
.tsm-bg {
  position: absolute;
  inset: 0;
  background: rgba(10, 10, 10, 0.55);
  backdrop-filter: blur(12px);
}
.tsm-sheet {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 520px;
  height: 80vh;
  max-height: 80vh;
  background: var(--s-card, #17171b);
  border-radius: 24px 24px 0 0;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-bottom: none;
  display: flex;
  flex-direction: column;
  transform: translateY(40px);
  transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
}
#tsuki-summary-modal.open .tsm-sheet { transform: translateY(0); }
.tsm-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.065);
}
.tsm-title {
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-size: 20px;
  color: white;
}
.tsm-close {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: 0.18s;
}
.tsm-close:hover { background: rgba(255, 255, 255, 0.12); color: white; }
.tsm-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px;
  scrollbar-width: none;
  min-height: 0;
}
.tsm-body::-webkit-scrollbar { display: none; }
.tsm-textarea {
  width: 100%;
  height: 100%;
  min-height: 200px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.065);
  border-radius: 14px;
  padding: 12px 14px;
  font-family: 'Geist', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.82);
  resize: none;
  outline: none;
  line-height: 1.65;
}
.tsm-textarea:focus { border-color: rgba(212, 255, 77, 0.3); }
.tsm-rawtext {
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.7;
  white-space: pre-wrap;
}

/* ── 原文逐条气泡 ── */
.tsm-body-raw {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.tsm-raw-item {
  border-radius: 10px 14px 10px 14px;
  padding: 7px 11px 8px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.03);
}
.tsm-raw-narr {
  background: rgba(255,159,67,0.06);
  border-color: rgba(255,159,67,0.15);
}
.tsm-raw-user {
  background: rgba(255,180,210,0.05);
  border-color: rgba(255,180,210,0.12);
}
.tsm-raw-char {
  background: rgba(91,124,250,0.05);
  border-color: rgba(91,124,250,0.13);
}
.tsm-raw-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.tsm-raw-sender {
  font-family: 'Geist Mono', monospace;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.5);
}
.tsm-raw-narr .tsm-raw-sender { color: rgba(255,159,67,0.75); }
.tsm-raw-user .tsm-raw-sender { color: rgba(255,180,210,0.75); }
.tsm-raw-char .tsm-raw-sender { color: rgba(91,124,250,0.75); }
.tsm-raw-floor {
  font-family: 'Geist Mono', monospace;
  font-size: 7.5px;
  color: rgba(255,255,255,0.2);
  letter-spacing: 0.08em;
}
.tsm-raw-content {
  font-size: 12px;
  color: rgba(255,255,255,0.72);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.tsm-footer {
  flex-shrink: 0;
  padding: 10px 18px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.065);
}
.tsm-save-btn {
  width: 100%;
  height: 44px;
  background: var(--ink, #0a0a0a);
  color: var(--accent-lime, #d4ff4d);
  border: none;
  border-radius: 14px;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: 0.2s;
}
.tsm-save-btn:active { transform: scale(0.98); }

/* ── 设置面板 - 自动总结开关 ── */
.auto-sum-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--s-line, rgba(255,255,255,0.065));
  border-radius: 14px;
  margin-bottom: 8px;
}
.auto-sum-toggle-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  font-family: 'Geist', sans-serif;
}
.auto-sum-switch {
  width: 46px;
  height: 26px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  position: relative;
  transition: background 0.28s, border-color 0.28s;
  flex-shrink: 0;
}
.auto-sum-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  transition: left 0.28s cubic-bezier(0.22, 1, 0.36, 1), background 0.28s;
}
.auto-sum-switch.on {
  background: linear-gradient(135deg, rgba(212, 255, 77, 0.35), rgba(67, 217, 160, 0.3));
  border-color: rgba(212, 255, 77, 0.45);
}
.auto-sum-switch.on::after {
  left: 21px;
  background: var(--accent-lime, #d4ff4d);
  box-shadow: 0 0 6px rgba(212, 255, 77, 0.5);
}

/* ── 楼层状态文字 ── */
#tsukiSummaryFloorStatus {
  font-family: 'Geist Mono', monospace;
  font-size: 8.5px;
  color: var(--s-mute, rgba(255,255,255,0.32));
  padding: 4px 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: 0.06em;
}
.sfs-done { color: var(--accent-mint, #43d9a0); }
.sfs-sep { opacity: 0.35; }
.sfs-pending { color: var(--accent-amber, #ff9f43); }

/* ── 提示词文本框 ── */
.sum-prompt-wrap {
  position: relative;
}
.sum-prompt-reset {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 3px 9px;
  font-family: 'Geist Mono', monospace;
  font-size: 7.5px;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  letter-spacing: 0.08em;
  transition: 0.18s;
}
.sum-prompt-reset:hover {
  background: rgba(255, 107, 107, 0.12);
  border-color: rgba(255, 107, 107, 0.25);
  color: #ff6b6b;
}
.sum-prompt-textarea {
  width: 100%;
  min-height: 96px;
  max-height: 160px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.065);
  border-radius: 12px;
  padding: 10px 12px;
  padding-right: 60px;
  font-family: 'Geist', sans-serif;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.72);
  resize: vertical;
  outline: none;
  line-height: 1.6;
  scrollbar-width: none;
  transition: border-color 0.2s;
}
.sum-prompt-textarea:focus { border-color: rgba(212, 255, 77, 0.28); }
.sum-prompt-textarea::-webkit-scrollbar { display: none; }

/* ── 手动总结按钮 ── */
.sum-manual-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--s-line, rgba(255,255,255,0.065));
  border-radius: 14px;
  margin-bottom: 8px;
}
.sum-manual-btn {
  flex: 1;
  height: 36px;
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.35), rgba(67, 217, 160, 0.25));
  border: 1px solid rgba(91, 124, 250, 0.3);
  border-radius: 11px 7px 11px 7px;
  font-family: 'Geist Mono', monospace;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: 0.2s;
  text-transform: uppercase;
}
.sum-manual-btn:hover { opacity: 0.85; }
.sum-manual-btn:active { transform: scale(0.97); }
.sum-manual-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
.sum-manual-count-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.sum-manual-input {
  width: 44px;
  height: 30px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  text-align: center;
  font-family: 'Geist Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  color: white;
  outline: none;
  transition: border-color 0.2s;
}
.sum-manual-input:focus { border-color: rgba(91, 124, 250, 0.4); }
.sum-manual-max-label {
  font-family: 'Geist Mono', monospace;
  font-size: 8.5px;
  color: var(--s-mute, rgba(255,255,255,0.32));
  white-space: nowrap;
}

/* day-mode overrides for settings */
.stage-settings-bg.day .auto-sum-toggle,
.stage-settings-bg.day .sum-manual-row {
  background: var(--paper-2, #f1f0ea);
  border-color: var(--line, rgba(10,10,10,0.06));
}
.stage-settings-bg.day .auto-sum-toggle-label { color: var(--ink, #0a0a0a); }
.stage-settings-bg.day .auto-sum-switch {
  background: rgba(10, 10, 10, 0.08);
  border-color: rgba(10, 10, 10, 0.15);
}
.stage-settings-bg.day .auto-sum-switch::after {
  background: rgba(10, 10, 10, 0.3);
}
.stage-settings-bg.day .auto-sum-switch.on {
  background: linear-gradient(135deg, rgba(100, 160, 0, 0.22), rgba(0, 160, 100, 0.18));
  border-color: rgba(100, 160, 0, 0.35);
}
.stage-settings-bg.day .auto-sum-switch.on::after {
  background: #6a8e00;
  box-shadow: 0 0 6px rgba(100, 160, 0, 0.4);
}
.stage-settings-bg.day #tsukiSummaryFloorStatus { color: var(--mute, #8a8a8e); }
.stage-settings-bg.day .sfs-done { color: #00a06a; }
.stage-settings-bg.day .sfs-pending { color: #c07000; }
/* 触发楼层数 input — 日间模式 */
.stage-settings-bg.day #ssAutoCountNum {
  color: var(--ink, #0a0a0a) !important;
}
.stage-settings-bg.day .ss-count-stepper {
  background: rgba(10, 10, 10, 0.05);
  border-color: rgba(10, 10, 10, 0.12);
}
.stage-settings-bg.day .ss-stepper-btn {
  background: rgba(10, 10, 10, 0.06);
  color: var(--ink-3, #4a4a4d);
}
.stage-settings-bg.day .ss-stepper-btn:hover {
  background: rgba(10, 10, 10, 0.12);
  color: var(--ink, #0a0a0a);
}
.stage-settings-bg.day .ss-count-label { color: var(--ink, #0a0a0a); }
.stage-settings-bg.day .sum-prompt-textarea {
  background: var(--paper-2, #f1f0ea);
  border-color: var(--line, rgba(10,10,10,0.06));
  color: var(--ink, #0a0a0a);
}
.stage-settings-bg.day .sum-prompt-reset { color: var(--mute); }
.stage-settings-bg.day .sum-manual-input {
  background: var(--paper-2, #f1f0ea);
  border-color: var(--line);
  color: var(--ink);
}
.stage-settings-bg.day .sum-manual-max-label { color: var(--mute); }
.stage-settings-bg.day .sum-manual-btn {
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.15), rgba(67, 217, 160, 0.12));
  border-color: rgba(91, 124, 250, 0.2);
  color: var(--ink-2, #1f1f20);
}
    `;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════════════════════
     14. 公开 API
  ═══════════════════════════════════════════════════════════ */

  window.TsukiSummary = {
    // 核心执行
    executeSummary,
    // 气泡渲染
    buildSummaryFolderBubble,
    // 历史记录（供 callApi 使用）
    getSummaryAwareHistory,
    // 楼层状态
    getUnsummarizedFloors,
    updateSummaryFloorStatus,
    // 自动监控
    startAutoWatch,
    stopAutoWatch,
    // 配置
    loadSummaryCfg: () => _cfg,
    saveSummaryCfg: (c) => { _saveCfgAndSync(c); },
    DEFAULT_SUMMARY_PROMPT,
    // 样式注入
    injectStyles,
    // DB
    ensureSummaryStore,
    getSummariesByTheater,
    getSummaryById,
  };

  // 自动注入样式
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else {
    injectStyles();
  }

  // 页面加载后立即确保 theater_summaries store 存在
  // （避免第一次总结时才升级 DB，导致与已打开连接冲突）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureSummaryStore().catch(e => console.warn('[TsukiSummary] store 预建失败（将在首次总结时重试）:', e));
    });
  } else {
    ensureSummaryStore().catch(e => console.warn('[TsukiSummary] store 预建失败（将在首次总结时重试）:', e));
  }

  console.log('%c📚 TsukiSummary.js v1.0 已加载', 'color:#d4ff4d;font-weight:bold;font-size:14px');
})();
