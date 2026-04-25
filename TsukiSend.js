/**
 * TsukiSend.js  v1.2
 * 发送按钮上划触发 · API调用 · 消息解析与渲染 · 存库
 * ─────────────────────────────────────────────────────
 * 修复记录 v1.1：
 *  ① 上划发送时用户消息同步存库 & 渲染
 *  ② 输入框为空时改发占位符给 API，避免 500 空 content 报错
 *  ③ 新增 recalled / blocked 两种消息格式的解析与渲染
 *
 * 新增 v1.2：
 *  ④ 新增 buildScheduleInject(chatId) — 根据 scheduleEnabled 开关，
 *     将当前剧情时间前1天+后6天共8天的日程注入 system 提示词
 *     时间感知 ON：用真实日期格式 "MM-DD HH:MM"
 *     时间感知 OFF：用剧情格式 "DX-时分"（如 D3-09:30）
 *  ⑤ 新增 extractAndApplyScheduleFromAiReply(rawText, chatId) —
 *     从 AI 原始回复中提取 ```json 日程块，自动写入 DB
 *     并在控制台打印写入摘要
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
   - 特别提示：你可以通过这种方式发送表情包。如果在对话历史中看到用户发送了 [表情包] 某某猫咪，你可以直接回复 [角色名|sticker] 某某猫咪 来"偷取"并发送同一个表情包跟用户斗图！如果你有确切的图片URL，也可以用 名称|URL 的格式发送。
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

14. STATUS UPDATE — 更改角色状态。
    - ⚠️ <status> 标签必须单独占一行，绝对不能跟在任何 [角色名|type] 标签后面。
    - 它出现的位置：<story_time>（如有）之后，所有 [角色名|type] 消息行之前。
    - 格式：<status=#色号|· 状态内容>  色号必须是 HEX（如 #ff6b6b），状态内容建议10字以内，开头必须有 ·
    - ✅ 正确示例：
        <story_time>第1天 08:00</story_time>
        <status=#ff6b6b|· 别来烦我>
        [祁京野|text] 谁啊。
    - ❌ 错误示例（绝对禁止）：
        [祁京野|text] <status=#ff6b6b|· 别来烦我> 谁啊。

Rules:
- ALWAYS start every message with the [角色名|格式类别] tag.
- Never include manual timestamps (e.g., "09:32").
- QUOTING: Use the <quote=Name|[Prefix] Content> syntax when you want to reply specifically to a previous statement.
- QUOTE PREFIXES: If quoting a non-text message, you MUST include the prefix inside the quote block: [语音], [图片], [文件], [转账], [礼物]. If quoting plain text, DO NOT use a prefix.
- The quoted content should be a short summary or a snippet of the message you are replying to.
- transfer content: "金额|备注"  gift content: "礼物名|备注"
- recalled/blocked: Use these for realistic character interactions.
- STORY TIME: If the system prompt contains a [剧情时钟] block, you MUST output <story_time>第X天 HH:MM</story_time> as the very first line of your entire response — before <status>, before any [name|type] lines.
- STATUS UPDATE: <status=#HEX|· Text> MUST be on its own line. NEVER attach it to a [name|type] line. Order is strictly: <story_time> → <status> → [name|type] messages. Writing [name|type] before or alongside <status> is a critical formatting error.
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
     2b. DB 辅助（复用 ScheduleUpdater 的同名函数，但 ScheduleUpdater 是 IIFE 无法直接调用）
  ═══════════════════════════════════════════════════════════ */

  async function _dbGet(store, key) {
    const db = await (typeof openDb === 'function' ? openDb() : initTsukiDB());
    return new Promise(res => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      } catch { res(null); }
    });
  }

  async function _dbGetAll(store) {
    const db = await (typeof openDb === 'function' ? openDb() : initTsukiDB());
    return new Promise(res => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      } catch { res([]); }
    });
  }

  function _p2(n) { return String(n).padStart(2, '0'); }

  /* ═══════════════════════════════════════════════════════════
     2c. ★ 日程注入提示词构建
     buildScheduleInject(chatId) → string
     ─────────────────────────────────────────────────────────
     读取当前聊天的 scheduleEnabled 开关。开启时：
       · 以当前剧情时间为"今天"，取前1天 + 后6天（共8天）的已有日程
       · 时间感知 ON  → 每条时间显示真实日历 "MM-DD HH:MM"
       · 时间感知 OFF → 每条时间显示剧情格式 "DX-HH:MM"（X=剧情天数）
       · 还会透出 comments（吐槽）和 edits（修改记录）
     关闭时返回空字符串。
  ═══════════════════════════════════════════════════════════ */

  async function buildScheduleInject(chatId) {
    try {
      // ── 1. 读开关 ──────────────────────────────────────────────────
      const settings = (await _dbGet('config', `chat_settings_${chatId}`)) || {};
      const scheduleEnabled = settings.scheduleEnabled !== false; // 默认 true
      if (!scheduleEnabled) return '';

      // ── 2. 读时间感知开关 ──────────────────────────────────────────
      const timestampEnabled = settings.timestampEnabled !== false; // 默认 true

      // ── 3. 确定"今天"对应的真实日历日期 ───────────────────────────
      //   时间感知 ON：真实今日
      //   时间感知 OFF：以剧情时钟当前天对应的真实日历日期作锚点
      const SU = window.ScheduleUpdater;
      let todayRealDate = null; // "YYYY-MM-DD"
      let todayStoryDay = null; // 剧情第几天（仅 OFF 模式用到）

      const nowObj = new Date();
      nowObj.setHours(0, 0, 0, 0);
      const realTodayStr = `${nowObj.getFullYear()}-${_p2(nowObj.getMonth()+1)}-${_p2(nowObj.getDate())}`;

      if (timestampEnabled) {
        // 时间感知 ON：直接用真实今日
        todayRealDate = realTodayStr;
      } else {
        // 时间感知 OFF：从剧情时钟推算
        if (SU && typeof SU.loadStoryClock === 'function') {
          const clock = await SU.loadStoryClock(chatId);
          if (clock) {
            const currentMs = SU.calcCurrentStoryMs(clock);
            const { day } = SU.msToStoryTime(currentMs);
            todayStoryDay = day;
            // 真实今日 = 剧情当天的真实锚点（与 writeScheduleToDb 对齐）
            todayRealDate = realTodayStr;
          }
        }
        if (!todayRealDate) todayRealDate = realTodayStr;
      }

      // ── 4. 计算日期窗口 [-1, +6]（共8天） ─────────────────────────
      const windowDates = []; // ["YYYY-MM-DD", ...]
      const anchor = new Date(todayRealDate + 'T00:00:00');
      for (let i = -1; i <= 6; i++) {
        const d = new Date(anchor);
        d.setDate(d.getDate() + i);
        windowDates.push(`${d.getFullYear()}-${_p2(d.getMonth()+1)}-${_p2(d.getDate())}`);
      }

      // ── 5. 读取所有日程 ────────────────────────────────────────────
      const allEvs = await _dbGetAll('cal_events');
      const allComments = await _dbGetAll('cal_comments');
      const allEdits = await _dbGetAll('cal_edits');

      const chatEvs = allEvs.filter(e => e.chatId === chatId && windowDates.includes(e.date));
      if (chatEvs.length === 0) return '';

      // ── 6. 辅助：真实日期 → 显示时间前缀 ─────────────────────────
      //   时间感知 ON  → "04-05"（月-日）
      //   时间感知 OFF → "D3"（剧情第X天）
      function dateToLabel(realDateStr) {
        if (timestampEnabled) {
          // "YYYY-MM-DD" → "MM-DD"
          return realDateStr.slice(5);
        } else {
          // 根据与锚点的差值算剧情天数
          const base = new Date(todayRealDate + 'T00:00:00');
          const target = new Date(realDateStr + 'T00:00:00');
          const diffDays = Math.round((target - base) / 86400000);
          const storyDay = (todayStoryDay || 1) + diffDays;
          return `D${storyDay}`;
        }
      }

      // ── 7. 构建日期分组 ────────────────────────────────────────────
      const grouped = {};
      windowDates.forEach(d => { grouped[d] = []; });
      chatEvs.forEach(ev => {
        if (grouped[ev.date]) grouped[ev.date].push(ev);
      });

      // ── 8. 构建每条条目的文本，附带 comments/edits ─────────────────
      function formatItem(ev) {
        const label = dateToLabel(ev.date);
        const whoTag = ev.charGen
          ? `[${ev.charName || 'char'}]`
          : `[${ev.userName || 'user'}]`;

        let timeStr = '';
        if (ev.type === 'event' && ev.hour != null) {
          // 时间感知 ON：日期+时分  OFF：D天-时分
          timeStr = timestampEnabled
            ? ` ${label} ${_p2(ev.hour)}:${_p2(ev.minute || 0)}`
            : ` ${label}-${_p2(ev.hour)}:${_p2(ev.minute || 0)}`;
        } else {
          timeStr = ` ${label}`;
        }

        let typeIcon = '';
        if (ev.type === 'event')      typeIcon = '⏰';
        if (ev.type === 'todo')       typeIcon = ev.done ? '✅' : '☐';
        if (ev.type === 'memo')       typeIcon = '📝';
        if (ev.type === 'annotation') typeIcon = ev.symbol || '囍';

        const mainContent = ev.type === 'annotation'
          ? (ev.note || '')
          : (ev.title || '');

        let line = `  ${typeIcon}${timeStr} ${whoTag} ${mainContent}`;

        // 通用：把 createdAt + timeMode 转成可读时间字符串
        function _fmtBubbleTime(createdAt, timeMode) {
          // 兜底：没有 timeMode 的老数据按当前 timestampEnabled 判断
          const mode = timeMode || (timestampEnabled ? 'real' : 'story');
          if (mode === 'real') {
            // createdAt 是真实时间戳 ms
            const d = new Date(createdAt);
            return `${_p2(d.getMonth()+1)}-${_p2(d.getDate())} ${_p2(d.getHours())}:${_p2(d.getMinutes())}`;
          } else {
            // createdAt 是剧情毫秒偏移（从第1天00:00起）
            const totalSec = Math.floor(createdAt / 1000);
            const day  = Math.floor(totalSec / 86400) + 1;
            const hour = Math.floor((totalSec % 86400) / 3600);
            const min  = Math.floor((totalSec % 3600) / 60);
            return `D${day}-${_p2(hour)}:${_p2(min)}`;
          }
        }

        // 附加吐槽（comments）
        const itemComments = allComments.filter(c => c.chatId === chatId && c.targetId === ev.id);
        itemComments.forEach(c => {
          const ts = c.createdAt != null ? ` · ${_fmtBubbleTime(c.createdAt, c.timeMode)}` : '';
          line += `\n    💬 [${c.authorName}吐槽${ts}] ${c.content}`;
        });

        // 附加修改记录（edits）
        const itemEdits = allEdits.filter(ed => ed.chatId === chatId && ed.targetId === ev.id);
        itemEdits.forEach(ed => {
          const ts = ed.createdAt != null ? ` · ${_fmtBubbleTime(ed.createdAt, ed.timeMode)}` : '';
          line += `\n    ✏️ [${ed.editorName}修改了${ed.field}${ts}] ${ed.oldValue} → ${ed.newValue}`;
        });

        return line;
      }

      // ── 9. 拼装最终注入文本 ───────────────────────────────────────
      const lines = [];
      windowDates.forEach(dateStr => {
        const evs = grouped[dateStr];
        if (!evs || evs.length === 0) return;

        const label = dateToLabel(dateStr);
        const isToday = dateStr === todayRealDate;
        const isPast  = dateStr < todayRealDate;
        const mark = isPast ? '（昨天）' : isToday ? '（今天）' : '';

        const header = timestampEnabled
          ? `【${dateStr}${mark}】`
          : `【${label}${mark}】`;

        lines.push(header);
        evs.forEach(ev => lines.push(formatItem(ev)));
      });

      if (lines.length === 0) return '';

      const inject = `[角色日程安排（前1天~后6天，共8天）]\n` +
        `时间格式：${timestampEnabled ? '真实日期 MM-DD / MM-DD HH:MM' : '剧情天数 DX / DX-HH:MM'}\n` +
        lines.join('\n') + '\n' +
        `[/角色日程安排]\n\n`;

      console.group('%c📅 [TsukiSend] 日程注入内容', 'color:#f9c784;font-weight:bold');
      console.log(inject);
      console.groupEnd();

      return inject;

    } catch (e) {
      console.warn('[TsukiSend] buildScheduleInject 出错，跳过日程注入:', e);
      return '';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     2d. ★ 从 AI 回复中提取日程 JSON 并写入 DB
     extractAndApplyScheduleFromAiReply(rawText, chatId)
     ─────────────────────────────────────────────────────────
     · 在原始文本中寻找 ```json ... ``` 块
     · 检查是否包含 events / todos / memos / annotations 字段（日程特征）
     · 调用 ScheduleUpdater.writeScheduleToDb 写入
     · 控制台打印写入摘要
     · 返回去掉该 JSON 块后的干净文本（不影响消息解析）
       注意：若 JSON 块不含日程特征字段则原样保留，不做处理
  ═══════════════════════════════════════════════════════════ */

  async function extractAndApplyScheduleFromAiReply(rawText, chatId) {
    // ── 通用：先把所有 ```json...``` 块（及其后同行垃圾字符）的位置记下来
    // ── 不管能不能写库，都必须从文本里抹掉，避免渲染成气泡
    const jsonBlockRe = /```json\s*([\s\S]*?)```[^\n]*/g;
    let match;
    let scheduleJson = null;
    let matchStart = -1;
    let matchEnd   = -1;

    while ((match = jsonBlockRe.exec(rawText)) !== null) {
      let parsed;
      try { parsed = JSON.parse(match[1].trim()); }
      catch { continue; }

      const isScheduleBlock =
        Array.isArray(parsed.events)      ||
        Array.isArray(parsed.todos)       ||
        Array.isArray(parsed.memos)       ||
        Array.isArray(parsed.annotations) ||
        Array.isArray(parsed.comments)    ||
        Array.isArray(parsed.edits);

      if (isScheduleBlock) {
        scheduleJson = parsed;
        matchStart   = match.index;
        matchEnd     = match.index + match[0].length;
        break;
      }
    }

    // 抹除 JSON 块，得到干净文本（不管后面写不写库都要抹）
    const cleanText = matchStart >= 0
      ? (rawText.slice(0, matchStart) + rawText.slice(matchEnd)).trim()
      : rawText.replace(/```json[\s\S]*?```[^\n]*/g, '').trim();

    if (!scheduleJson) {
      if (matchStart >= 0) {
        console.log('[TsukiSend] AI 返回了 ```json 块但无法识别为日程格式，已抹除');
      }
      return cleanText;
    }

    // ── 写库 ──────────────────────────────────────────────────────────
    try {
      const SU = window.ScheduleUpdater;

      // ── 读时间感知开关 & 时钟 ─────────────────────────────────────
      const settings = (await _dbGet('config', `chat_settings_${chatId}`)) || {};
      const timestampEnabled = settings.timestampEnabled !== false;
      const clock = (SU && typeof SU.loadStoryClock === 'function')
        ? await SU.loadStoryClock(chatId)
        : null;
      const nowObj   = new Date();
      const realToday = `${nowObj.getFullYear()}-${_p2(nowObj.getMonth()+1)}-${_p2(nowObj.getDate())}`;

      // ── 读 ctx ────────────────────────────────────────────────────
      const charName = window.currentChatChar?.name || 'char';
      let userName = 'user';
      try {
        const db = await (typeof openDb === 'function' ? openDb() : initTsukiDB());
        const chat = await new Promise(res => {
          const tx = db.transaction('chats', 'readonly');
          const req = tx.objectStore('chats').get(chatId);
          req.onsuccess = () => res(req.result);
          req.onerror   = () => res(null);
        });
        if (chat?.userId) {
          const userRec = await _dbGet('users', chat.userId);
          if (userRec?.name) userName = userRec.name;
        }
      } catch { /* 静默降级 */ }
      const ctx = { charName, userName };

      // ── 优先走 ScheduleUpdater.writeScheduleToDb ─────────────────
      if (SU && typeof SU.writeScheduleToDb === 'function') {
        const stats = await SU.writeScheduleToDb(
          scheduleJson, chatId, ctx, clock, timestampEnabled, realToday
        );
        _logScheduleStats(stats, scheduleJson, timestampEnabled);
      } else {
        // ── 降级：内联写库（与 ScheduleUpdater.writeScheduleToDb 逻辑对齐）──
        console.warn('[TsukiSend] ScheduleUpdater.writeScheduleToDb 未暴露，使用内联写库');
        const stats = await _inlineWriteSchedule(
          scheduleJson, chatId, ctx, clock, timestampEnabled, realToday
        );
        _logScheduleStats(stats, scheduleJson, timestampEnabled);
      }

      // 触发日历刷新
      if (typeof window.refreshCalendarView  === 'function') window.refreshCalendarView();
      if (typeof window.refreshStoryClockDisplay === 'function') window.refreshStoryClockDisplay();

    } catch (e) {
      console.warn('[TsukiSend] extractAndApplyScheduleFromAiReply 写库出错:', e);
    }

    return cleanText;
  }

/* ─── 写库日志打印 ─────────────────────────────────────────────── */
function _logScheduleStats(stats, scheduleJson, timestampEnabled) {
  // ── 原有控制台打印（保留）──────────────────────────────────────
  console.group('%c📅 [TsukiSend] AI 日程写入完成', 'color:#72c9a0;font-weight:bold');
  console.log(`模式：${timestampEnabled ? '时间感知（真实日期）' : '剧情时钟'}`);
  if (stats.events)      console.log(`⏰ 时间轴事件  +${stats.events}`);
  if (stats.todos)       console.log(`☐  待办        +${stats.todos}`);
  if (stats.memos)       console.log(`📝 备忘        +${stats.memos}`);
  if (stats.annotations) console.log(`💬 心情批注    +${stats.annotations}`);
  if (stats.comments)    console.log(`💬 吐槽        +${stats.comments}`);
  if (stats.edits)       console.log(`✏️  修改        +${stats.edits}`);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  console.log(`合计写入 ${total} 条`);
  console.log('原始 JSON：', scheduleJson);
  console.groupEnd();

  // ── 新增：顶栏头像下方气泡提示 ───────────────────────────────
  _showScheduleBubble(stats, timestampEnabled);
}

/* ─── 日程写入气泡（顶栏大头像正下方，7s后消失）────────────────── */
function _showScheduleBubble(stats, timestampEnabled) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total === 0) return;

  // ── 注入样式（只注入一次）──────────────────────────────────────
  if (!document.getElementById('tsuki-sched-bubble-style')) {
    const s = document.createElement('style');
    s.id = 'tsuki-sched-bubble-style';
    s.textContent = `
      @keyframes tskSchedIn  { from{opacity:0;transform:translateY(-4px) scale(.97)} to{opacity:1;transform:translateY(0) scale(1)} }
      @keyframes tskSchedOut { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(-3px) scale(.96)} }
      #tsuki-sched-pop {
        position: fixed;
        z-index: 99990;
        animation: tskSchedIn .28s cubic-bezier(.22,1,.36,1) both;
        filter: drop-shadow(0 3px 10px rgba(10,10,10,.13));
      }
      #tsuki-sched-pop.out { animation: tskSchedOut .22s ease-in both; }
      /* 外层：虚线双边框容器 */
      .tsk-s-outer {
        position: relative;
        padding: 2px;
        border-radius: 11px 11px 11px 3px;
        background: linear-gradient(135deg,rgba(212,255,77,.22),rgba(67,217,160,.15),rgba(91,124,250,.15));
        outline: 1.5px dashed rgba(212,255,77,.5);
        outline-offset: 2px;
      }
      /* 内层气泡 */
      .tsk-s-inner {
        position: relative;
        background: #fff;
        border-radius: 10px 10px 10px 2px;
        border: 1px solid rgba(10,10,10,.07);
        padding: 7px 10px 6px 9px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      /* 左侧彩条 */
      .tsk-s-inner::before {
        content:'';
        position:absolute;
        top:7px; left:-1px;
        width:2.5px; height:22px;
        border-radius:0 2px 2px 0;
        background:linear-gradient(180deg,#d4ff4d,#43d9a0);
        opacity:.75;
      }
      .tsk-s-head {
        font-family:'Geist Mono',monospace;
        font-size:8.5px;
        font-weight:700;
        letter-spacing:.07em;
        color:#4a4a4d;
        display:flex;
        align-items:center;
        gap:4px;
        padding-left:6px;
        margin-bottom:1px;
      }
      .tsk-s-head i { font-size:8px; color:#72c9a0; }
      .tsk-s-row {
        font-family:'Geist',sans-serif;
        font-size:10.5px;
        line-height:1.4;
        display:flex;
        align-items:center;
        gap:6px;
        padding-left:6px;
        white-space:nowrap;
      }
      .tsk-s-row i { font-size:9px; width:11px; text-align:center; flex-shrink:0; }
      .tsk-s-lbl  { color:#4a4a4d; }
      .tsk-s-num  { font-family:'Geist Mono',monospace; font-size:9.5px; font-weight:700; letter-spacing:.03em; }
      .tsk-s-div  { height:1px; background:linear-gradient(90deg,rgba(10,10,10,.07),transparent); margin:1px 6px; }
      .tsk-s-foot {
        font-family:'Geist Mono',monospace;
        font-size:9px;
        color:#8a8a8e;
        padding-left:6px;
        display:flex;
        align-items:center;
        gap:4px;
      }
      .tsk-s-foot i { font-size:8px; color:#5b7cfa; }
      .tsk-s-foot b { color:#1f1f20; font-weight:600; }
      .tsk-s-mode {
        display:inline-flex; align-items:center; gap:2px;
        font-family:'Geist Mono',monospace; font-size:7.5px;
        padding:1px 5px; border-radius:100px;
        background:rgba(212,255,77,.16);
        color:#596018;
        border:1px solid rgba(212,255,77,.38);
        margin-left:3px;
      }
    `;
    document.head.appendChild(s);
  }

  // ── 定位：找顶栏大头像 ──────────────────────────────────────────
  const avatarEl = document.querySelector('.char-avatar');
  if (!avatarEl) return;
  const rect = avatarEl.getBoundingClientRect();

  // ── 构建行 HTML ────────────────────────────────────────────────
  const ROWS = [
    { key:'events',      icon:'fa-solid fa-clock',           color:'#ff9f43', lbl:'时间轴事件' },
    { key:'todos',       icon:'fa-regular fa-square-check',  color:'#5b7cfa', lbl:'待办事项'   },
    { key:'memos',       icon:'fa-solid fa-pen-nib',         color:'#fa5bd5', lbl:'备忘录'     },
    { key:'annotations', icon:'fa-solid fa-heart',           color:'#ff6b6b', lbl:'心情批注'   },
    { key:'comments',    icon:'fa-regular fa-comment-dots',  color:'#43d9a0', lbl:'吐槽'       },
    { key:'edits',       icon:'fa-solid fa-pen-to-square',   color:'#8b7cf6', lbl:'修改记录'   },
  ];
  const activeRows = ROWS.filter(r => stats[r.key] > 0);

  const rowsHtml = activeRows.map(r =>
    `<div class="tsk-s-row">
       <i class="${r.icon}" style="color:${r.color}"></i>
       <span class="tsk-s-lbl">${r.lbl}</span>
       <span class="tsk-s-num" style="color:${r.color}">+${stats[r.key]}</span>
     </div>`
  ).join('');

  const modeIcon = timestampEnabled ? 'fa-calendar-days' : 'fa-book-open';
  const modeText = timestampEnabled ? '真实日期' : '剧情时钟';

  // ── 组装气泡 ───────────────────────────────────────────────────
  const pop = document.createElement('div');
  pop.id = 'tsuki-sched-pop';
  pop.innerHTML = `
    <div class="tsk-s-outer">
      <div class="tsk-s-inner">
        <div class="tsk-s-head">
          <i class="fa-solid fa-bolt-lightning"></i>日程已写入
          <span class="tsk-s-mode"><i class="fa-solid ${modeIcon}"></i>${modeText}</span>
        </div>
        <div class="tsk-s-div"></div>
        ${rowsHtml}
        <div class="tsk-s-div"></div>
        <div class="tsk-s-foot">
          <i class="fa-solid fa-layer-group"></i>合计 <b>${total}</b> 条
        </div>
      </div>
    </div>`;

  document.body.appendChild(pop);

  // ── 定位到头像正下方（左对齐头像左侧）─────────────────────────
  // 先 append 再量尺寸，避免宽高为0
  const popW = pop.offsetWidth;
  const margin = 6; // 距头像底部间距
  pop.style.top  = (rect.bottom + margin) + 'px';
  pop.style.left = rect.left + 'px';

// ── 点击气泡淡出移除 ──────────────────────────────────────────
  pop.style.cursor = 'pointer';
  pop.addEventListener('click', () => {
    pop.classList.add('out');
    pop.addEventListener('animationend', () => pop.remove(), { once: true });
  }, { once: true });
}

  /* ─── 内联写库（降级兜底，逻辑与 ScheduleUpdater.writeScheduleToDb 对齐）─── */
  async function _inlineWriteSchedule(schedule, chatId, ctx, clock, realDateMode, realToday) {
    const stats = { events: 0, todos: 0, memos: 0, annotations: 0, comments: 0, edits: 0 };
    if (!schedule) return stats;

    const SU = window.ScheduleUpdater;
    const p2 = (SU && SU.p2) ? SU.p2 : (n => String(n).padStart(2, '0'));

    // ── 确定"今天"真实日期字符串 & getItemDate 转换函数 ────────────
    let todayStr, getItemDate;
    const nowObj = new Date(); nowObj.setHours(0, 0, 0, 0);
    const realTodayStr = realToday || `${nowObj.getFullYear()}-${p2(nowObj.getMonth()+1)}-${p2(nowObj.getDate())}`;

    if (realDateMode) {
      todayStr    = realTodayStr;
      getItemDate = item => item.date || null;
    } else {
      if (!clock) return stats;
      const calcMs = SU ? SU.calcCurrentStoryMs(clock) : (clock.lastSyncStoryMs + (Date.now() - clock.lastSyncRealMs));
      const msToDay = ms => Math.floor(ms / 1000 / 86400) + 1;
      const todayStoryDay = msToDay(calcMs);
      todayStr    = realTodayStr;
      getItemDate = item => {
        if (item.storyDay == null) return null;
        const d = new Date(nowObj);
        d.setDate(d.getDate() + item.storyDay - todayStoryDay);
        return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
      };
    }

    // ── 收集要覆写的日期 ──────────────────────────────────────────
    const coreItems = [
      ...(schedule.events      || []).map(e => ({ ...e, _type: 'event' })),
      ...(schedule.todos       || []).map(e => ({ ...e, _type: 'todo' })),
      ...(schedule.memos       || []).map(e => ({ ...e, _type: 'memo' })),
      ...(schedule.annotations || []).map(e => ({ ...e, _type: 'annotation' })),
    ];
    const overwriteDates = new Set();
    coreItems.forEach(item => {
      const d = getItemDate(item);
      if (d && d >= todayStr) overwriteDates.add(d);
    });

    const db   = await (typeof openDb === 'function' ? openDb() : initTsukiDB());
    const allEvs = await _dbGetAll('cal_events');

    // ── 删除这些日期的 charGen 旧条目 ────────────────────────────
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

    // ── 写入新日程条目 ─────────────────────────────────────────
    const now = Date.now();
    const evIdMap = [];

    async function _dbPutItem(obj) {
      return new Promise((res, rej) => {
        try {
          const tx = db.transaction('cal_events', 'readwrite');
          const req = tx.objectStore('cal_events').put(obj);
          req.onsuccess = () => res();
          req.onerror   = () => rej(req.error);
        } catch(e) { rej(e); }
      });
    }

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
      await _dbPutItem(obj);
      evIdMap.push({ date: realDate, type: item._type, titleKey: (obj.title || obj.note || '').substring(0, 20), id });
    }

    // ── 计算写入时的时间戳（对齐 calendar.html 手动添加逻辑）──────
    //   realDateMode=true  → timeMode:'real',  createdAt=Date.now()
    //   realDateMode=false → timeMode:'story', createdAt=剧情毫秒偏移
    const _storyNowMs = (!realDateMode && clock)
      ? Math.max(0, (clock.lastSyncStoryMs || 0) + (Date.now() - (clock.lastSyncRealMs || Date.now())))
      : null;
    const _commentCreatedAt = _storyNowMs !== null ? _storyNowMs : Date.now();
    const _timeMode = realDateMode ? 'real' : 'story';

    // ── 写入吐槽 comments ──────────────────────────────────────
    async function _dbPutComment(obj) {
      return new Promise((res, rej) => {
        try {
          const tx = db.transaction('cal_comments', 'readwrite');
          const req = tx.objectStore('cal_comments').put(obj);
          req.onsuccess = () => res();
          req.onerror   = () => rej(req.error);
        } catch(e) { rej(e); }
      });
    }
    async function _dbPutEdit(obj) {
      return new Promise((res, rej) => {
        try {
          const tx = db.transaction('cal_edits', 'readwrite');
          const req = tx.objectStore('cal_edits').put(obj);
          req.onsuccess = () => res();
          req.onerror   = () => rej(req.error);
        } catch(e) { rej(e); }
      });
    }

    // 模糊匹配 targetId
    function resolveId(item) {
      const ref  = (item.targetRef || '').toLowerCase();
      const type = item.targetType || '';
      const d    = getItemDate(item);
      const inNew = evIdMap.find(m =>
        (!d || m.date === d) && (!type || m.type === type) && m.titleKey.toLowerCase().includes(ref)
      );
      if (inNew) return inNew.id;
      const all = allEvs.find(e =>
        e.chatId === chatId && (!d || e.date === d) && (!type || e.type === type) &&
        ((e.title || e.note || '').toLowerCase().includes(ref))
      );
      return all ? all.id : null;
    }

    for (const cm of (schedule.comments || [])) {
      const targetId = resolveId(cm);
      if (!targetId) { console.warn('[TsukiSend inline] comment 未匹配到目标:', cm.targetRef); continue; }
      await _dbPutComment({
        id: `cm_${now}_${Math.random().toString(36).slice(2)}`,
        chatId, targetId,
        authorType: cm.authorType || 'char',
        authorName: cm.authorName || ctx.charName,
        content: cm.content || '',
        createdAt: _commentCreatedAt,
        timeMode: _timeMode,
      });
      stats.comments++;
    }

    for (const ed of (schedule.edits || [])) {
      const targetId = resolveId(ed);
      if (!targetId) { console.warn('[TsukiSend inline] edit 未匹配到目标:', ed.targetRef); continue; }
      let newValue = ed.newValue;
      if (ed.field === 'done') newValue = (newValue === true || newValue === 'true') ? 'true' : 'false';
      await _dbPutEdit({
        id: `ed_${now}_${Math.random().toString(36).slice(2)}`,
        chatId, targetId,
        editorType: ed.editorType || 'char',
        editorName: ed.editorName || ctx.charName,
        field: ed.field,
        oldValue: '',
        newValue: String(newValue),
        createdAt: _commentCreatedAt,
        timeMode: _timeMode,
      });
      stats.edits++;
    }

    return stats;
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

    // ─────────────────────────────────────────────────────────────
    // 🌟 重点 1：处理系统提示词（历史记录）中的 Base64
    // 历史记录是以字符串形式塞进 system 的，AI 无法直接"看"字符串里的 Base64。
    // 为了节省 Token 且不干扰 AI，我们将历史记录里的超长 Base64 替换为占位符。
    // ─────────────────────────────────────────────────────────────
    let historyText = promptStream.join('\n\n');
    const base64Regex = /data:image\/[a-zA-Z]+;base64,[^\]\s>]+/g;
    historyText = historyText.replace(base64Regex, '[图片数据已归档]');

    // ✅ 注入剧情时钟（须同时满足：ScheduleUpdater已加载 + 该聊天开启了剧情时间开关）
    let storyClockInject = '';
    if (typeof window.ScheduleUpdater?.getStoryClockInject === 'function') {
      try {
        const _csDb = await (typeof openDb === 'function' ? openDb() : initTsukiDB());
        const _cs = await new Promise(res => {
          const tx = _csDb.transaction('config', 'readonly');
          const req = tx.objectStore('config').get(`chat_settings_${chatId}`);
          req.onsuccess = () => res(req.result);
          req.onerror  = () => res(null);
        });
        if (_cs && _cs.storyTimeEnabled === true) {
          storyClockInject = await window.ScheduleUpdater.getStoryClockInject(chatId);
        }
      } catch(e) { /* 静默忽略，不影响主流程 */ }
    }

    // ✅ ★ 注入角色日程（scheduleEnabled 开关控制，v1.2 新增）
    const scheduleInject = await buildScheduleInject(chatId);

    // 当日程开关开启时，根据时间感知开关生成对应格式的日程生成说明
    // 时间感知 ON  → date "YYYY-MM-DD" 模板
    // 时间感知 OFF → storyDay 整数 模板
    const _calSettings = (await _dbGet('config', `chat_settings_${chatId}`)) || {};
    const _tsEnabled = _calSettings.timestampEnabled !== false;

    let SCHEDULE_APPEND = '';
    if (scheduleInject) {
      const _commonRules = (
          '- charGen: true=角色视角; false=用户视角.\n'
        + '- symbol: "囍"(好) or "寂"(坏). color: #72c9a0 #82c4e8 #f4a7b9 #b8a8d8 #f9c784 #a8dcc8 #f4927a.\n'
        + '- targetRef (comments/edits): MUST be an exact substring of an existing entry\'s title or note shown in [角色日程安排]. NEVER invent a targetRef. If unsure, omit comments/edits entirely.'
      );

      if (_tsEnabled) {
        // ── 时间感知 ON：用真实日期 date ──────────────────────────────
        const _nowD = new Date();
        const _todayStr = `${_nowD.getFullYear()}-${_p2(_nowD.getMonth()+1)}-${_p2(_nowD.getDate())}`;
        SCHEDULE_APPEND = (
    '\n\nSCHEDULE UPDATE (optional): If this conversation clearly creates or modifies a schedule item — append ONE ```json``` block at the very end of your reply (after all [角色名|type] lines). Skip entirely if nothing schedule-related happened.\n'
  + '\n'
  + '⚠️ 当前为【时间感知模式】。必须使用 "date" 字段（"YYYY-MM-DD"格式），严禁出现 storyDay 字段。今天是 ' + _todayStr + '。\n'
  + '\n'
  + '```json\n'
  + '{\n'
  + '  "events": [\n'
  + '    { "date": "YYYY-MM-DD", "charGen": true, "charName": "角色名", "hour": 14, "minute": 0, "title": "事件标题", "color": "#72c9a0" }\n'
  + '  ],\n'
  + '  "todos": [\n'
  + '    { "date": "YYYY-MM-DD", "charGen": false, "charName": "用户名", "title": "待办内容", "done": false }\n'
  + '  ],\n'
  + '  "memos": [\n'
  + '    { "date": "YYYY-MM-DD", "charGen": true, "charName": "角色名", "title": "备忘内容" }\n'
  + '  ],\n'
  + '  "annotations": [\n'
  + '    { "date": "YYYY-MM-DD", "charGen": true, "charName": "角色名", "symbol": "囍", "note": "批注内容" }\n'
  + '  ],\n'
  + '  "comments": [\n'
  + '    { "targetRef": "被吐槽条目的title或note原文片段（必须与已有日程完全匹配）", "targetType": "event", "date": "YYYY-MM-DD", "authorType": "char", "authorName": "角色名", "content": "吐槽内容" }\n'
  + '  ],\n'
  + '  "edits": [\n'
  + '    { "targetRef": "被修改条目的title或note原文片段（必须与已有日程完全匹配）", "targetType": "todo", "date": "YYYY-MM-DD", "editorType": "char", "editorName": "角色名", "field": "done", "oldValue": "false", "newValue": "true" }\n'
  + '  ]\n'
  + '}\n'
  + '```\n'
  + '\n'
  + 'STRICT RULES — 违反任意一条将导致写库失败：\n'
  + '1. 【结构】JSON 必须是单个 {} 对象，禁止使用数组 [] 作为根节点，禁止按天分组嵌套。\n'
  + '2. 【字段】只允许出现 events / todos / memos / annotations / comments / edits 这六个顶层字段，只写有内容的字段，没有内容的字段直接省略。\n'
  + '3. 【日期】date 必须是 "YYYY-MM-DD" 字符串，如 "' + _todayStr + '"，严禁使用 storyDay 整数。\n'
  + '4. 【charGen】有 charGen 字段时：角色主动创建的条目填 true，用户视角的条目填 false。\n'
  + '5. 【comments/edits】targetRef 必须是 [角色日程安排] 注入内容中某条目 title 或 note 的原文片段，用于精确匹配已有条目；不得凭空捏造不存在的 targetRef。\n'
  + '6. 【edits】必须同时提供 oldValue 和 newValue，field 填被修改的字段名（如 "title" / "done" / "hour"）。\n'
  + '7. 【位置】```json 块必须位于所有 [角色名|type] 消息行之后，作为整个回复的最后内容，绝不能夹在消息行中间。\n'
  + '8. 【数量】每次回复最多输出一个 ```json 块，严禁拆分成多个块。\n'
  + '9. 【克制】只写本轮对话中明确发生的日程变化，不要主动补充、预测或虚构用户未提及的事项。\n'
  + 'Rules:\n'
  + '- date: real calendar date "YYYY-MM-DD". Do NOT use storyDay in this mode.\n'
  + _commonRules
);
      } else {
        // ── 时间感知 OFF：用剧情天数 storyDay ─────────────────────────
        SCHEDULE_APPEND = (
    '\n\nSCHEDULE UPDATE (optional): If this conversation clearly creates or modifies a schedule item — append ONE ```json``` block at the very end of your reply (after all [角色名|type] lines). Skip entirely if nothing schedule-related happened.\n'
  + '\n'
  + '⚠️ 当前为【剧情时钟模式】。必须使用 "storyDay" 整数字段（从1开始计），严禁出现 date 字符串字段。\n'
  + '\n'
  + '```json\n'
  + '{\n'
  + '  "events": [\n'
  + '    { "storyDay": 3, "charGen": true, "charName": "角色名", "hour": 14, "minute": 0, "title": "事件标题", "color": "#72c9a0" }\n'
  + '  ],\n'
  + '  "todos": [\n'
  + '    { "storyDay": 3, "charGen": false, "charName": "用户名", "title": "待办内容", "done": false }\n'
  + '  ],\n'
  + '  "memos": [\n'
  + '    { "storyDay": 3, "charGen": true, "charName": "角色名", "title": "备忘内容" }\n'
  + '  ],\n'
  + '  "annotations": [\n'
  + '    { "storyDay": 3, "charGen": true, "charName": "角色名", "symbol": "囍", "note": "批注内容" }\n'
  + '  ],\n'
  + '  "comments": [\n'
  + '    { "targetRef": "被吐槽条目的title或note原文片段（必须与已有日程完全匹配）", "targetType": "event", "storyDay": 3, "authorType": "char", "authorName": "角色名", "content": "吐槽内容" }\n'
  + '  ],\n'
  + '  "edits": [\n'
  + '    { "targetRef": "被修改条目的title或note原文片段（必须与已有日程完全匹配）", "targetType": "todo", "storyDay": 3, "editorType": "char", "editorName": "角色名", "field": "done", "oldValue": "false", "newValue": "true" }\n'
  + '  ]\n'
  + '}\n'
  + '```\n'
  + '\n'
  + 'STRICT RULES — 违反任意一条将导致写库失败：\n'
  + '1. 【结构】JSON 必须是单个 {} 对象，禁止使用数组 [] 作为根节点，禁止按天分组嵌套。\n'
  + '2. 【字段】只允许出现 events / todos / memos / annotations / comments / edits 这六个顶层字段，只写有内容的字段，没有内容的字段直接省略。\n'
  + '3. 【日期】storyDay 必须是正整数（如 1、2、3），严禁使用 "YYYY-MM-DD" 日期字符串。\n'
  + '4. 【charGen】有 charGen 字段时：角色主动创建的条目填 true，用户视角的条目填 false。\n'
  + '5. 【comments/edits】targetRef 必须是 [角色日程安排] 注入内容中某条目 title 或 note 的原文片段，用于精确匹配已有条目；不得凭空捏造不存在的 targetRef。\n'
  + '6. 【edits】必须同时提供 oldValue 和 newValue，field 填被修改的字段名（如 "title" / "done" / "hour"）。\n'
  + '7. 【位置】```json 块必须位于所有 [角色名|type] 消息行之后，作为整个回复的最后内容，绝不能夹在消息行中间。\n'
  + '8. 【数量】每次回复最多输出一个 ```json 块，严禁拆分成多个块。\n'
  + '9. 【克制】只写本轮对话中明确发生的日程变化，不要主动补充、预测或虚构用户未提及的事项。\n'
          + 'Rules:\n'
          + '- storyDay: integer (1-based). Do NOT use date string in this mode.\n'
          + _commonRules
        );
      }
    }


    // 提示词拼装顺序：剧情时钟 → 日程 → 历史/人设 → 格式指令（含日程说明）
    const systemPrompt = [
      storyClockInject + scheduleInject + historyText,
      '──────────────────────────────',
      FORMAT_SYSTEM_PROMPT + SCHEDULE_APPEND,
    ].join('\n\n');

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

    console.group('%c🕐 [剧情时钟注入]', 'color:#72c9a0;font-weight:bold');
    if (storyClockInject) {
      console.log(storyClockInject);
    } else {
      console.log('（未注入 — 剧情时间开关未开启 或 ScheduleUpdater 未加载）');
    }
    console.groupEnd();

    console.group('%c📅 [日程注入]', 'color:#f9c784;font-weight:bold');
    if (scheduleInject) {
      console.log(scheduleInject);
    } else {
      console.log('（未注入 — 日程开关未开启 或 该时间窗口内暂无日程）');
    }
    console.groupEnd();

    console.group('%c📋 [FORMAT_SYSTEM_PROMPT + SCHEDULE_APPEND]', 'color:#82c4e8;font-weight:bold');
    console.log(FORMAT_SYSTEM_PROMPT + SCHEDULE_APPEND);
    console.groupEnd();

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

    // ✅ 预先计算本条AI消息的剧情时间戳（story_clock 已由 processStoryTimeTag 推进过）
    const _storyTs = typeof window._getStoryTimestampNow === 'function'
      ? await window._getStoryTimestampNow(window.currentChatId)
      : null;

    // ✅ 三分支 meta：剧情时间开(双勾+已读+剧情时分) > 时间感知开(时钟+真实时分) > 双勾已读
    async function buildCharMeta() {
      try {
        const _chatId = window.currentChatId;
        const _db = typeof openDb === 'function' ? await openDb() : await initTsukiDB();
        // 实时读开关，不依赖可能未赋值的全局缓存
        const _settings = await new Promise(res => {
          try {
            const tx = _db.transaction('config', 'readonly');
            const req = tx.objectStore('config').get(`chat_settings_${_chatId}`);
            req.onsuccess = () => res(req.result || {});
            req.onerror = () => res({});
          } catch { res({}); }
        });
        const _storyOn = _settings.storyTimeEnabled === true;
        const _tsOn    = _settings.timestampEnabled !== false;

        if (_storyOn && _storyTs) {
          const _clock = await new Promise(res => {
            try {
              const tx = _db.transaction('config', 'readonly');
              const req = tx.objectStore('config').get(`story_clock_${_chatId}`);
              req.onsuccess = () => res(req.result || null);
              req.onerror = () => res(null);
            } catch { res(null); }
          });
          if (_clock && _clock.baseRealDate) {
            const _baseTs = new Date(_clock.baseRealDate + 'T00:00:00').getTime();
            const _diffSec = Math.floor((_storyTs - _baseTs) / 1000);
            const _secInDay = ((_diffSec % 86400) + 86400) % 86400;
            const _hh = String(Math.floor(_secInDay / 3600)).padStart(2, '0');
            const _mm = String(Math.floor((_secInDay % 3600) / 60)).padStart(2, '0');
            return `<i class="fa-solid fa-check-double" style="color:var(--accent-mint)"></i> 已读 · ${_hh}:${_mm}`;
          }
        }
        if (_tsOn) return `<i class="fa-regular fa-clock"></i> ${timeStr}`;
      } catch(e) { /* 静默降级 */ }
      return `<i class="fa-solid fa-check-double" style="color:var(--accent-mint)"></i> 已读`;
    }

    /* ── system ─────────────────────────────────────────── */
    if (type === 'system') {
      const el = window.renderMessage('system', content);
      if (el && window.saveMessageToDB) {
        const floor = await window.saveMessageToDB('system', content, content, 'system', _storyTs);
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
        const floor = await window.saveMessageToDB('recalled', content, '[撤回消息]', 'char', _storyTs);
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
        const floor = await window.saveMessageToDB('blocked', content, '[屏蔽消息]', 'char', _storyTs);
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
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB(
          'call',
          { callType: isVideo ? 'video' : 'voice' },
          isVideo ? '[视频通话]' : '[语音通话]',
          'char',
          _storyTs,
        );
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── text ───────────────────────────────────────────── */
    if (type === 'text') {
      const row = window.renderMessage('char', content, { meta: await buildCharMeta() });
      if (window.saveMessageToDB) {
        const match = content.match(/^<quote=.*?\|.*?>([\s\S]*)$/);
        const cleanSummary = match ? match[1].trim() : content;
        const floor = await window.saveMessageToDB('text', content, cleanSummary, 'char', _storyTs);
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
        const floor = await window.saveMessageToDB('voice', { transcript: content }, '[语音]', 'char', _storyTs);
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
        const floor = await window.saveMessageToDB('image', { text: content }, '[图文] ' + content, 'char', _storyTs);
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
        meta: await buildCharMeta(),
      });
      if (window.bindTransferView) window.bindTransferView(b);
      if (window.saveMessageToDB) {
        const floor = await window.saveMessageToDB(
          'transfer',
          { from: charName, amount, note },
          `[转账] ¥${amount}`,
          'char',
          _storyTs,
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
        const floor = await window.saveMessageToDB('location', { location: content }, `[位置] ${content}`, 'char', _storyTs);
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
        const floor = await window.saveMessageToDB('gift', { item, note: gnote }, `[礼物] ${item}`, 'char', _storyTs);
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── sticker ────────────────────────────────────────── */
    if (type === 'sticker') {
      let stickerName = content;
      let stickerUrl = '';

      // 1. 解析两种格式：
      //    格式A（带URL）: 坏心思|https://i.postimg.cc/xxx/yyy.jpg
      //    格式B（纯名）:  委屈猫猫
      if (content.includes('|')) {
        const pipeIdx = content.indexOf('|');
        const left  = content.slice(0, pipeIdx).trim();
        const right = content.slice(pipeIdx + 1).trim();
        // 竖线右侧是 URL（http:// 或 //）才拆分，否则整段当名字
        if (/^(https?:)?\/\//i.test(right)) {
          stickerName = left;
          stickerUrl  = /^https?:/i.test(right) ? right : 'https:' + right;
        }
        // 右侧不像 URL：stickerName 保持 content 原值，不拆
      } else {
        // 没有竖线：整段都是名字，兜底检查裸 URL（理论上不该出现）
        const urlMatch = content.match(/https?:\/\/\S+/i);
        if (urlMatch) {
          stickerUrl  = urlMatch[0];
          stickerName = content.replace(stickerUrl, '').trim();
        }
      }

      // 2. 清洗名字：去掉末尾冒号/竖线、图片后缀
      stickerName = stickerName
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
        const floor = await window.saveMessageToDB('sticker', contentData, `[表情包] ${stickerName}`, 'char', _storyTs);
        if (row && floor != null) row.dataset.floor = floor;
      }
      return;
    }

    /* ── 兜底 text ──────────────────────────────────────── */
    const fbRow = window.renderMessage('char', content, { meta: await buildCharMeta() });
    if (window.saveMessageToDB) {
      const match = content.match(/^<quote=.*?\|.*?>([\s\S]*)$/);
      const cleanSummary = match ? match[1].trim() : content;
      const floor = await window.saveMessageToDB('text', content, cleanSummary, 'char', _storyTs);
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

    function handleStart(e) {
      if (e.button && e.button !== 0) return;
      startY = getY(e);
      isDragging = true;
      triggered = false;
      currentDY = 0;
      sendBtn.style.transition = 'none';
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
        // ✅ 获取当前剧情时间戳存入消息
        const storyTs = typeof window._getStoryTimestampNow === 'function'
          ? await window._getStoryTimestampNow(chatId)
          : null;
        const floor = await window.saveMessageToDB('text', userText, userText, 'user', storyTs);
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

      // ✅ ★ 先提取并写入 AI 返回的日程 JSON（v1.2 新增）
      // 必须在 processStoryTimeTag 之前，因为日程 JSON 块本身不含 story_time 标签
      let processedRaw = await extractAndApplyScheduleFromAiReply(raw, chatId);

      // ✅ 再处理 story_time 标签：更新 story_clock，再剥离标签，此后 AI 消息存库时 storyTimestamp 已是推进后的值
      if (typeof window.ScheduleUpdater?.processStoryTimeTag === 'function') {
        processedRaw = await window.ScheduleUpdater.processStoryTimeTag(processedRaw, chatId);
      }

      // 【新增】：先提取并抹除状态标签
      const newraw = await handleStatusTag(processedRaw);

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

      // ✅ ★ 先提取并写入 AI 返回的日程 JSON（v1.2 新增）
      let processedRaw = await extractAndApplyScheduleFromAiReply(raw, chatId);

      // ✅ 再处理 story_time 标签更新 clock
      if (typeof window.ScheduleUpdater?.processStoryTimeTag === 'function') {
        processedRaw = await window.ScheduleUpdater.processStoryTimeTag(processedRaw, chatId);
      }

      const newraw = await handleStatusTag(processedRaw);
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
    // v1.2 新增暴露，方便外部调试
    buildScheduleInject,
    extractAndApplyScheduleFromAiReply,
  };

  init();
})();
