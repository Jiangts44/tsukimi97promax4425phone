/**
 * StageSend.js v1.6
 * 修复换行丢失问题 | 修复开关无法点击问题 | 强化长篇沉浸式小说级指令
 */

(function () {
  'use strict';

  const SWIPE_THRESHOLD = 60;
  const EMPTY_NUDGE =
    '（请根据当前舞台的剧情上下文，自然地推进故事。请进行深度的心理和环境描写，让这段剧情充满沉浸感。）';

  // --- 模式 A：ON - 分段模式提示词 ---
  const PROMPT_SEGMENTED = `
[Offline Theater Mode - Segmented]
You are a master Roleplay co-author driving an immersive, SLOW-BURN, highly detailed interactive theater.
Your responses MUST be LONG and rich in novelistic prose (at least 3-4 paragraphs per reply). 
Focus deeply on micro-expressions, psychological activities, atmospheric tension, and vivid environmental details. Avoid short, fast-paced, dialogue-only replies.

OUTPUT FORMAT RULES:
1. Every new action, dialogue, or scene description MUST start with a tag on a new line.
2. Use [char|CharacterName] for a character's dialogue or specific actions.
3. Use [narrator|旁白] for environmental descriptions, time skips, or overarching narrative.
4. ABSOLUTELY NO JSON. Output pure plain text.

Example:
[narrator|旁白] 随着剧院的灯光骤然熄灭，安静的空气里，他像一只竖起耳朵守在门后的杜宾，视线死死咬着界面。
[char|祁京野] （指骨抵在唇边，试图压平疯狂上扬的唇角）既然来了，就别急着走。
`.trim();

  // --- 模式 B：OFF - 合并模式提示词 ---
  const PROMPT_MERGED = `
[Offline Theater Mode - Continuous Novel Plot]
You are a master Roleplay co-author driving an immersive, SLOW-BURN interactive theater.
Write a LONG, highly detailed, and emotionally rich continuous story plot (at least 3-4 paragraphs per reply) using professional novel-style narration.
Focus deeply on micro-expressions, psychological activities, atmospheric tension, and vivid environmental details. Avoid short, fast-paced, dialogue-only replies.

1. DO NOT use any segmented tags like [char|Name] or [narrator] in your final output.
2. ABSOLUTELY NO JSON. Output pure plain text.

Example:
灯光渐渐暗下，他转过了身，目光深沉地看着眼前的女孩。大厅里的白炽灯光落在他无可奈何的眼底，那点被刻意压抑的纵容不可避免地浮了上来。“既然来了，就别急着走。”祁京野轻声说道，他毫不客气地屈起食指，在她额头上不轻不重地弹了一下。
`.trim();

  const IDB_CONFIG = {
    name: 'tsukiphonepromax',
    stores: {
      config: 'config',
      worldbook: 'worldbook',
      theaters: 'theaters',
      theater_messages: 'theater_messages',
      chars: 'chars',
    },
  };

  /* ═══════════════════════════════════════════════════════════
     1. 配置持久化与 UI (修复开关失效)
  ═══════════════════════════════════════════════════════════ */
  async function getRenderConfig() {
    const db = await getDb();
    return new Promise(res => {
      const tx = db.transaction('config', 'readonly');
      const req = tx.objectStore('config').get('stage_render_config');
      req.onsuccess = () => res(req.result?.segmented ?? false); // 默认 OFF
      req.onerror = () => res(false);
    });
  }

  async function setRenderConfig(isSegmented) {
    const db = await getDb();
    const tx = db.transaction('config', 'readwrite');
    tx.objectStore('config').put({ id: 'stage_render_config', segmented: isSegmented });

    const toggle = document.getElementById('renderModeToggle');
    if (toggle) {
      toggle.innerText = isSegmented ? 'ON' : 'OFF';
      toggle.style.background = isSegmented ? 'var(--ink)' : 'var(--s-line)';
      toggle.style.color = isSegmented ? 'var(--accent-lime)' : 'var(--mute)'; // 增加明显的颜色反馈
    }
  }

  function initConfigUI() {
    const toggle = document.getElementById('renderModeToggle');
    // 如果找不到开关，说明 DOM 还没渲染完，0.5秒后重试
    if (!toggle) {
      setTimeout(initConfigUI, 500);
      return;
    }
    // 防止重复绑定
    if (toggle._isBound) return;
    toggle._isBound = true;

    // 初始化显示状态
    getRenderConfig().then(isSegmented => {
      toggle.innerText = isSegmented ? 'ON' : 'OFF';
      toggle.style.background = isSegmented ? 'var(--ink)' : 'var(--s-line)';
      toggle.style.color = isSegmented ? 'var(--accent-lime)' : 'var(--mute)';
    });

    // 绑定点击事件
    toggle.addEventListener('click', async () => {
      const current = await getRenderConfig();
      await setRenderConfig(!current);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     0. CSS 动态注入 & 打字机 (修复换行丢失)
  ═══════════════════════════════════════════════════════════ */
  if (!document.getElementById('stage-text-styles')) {
    const style = document.createElement('style');
    style.id = 'stage-text-styles';
    style.textContent = `
      .stage-quote { color: var(--accent-amber, #ff9f43); font-style: italic; opacity: 0.95; }
      .stage-emphasis { color: var(--accent-lime, #d4ff4d); font-weight: 600; text-shadow: 0 0 6px rgba(212,255,77,0.15); }
      .stage-typing-cursor { 
        display: inline-block; width: 4px; height: 1em; 
        background: var(--accent-lime); vertical-align: middle; 
        margin-left: 2px; animation: stage-blink 1s step-end infinite; 
      }
      @keyframes stage-blink { 50% { opacity: 0; } }
    `;
    document.head.appendChild(style);
  }

  // 格式化函数：处理加粗、引号和换行
  function formatStageText(text) {
    if (typeof text !== 'string') return text;

    // 🌟 安全保护：如果这是一条带有复杂 HTML 结构的消息（如置入的前置剧情），直接跳过正则，防止破坏标签的双引号！
    if (text.includes('<div') && text.includes('class=')) {
      return text;
    }

    let html = text.replace(/\*\*(.*?)\*\*/g, '<span class="stage-emphasis">$1</span>');
    html = html.replace(/([“"「『])([^”"」』]+)([”"」』])/g, '<span class="stage-quote">$1$2$3</span>');
    html = html.replace(/\r?\n/g, '<br>');
    return html;
  }

  // 🌟 辅助函数：根据时间戳，智能折叠旧的历史记录
  function autoCollapseOldHistory(content, timestamp) {
    if (!content || typeof content !== 'string') return content;
    if (!content.includes('history-tag')) return content; // 如果不是前置剧情记录，直接跳过

    // 【核心魔法】计算这条消息是“刚刚发的”还是“以前存的”（时间差超过 2 秒即认为是页面初次加载的历史）
    const isOldMessage = Date.now() - (timestamp || 0) > 2000;

    if (isOldMessage) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');

        const tags = doc.querySelectorAll('.history-tag');
        if (tags.length === 0) return content;

        tags.forEach(tag => {
          // 注入折叠状态的样式
          tag.style.opacity = '0.6';
          const icon = tag.querySelector('i');
          if (icon) icon.style.transform = 'rotate(-90deg)';

          const entries = tag.nextElementSibling;
          if (entries && entries.classList.contains('history-entries')) {
            entries.style.display = 'none'; // 隐藏主体记录
            const foot = entries.nextElementSibling;
            if (foot && foot.classList.contains('history-foot')) {
              foot.style.display = 'none'; // 隐藏底边统计
            }
          }
        });
        return doc.body.innerHTML;
      } catch (e) {
        console.error('折叠解析失败', e);
        return content;
      }
    }
    // 如果是新鲜刚刚置入的，直接返回原文，保持展开状态！
    return content;
  }

  // 🌟【核心机制】：全局劫持剧场渲染函数，确保重新加载时依然拥有特效！
  if (typeof window.buildBubble === 'function' && !window.buildBubble._isStagePatched) {
    const origBuildBubble = window.buildBubble;
    window.buildBubble = function (msg, name, avatar, isUser) {
      const clonedMsg = { ...msg };
      if (typeof clonedMsg.content === 'string') {
        let text = clonedMsg.content;
        text = autoCollapseOldHistory(text, clonedMsg.timestamp); // 1. 先判断是否需要折叠
        text = formatStageText(text); // 2. 再处理字体特效
        clonedMsg.content = text;
      }
      return origBuildBubble(clonedMsg, name, avatar, isUser);
    };
    window.buildBubble._isStagePatched = true;
  }

  if (typeof window.buildNarratorBubble === 'function' && !window.buildNarratorBubble._isStagePatched) {
    const origBuildNarratorBubble = window.buildNarratorBubble;
    window.buildNarratorBubble = function (msg) {
      const clonedMsg = { ...msg };
      if (typeof clonedMsg.content === 'string') {
        let text = clonedMsg.content;
        text = autoCollapseOldHistory(text, clonedMsg.timestamp); // 1. 先判断是否需要折叠
        text = formatStageText(text); // 2. 再处理字体特效
        clonedMsg.content = text;
      }
      return origBuildNarratorBubble(clonedMsg);
    };
    window.buildNarratorBubble._isStagePatched = true;
  }

  async function typewriterHTML(container, htmlContent) {
    return new Promise(async resolve => {
      let i = 0,
        buffer = '';
      while (i < htmlContent.length) {
        if (htmlContent[i] === '<') {
          let tag = '';
          while (htmlContent[i] !== '>' && i < htmlContent.length) {
            tag += htmlContent[i];
            i++;
          }
          tag += '>';
          buffer += tag;
          i++;
          continue;
        } else if (htmlContent[i] === '&') {
          let ent = '';
          while (htmlContent[i] !== ';' && i < htmlContent.length) {
            ent += htmlContent[i];
            i++;
          }
          ent += ';';
          buffer += ent;
          i++;
        } else {
          buffer += htmlContent[i];
          i++;
        }
        container.innerHTML = buffer + '<span class="stage-typing-cursor"></span>';
        const area = document.getElementById('sArea');
        if (area) area.scrollTop = area.scrollHeight;
        await new Promise(r => setTimeout(r, 20));
      }
      container.innerHTML = buffer;
      resolve();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     2. 工具函数 & 提示词构建
  ═══════════════════════════════════════════════════════════ */
  async function getDb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_CONFIG.name);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function dbGet(storeName, key) {
    if (!key) return null;
    const db = await getDb();
    if (!db.objectStoreNames.contains(storeName)) return null;
    return new Promise(res => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      } catch (e) {
        res(null);
      }
    });
  }

  function isKeywordTriggered(text, keysStr) {
    if (!keysStr || keysStr.trim() === '') return true;
    const keys = keysStr
      .split(/[,，]/)
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);
    const target = text.toLowerCase();
    return keys.some(key => target.includes(key));
  }

  const sortByPriority = (a, b) => Number(b.priority || 100) - Number(a.priority || 100);

  async function buildStageFinalPromptStream(theater, latestMessage = '', instruction = '') {
    const db = await getDb();
    const finalStream = [];
    const charIds = theater.charIds || [];
    const category = 'offline';

    async function getGlobalWb(key) {
      if (!db.objectStoreNames.contains(IDB_CONFIG.stores.worldbook)) return [];
      return new Promise(res => {
        try {
          const tx = db.transaction(IDB_CONFIG.stores.worldbook, 'readonly');
          const req = tx.objectStore(IDB_CONFIG.stores.worldbook).get(key);
          req.onsuccess = () => res(Array.isArray(req.result) ? req.result : []);
          req.onerror = () => res([]);
        } catch (e) {
          res([]);
        }
      });
    }

    const pushWbWithLog = list => {
      const filtered = list
        .filter(
          item =>
            item.enabled &&
            (!item.category || item.category === '所有' || item.category.toLowerCase() === category) &&
            isKeywordTriggered(latestMessage, item.keys),
        )
        .sort(sortByPriority);
      filtered.forEach(item => finalStream.push(item.content));
    };

    pushWbWithLog(await getGlobalWb('wb_pre'));
    pushWbWithLog(await getGlobalWb('wb_mid'));
    pushWbWithLog(await getGlobalWb('wb_global'));

    for (const cid of charIds) {
      const char = await dbGet(IDB_CONFIG.stores.chars, cid);
      if (char && char.persona) finalStream.push(`[Character Persona: ${char.name}]\n${char.persona}`);
    }

    const localWbList = await getGlobalWb('wb_local');
    localWbList
      .filter(item => {
        const boundIds = Array.isArray(item.charIds) ? item.charIds : item.charIds ? [item.charIds] : [];
        return (
          item.enabled && charIds.some(id => boundIds.includes(id)) && isKeywordTriggered(latestMessage, item.keys)
        );
      })
      .sort(sortByPriority)
      .forEach(item => finalStream.push(item.content));

    const theaterHistory = await buildTheaterHistoryText(theater.id);
    if (theaterHistory) {
      finalStream.push(
        `\n========== THEATER STAGE HISTORY START ==========\n${theaterHistory}\n========== THEATER STAGE HISTORY END ==========\n`,
      );
    }

    if (instruction) finalStream.push(instruction);
    pushWbWithLog(await getGlobalWb('wb_post'));

    return finalStream;
  }

  async function buildTheaterHistoryText(theaterId) {
    const db = await getDb();
    if (!db.objectStoreNames.contains(IDB_CONFIG.stores.theater_messages)) return '';
    return new Promise(res => {
      const tx = db.transaction(IDB_CONFIG.stores.theater_messages, 'readonly');
      const idx = tx.objectStore(IDB_CONFIG.stores.theater_messages).index('by_theater');
      const req = idx.getAll(theaterId);
      req.onsuccess = () => {
        const msgs = (req.result || []).sort((a, b) => a.floor - b.floor);
        const textLines = msgs.map(m => {
          let content = m.content || '';

          content = content.replace(/\{"transcript":"(.*?)"\}/g, '$1');
          content = content.replace(/\{"name":"(.*?)".*?\}/g, '[$1]');

          if (m.type === 'prologue') return `[narrator|序幕] ${content.replace(/<[^>]+>/g, '')}`;

          if (m.type === 'history' || m.type === 'summary' || m.isSummary) {
            let clean = content
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            return `[system|前情剧情] ${clean}`;
          }

          const tag = m.isNarrator ? 'narrator' : m.isUser ? 'user' : 'char';
          return `[${tag}] ${content}`;
        });
        res(textLines.join('\n'));
      };
      req.onerror = () => res('');
    });
  }

  /* ═══════════════════════════════════════════════════════════
     3. API 调用与解析 
  ═══════════════════════════════════════════════════════════ */
  async function callStageApi(userText, theater, instruction) {
    const db = await getDb();
    const mainConfig = await new Promise(res => {
      const tx = db.transaction('config', 'readonly');
      tx.objectStore('config').get('main_config').onsuccess = e => res(e.target.result);
    });

    if (!mainConfig || !mainConfig.api) throw new Error('API 配置丢失');
    const api = mainConfig.api;
    const cfg = api.activePreset && api.presets ? api.presets[api.activePreset] : api.temp;
    if (!cfg || !cfg.url) throw new Error('未配置 API 地址，请在设置中填写');

    const finalPrompts = await buildStageFinalPromptStream(theater, userText || EMPTY_NUDGE, instruction);
    const systemPrompt = finalPrompts.join('\n\n');
    const userPrompt = userText.trim() || EMPTY_NUDGE;

    let url = cfg.url.trim();
    if (!url.endsWith('/chat/completions')) {
      url += url.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
    }

    const payload = {
      model: cfg.model || 'gpt-4o',
      temperature: parseFloat(cfg.temp) || 0.7,
      max_tokens: parseInt(cfg.maxTokens) || 4000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

    console.group('%c🚀 [StageSend] API 请求已发射', 'color: #ff9f43; font-weight: bold; font-size: 13px;');
    console.log('%c【请求地址】', 'color: #8a8a8e', url);
    console.log('%c【System Prompt】\n', 'color: #d4ff4d', systemPrompt);
    console.log('%c【User Input】', 'color: #5b7cfa', userPrompt);
    console.groupEnd();

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || '请求失败');
    const rawText = data.choices[0].message.content;

    console.group('%c📥 [StageSend] AI 原始返回文本', 'color: #fa5bd5; font-weight: bold; font-size: 13px;');
    console.log(rawText);
    console.groupEnd();

    return rawText;
  }

  function parseStageResponse(raw) {
    const lines = raw.split('\n');
    const results = [];
    const TAG_RE = /^\[(char|user|narrator)(?:\|([^\]]+))?\]\s*(.*)/i;
    let cur = null;

    lines.forEach(line => {
      const m = line.match(TAG_RE);
      if (m) {
        if (cur) results.push(cur);
        const roleType = m[1].toLowerCase();
        const name = m[2] ? m[2].trim() : roleType === 'narrator' ? '旁白' : '剧情';
        cur = { roleType, name, content: m[3].trim() };
      } else if (cur) {
        // 如果当前块还有内容，把下一行拼进去，保留真正的换行！
        cur.content += '\n' + line;
      }
    });
    if (cur) results.push(cur);
    return results;
  }

  /* ═══════════════════════════════════════════════════════════
     4. 渲染与手势核心逻辑
  ═══════════════════════════════════════════════════════════ */
  async function renderAndSaveStageMessage(msg, theater) {
    const isChar = msg.roleType === 'char';
    const isNarrator = msg.roleType === 'narrator';
    const isUser = msg.roleType === 'user';

    if (isUser) return;

    if (typeof getNextFloor !== 'function') return;

    const floor = await getNextFloor(theater.id);
    const db = await getDb();

    // 真正的换行符内容
    const fullContent = msg.content.trim();
    // 转换为含特殊 class 的 HTML 字符串（包括 <br>）
    const formattedHTML = formatStageText(fullContent);

    const stageMsg = {
      theaterId: theater.id,
      floor,
      type: 'text',
      isUser,
      isNarrator,
      content: '',
      charId: isChar ? theater.charIds[0] || null : null,
      timestamp: Date.now(),
    };

    let el;
    if (isNarrator && typeof window.buildNarratorBubble === 'function') {
      el = window.buildNarratorBubble(stageMsg);
    } else if (typeof window.buildBubble === 'function') {
      el = window.buildBubble(stageMsg, msg.name, null, isUser);
    }

    stageMsg.content = fullContent;
    const tx = db.transaction('theater_messages', 'readwrite');
    tx.objectStore('theater_messages').put(stageMsg);

    theater.updatedAt = Date.now();
    theater.lastFloor = floor;
    const tTx = db.transaction('theaters', 'readwrite');
    tTx.objectStore('theaters').put(theater);

    const area = document.getElementById('sArea');
    if (area && el) {
      area.querySelector('.s-empty')?.remove();
      area.appendChild(el);
      area.scrollTop = area.scrollHeight;

      const textContainer = isNarrator ? el.querySelector('.narrator-body') : el.querySelector('.msg-body');
      if (textContainer) {
        await typewriterHTML(textContainer, formattedHTML);
      } else {
        el.innerHTML += formattedHTML;
      }

      if (typeof window.updateFloor === 'function') window.updateFloor(floor);
    }
  }

  let _isSending = false;

  async function triggerStageSwipeSend() {
    if (_isSending) return;
    const theater = typeof S !== 'undefined' ? S.theater : null;
    if (!theater) return alert('未选择剧场');

    const isSegmented = await getRenderConfig();
    const inputField = document.getElementById('sField');
    const userText = inputField.value.trim();

    if (userText && typeof window.sendMsg === 'function') {
      await window.sendMsg();
    }

    _isSending = true;
    const btn = document.getElementById('sSend');
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    try {
      const systemInstruction = isSegmented ? PROMPT_SEGMENTED : PROMPT_MERGED;
      const raw = await callStageApi(userText, theater, systemInstruction);

      if (isSegmented) {
        const parsed = parseStageResponse(raw);
        for (const m of parsed) {
          await renderAndSaveStageMessage(m, theater);
          await new Promise(r => setTimeout(r, 200));
        }
      } else {
        const cleanedText = raw.replace(/\[(char|narrator|user)\|?.*?\]/gi, '').trim();
        const mergedMsg = {
          roleType: 'char',
          name: S.chars[0]?.name || '剧情',
          content: cleanedText,
        };
        await renderAndSaveStageMessage(mergedMsg, theater);
      }
    } catch (e) {
      console.error('[StageSend] API 失败:', e);
    } finally {
      _isSending = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     5. 初始化 UI 与手势
  ═══════════════════════════════════════════════════════════ */
  function init() {
    initConfigUI();
    const btn = document.getElementById('sSend');
    if (!btn) return setTimeout(init, 500);

    let startY = 0,
      currentDY = 0,
      isDragging = false;
    const getY = e => (e.type.includes('mouse') ? e.clientY : e.touches[0].clientY);

    btn.addEventListener('mousedown', e => {
      startY = getY(e);
      isDragging = true;
      btn.style.transition = 'none';
    });
    btn.addEventListener(
      'touchstart',
      e => {
        startY = getY(e);
        isDragging = true;
        btn.style.transition = 'none';
      },
      { passive: false },
    );

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const dy = getY(e) - startY;
      currentDY = dy;
      if (dy < -5) btn.style.transform = `translateY(${Math.max(dy, -80)}px)`;
    });

    document.addEventListener(
      'touchmove',
      e => {
        if (!isDragging) return;
        const dy = getY(e) - startY;
        currentDY = dy;
        if (dy < -5) {
          if (e.cancelable) e.preventDefault();
          btn.style.transform = `translateY(${Math.max(dy, -80)}px)`;
        }
      },
      { passive: false },
    );

    const end = async () => {
      if (!isDragging) return;
      isDragging = false;
      btn.style.transition = '0.4s cubic-bezier(0.22,1,0.36,1)';
      if (currentDY < -SWIPE_THRESHOLD) {
        btn.style.transform = 'translateY(-100px)';
        await triggerStageSwipeSend();
      }
      btn.style.transform = 'translateY(0)';
    };
    document.addEventListener('mouseup', end);
    document.addEventListener('touchend', end);
  }

  init();

  /* ═══════════════════════════════════════════════════════════
     6. 动态附加：前置剧情记录 折叠/展开 交互
  ═══════════════════════════════════════════════════════════ */
  // 注入折叠交互需要的极简 CSS (增加指针、点击反馈和图标旋转动画)
  if (!document.getElementById('history-fold-style')) {
    const style = document.createElement('style');
    style.id = 'history-fold-style';
    style.textContent = `
      .history-tag { 
        cursor: pointer; 
        transition: opacity 0.3s ease, transform 0.1s ease; 
        user-select: none; 
      }
      .history-tag:active { transform: scale(0.98); }
      .history-tag i { transition: transform 0.3s ease; display: inline-block; }
    `;
    document.head.appendChild(style);
  }

  // 监听整个文档的点击事件（事件委托机制）
  document.addEventListener('click', function (e) {
    // 1. 检查点击的是否是 .history-tag 或其内部元素
    const tag = e.target.closest('.history-tag');
    if (!tag) return;

    // 2. 找到紧跟在 tag 后面的记录容器 .history-entries
    const entries = tag.nextElementSibling;
    if (!entries || !entries.classList.contains('history-entries')) return;

    // 3. 找到再后面的脚注容器 .history-foot (如果有)
    const foot = entries.nextElementSibling;
    const hasFoot = foot && foot.classList.contains('history-foot');

    // 4. 判断当前是否是折叠状态
    const isCollapsed = entries.style.display === 'none';
    const icon = tag.querySelector('i'); // 获取前面的小图标

    if (isCollapsed) {
      // 【执行展开】
      entries.style.display = '';
      if (hasFoot) foot.style.display = '';
      tag.style.opacity = '1';
      // 图标恢复原样
      if (icon) icon.style.transform = 'rotate(0deg)';
    } else {
      // 【执行折叠】
      entries.style.display = 'none';
      if (hasFoot) foot.style.display = 'none';
      tag.style.opacity = '0.6'; // 变灰暗，暗示被收起
      // 图标稍微旋转，提供视觉反馈
      if (icon) icon.style.transform = 'rotate(-90deg)';
    }
  });
})();
