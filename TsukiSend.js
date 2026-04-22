/**
 * TsukiSend.js  v1.1
 * 发送按钮上划触发 · API调用 · 消息解析与渲染 · 存库
 * ─────────────────────────────────────────────────────
 * 修复记录 v1.1：
 *  ① 上划发送时用户消息同步存库 & 渲染
 *  ② 输入框为空时改发占位符给 API，避免 500 空 content 报错
 *  ③ 新增 recalled / blocked 两种消息格式的解析与渲染
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     1. 常量 & 配置
  ═══════════════════════════════════════════════════════════ */

  const SWIPE_THRESHOLD = 60; // 上划触发阈值（px）
  const RENDER_DELAY_MS = 1500; // 逐条上屏间隔（ms）
  const API_URL = ''; // 留空，强制用户在设置里填代理

  /**
   * ② 输入框为空时发给 API 的占位符——仅作触发信号，不渲染到聊天区
   */
  const EMPTY_INPUT_NUDGE = '(继续对话，请根据上下文和你的人物设定自然地给出下一条回复)';

  const FORMAT_SYSTEM_PROMPT = `
You are roleplaying in a mobile chat application. Each of your messages MUST begin with a tag in the format [角色名|格式类别] followed immediately by the message content. Do NOT include timestamps — they are assigned automatically by the system.

You can send MULTIPLE messages in a single response. Each message must be on its own line or separated by a blank line. Do NOT number them.

The 13 supported message formats are:

1. [角色名|text] — 普通文本消息
   Example: [祁京野|text] 我在楼下等你了，快点下来

2. [角色名|voice] — 语音消息（用文字表示语音转写内容）
   Example: [祁京野|voice] 喂，你到哪儿了，我都等了你十分钟了

3. [角色名|image] — 图文卡片（发送带文字的图片）
   Example: [祁京野|image] 这是今天下午拍的照片，觉得很美就发给你看

4. [角色名|transfer] — 转账消息，格式：金额|备注
   Example: [祁京野|transfer] 88.00|买杯咖啡等我

5. [角色名|location] — 位置消息，格式：地点名称
   Example: [祁京野|location] 外滩·上海市黄浦区

6. [角色名|gift] — 礼物消息，格式：礼物名称|备注
   Example: [祁京野|gift] 限量版香水|生日快乐

7. [角色名|sticker] — 表情包/贴图，格式：表情描述名称 (或 名字|图片URL)
   - 特别提示：你可以通过这种方式发送表情包。如果在对话历史中看到用户发送了 [表情包] 某某猫咪，你可以直接回复 [角色名|sticker] 某某猫咪 来“偷取”并发送同一个表情包跟用户斗图！如果你有确切的图片URL，也可以用 名称|URL 的格式发送。
   Example: [祁京野|sticker] 委屈猫猫
            [祁京野|sticker] 我难受|https:...（表情包的url链接）

8. [角色名|recalled] — 撤回消息（内容为原文，会被折叠隐藏）
   Example: [祁京野|recalled] 没事，算了，我不说了

9. [角色名|blocked] — 屏蔽消息（内容模糊不可见）
   Example: [祁京野|blocked] 其实我喜欢你很久了

10. [角色名|voice_call] — 发起语音通话邀请
    Example: [祁京野|voice_call] 语音通话邀请

11. [角色名|video_call] — 发起视频通话邀请
    Example: [祁京野|video_call] 视频通话邀请

12. [system|system] — 系统通知
    Example: [system|system] 祁京野 已将状态切换为「在线」

13. [角色名|text] (WITH QUOTE) — 引用回复。在文本消息开头使用 <quote=人名|内容> 标签。
    - 如果引用的是特殊消息，必须在内容开头加上对应的类型前缀，支持的前缀有：[语音], [图片], [文件], [转账], [礼物]。
    - 如果引用的是普通文本，不需要加前缀（不带前缀默认引用纯文本）。
    Example (引用普通文本): [祁京野|text] <quote=江眠月|别催了，我已经在电梯里了> 那我在电梯口等你。
    Example (引用语音消息): [祁京野|text] <quote=江眠月|[语音] 我马上就到啦> 慢点跑，别摔着。
    Example (引用图片消息): [祁京野|text] <quote=江眠月|[图片] 看看这只猫> 好可爱！

14. [角色名|text] (WITH STATUS UPDATE) — 更改角色状态。在回复内容的最顶部添加 <status=#色号|状态内容>。
    - 色号必须是 HEX 格式（如 #ff6b6b）。状态内容建议在 10 字以内。
    Example: [祁京野|text] <status=#8a8a8e|正在认真打字...> 刚才在忙，没看到消息。

Rules:
- ALWAYS start every message with the [角色名|格式类别] tag.
- Never include manual timestamps (e.g., "09:32").
- QUOTING: Use the <quote=Name|[Prefix] Content> syntax when you want to reply specifically to a previous statement.
- QUOTE PREFIXES: If quoting a non-text message, you MUST include the prefix inside the quote block: [语音], [图片], [文件], [转账], [礼物]. If quoting plain text, DO NOT use a prefix.
- The quoted content should be a short summary or a snippet of the message you are replying to.
- transfer content: "金额|备注"  gift content: "礼物名|备注"
- recalled/blocked: Use these for realistic character interactions.
- STATUS UPDATE: You can voluntarily update your character's status by placing <status=#HEX|· Text> at the very beginning of your FIRST message in a response. Use this when your mood or activity changes.Don't user[name|type] before status.Don't forget use · before status text.
- You may reply with multiple messages to simulate natural conversation.
`.trim();

  /* ═══════════════════════════════════════════════════════════
     2. 数据库 & 配置读取
  ═══════════════════════════════════════════════════════════ */

  function initTsukiDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('tsukiphonepromax');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadApiConfig() {
    const defaults = {
      apiKey: '',
      baseUrl: '',
      model: 'gpt-4o',
      maxTokens: 99999999,
      temperature: 0.7,
      historyCount: 0,
    };

    try {
      const idb = await initTsukiDB();

      // 1. 读取 main_config (获取 API 相关配置)
      const mainConfig = await new Promise((res, rej) => {
        const tx = idb.transaction('config', 'readonly');
        const req = tx.objectStore('config').get('main_config');
        req.onsuccess = () => res(req.result);
        req.onerror = e => rej(e.target.error);
      });

      // 2. 读取 chat_settings (获取上下文记忆条数)
      const chatSettings = await new Promise((res, rej) => {
        const tx = idb.transaction('config', 'readonly');
        const req = tx.objectStore('config').get('chat_settings');
        req.onsuccess = () => res(req.result);
        req.onerror = e => rej(e.target.error);
      });

      // --- 独立处理历史记录条数 (historyCount) ---
      let finalHistoryCount = defaults.historyCount;
      if (chatSettings && chatSettings.historyCount !== undefined) {
        finalHistoryCount = parseInt(chatSettings.historyCount, 10);
        console.log(`[TsukiSend Monitor] 成功读取 DB 'chat_settings' -> historyCount: ${finalHistoryCount}`);
      } else {
        console.log(`[TsukiSend Monitor] 未找到自定义 'chat_settings'，使用默认 historyCount: ${finalHistoryCount}`);
      }

      // 如果没有主配置，直接返回默认值，但要把我们刚读到的 historyCount 带上
      if (!mainConfig) {
        console.log('[TsukiSend Monitor] 未找到主 API 配置 (main_config)，将返回默认设置');
        defaults.historyCount = finalHistoryCount;
        return defaults;
      }

      // --- 处理 API 预设逻辑 ---
      const apiData = mainConfig.api || {};
      let cfg = apiData.temp || {};
      const presetName = apiData.activePreset;

      if (presetName && apiData.presets?.[presetName]) {
        cfg = apiData.presets[presetName];
        console.log(`[TsukiSend Monitor] 已加载 API 预设: ${presetName}`);
      } else {
        console.log('[TsukiSend Monitor] 未使用预设，加载 API 临时配置');
      }

      return {
        apiKey: cfg.key || defaults.apiKey,
        baseUrl: cfg.url || defaults.baseUrl,
        model: cfg.model || defaults.model,
        temperature: parseFloat(cfg.temp || defaults.temperature),
        maxTokens: parseInt(cfg.maxTokens || defaults.maxTokens, 10),
        // 这里的 historyCount 不再读取 cfg，而是强制使用我们刚从 chat_settings 读出来的值
        historyCount: finalHistoryCount,
      };
    } catch (e) {
      console.error('[TsukiSend Error] 读取配置遭遇严重错误，使用安全默认值兜底', e);
      return defaults;
    }
  }

  /* ═══════════════════════════════════════════════════════════
    ！！ 3. 调用 API
  ═══════════════════════════════════════════════════════════ */
  /**
   * 🌟 图片压缩核心函数
   * @param {string} base64Str - 原始 Base64 字符串
   * @param {number} maxWidth - 压缩后的最大宽度（px）
   * @param {number} quality - 压缩质量 (0.1 - 1.0)
   * @returns {Promise<string>} - 返回压缩后的 Base64 字符串
   */
  async function compressImage(base64Str, maxWidth = 1024, quality = 0.7) {
    return new Promise(resolve => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // 如果图片宽度超过限制，进行等比例缩放
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // 绘制图片到画布
        ctx.drawImage(img, 0, 0, width, height);

        // 导出为 JPEG 格式以实现最大程度压缩
        // 'image/jpeg' 格式比 'image/png' 压缩率更高
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.onerror = () => resolve(base64Str); // 失败则返回原图兜底
    });
  }

  // --- 增强版：自动更新角色状态并生成系统通知 ---
  async function handleStatusTag(rawText) {
    // 正则匹配 <status=#色号|状态内容>
    const statusRegex = /<status=(#[0-9a-fA-F]{3,6}|[a-z]+)\|(.*?)>/;
    const match = rawText.match(statusRegex);

    if (match) {
      const newColor = match[1];
      const newText = match[2];

      // 1. 立即更新顶部状态栏 UI
      const charStatusTextEl = document.querySelector('.char-status-text');
      if (charStatusTextEl) {
        charStatusTextEl.innerText = newText;
        charStatusTextEl.style.color = newColor;
      }

      // 2. 同步存入 IndexedDB (chars 商店)
      if (window.currentChatChar && window.currentChatChar.id) {
        try {
          const db = await (typeof openDb === 'function' ? openDb() : initTsukiDB());
          await new Promise((resolve, reject) => {
            const tx = db.transaction('chars', 'readwrite');
            const store = tx.objectStore('chars');
            const getReq = store.get(window.currentChatChar.id);

            getReq.onsuccess = () => {
              const charData = getReq.result;
              if (charData) {
                charData.status = newText;
                charData.statusColor = newColor;
                store.put(charData);
              }
              resolve();
            };
            getReq.onerror = () => reject(getReq.error);
          });
          console.log(`[AI Status Update] 状态已更新: ${newText}`);
        } catch (err) {
          console.error('AI 状态更新流程失败:', err);
        }
      }

      // 3. 【核心修复】将状态更新转化为系统消息，放回文本流中！
      // 这样它可以进入消息队列，严格按顺序分配楼层存库，彻底杜绝楼层冲突导致的消息丢失
      const charName = window.currentChatChar ? window.currentChatChar.name : '角色';
      const sysMsg = `\n[system|system] ${charName} 将状态切换为「${newText}」\n`;

      return rawText.replace(statusRegex, sysMsg).trim();
    }
    return rawText;
  }

  async function callApi(userMessage, chatId, extraImages = []) {
    const config = await loadApiConfig();
    if (!config.baseUrl) throw new Error('API 代理地址未配置，请先在设置页面填写');
    if (!config.apiKey) throw new Error('API Key 未配置，请在设置页面填写');

    const db = await (typeof openDb === 'function' ? openDb() : initTsukiDB());
    const chat = await new Promise(res => {
      const tx = db.transaction('chats', 'readonly');
      const req = tx.objectStore('chats').get(chatId);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });
    if (!chat) throw new Error(`找不到聊天室: ${chatId}`);

    const charIds = chat.charIds || [];
    const category = 'Online'; // 线上聊天专用，固定传入 Online 分类
    const chatUserId = chat.userId || null;

    let personaPrompts = [];
    if (typeof assembleCharacterPrompts === 'function') {
      personaPrompts = await assembleCharacterPrompts(charIds, userMessage, chatUserId);
    }
    let promptStream = [];
    if (typeof buildFinalPromptStream === 'function') {
      promptStream = await buildFinalPromptStream(
        charIds,
        personaPrompts,
        config.historyCount,
        category,
        userMessage,
        chatId,
      );
    }

    // const systemPrompt = [promptStream.join('\n\n'), '──────────────────────────────', FORMAT_SYSTEM_PROMPT].join(
    //   '\n\n',
    // );

    // // ② 空输入时替换为占位符，避免 API 收到空 content 返回 500
    // const apiUserContent = userMessage.trim() !== '' ? userMessage : EMPTY_INPUT_NUDGE;

    // const messages = [
    //   { role: 'system', content: systemPrompt },
    //   { role: 'user', content: apiUserContent },
    // ];
    // ─────────────────────────────────────────────────────────────
    // 🌟 重点 1：处理系统提示词（历史记录）中的 Base64
    // 历史记录是以字符串形式塞进 system 的，AI 无法直接“看”字符串里的 Base64。
    // 为了节省 Token 且不干扰 AI，我们将历史记录里的超长 Base64 替换为占位符。
    // ─────────────────────────────────────────────────────────────
    let historyText = promptStream.join('\n\n');
    const base64Regex = /data:image\/[a-zA-Z]+;base64,[^\]\s>]+/g;
    historyText = historyText.replace(base64Regex, '[图片数据已归档]');

    const systemPrompt = [historyText, '──────────────────────────────', FORMAT_SYSTEM_PROMPT].join('\n\n');

    // ─────────────────────────────────────────────────────────────
    // 🌟 重点 2：构建多模态消息体 (Multi-modal Content)
    // ─────────────────────────────────────────────────────────────
    // ② 空文字时：有额外图片用识图提示，否则用对话续接提示
    const apiUserText =
      userMessage.trim() !== ''
        ? userMessage
        : extraImages.length > 0
          ? '(用户发送了图片，请仔细观察图片内容，结合角色设定自然地给出回复)'
          : EMPTY_INPUT_NUDGE;

    // 提取消息文字里的 Base64，再合并从 sendAll 传来的额外图片
    const extractedImages = [...(apiUserText.match(base64Regex) || []), ...extraImages];
    // 抹除文字里的超长源码，替换为简洁的描述，保持 AI 看到的文本整洁
    const cleanUserText = apiUserText.replace(base64Regex, '[已上传图片]');

    let finalUserContent;

    if (extractedImages.length > 0) {
      // 构造符合 OpenAI 标准的多模态数组
      finalUserContent = [{ type: 'text', text: cleanUserText }];
      // 将每张图片单独作为一个 image_url 对象加入数组
      extractedImages.forEach(imgData => {
        finalUserContent.push({
          type: 'image_url',
          image_url: {
            url: imgData, // 这就是压缩后的 Base64 原始数据
          },
        });
      });
    } else {
      // 如果没有图片，依然使用普通的纯字符串格式
      finalUserContent = apiUserText;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: finalUserContent }, // 此时可能是数组也可能是字符串
    ];

    // ─────────────────────────────────────────────────────────────
    // API 请求部分 (保持不变)
    // ─────────────────────────────────────────────────────────────
    let apiUrl = (config.baseUrl || API_URL).trim();
    while (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    if (apiUrl.endsWith('/v1/messages')) apiUrl = apiUrl.slice(0, -12);
    else if (apiUrl.endsWith('/v1')) apiUrl = apiUrl.slice(0, -3);
    const finalUrl = `${apiUrl}/v1/chat/completions`;

    console.group('%c📡 [TsukiSend] API 请求 (多模态)', 'color:#d4ff4d;font-weight:bold');
    console.log('URL:', finalUrl);
    console.log('图片数量:', extractedImages.length);
    console.log('发送给 AI 的文本:', cleanUserText);
    console.groupEnd();

    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages,
        stream: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`API 请求失败 ${res.status}: ${data.error?.message || data.detail || '未知错误'}`);

    const rawText = data.choices?.[0]?.message?.content || '';
    console.log('%c[TsukiSend] AI 响应:\n' + rawText, 'color:#43d9a0');
    return rawText;
  }

  /* ═══════════════════════════════════════════════════════════
     4. 解析 AI 响应 → 消息数组
  ═══════════════════════════════════════════════════════════ */

  function stripTimestamps(text) {
    return text
      .replace(/\b\d{13}\b/g, '')
      .replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:\s+星期[一二三四五六日])?(?:\s+\d{10,13})?/g, '')
      .replace(/\[([^\]|]+)\|[^\]|]*\d{4}[^\]|]*\|([^\]]+)\]/g, '[$1|$2]')
      .replace(/(\[[^\]]+\])\s*\d{2}:\d{2}(?::\d{2})?\s*/g, '$1 ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function normalizeType(raw) {
    const map = {
      text: 'text',
      文本: 'text',
      voice: 'voice',
      语音: 'voice',
      image: 'image',
      图文: 'image',
      图片: 'image',
      transfer: 'transfer',
      转账: 'transfer',
      location: 'location',
      位置: 'location',
      gift: 'gift',
      礼物: 'gift',
      sticker: 'sticker',
      表情包: 'sticker',
      表情: 'sticker',
      // ③ 新增
      recalled: 'recalled',
      撤回: 'recalled',
      blocked: 'blocked',
      屏蔽: 'blocked',
      拉黑: 'blocked',
      // 通话
      voice_call: 'voice_call',
      语音通话: 'voice_call',
      语音邀请: 'voice_call',
      video_call: 'video_call',
      视频通话: 'video_call',
      视频邀请: 'video_call',
      system: 'system',
      系统: 'system',
    };
    return map[raw] || 'text';
  }

  /** 允许 content 为空的类型 */
  function isNoContentType(type) {
    return type === 'voice_call' || type === 'video_call';
  }

  function parseAiResponse(raw) {
    const cleaned = stripTimestamps(raw);
    const lines = cleaned.split('\n');
    const messages = [];
    const TAG_RE = /^\s*\[([^\]|]+)\|([^\]]+)\]\s*([\s\S]*)/;
    let cur = null;

    const flush = () => {
      if (!cur) return;
      cur.content = cur.content.trim();
      if (cur.content || isNoContentType(cur.type)) messages.push(cur);
      cur = null;
    };

    for (const line of lines) {
      const m = line.match(TAG_RE);
      if (m) {
        flush();
        cur = { charName: m[1].trim(), type: normalizeType(m[2].trim().toLowerCase()), content: m[3].trim() };
      } else if (cur) {
        cur.content += '\n' + line;
      }
    }
    flush();

    console.log(`[TsukiSend] 解析出 ${messages.length} 条消息`, messages);
    return messages;
  }

  /* ═══════════════════════════════════════════════════════════
     5. 渲染单条解析消息
  ═══════════════════════════════════════════════════════════ */

  async function renderParsedMessage(msg) {
    const { charName, type, content } = msg;
    const now = new Date();
    const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');

    /* ── system ─────────────────────────────────────────── */
    if (type === 'system') {
      const el = window.renderMessage('system', content);
      if (el && window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('system', content, content, 'system');
        if (floor != null) el.dataset.floor = floor;
      }
      return;
    }

    /* ── ③ recalled（撤回）──────────────────────────────── */
    if (type === 'recalled') {
      const chatArea = document.getElementById('chatArea');
      if (!chatArea) return;

      const notice = document.createElement('div');
      notice.className = 'msg-recalled';
      notice.dataset.recall = '1';
      notice.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${charName} recalled a message <span class="redo">re-edit <i class="fa-solid fa-arrow-right"></i></span>`;

      const revDiv = document.createElement('div');
      revDiv.className = 'recalled-reveal';
      revDiv.innerHTML = `<div class="recalled-reveal-label"><i class="fa-solid fa-eye"></i> RECALLED CONTENT</div>${content}`;

      const redoBtn = notice.querySelector('.redo');
      if (redoBtn) {
        redoBtn.onclick = e => {
          e.stopPropagation();
          revDiv.classList.toggle('show');
        };
      }

      chatArea.appendChild(notice);
      chatArea.appendChild(revDiv);
      chatArea.scrollTop = chatArea.scrollHeight;

      if (window.bindLongPress) window.bindLongPress(notice, 'recalled');

      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('recalled', content, '[撤回消息]', 'char');
        if (floor != null) {
          notice.dataset.floor = floor;
          revDiv.dataset.floor = floor;
        }
      }
      return;
    }

    /* ── ③ blocked（屏蔽）──────────────────────────────── */
    if (type === 'blocked') {
      const b = document.createElement('div');
      b.className = 'bubble blocked';
      b.innerHTML = `${content}<div class="bubble-blocked-badge"><i class="fa-solid fa-ban"></i> BLOCKED · 消息已屏蔽</div>`;

      const row = window.renderMessage('char', b, { meta: `<i class="fa-solid fa-ban"></i> 屏蔽信息` });
      if (window.bindLongPress) {
        row.style.cursor = 'context-menu';
        window.bindLongPress(row, 'blocked');
      }
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('blocked', content, '[屏蔽消息]', 'char');
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── 通话邀请 ────────────────────────────────────────── */
    if (type === 'voice_call' || type === 'video_call') {
      const isVideo = type === 'video_call';
      const icon = isVideo ? 'fa-video' : 'fa-phone';
      const b = document.createElement('div');
      b.className = 'bubble call-invite';
      b.innerHTML = `
        <div class="call-invite-icon ${isVideo ? 'video' : 'voice'}"><i class="fa-solid ${icon}"></i></div>
        <div class="call-invite-info">
          <div class="call-invite-label">${isVideo ? '视频通话邀请' : '语音通话邀请'}</div>
          <div class="call-invite-sub">${isVideo ? 'VIDEO CALL · RINGING' : 'VOICE CALL · RINGING'}</div>
        </div>
        <button class="call-invite-btn">接听</button>
      `;
      const row = window.renderMessage('char', b, {
        meta: `<i class="fa-solid ${icon}"></i> ${isVideo ? 'video call' : 'voice call'}`,
      });
      // ❌ 【删除下面这一行！】
      // if (window.bindCallInvite) window.bindCallInvite(row.querySelector('.bubble-wrap'));
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB(
          'call',
          { callType: isVideo ? 'video' : 'voice' },
          isVideo ? '[视频通话]' : '[语音通话]',
          'char',
        );
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── text ───────────────────────────────────────────── */
    if (type === 'text') {
      // 修复：不要在这里创建 DOM，直接把纯文本 content 传给 renderMessage
      // 让底层的正则解析器能够正常接管 <quote> 标签和徽章转换！
      const row = window.renderMessage('char', content, { meta: `<i class="fa-regular fa-clock"></i> ${timeStr}` });
      if (window.saveMessageToDB) {
        // 提取真正的话语作为左侧聊天列表的摘要（去掉引用前缀），保持列表干净
        const match = content.match(/^<quote=.*?\|.*?>([\s\S]*)$/);
        const cleanSummary = match ? match[1].trim() : content;

        const floor = await window.saveMessageToDB('text', content, cleanSummary, 'char');
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── voice ──────────────────────────────────────────── */
    if (type === 'voice') {
      const b = document.createElement('div');
      b.className = 'bubble voice expanded';
      b.dataset.duration = '0:04';
      b.onclick = function () {
        if (typeof toggleVoice === 'function') toggleVoice(this);
      };
      b.innerHTML = `
        <div class="voice-main">
          <div class="voice-play"><i class="fa-solid fa-play"></i></div>
          <div class="voice-waves" data-wave></div>
          <span class="voice-duration">0:04</span>
        </div>
        ${content ? `<div class="voice-transcript"><div class="voice-transcript-inner">${content}</div></div>` : ''}
      `;
      const waveWrap = b.querySelector('[data-wave]');
      [0.3, 0.7, 0.4, 0.9, 0.6, 0.2, 0.8, 0.5, 0.65].forEach((h, i) => {
        const s = document.createElement('span');
        s.style.height = h * 100 + '%';
        s.style.animationDelay = i * 0.05 + 's';
        waveWrap.appendChild(s);
      });
      const row = window.renderMessage('char', b, { meta: `<i class="fa-solid fa-microphone-lines"></i> voice` });
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('voice', { transcript: content }, '[语音]', 'char');
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── image ──────────────────────────────────────────── */
    if (type === 'image') {
      const b = document.createElement('div');
      b.className = 'bubble img-text-card';
      b.innerHTML = `
        <div class="img-text-card-inner">
          <div class="img-text-card-label">IMAGE · TEXT</div>
          <div class="img-text-card-text">${content}</div>
          <i class="fa-solid fa-image img-text-card-deco"></i>
        </div>
      `;
      const row = window.renderMessage('char', b, { meta: '<i class="fa-solid fa-font"></i> image text' });
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('image', { text: content }, '[图文] ' + content, 'char');
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── transfer ───────────────────────────────────────── */
    if (type === 'transfer') {
      const [rawAmt, rawNote] = content.split('|');
      const amount = (rawAmt || '').trim();
      const note = (rawNote || '').trim();
      const b = document.createElement('div');
      b.className = 'bubble transfer';
      b.innerHTML = `
        <div class="transfer-head"><span><i class="fa-solid fa-paper-plane" style="font-size:9px"></i> TRANSFER · SENT</span><span>#TSUKI</span></div>
        <div class="transfer-body">
          <div class="transfer-icon"><i class="fa-solid fa-mug-saucer"></i></div>
          <div class="transfer-info">
            <div class="transfer-amount"><sup>¥</sup>${amount}</div>
            <div class="transfer-note">${charName} · ${note}</div>
          </div>
        </div>
        <div class="transfer-foot"><span>TAP TO OPEN</span><span class="tap"><i class="fa-solid fa-hand-pointer"></i> view</span></div>
      `;
      const row = window.renderMessage('char', b, {
        meta: `<i class="fa-solid fa-check-double" style="color:var(--accent-mint)"></i> delivered · ${timeStr}`,
      });
      if (window.bindTransferView) window.bindTransferView(b);
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB(
          'transfer',
          { from: charName, amount, note },
          `[转账] ¥${amount}`,
          'char',
        );
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── location ───────────────────────────────────────── */
    if (type === 'location') {
      const container = document.createElement('div');
      container.innerHTML = `
        <div class="bubble location-bub r3"><i class="fa-solid fa-location-dot"></i><span>${content}</span></div>
        <div class="location-hint">· 点击在地图中查看</div>
      `;
      const row = window.renderMessage('char', container, {
        meta: `<i class="fa-solid fa-location-dot"></i> location`,
      });
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('location', { location: content }, `[位置] ${content}`, 'char');
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── gift ───────────────────────────────────────────── */
    if (type === 'gift') {
      const [rawItem, rawGNote] = content.split('|');
      const item = (rawItem || '').trim();
      const gnote = (rawGNote || '').trim();
      const b = document.createElement('div');
      b.className = 'bubble gift';
      b.dataset.giftItem = item;
      b.dataset.giftNote = gnote;
      b.innerHTML = `
        <div class="gift-head"><span>GIFT</span><span>#TSUKI</span></div>
        <div class="gift-mystery">
          <div class="gift-mystery-icon"><i class="fa-solid fa-gift"></i></div>
          <div class="gift-mystery-text">
            <div class="gift-mystery-label">收到一份礼物</div>
            <div class="gift-mystery-sub">tap to open</div>
          </div>
        </div>
        <div class="gift-foot"><span>TAP TO OPEN</span><span class="tap gift-tap"><i class="fa-solid fa-hand-pointer"></i> view</span></div>
      `;
      const row = window.renderMessage('char', b, { meta: `<i class="fa-solid fa-gift"></i> gift` });
      if (window.bindGiftView) window.bindGiftView(b);
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('gift', { item, note: gnote }, `[礼物] ${item}`, 'char');
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    // /* ── sticker ────────────────────────────────────────── */
    // if (type === 'sticker') {
    //   const b = document.createElement('div');
    //   b.className = 'bubble sticker-bub';
    //   b.style.cssText = 'padding:4px;background:transparent;box-shadow:none;';
    //   b.innerHTML = `<div style="width:68px;height:68px;border-radius:10px;background:var(--paper-2);display:flex;align-items:center;justify-content:center;font-size:9px;font-family:'Geist Mono',monospace;color:var(--mute);text-align:center;padding:5px;word-break:break-all;">${content}.jpg</div>`;
    //   const row = window.renderMessage('char', b, { meta: `<i class="fa-solid fa-face-smile-wink"></i> ${content}` });
    //   if (window.saveMessageToDB) {
    //     const floor = await window.saveMessageToDB('sticker', { name: content }, `[表情包] ${content}`, 'char');
    //     if (row && floor != null) row.dataset.floor = floor;
    //   }
    //   return;
    // }

    /* ── sticker ────────────────────────────────────────── */
    // if (type === 'sticker') {
    //   // 1. 【存储逻辑】先清理掉 AI 可能带的所有后缀，得到纯净名称用于存库
    //   const cleanName = content.replace(/\.(jpg|jpeg|gif|png|webp)$/i, '');

    //   const b = document.createElement('div');
    //   b.className = 'bubble sticker-bub';
    //   b.style.cssText = 'padding:4px;background:transparent;box-shadow:none;';

    //   // 2. 【渲染逻辑】在这里手动加上 .jpg 后缀显示在气泡内
    //   b.innerHTML = `<div style="width:68px;height:68px;border-radius:10px;background:var(--paper-2);display:flex;align-items:center;justify-content:center;font-size:9px;font-family:'Geist Mono',monospace;color:var(--mute);text-align:center;padding:5px;word-break:break-all;">${cleanName}.jpg</div>`;

    //   // 3. 【渲染逻辑】下方 Meta 小字也带上后缀
    //   const row = window.renderMessage('char', b, {
    //     meta: `<i class="fa-solid fa-face-smile-wink"></i> ${cleanName}`,
    //   });

    //   // 4. 【存储逻辑】存入数据库时，只使用 cleanName
    //   if (window.saveMessageToDB) {
    //     // 这里 content 存的是对象 { name: cleanName }，摘要存的是 [表情包] cleanName
    //     const floor = await window.saveMessageToDB('sticker', { name: cleanName }, `[表情包] ${cleanName}`, 'char');
    //     if (row && floor != null) row.dataset.floor = floor;
    //   }
    //   return;
    // }

    /* ── sticker ────────────────────────────────────────── */
    if (type === 'sticker') {
      let stickerName = content;
      let stickerUrl = '';

      // 1. 🌟 智能抓取：直接寻找 http 或 // 提取 URL，无视冒号或竖线
      const urlMatch = content.match(/(https?:)?\/\/[^\s]+/i);
      if (urlMatch) {
        stickerUrl = urlMatch[0];
        // 名字就是剔除 URL 后剩下的部分
        stickerName = content.replace(stickerUrl, '').trim();
      } else if (content.includes('|')) {
        // 兼容没有任何 http 前缀，纯靠竖线分割的旧格式
        const parts = content.split('|');
        stickerName = parts[0];
        stickerUrl = parts.slice(1).join('|').trim();
      }

      // 2. 🌟 终极清洗：以 http 为界限彻底截断名字，砍掉残留的冒号及后缀
      stickerName = stickerName
        .split(/http/i)[0]
        .replace(/[:：|]\s*$/, '')
        .replace(/\.(jpg|jpeg|gif|png|webp)$/i, '')
        .trim();

      // 3. 【偷图魔法】如果没抓到 URL，去表情包库里找同名图片
      if (!stickerUrl && window.stickerState && window.stickerState.categories) {
        for (const cat of window.stickerState.categories) {
          const found = cat.stickers.find(
            s => s.name.includes(stickerName) || stickerName.includes(s.name.split(/http/i)[0]),
          );
          if (found) {
            stickerUrl = found.url;
            break;
          }
        }
      }

      const b = document.createElement('div');
      b.className = 'bubble sticker-bub';
      b.style.cssText = 'padding:4px;background:transparent;box-shadow:none;';

      // 4. 渲染图片或占位符
      if (stickerUrl) {
        b.innerHTML = `<img src="${stickerUrl}" style="min-width:70px;max-width:120px;height:auto;border-radius:10px;display:block;object-fit:cover;" alt="${stickerName}">`;
      } else {
        b.innerHTML = `<div style="width:68px;height:68px;border-radius:10px;background:var(--paper-2);display:flex;align-items:center;justify-content:center;font-size:9px;font-family:'Geist Mono',monospace;color:var(--mute);text-align:center;padding:5px;word-break:break-all;">${stickerName}.jpg</div>`;
      }

      // 5. 渲染下方元数据（名字此时已经干干净净，绝对没有 https）
      const row = window.renderMessage('char', b, {
        meta: `<i class="fa-solid fa-face-smile-wink"></i> ${stickerName}`,
      });

      // 6. 存入数据库
      if (window.saveMessageToDB) {
        const contentData = stickerUrl ? { name: stickerName, url: stickerUrl } : { name: stickerName };
        const floor = await window.saveMessageToDB('sticker', contentData, `[表情包] ${stickerName}`, 'char');
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── 兜底 text ──────────────────────────────────────── */
    // 同理，兜底文本也直接传字符串
    const fbRow = window.renderMessage('char', content, { meta: `<i class="fa-regular fa-clock"></i> ${timeStr}` });
    if (window.saveMessageToDB) {
      const match = content.match(/^<quote=.*?\|.*?>([\s\S]*)$/);
      const cleanSummary = match ? match[1].trim() : content;

      const floor = await window.saveMessageToDB('text', content, cleanSummary, 'char');
      if (fbRow && floor != null) fbRow.dataset.floor = floor;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     6. 逐条上屏
  ═══════════════════════════════════════════════════════════ */

  async function renderMessagesSequentially(messages) {
    for (let i = 0; i < messages.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, RENDER_DELAY_MS));
      await renderParsedMessage(messages[i]);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     7. 上划手势绑定
  ═══════════════════════════════════════════════════════════ */

  function bindSwipeSend() {
    const sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) {
      setTimeout(bindSwipeSend, 500);
      return;
    }
    if (sendBtn._tsukiSwipeBound) return;
    sendBtn._tsukiSwipeBound = true;

    let startY = 0,
      currentDY = 0,
      isDragging = false,
      triggered = false;
    const BASE = 'translateY(-1px) rotate(-6deg)';

    const getY = e => (e.type.includes('mouse') ? e.clientY : e.touches[0].clientY);

    // 在 TsukiSend.js 中找到这段代码
    function handleStart(e) {
      if (e.button && e.button !== 0) return;
      startY = getY(e);
      isDragging = true;
      triggered = false;
      currentDY = 0;
      sendBtn.style.transition = 'none';

      // ⛔ 删掉下面这一行代码！就是它吞掉了你的点击事件
      // if (e.cancelable) e.preventDefault();
    }

    function handleMove(e) {
      if (!isDragging) return;

      const dy = getY(e) - startY;
      currentDY = dy;

      // 【关键修复】：增加 5px 的滑动死区
      // 只有明确向上滑动超过 5px 时，才拦截原生事件并改变按钮样式
      if (dy < -5) {
        if (e.cancelable) e.preventDefault(); // 拦截原生点击

        const travel = Math.min(Math.abs(dy) * 0.7, 80);
        sendBtn.style.transform = `translateY(calc(-1px - ${travel}px)) rotate(-6deg)`;
        const over = travel >= SWIPE_THRESHOLD * 0.7;
        sendBtn.style.background = over ? 'var(--ink)' : '';
        sendBtn.style.color = over ? 'var(--accent-lime)' : '';
        sendBtn.style.borderColor = over ? 'var(--ink)' : '';
      }
    }

    async function handleEnd() {
      if (!isDragging) return;
      isDragging = false;
      sendBtn.style.transition = '0.45s cubic-bezier(0.22,1,0.36,1)';
      sendBtn.style.background = '';
      sendBtn.style.color = '';
      sendBtn.style.borderColor = '';
      if (-currentDY >= SWIPE_THRESHOLD && !triggered) {
        triggered = true;
        sendBtn.style.transform = `translateY(-100px) rotate(-6deg)`;
        await triggerApiSend();
        await bounceBack(sendBtn);
      } else {
        sendBtn.style.transform = BASE;
      }
    }

    sendBtn.addEventListener('touchstart', handleStart, { passive: false });
    document.addEventListener(
      'touchmove',
      e => {
        if (isDragging) handleMove(e);
      },
      { passive: false },
    );
    document.addEventListener('touchend', handleEnd);
    sendBtn.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', e => {
      if (isDragging) handleMove(e);
    });
    document.addEventListener('mouseup', handleEnd);

    console.log('[TsukiSend] ✅ 上划手势已绑定到 #sendBtn');
  }

  function bounceBack(btn) {
    return new Promise(resolve => {
      const BASE = 'translateY(-1px) rotate(-6deg)';
      [
        { transform: `translateY(-30px) rotate(-6deg)`, delay: 0 },
        { transform: `translateY(6px)   rotate(-6deg)`, delay: 180 },
        { transform: `translateY(-8px)  rotate(-6deg)`, delay: 320 },
        { transform: BASE, delay: 440 },
      ].forEach(({ transform, delay }) =>
        setTimeout(() => {
          btn.style.transform = transform;
        }, delay),
      );
      setTimeout(resolve, 500);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     8. 核心发送流程
  ═══════════════════════════════════════════════════════════ */

  let _isSending = false;

  async function triggerApiSend() {
    if (_isSending) {
      console.log('[TsukiSend] 防抖：忽略本次触发');
      return;
    }

    const chatId = window.currentChatId;
    if (!chatId) {
      showToast('请先打开一个聊天室');
      return;
    }

    const inputField = document.querySelector('.input-field');
    const userText = (inputField?.value || '').trim();

    // ← 加这两行，上滑时取走相机图片队列
    const pendingImgs = window.pendingCameraImages || [];
    window.pendingCameraImages = [];

    // ① 有文字时先渲染 user 消息 & 存库，再调 API
    if (userText) {
      const now = new Date();
      const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');

      const userEl = window.renderMessage
        ? window.renderMessage('user', userText, { meta: `<i class="fa-regular fa-clock"></i> ${timeStr}` })
        : null;

      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('text', userText, userText, 'user');
        if (userEl && floor != null) userEl.dataset.floor = floor;
      }
    }

    // 清空输入框（防重复）
    if (inputField) inputField.value = '';

    _isSending = true;
    showTypingIndicator(true);

    try {
      // ② 空输入时 callApi 内部自动用占位符替换，不会 500
      const raw = await callApi(userText, chatId, pendingImgs);
      // 【新增】：先提取并抹除状态标签
      const newraw = await handleStatusTag(raw);

      const messages = parseAiResponse(newraw);

      if (!messages.length) {
        showToast('AI 返回格式异常，请重试');
        return;
      }

      showTypingIndicator(false);
      await renderMessagesSequentially(messages);
    } catch (err) {
      console.error('[TsukiSend] 发送失败:', err);
      showToast(`发送失败: ${err.message}`);
    } finally {
      showTypingIndicator(false);
      _isSending = false;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     8b. sendAll 专用入口：气泡已渲染，只携带图片调 API
  ═══════════════════════════════════════════════════════════ */

  /**
   * 由 sendAll（点击/回车发送）在渲染完所有气泡后调用。
   * 与 triggerApiSend 的区别：不再重复渲染用户气泡，只负责调 API + 渲染 AI 回复。
   * @param {string}   userText    用户原始文字（可能已随 sendAll 渲染过）
   * @param {string[]} extraImages 压缩后的 Base64 图片数组
   */
  async function triggerApiSendWithImages(userText, extraImages) {
    if (_isSending) {
      console.log('[TsukiSend] 防抖：sendAll 触发被忽略');
      return;
    }
    const chatId = window.currentChatId;
    if (!chatId) {
      showToast('请先打开一个聊天室');
      return;
    }

    _isSending = true;
    showTypingIndicator(true);

    try {
      const raw = await callApi(userText || '', chatId, extraImages || []);
      const newraw = await handleStatusTag(raw);
      const messages = parseAiResponse(newraw);

      if (!messages.length) {
        showToast('AI 返回格式异常，请重试');
        return;
      }

      showTypingIndicator(false);
      await renderMessagesSequentially(messages);
    } catch (err) {
      console.error('[TsukiSend] sendAll → AI 失败:', err);
      showToast(`发送失败: ${err.message}`);
    } finally {
      showTypingIndicator(false);
      _isSending = false;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     9. 辅助 UI
  ═══════════════════════════════════════════════════════════ */

  function showTypingIndicator(show) {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;
    let el = document.getElementById('tsuki-typing-indicator');
    if (show) {
      if (el) return;
      // ==========================================
      // 新增：动态获取当前聊天的 Char 头像
      // ==========================================
      let avatarStyle = '';
      let avatarInner = '';

      if (window.currentChatChar && window.currentChatChar.avatar) {
        // 如果有自定义图片，渲染背景图，并保留原来的渐变作为兜底
        avatarStyle = `style="background-image: url('${window.currentChatChar.avatar}'), linear-gradient(135deg, #1a1a1a, #3a3a3c); background-size: cover; background-position: center;"`;
      } else {
        // 如果没有图片，渲染默认的占位图标
        avatarInner = '<i class="fa-solid fa-user-astronaut"></i>';
      }
      el = document.createElement('div');
      el.id = 'tsuki-typing-indicator';
      el.className = 'msg-row char';
      el.innerHTML = `
        <div class="msg-avatar char" ${avatarStyle}>${avatarInner}</div>
        <div class="bubble-wrap">
          <div class="bubble" style="padding:10px 14px;">
            <div style="display:flex;gap:4px;align-items:center;height:16px;">
              <span style="width:6px;height:6px;border-radius:50%;background:var(--mute);animation:tsuki-dot 1.2s 0s   infinite;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:var(--mute);animation:tsuki-dot 1.2s 0.2s infinite;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:var(--mute);animation:tsuki-dot 1.2s 0.4s infinite;"></span>
            </div>
          </div>
        </div>
      `;
      if (!document.getElementById('tsuki-dot-style')) {
        const s = document.createElement('style');
        s.id = 'tsuki-dot-style';
        s.textContent = `@keyframes tsuki-dot{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}`;
        document.head.appendChild(s);
      }
      chatArea.appendChild(el);
      chatArea.scrollTop = chatArea.scrollHeight;
    } else {
      el?.remove();
    }
  }

  function showToast(msg) {
    document.getElementById('tsuki-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'tsuki-toast';
    t.textContent = msg;
    t.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(10,10,10,.88);color:#f5f5f0;padding:8px 18px;border-radius:100px;font-size:12px;font-family:'Geist',sans-serif;letter-spacing:.04em;z-index:99999;pointer-events:none;animation:tsukiToastIn .25s ease;`;
    if (!document.getElementById('tsuki-toast-style')) {
      const s = document.createElement('style');
      s.id = 'tsuki-toast-style';
      s.textContent = `@keyframes tsukiToastIn{from{opacity:0;top:10px}to{opacity:1;top:20px}}`;
      document.head.appendChild(s);
    }
    document.body.appendChild(t);
    setTimeout(() => t?.remove(), 2800);
  }

  /* ═══════════════════════════════════════════════════════════
     10. 初始化
  ═══════════════════════════════════════════════════════════ */

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindSwipeSend);
    } else {
      bindSwipeSend();
    }
  }

  window.TsukiSend = {
    triggerApiSend,
    triggerApiSendWithImages,
    parseAiResponse,
    stripTimestamps,
    loadApiConfig,
    callApi,
  };

  init();
})();
