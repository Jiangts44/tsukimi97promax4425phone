/**
 * ScheduleUpdater.js  v1.0
 * 剧情时钟 (Story Clock) + AI 全局日程更新
 * ─────────────────────────────────────────────────────────────
 * 剧情时钟机制：
 *   story_clock = {
 *     baseRealDate : string  "YYYY-MM-DD"  剧情第1天对应的真实日历日期（用于写入cal_events）
 *     lastSyncStoryMs : number             上次AI回复后的剧情毫秒偏移（从第1天00:00算起）
 *     lastSyncRealMs  : number             上次AI回复时的真实时间戳
 *   }
 *
 *   当前剧情毫秒 = lastSyncStoryMs + (Date.now() - lastSyncRealMs)
 *   当前剧情时间 = 第X天 HH:MM  （X从1开始）
 *
 * 发送给AI时注入：
 *   [剧情时钟] 当前剧情时间：第X天 HH:MM
 *
 * AI必须在回复最开头返回（所有[角色名|type]行之前）：
 *   <story_time>第X天 HH:MM</story_time>
 *
 * AI返回日程JSON格式（被 ```json ... ``` 包裹）：
 * {
 *   "storyTimeAfter": "第3天 20:15",   // AI认为这次对话后剧情时间推进到哪里
 *   "events": [
 *     { "storyDay": 3, "hour": 9, "minute": 0, "title": "...", "color": "#72c9a0" },
 *     ...
 *   ],
 *   "todos":  [ { "storyDay": 3, "title": "...", "done": false }, ... ],
 *   "memos":  [ { "storyDay": 3, "title": "..." }, ... ],
 *   "annotations": [ { "storyDay": 3, "symbol": "囍", "note": "..." }, ... ]
 * }
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     1. DB 工具
  ══════════════════════════════════════════════════════════ */

  function openDb() {
    if (typeof window.openDb === 'function') return window.openDb();
    return new Promise((res, rej) => {
      const r = indexedDB.open('tsukiphonepromax');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async function dbGet(store, key) {
    const db = await openDb();
    return new Promise(res => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      } catch { res(null); }
    });
  }

  async function dbPut(store, obj) {
    const db = await openDb();
    return new Promise((res, rej) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).put(obj);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      } catch (e) { rej(e); }
    });
  }

  async function dbGetAll(store) {
    const db = await openDb();
    return new Promise(res => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      } catch { res([]); }
    });
  }

  /* ══════════════════════════════════════════════════════════
     2. 剧情时钟核心
  ══════════════════════════════════════════════════════════ */

  /** 每个聊天独立的时钟 key */
  function clockKey(chatId) {
    return chatId ? `story_clock_${chatId}` : 'story_clock';
  }

  /**
   * 读取剧情时钟配置
   * @param {string} [chatId]
   * @returns {Promise<{baseRealDate:string, lastSyncStoryMs:number, lastSyncRealMs:number}|null>}
   */
  async function loadStoryClock(chatId) {
    return dbGet('config', clockKey(chatId));
  }

  /**
   * 读取日程锚点（记录生成时剧情第1天对应的真实日期，供两种模式对齐使用）
   * @param {string} chatId
   * @returns {Promise<{realAnchorDay1:string, updatedAt:number}|null>}
   */
  async function loadScheduleAnchor(chatId) {
    return dbGet('config', `schedule_anchor_${chatId}`);
  }

  /**
   * 保存剧情时钟配置
   * @param {object} clock
   * @param {string} [chatId]
   */
  async function saveStoryClock(clock, chatId) {
    try {
      await dbPut('config', { id: clockKey(chatId), ...clock });
    } catch (e) {
      console.error('[StoryClock] 保存失败:', e);
      throw e;
    }
  }

  /**
   * 初始化剧情时钟（第一次设置起点时调用）
   * @param {string} baseRealDate   "YYYY-MM-DD"  剧情第1天 = 哪一天（真实日历）
   * @param {number} [initDayMs=0]  初始剧情偏移毫秒（默认第1天00:00 = 0）
   * @param {string} [chatId]
   */
  async function initStoryClock(baseRealDate, initDayMs = 0, chatId) {
    const clock = {
      baseRealDate,
      lastSyncStoryMs: initDayMs,
      lastSyncRealMs: Date.now(),
    };
    await saveStoryClock(clock, chatId);
    console.log('[StoryClock] 初始化完成', chatId || '(global)', clock);
    return clock;
  }

  /**
   * 手动调整剧情时间
   * @param {number} dayNum   第几天（从1开始）
   * @param {number} hour
   * @param {number} minute
   * @param {string} [chatId]
   */
  async function setStoryTime(dayNum, hour, minute, chatId) {
    const clock = await loadStoryClock(chatId);
    if (!clock) {
      console.warn('[StoryClock] 尚未初始化，无法手动调整');
      return null;
    }
    const newMs = ((dayNum - 1) * 86400 + hour * 3600 + minute * 60) * 1000;
    clock.lastSyncStoryMs = newMs;
    clock.lastSyncRealMs = Date.now();
    await saveStoryClock(clock, chatId);
    console.log(`[StoryClock] 手动调整 → 第${dayNum}天 ${p2(hour)}:${p2(minute)}`, chatId || '(global)');
    return clock;
  }

  /**
   * 计算当前剧情时间的毫秒偏移
   */
  function calcCurrentStoryMs(clock) {
    if (!clock) return 0;
    return clock.lastSyncStoryMs + (Date.now() - clock.lastSyncRealMs);
  }

  /**
   * 毫秒偏移 → { day, hour, minute }（day从1开始）
   */
  function msToStoryTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const day = Math.floor(totalSec / 86400) + 1;
    const hour = Math.floor((totalSec % 86400) / 3600);
    const minute = Math.floor((totalSec % 3600) / 60);
    return { day, hour, minute };
  }

  /**
   * 字符串 "第X天 HH:MM" → 毫秒偏移
   */
  function storyTimeStrToMs(str) {
    const m = str.match(/第(\d+)天\s*(\d+):(\d+)/);
    if (!m) return null;
    const day = parseInt(m[1]);
    const hour = parseInt(m[2]);
    const min = parseInt(m[3]);
    return ((day - 1) * 86400 + hour * 3600 + min * 60) * 1000;
  }

  /**
   * 毫秒偏移 → "第X天 HH:MM"
   */
  function msToStoryTimeStr(ms) {
    const { day, hour, minute } = msToStoryTime(ms);
    return `第${day}天 ${p2(hour)}:${p2(minute)}`;
  }

  /**
   * storyDay(第几天) + baseRealDate → 真实日历日期字符串 "YYYY-MM-DD"
   */
  function storyDayToRealDate(baseRealDate, storyDay) {
    const base = new Date(baseRealDate + 'T00:00:00');
    base.setDate(base.getDate() + storyDay - 1);
    const y = base.getFullYear();
    const mo = p2(base.getMonth() + 1);
    const d = p2(base.getDate());
    return `${y}-${mo}-${d}`;
  }

  function p2(n) { return String(n).padStart(2, '0'); }

  /* ══════════════════════════════════════════════════════════
     3. API 配置读取（对齐 TsukiSend）
  ══════════════════════════════════════════════════════════ */

  async function loadApiConfig() {
    const defaults = { apiKey: '', baseUrl: '', model: 'gpt-4o', maxTokens: 8000, temperature: 0.8, historyCount: 20 };
    try {
      const db = await openDb();
      const readKey = (key) => new Promise(res => {
        try {
          const tx = db.transaction('config', 'readonly');
          const req = tx.objectStore('config').get(key);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        } catch { res(null); }
      });

      const mainConfig = await readKey('main_config');
      const chatSettings = await readKey('chat_settings');

      const historyCount = chatSettings?.historyCount ?? defaults.historyCount;

      if (!mainConfig) return { ...defaults, historyCount };

      const apiData = mainConfig.api || {};
      const presetName = apiData.activePreset;
      const cfg = (presetName && apiData.presets?.[presetName]) ? apiData.presets[presetName] : (apiData.temp || {});

      return {
        apiKey: cfg.key || defaults.apiKey,
        baseUrl: cfg.url || defaults.baseUrl,
        model: cfg.model || defaults.model,
        temperature: parseFloat(cfg.temp || defaults.temperature),
        maxTokens: parseInt(cfg.maxTokens || defaults.maxTokens, 10),
        historyCount,
      };
    } catch (e) {
      console.error('[ScheduleUpdater] 读取 API 配置失败:', e);
      return defaults;
    }
  }

  /* ══════════════════════════════════════════════════════════
     4. 构建提示词（对齐 TsukiSend/PromptHelper）
  ══════════════════════════════════════════════════════════ */

  const SCHEDULE_SYSTEM_PROMPT = `你是日程规划助手，根据对话历史为角色和用户生成/更新七天日程安排。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第一步：输出剧情时间（必须在最开头，单独一行）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<story_time>第X天 HH:MM</story_time>
填写你认为这段对话结束后剧情推进到的时间。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第二步：一句话吐槽/评价（不超过40字，可以不正经）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
直接写这句话，不加任何标签。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第三步：输出 JSON（用 \`\`\`json 包裹）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\`\`\`json
{
  "events": [
    {
      "storyDay": 整数,
      "charGen": true,
      "charName": "角色名（由角色视角产生的日程填角色名，由用户视角产生的填用户名）",
      "hour": 0-23,
      "minute": 0-59,
      "title": "纯内容，不要加（角色名）前缀",
      "color": "#72c9a0"
    }
  ],
  "todos": [
    {
      "storyDay": 整数,
      "charGen": true,
      "charName": "角色名或用户名",
      "title": "纯内容，不要加（角色名）前缀",
      "done": false
    }
  ],
  "memos": [
    {
      "storyDay": 整数,
      "charGen": true,
      "charName": "角色名或用户名",
      "title": "纯内容，不要加（角色名）前缀"
    }
  ],
  "annotations": [
    {
      "storyDay": 整数,
      "charGen": true,
      "charName": "角色名或用户名",
      "symbol": "囍",
      "note": "这天发生了什么"
    }
  ],
  "comments": [
    {
      "targetRef": "被吐槽条目的标题关键词（用于匹配）",
      "targetType": "event 或 todo 或 memo 或 annotation",
      "storyDay": 整数,
      "authorType": "char",
      "authorName": "角色名",
      "content": "吐槽内容，角色口吻，可以调皮"
    }
  ],
  "edits": [
    {
      "targetRef": "被修改条目的标题关键词",
      "targetType": "event 或 todo 或 memo 或 annotation",
      "storyDay": 整数,
      "editorType": "char",
      "editorName": "角色名",
      "field": "title 或 hour 或 minute 或 color 或 done 或 symbol 或 note",
      "newValue": "修改后的值（done字段用 true/false，hour/minute 用数字）"
    }
  ]
}
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【字段说明】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ charGen
  - true  = 这条日程由角色视角产生（角色的安排、角色对用户的期待等）
  - false = 这条日程由用户视角产生（用户自己的安排）
  注意：根据对话内容判断，不要全写 true

■ charName
  - charGen=true 时填角色名（如 "许知砚"）
  - charGen=false 时填用户名（如 "江眠月"）

■ title / note
  ❌ 错误：（许知砚）健身房，发泄多余精力
  ✅ 正确：健身房，发泄多余精力
  内容里不要出现任何人名前缀，人名通过 charName 字段表达

■ color（仅 event 类型）
  可用颜色：#72c9a0  #82c4e8  #f4a7b9  #b8a8d8  #f9c784  #a8dcc8  #f4927a

■ symbol（仅 annotation 类型）
  只能是 "囍"（美好/开心）或 "寂"（低落/难过）

■ comments（吐槽）
  角色对某条日程的即兴评论，用角色口吻写，体现性格

■ edits（修改）
  角色主动修改某条日程的某个字段
  field 可选值：title · hour · minute · color · done · symbol · note
  newValue 类型：
    - title/note：字符串
    - hour/minute：数字字符串，如 "9"、"30"
    - done："true" 或 "false"
    - color：颜色 hex 字符串
    - symbol："囍" 或 "寂"

■ targetRef（comments/edits 用）
  填被操作条目 title 或 note 的关键词片段，系统会用 storyDay + type + 关键词模糊匹配

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【日程内容要求】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 覆盖当前剧情日起的7天
- 当天详细：3-5条时间轴事件 + 2-3条待办 + 1-2条备忘 + 1条心情批注
- 其他每天 1-2 条即可，体现生活节奏
- 只改/增今天起的日程，不动今天之前的
- 至少新增今天以后第二天的日程
- 内容贴合角色人设和对话氛围，可以用细节表达情感
- storyDay 是剧情第几天（整数，从1开始），不是真实日期`;

  /**
   * 时间感知模式（timestampEnabled=true）的系统提示词
   * AI 使用真实日期 "YYYY-MM-DD"，不使用 storyDay
   */
  function buildRealtimeSchedulePrompt(realToday) {
    return `你是日程规划助手，根据对话历史为角色和用户生成/更新七天日程安排。
【当前真实日期】${realToday}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第一步：一句话吐槽/评价（不超过40字，可以不正经）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
直接写这句话，不加任何标签。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第二步：输出 JSON（用 \`\`\`json 包裹）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\`\`\`json
{
  "events": [
    {
      "date": "YYYY-MM-DD",
      "charGen": true,
      "charName": "角色名或用户名",
      "hour": 0-23,
      "minute": 0-59,
      "title": "纯内容，不要加人名前缀",
      "color": "#72c9a0"
    }
  ],
  "todos": [
    { "date": "YYYY-MM-DD", "charGen": true, "charName": "角色名或用户名", "title": "纯内容", "done": false }
  ],
  "memos": [
    { "date": "YYYY-MM-DD", "charGen": true, "charName": "角色名或用户名", "title": "纯内容" }
  ],
  "annotations": [
    { "date": "YYYY-MM-DD", "charGen": true, "charName": "角色名或用户名", "symbol": "囍", "note": "这天发生了什么" }
  ],
  "comments": [
    { "targetRef": "条目关键词", "targetType": "event或todo或memo或annotation", "date": "YYYY-MM-DD", "authorType": "char", "authorName": "角色名", "content": "吐槽内容" }
  ],
  "edits": [
    { "targetRef": "条目关键词", "targetType": "event或todo或memo或annotation", "date": "YYYY-MM-DD", "editorType": "char", "editorName": "角色名", "field": "title或hour或minute或color或done或symbol或note", "newValue": "修改后的值" }
  ]
}
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【字段说明】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ date（必填）
  真实日历日期，格式 "YYYY-MM-DD"，必须在今天（${realToday}）起的7天内

■ charGen
  - true  = 由角色视角产生（角色的安排/对用户的期待）
  - false = 由用户视角产生（用户自己的安排）
  根据对话内容判断，不要全写 true

■ charName
  charGen=true 时填角色名，false 时填用户名

■ title / note
  ❌ 错误：（许知砚）健身房，发泄多余精力
  ✅ 正确：健身房，发泄多余精力

■ color（仅 event）
  可用颜色：#72c9a0  #82c4e8  #f4a7b9  #b8a8d8  #f9c784  #a8dcc8  #f4927a

■ symbol（仅 annotation）
  只能是 "囍"（美好/开心）或 "寂"（低落/难过）

■ targetRef（comments/edits 用）
  填被操作条目 title 或 note 的关键词片段，系统用 date+type+关键词模糊匹配

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【日程内容要求】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 覆盖今天（${realToday}）起7天的真实日期
- 当天详细：3-5条时间轴事件 + 2-3条待办 + 1-2条备忘 + 1条心情批注
- 其他每天 1-2 条即可，体现生活节奏
- 只新增或修改今天及以后的日程，不动今天之前的
- 内容贴合角色人设和对话氛围，可以用细节表达情感
- date 字段必须是真实日期字符串 YYYY-MM-DD，不要用整数`;
  }

  /**
   * 构建发送给AI的完整消息数组（严格对齐 TsukiSend 的 callApi 逻辑）
   * 提示词拼接顺序：
   *   [wb_pre] → [人设/角色/用户] → [wb_local] → [聊天记录] → [wb_post]
   *   → 分隔线 → 剧情时钟信息 → 已有日程 → 日程生成指令
   */
  async function buildMessages(chatId, ctx) {
    const config = await loadApiConfig();

    // ── PromptHelper 可用性检查 ──
    const _assembleChar = window.assembleCharacterPrompts;
    const _buildFinal   = window.buildFinalPromptStream;
    if (typeof _assembleChar !== 'function' || typeof _buildFinal !== 'function') {
      throw new Error('PromptHelper.js 未加载或函数未暴露到全局，请确认 calendar.html 已引入 PromptHelper.js');
    }

    // 1. 读取聊天信息
    const chat = await dbGet('chats', chatId);
    if (!chat) throw new Error('找不到聊天室: ' + chatId);
    const charIds    = chat.charIds  || [];
    const chatUserId = chat.userId   || null;

    // 2. Step1: 组装角色人设提示词（与 TsukiSend.callApi 完全一致）
    //    latestMessage 传空字符串——世界书关键词触发在日程场景下无意义，全量注入
    const personaPrompts = await _assembleChar(charIds, '', chatUserId);

    // 3. Step2: 组装完整 prompt 流（含 wb_pre/mid/global/local/人设/聊天记录/wb_post）
    //    category 固定 'Online'，与 TsukiSend 保持一致
    const promptStream = await _buildFinal(
      charIds,
      personaPrompts,
      config.historyCount,  // 历史记录条数，从 chat_settings 读取
      'Online',
      '',                   // latestMessage
      chatId,
    );

    // 4. 时间感知开关
    const chatSettings    = await dbGet('config', 'chat_settings');
    const timestampEnabled = chatSettings ? chatSettings.timestampEnabled !== false : true;

    // 5. 剧情时钟 / 真实时间（每个聊天独立）
    const clock        = await loadStoryClock(chatId);
    const now = new Date();
    const realToday = `${now.getFullYear()}-${p2(now.getMonth()+1)}-${p2(now.getDate())}`;
    const realNow   = `${realToday} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
    const currentMs    = calcCurrentStoryMs(clock);
    const storyTimeStr = clock ? msToStoryTimeStr(currentMs) : '未设置';

    // 6. 已有日程摘要（放在分隔线之后、指令之前）
    const allEvs  = await dbGetAll('cal_events');
    const chatEvs = allEvs.filter(e => e.chatId === chatId);
    let existingScheduleSummary = '';
    if (chatEvs.length > 0) {
      const grouped = {};
      chatEvs.forEach(e => {
        const k = e.date || '未知日期';
        if (!grouped[k]) grouped[k] = [];
        grouped[k].push(e);
      });
      const lines = Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, evs]) => {
          const items = evs.map(e => {
            if (e.type === 'event')      return `  · [时间轴] ${e.hour != null ? p2(e.hour) + ':' + p2(e.minute || 0) + ' ' : ''}${e.title}`;
            if (e.type === 'todo')       return `  · [待办] ${e.title}${e.done ? '（已完成）' : ''}`;
            if (e.type === 'memo')       return `  · [备忘] ${e.title}`;
            if (e.type === 'annotation') return `  · [心情] ${e.symbol} ${e.note || ''}`;
            return `  · ${e.title}`;
          });
          return `${date}:\n${items.join('\n')}`;
        });
      existingScheduleSummary =
        `========== 已有日程（今天及以后可修改，今天之前请保留）==========\n` +
        lines.join('\n\n') +
        `\n=================================================================`;
    }

    // 7. 拼装 system prompt — 按时间感知开关走两条路
    let historyText = promptStream.join('\n\n');
    historyText = historyText.replace(/data:image\/[a-zA-Z]+;base64,[^\]\s>]+/g, '[图片数据已归档]');

    let systemPrompt, userMsg;

    if (timestampEnabled) {
      // ── 时间感知 ON：用真实日期，不用剧情时钟 ──────────────────────────
      const timeAwareNote = '[时间感知：开启，消息历史中包含时间戳，可参考判断对话时间节奏]';
      systemPrompt = [
        historyText,
        '──────────────────────────────',
        `[当前真实日期时间] ${realNow}`,
        timeAwareNote,
        existingScheduleSummary || null,
        '──────────────────────────────',
        buildRealtimeSchedulePrompt(realToday),
      ].filter(Boolean).join('\n\n');

      userMsg = `请根据以上对话历史和角色人设，为${ctx.charName}和${ctx.userName}生成从今天（${realToday}）起七天的日程安排。所有条目使用真实日期字段 "date"（格式 YYYY-MM-DD），不要使用 storyDay。`;

    } else {
      // ── 时间感知 OFF：用剧情时钟 ─────────────────────────────────────
      const timeAwareNote = '[时间感知：关闭，消息历史无时间戳，请以剧情时钟为唯一时间参考]';
      systemPrompt = [
        historyText,
        '──────────────────────────────',
        `[剧情时钟] 当前剧情时间：${storyTimeStr}`,
        timeAwareNote,
        clock ? `[日历起点] 剧情第1天对应真实日期：${clock.baseRealDate}` : '',
        existingScheduleSummary || null,
        '──────────────────────────────',
        SCHEDULE_SYSTEM_PROMPT,
      ].filter(Boolean).join('\n\n');

      userMsg = `请根据以上对话历史和角色人设，为${ctx.charName}和${ctx.userName}生成接下来七天的日程安排。当前剧情时间：${storyTimeStr}，请在回复最开头输出<story_time>标签。`;
    }

    // ── 📋 完整提示词分段打印 ──────────────────────────────────────────
    console.groupCollapsed(
      '%c📋 [ScheduleUpdater] ══ 完整提示词预览 ══',
      'color:#d4ff4d;font-size:13px;font-weight:bold'
    );

    console.group('%c① PromptHelper流（人设+世界书+聊天记录）', 'color:#82c4e8;font-weight:bold');
    console.log(`共 ${promptStream.length} 个片段，合并后长度 ${historyText.length} 字符`);
    promptStream.forEach((chunk, i) => {
      const preview = chunk.length > 200 ? chunk.substring(0, 200) + '…(共' + chunk.length + '字)' : chunk;
      console.log(`%c  [片段 ${i + 1}/${promptStream.length}]\n${preview}`, 'color:#8a8a8e');
    });
    console.groupEnd();

    console.group('%c② 时间信息', 'color:#f9c784;font-weight:bold');
    if (timestampEnabled) {
      console.log(`%c  [模式] 时间感知 ON — 使用真实日期`, 'color:#72c9a0');
      console.log(`%c  [真实时间] ${realNow}`, 'color:#f9c784');
    } else {
      console.log(`%c  [模式] 时间感知 OFF — 使用剧情时钟`, 'color:#b8a8d8');
      console.log(`%c  [剧情时钟] 当前剧情时间：${storyTimeStr}`, 'color:#f9c784');
      if (clock) console.log(`%c  [日历起点] 剧情第1天对应真实日期：${clock.baseRealDate}`, 'color:#f9c784');
    }
    console.groupEnd();

    console.group('%c③ 已有日程摘要', 'color:#72c9a0;font-weight:bold');
    if (existingScheduleSummary) {
      console.log(existingScheduleSummary);
      console.log(`共 ${chatEvs.length} 条日程`);
    } else {
      console.log('（暂无已有日程）');
    }
    console.groupEnd();

    console.group('%c④ 日程生成指令', 'color:#b8a8d8;font-weight:bold');
    console.log(timestampEnabled ? buildRealtimeSchedulePrompt(realToday) : SCHEDULE_SYSTEM_PROMPT);
    console.groupEnd();

    console.group('%c⑤ User 消息', 'color:#f4a7b9;font-weight:bold');
    console.log(userMsg);
    console.groupEnd();

    console.group('%c⑥ 最终 system prompt 全文', 'color:#43d9a0;font-weight:bold');
    console.log(systemPrompt);
    console.groupEnd();

    console.groupEnd(); // 外层 ══ 完整提示词预览 ══
    // ────────────────────────────────────────────────────────────────────

    return {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMsg },
      ],
      config,
      storyTimeStr,
      timestampEnabled,
      realToday,
    };
  }

  /* ══════════════════════════════════════════════════════════
     5. 调用 API
  ══════════════════════════════════════════════════════════ */

  async function callScheduleApi(chatId, ctx, onLog) {
    const log = (msg, style) => {
      console.log(style ? `%c${msg}` : msg, style || '');
      if (onLog) onLog(msg);
    };

    log('[ScheduleUpdater] 开始构建提示词...', 'color:#82c4e8;font-weight:bold');

    const { messages, config, storyTimeStr, timestampEnabled, realToday } = await buildMessages(chatId, ctx);

    if (!config.baseUrl) throw new Error('API 代理地址未配置');
    if (!config.apiKey) throw new Error('API Key 未配置');

    let apiUrl = config.baseUrl.trim().replace(/\/+$/, '');
    if (apiUrl.endsWith('/v1/messages')) apiUrl = apiUrl.slice(0, -12);
    else if (apiUrl.endsWith('/v1')) apiUrl = apiUrl.slice(0, -3);
    const finalUrl = `${apiUrl}/v1/chat/completions`;

    log(`[ScheduleUpdater] 调用 API... ${timestampEnabled ? '真实日期模式：' + realToday : '剧情时间模式：' + storyTimeStr}`, 'color:#f9c784');

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
    if (!res.ok) throw new Error(`API 请求失败 ${res.status}: ${data.error?.message || '未知错误'}`);

    const rawText = data.choices?.[0]?.message?.content || '';

    // ── 🤖 AI 原始返回打印 ─────────────────────────────────────────────
    console.group('%c🤖 [ScheduleUpdater] ══ AI 原始返回 ══', 'color:#fa5bd5;font-size:13px;font-weight:bold');
    console.log('%c完整原始文本：', 'color:#fa5bd5;font-weight:bold');
    console.log(rawText);
    console.groupEnd();
    // ────────────────────────────────────────────────────────────────────

    log('[ScheduleUpdater] AI 响应收到，开始解析...', 'color:#72c9a0');
    return { rawText, timestampEnabled, realToday };
  }

  /* ══════════════════════════════════════════════════════════
     6. 解析 AI 回复
  ══════════════════════════════════════════════════════════ */

  function parseScheduleResponse(rawText) {
    // 1. 提取 story_time 标签
    const stMatch = rawText.match(/<story_time>(.*?)<\/story_time>/);
    const storyTimeAfter = stMatch ? stMatch[1].trim() : null;

    // 2. 提取 JSON 块
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    let schedule = null;
    let parseError = null;

    if (!jsonMatch) {
      // 尝试裸 JSON
      const bareMatch = rawText.match(/\{[\s\S]*"events"[\s\S]*\}/);
      if (bareMatch) {
        try { schedule = JSON.parse(bareMatch[0]); }
        catch (e) { parseError = e.message; }
      }
    } else {
      try { schedule = JSON.parse(jsonMatch[1].trim()); }
      catch (e) {
        parseError = e.message;
        console.error('[ScheduleUpdater] JSON 解析失败:', e);
      }
    }

    // ── 🔍 解析结果打印 ───────────────────────────────────────────────
    console.group('%c🔍 [ScheduleUpdater] ══ AI 回复解析结果 ══', 'color:#43d9a0;font-size:13px;font-weight:bold');

    console.log('%cstory_time 标签：', 'color:#f9c784;font-weight:bold',
      storyTimeAfter ? storyTimeAfter : '⚠️ 未找到 <story_time> 标签');

    if (schedule) {
      console.log('%c✅ JSON 解析成功', 'color:#43d9a0;font-weight:bold');
      console.group('%c  events（时间轴事件）', 'color:#72c9a0');
      console.table(schedule.events || []);
      console.groupEnd();
      console.group('%c  todos（待办）', 'color:#82c4e8');
      console.table(schedule.todos || []);
      console.groupEnd();
      console.group('%c  memos（备忘）', 'color:#b8a8d8');
      console.table(schedule.memos || []);
      console.groupEnd();
      console.group('%c  annotations（心情批注）', 'color:#f4a7b9');
      console.table(schedule.annotations || []);
      console.groupEnd();
      console.log('%c完整 schedule 对象：', 'color:#43d9a0;font-weight:bold');
      console.log(schedule);
    } else {
      console.log('%c❌ JSON 解析失败', 'color:#ff6b6b;font-weight:bold', parseError || '（未找到 JSON 块）');
      console.log('%c原始文本前500字：', 'color:#ff6b6b');
      console.log(rawText.substring(0, 500));
    }

    console.groupEnd(); // ══ AI 回复解析结果 ══
    // ────────────────────────────────────────────────────────────────────

    return { storyTimeAfter, schedule, rawText };
  }

  /* ══════════════════════════════════════════════════════════
     7. 写入日程数据
  ══════════════════════════════════════════════════════════ */

  /**
   * 将 AI 返回的日程写入 cal_events / cal_comments / cal_edits
   * 策略：只操作「今天起」的日程，对每个 storyDay/date 先清除 charGen 条目再写入
   * @param {boolean} realDateMode  true=时间感知模式（item.date）/ false=剧情模式（item.storyDay）
   * @param {string}  realToday     "YYYY-MM-DD" 真实今天（realDateMode=true 时作为过滤基准）
   */
  async function writeScheduleToDb(schedule, chatId, ctx, clock, realDateMode = false, realToday = null) {
    if (!schedule) return { events: 0, todos: 0, memos: 0, annotations: 0, comments: 0, edits: 0 };

    // ── 模式分支：真实日期 vs 剧情天数 ─────────────────────────────────
    let getItemDate, todayStr;
    // _anchorStoryDay：生成时剧情处于第几天（用于计算日程锚点 realAnchorDay1）
    let _anchorStoryDay = 1;

    if (realDateMode) {
      // 时间感知 ON：item.date 就是真实日历日期
      todayStr = realToday || new Date().toISOString().slice(0, 10);
      getItemDate = (item) => item.date || null;
      // 记录生成时的剧情天数（如果时钟存在）
      if (clock) {
        _anchorStoryDay = msToStoryTime(calcCurrentStoryMs(clock)).day;
      }
    } else {
      // 时间感知 OFF：以真实今日为剧情当天锚点（不再使用固定的 baseRealDate 偏移）
      // 这样生成的事件日期与真实日历对齐，切换到时间感知模式也能正确显示
      if (!clock) return { events: 0, todos: 0, memos: 0, annotations: 0, comments: 0, edits: 0 };
      const currentMs = calcCurrentStoryMs(clock);
      const { day: todayStoryDay } = msToStoryTime(currentMs);
      _anchorStoryDay = todayStoryDay;

      // 真实今日作为剧情当天的日历锚点
      const realTodayObj = new Date();
      realTodayObj.setHours(0, 0, 0, 0);
      const realTodayStr = `${realTodayObj.getFullYear()}-${p2(realTodayObj.getMonth()+1)}-${p2(realTodayObj.getDate())}`;
      todayStr = realTodayStr;
      getItemDate = (item) => {
        if (item.storyDay == null) return null;
        const d = new Date(realTodayObj);
        d.setDate(d.getDate() + item.storyDay - todayStoryDay);
        return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
      };
    }

    const stats = { events: 0, todos: 0, memos: 0, annotations: 0, comments: 0, edits: 0 };

    // ── 1. 收集需要覆写的日期 ─────────────────────────────────────────
    const overwriteDates = new Set();
    const coreItems = [
      ...(schedule.events      || []).map(e => ({ ...e, _type: 'event' })),
      ...(schedule.todos       || []).map(e => ({ ...e, _type: 'todo' })),
      ...(schedule.memos       || []).map(e => ({ ...e, _type: 'memo' })),
      ...(schedule.annotations || []).map(e => ({ ...e, _type: 'annotation' })),
    ];
    coreItems.forEach(item => {
      const d = getItemDate(item);
      if (d && d >= todayStr) overwriteDates.add(d);
    });

    if (overwriteDates.size === 0) {
      console.warn('[ScheduleUpdater] AI 返回的日程都在今天之前，跳过写入');
      return stats;
    }

    // ── 2. 删除这些日期的已有 charGen 日程 ───────────────────────────
    const allEvs = await dbGetAll('cal_events');
    const db = await openDb();
    for (const dateStr of overwriteDates) {
      const toDelete = allEvs.filter(e => e.chatId === chatId && e.date === dateStr && e.charGen);
      for (const ev of toDelete) {
        await new Promise(r => {
          const tx = db.transaction('cal_events', 'readwrite');
          tx.objectStore('cal_events').delete(ev.id);
          tx.oncomplete = r; tx.onerror = r;
        });
      }
    }

    // ── 3. 写入新日程条目 ─────────────────────────────────────────────
    const now = Date.now();
    const evIdMap = []; // [{ date, type, titleKey, id }]

    for (const item of coreItems) {
      const realDate = getItemDate(item);
      if (!realDate || realDate < todayStr) continue;

      const id = `su_${chatId}_${item._type}_${realDate}_${now}_${Math.random().toString(36).slice(2, 7)}`;

      const isCharGen = item.charGen !== false;
      const nameField = isCharGen
        ? { charGen: true,  charName: item.charName || ctx.charName }
        : { charGen: false, userName: item.charName || ctx.userName };

      let obj = { id, chatId, date: realDate, ...nameField, createdAt: now };

      if (item._type === 'event') {
        obj = { ...obj, type: 'event', hour: item.hour ?? 9, minute: item.minute ?? 0, title: item.title || '', color: item.color || '#72c9a0' };
        stats.events++;
      } else if (item._type === 'todo') {
        obj = { ...obj, type: 'todo', title: item.title || '', done: item.done ?? false };
        stats.todos++;
      } else if (item._type === 'memo') {
        obj = { ...obj, type: 'memo', title: item.title || '' };
        stats.memos++;
      } else if (item._type === 'annotation') {
        obj = { ...obj, type: 'annotation', symbol: item.symbol === '寂' ? '寂' : '囍', note: item.note || '' };
        stats.annotations++;
      }

      await dbPut('cal_events', obj);

      const titleKey = (obj.title || obj.note || '').substring(0, 20);
      evIdMap.push({ date: realDate, type: item._type, titleKey, id });
    }

    // ── 4. 写入吐槽 (comments) ────────────────────────────────────────
    for (const cm of (schedule.comments || [])) {
      const targetId = resolveTargetIdByDate(cm, evIdMap, allEvs, chatId, getItemDate);
      if (!targetId) {
        console.warn('[ScheduleUpdater] comment 未找到目标条目:', cm.targetRef, '跳过');
        continue;
      }
      // timeMode + createdAt 对齐 calendar.html 手动添加逻辑：
      //   realDateMode=true  → timeMode:'real',  createdAt=真实时间戳
      //   realDateMode=false → timeMode:'story', createdAt=剧情毫秒偏移
      const _cmStoryMs = (!realDateMode && clock)
        ? Math.max(0, clock.lastSyncStoryMs + (Date.now() - clock.lastSyncRealMs))
        : null;
      const c = {
        id: `cm_${now}_${Math.random().toString(36).slice(2)}`,
        chatId,
        targetId,
        authorType:  cm.authorType  || 'char',
        authorName:  cm.authorName  || ctx.charName,
        content:     cm.content     || '',
        createdAt:   _cmStoryMs !== null ? _cmStoryMs : now,
        timeMode:    realDateMode ? 'real' : 'story',
      };
      await dbPut('cal_comments', c);
      stats.comments++;
    }

    // ── 5. 写入修改 (edits) ───────────────────────────────────────────
    for (const ed of (schedule.edits || [])) {
      const targetId = resolveTargetIdByDate(ed, evIdMap, allEvs, chatId, getItemDate);
      if (!targetId) {
        console.warn('[ScheduleUpdater] edit 未找到目标条目:', ed.targetRef, '跳过');
        continue;
      }
      const origEv = [...evIdMap.map(m => ({ id: m.id })), ...allEvs].find(e => e.id === targetId);
      const oldValue = origEv ? (origEv[ed.field] ?? '') : '';
      let newValue = ed.newValue;
      if (ed.field === 'hour' || ed.field === 'minute') newValue = String(parseInt(newValue) || 0);
      if (ed.field === 'done') newValue = (newValue === true || newValue === 'true') ? 'true' : 'false';

      const _edStoryMs = (!realDateMode && clock)
        ? Math.max(0, clock.lastSyncStoryMs + (Date.now() - clock.lastSyncRealMs))
        : null;
      const edObj = {
        id: `ed_${now}_${Math.random().toString(36).slice(2)}`,
        chatId,
        targetId,
        editorType:  ed.editorType  || 'char',
        editorName:  ed.editorName  || ctx.charName,
        field:       ed.field,
        oldValue:    String(oldValue),
        newValue:    String(newValue),
        createdAt:   _edStoryMs !== null ? _edStoryMs : now,
        timeMode:    realDateMode ? 'real' : 'story',
      };
      await dbPut('cal_edits', edObj);
      stats.edits++;
    }

    // ── 保存日程锚点：供日历面板在两种模式间对齐 ─────────────────────
    // realAnchorDay1 = 真实今日 - (当前剧情天数 - 1) = 剧情第1天对应的真实日期
    // 面板切换模式时用此锚点替代 clock.baseRealDate，实现两模式日期对齐
    try {
      const anchorNow = new Date();
      anchorNow.setHours(0, 0, 0, 0);
      const anchorDay1 = new Date(anchorNow);
      anchorDay1.setDate(anchorDay1.getDate() - (_anchorStoryDay - 1));
      const realAnchorDay1 = `${anchorDay1.getFullYear()}-${p2(anchorDay1.getMonth()+1)}-${p2(anchorDay1.getDate())}`;
      await dbPut('config', { id: `schedule_anchor_${chatId}`, realAnchorDay1, updatedAt: Date.now() });
      console.log(`%c[ScheduleUpdater] 日程锚点已保存 realAnchorDay1=${realAnchorDay1} (剧情第${_anchorStoryDay}天→真实今日)`, 'color:#72c9a0');
    } catch (e) {
      console.warn('[ScheduleUpdater] 保存日程锚点失败:', e);
    }

    console.log('%c[ScheduleUpdater] 写入完成', 'color:#72c9a0;font-weight:bold', stats);
    return stats;
  }

  /**
   * 根据 targetRef / date(or storyDay) / targetType 匹配目标条目 id
   * getItemDate: (item) => "YYYY-MM-DD" | null  (两种模式共用)
   */
  function resolveTargetIdByDate(item, evIdMap, allEvs, chatId, getItemDate) {
    const ref  = (item.targetRef  || '').toLowerCase();
    const type = item.targetType  || '';
    const d    = getItemDate(item); // 真实日期字符串

    // 先在本次写入的条目里找
    if (d) {
      const inNew = evIdMap.find(m =>
        m.date === d &&
        (!type || m.type === type) &&
        m.titleKey.toLowerCase().includes(ref)
      );
      if (inNew) return inNew.id;
    }

    // 再从历史条目里找（模糊匹配 title / note）
    const match = allEvs.find(e =>
      e.chatId === chatId &&
      (!d || e.date === d) &&
      (!type || e.type === type) &&
      ((e.title || e.note || '').toLowerCase().includes(ref))
    );
    return match ? match.id : null;
  }

  /* ══════════════════════════════════════════════════════════
     8. 主入口：全局日程更新
  ══════════════════════════════════════════════════════════ */

  /**
   * 执行一次完整的日程更新流程
   * @param {string}   chatId
   * @param {object}   ctx      { userName, charName, charId, userId }
   * @param {function} onLog    日志回调 (message, type) type: 'info'|'success'|'error'|'stat'
   * @returns {Promise<{stats, storyTimeAfter, commentary}>}
   */
  async function runScheduleUpdate(chatId, ctx, onLog) {
    const log = (msg, type = 'info') => {
      console.log(`[ScheduleUpdater] ${msg}`);
      if (onLog) onLog(msg, type);
    };

    try {
      log('📡 正在连接 API...', 'info');
      const { rawText, timestampEnabled, realToday } = await callScheduleApi(chatId, ctx, null);

      log('🔍 解析 AI 返回内容...', 'info');
      const { storyTimeAfter, schedule, rawText: raw } = parseScheduleResponse(rawText);

      if (!schedule) {
        log('⚠️ AI 未返回有效 JSON，请检查回复格式', 'error');
        log('AI原始回复：' + raw.substring(0, 200), 'error');
        return { error: 'parse_failed', rawText: raw };
      }

      log('💾 写入日程数据...', 'info');
      const clock = await loadStoryClock(chatId);
      const stats = await writeScheduleToDb(schedule, chatId, ctx, clock, timestampEnabled, realToday);

      // 剧情模式才推进时钟；时间感知模式不动时钟
      if (!timestampEnabled && storyTimeAfter && clock) {
        const newMs = storyTimeStrToMs(storyTimeAfter);
        if (newMs !== null) {
          clock.lastSyncStoryMs = newMs;
          clock.lastSyncRealMs = Date.now();
          await saveStoryClock(clock, chatId);
          log(`⏰ 剧情时间已推进 → ${storyTimeAfter}`, 'success');
        }
      }

      // 提取 AI 的吐槽/说明（JSON 块之前的文字）
      let commentary = '';
      const jsonIdx = rawText.indexOf('```json');
      if (jsonIdx > 0) {
        commentary = rawText.substring(0, jsonIdx)
          .replace(/<story_time>.*?<\/story_time>/g, '')
          .trim();
      }

      log(`✅ 完成！时间轴 +${stats.events} · 待办 +${stats.todos} · 备忘 +${stats.memos} · 心情 +${stats.annotations}`, 'success');

      return { stats, storyTimeAfter, commentary, schedule };
    } catch (e) {
      log(`❌ 错误：${e.message}`, 'error');
      throw e;
    }
  }

  /* ══════════════════════════════════════════════════════════
     9. 清空日程
  ══════════════════════════════════════════════════════════ */

  async function clearAllSchedule(chatId) {
    const db = await openDb();
    const all = await dbGetAll('cal_events');
    const toDelete = all.filter(e => e.chatId === chatId);
    for (const ev of toDelete) {
      await new Promise(r => {
        const tx = db.transaction('cal_events', 'readwrite');
        tx.objectStore('cal_events').delete(ev.id);
        tx.oncomplete = r; tx.onerror = r;
      });
    }
    console.log(`[ScheduleUpdater] 清空 ${toDelete.length} 条日程，chatId=${chatId}`);
    return toDelete.length;
  }

  /* ══════════════════════════════════════════════════════════
     10. 向外暴露
  ══════════════════════════════════════════════════════════ */

  window.ScheduleUpdater = {
    // 时钟操作
    loadStoryClock,
    saveStoryClock,
    initStoryClock,
    setStoryTime,
    calcCurrentStoryMs,
    msToStoryTime,
    msToStoryTimeStr,
    storyTimeStrToMs,
    storyDayToRealDate,
    p2,
    // 日程锚点（两模式对齐用）
    loadScheduleAnchor,
    // API 相关
    runScheduleUpdate,
    clearAllSchedule,
    loadApiConfig,
    // TsukiSend 聊天内联日程写入（供 extractAndApplyScheduleFromAiReply 调用）
    writeScheduleToDb,
    parseScheduleResponse,
  };

  /**
   * 供 TsukiSend/线上聊天注入剧情时钟到提示词头部
   * 在 callApi 的 systemPrompt 拼接之前调用
   * @param {string} [chatId]
   * @returns {Promise<string>} 要追加到 system 头部的字符串（可能为空）
   */
  window.ScheduleUpdater.getStoryClockInject = async function (chatId) {
    try {
      const clock = await loadStoryClock(chatId);
      if (!clock) return '';
      const currentMs = calcCurrentStoryMs(clock);
      const str = msToStoryTimeStr(currentMs);
      return `[剧情时钟] 当前剧情时间：${str}\n请在你回复的所有[角色名|type]行之前，先单独输出一行：\n<story_time>第X天 HH:MM</story_time>\n填写你认为这段对话结束后剧情时间推进到哪里。\n【时间推进原则】不要拘谨，允许合理跳跃：\n· 简短互动几句 → 推进 5~15 分钟\n· 一段完整对话 → 推进 15~60 分钟\n· 情节明确跨越（睡觉/出门/过了一会儿/第二天等） → 直接跳到对应时间\n· 禁止每次只推进 1~2 分钟，那会让时间感失真\n\n`;
    } catch { return ''; }
  };

  /**
   * 供 TsukiSend 在 AI 回复后调用，解析并更新剧情时钟
   * @param {string} rawAiText
   * @param {string} [chatId]
   * @returns {Promise<string>} 去掉 story_time 标签后的干净文本
   */
  window.ScheduleUpdater.processStoryTimeTag = async function (rawAiText, chatId) {
    try {
      const m = rawAiText.match(/<story_time>(.*?)<\/story_time>/);
      if (!m) return rawAiText;

      const storyTimeAfter = m[1].trim();
      const clock = await loadStoryClock(chatId);
      if (clock) {
        const newMs = storyTimeStrToMs(storyTimeAfter);
        if (newMs !== null) {
          clock.lastSyncStoryMs = newMs;
          clock.lastSyncRealMs = Date.now();
          await saveStoryClock(clock, chatId);
          console.log(`[StoryClock] 自动更新 → ${storyTimeAfter}`, chatId || '(global)');
          // 触发日历面板刷新（如果开着的话）
          if (typeof window.refreshStoryClockDisplay === 'function') {
            window.refreshStoryClockDisplay();
          }
        }
      }

      // 去掉标签，返回干净文本
      return rawAiText.replace(/<story_time>.*?<\/story_time>\n?/, '').trim();
    } catch { return rawAiText; }
  };

  /**
   * 供 TsukiSend & tsukiphone 存库时附加剧情时间戳
   * @param {string} [chatId]
   * @returns {Promise<number|null>}
   */
  window._getStoryTimestampNow = async function (chatId) {
    try {
      const clock = await loadStoryClock(chatId);
      if (!clock || !clock.baseRealDate) return null;
      const baseTs = new Date(clock.baseRealDate + 'T00:00:00').getTime();
      return baseTs + calcCurrentStoryMs(clock);
    } catch { return null; }
  };

  /**
   * 页面加载时重置 lastSyncRealMs = Date.now()
   * 防止离线期间的真实时间差在下次打开页面时一次性累计进剧情时钟。
   * 在线时（用户在页面上）时钟仍然正常流走；关页面就暂停。
   */
  (async function resetClockSyncOnLoad() {
    try {
      const db = await openDb();
      const allConfig = await new Promise(res => {
        try {
          const tx = db.transaction('config', 'readonly');
          const req = tx.objectStore('config').getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        } catch { res([]); }
      });
      const clocks = allConfig.filter(c => c.id && c.id.startsWith('story_clock'));
      const now = Date.now();
      for (const clock of clocks) {
        if (clock.baseRealDate != null && clock.lastSyncRealMs != null) {
          clock.lastSyncRealMs = now;
          await dbPut('config', clock);
        }
      }
      if (clocks.length > 0) {
        console.log(`%c[StoryClock] 页面加载：重置 lastSyncRealMs，共 ${clocks.length} 个时钟`, 'color:#72c9a0');
      }
    } catch (e) {
      console.warn('[StoryClock] 页面加载重置失败:', e);
    }
  })();

  console.log('%c[ScheduleUpdater] ✅ 已加载', 'color:#72c9a0;font-weight:bold');
})();
