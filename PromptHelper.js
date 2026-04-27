/**
 * Tsukimi 提示词管理调试脚本 - 全链路监控版
 * v4.3: 新增 offline 线下剧场消息类型解析
 */

const IDB_CONFIG = {
  name: 'tsukiphonepromax',
  stores: {
    chars: 'chars',
    users: 'users',
    chats: 'chats',
    messages: 'messages',
    worldbook: 'worldbook',
    theaters: 'theaters',
    theater_messages: 'theater_messages',
    theater_summaries: 'theater_summaries',
    diaries: 'diaries',
  },
};

// ---------------- 基础工具函数 ----------------

/**
 * 获取 DB 连接：优先用 window.openDb（主 HTML 注入的完整 SCHEMA 连接），
 * 避免裸 indexedDB.open() 不带版本号导致拿到不含 theater_summaries 的旧连接。
 */
async function getDb() {
  if (typeof window.openDb === 'function') {
    const db = await window.openDb();
    console.log(
      `%c[PromptHelper] getDb → window.openDb ✅ ver=${db.version} stores=[${Array.from(db.objectStoreNames).join(', ')}]`,
      'color:#43d9a0'
    );
    return db;
  }
  // 回退：裸连接（仅在 PromptHelper 单独调试时走到这里）
  console.warn('[PromptHelper] getDb → window.openDb 不存在，走裸 indexedDB.open（⚠️ 可能缺 theater_summaries）');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_CONFIG.name);
    request.onsuccess = () => {
      const db = request.result;
      console.warn(`  裸连接 ver=${db.version} stores=[${Array.from(db.objectStoreNames).join(', ')}]`);
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function dbGet(storeName, key) {
  if (!key) return null;
  const db = await getDb();
  return new Promise(resolve => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
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
  const triggered = keys.some(key => target.includes(key));
  return triggered;
}

const sortByPriority = (a, b) => Number(b.priority || 100) - Number(a.priority || 100);

function formatTime(ts) {
  const d = new Date(ts);
  const weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${weeks[d.getDay()]}`;
}

function formatStoryTime(ts, baseTs) {
  const diffMs = ts - baseTs;
  const totalSec = Math.floor(diffMs / 1000);
  const dayNum = Math.floor(totalSec / 86400) + 1;
  const secInDay = ((totalSec % 86400) + 86400) % 86400;
  const hh = String(Math.floor(secInDay / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secInDay % 3600) / 60)).padStart(2, '0');
  const d = new Date(ts);
  const weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `Day${dayNum} ${hh}:${mm} ${weeks[d.getDay()]}`;
}

// ── 日记消息解析工具 ────────────────────────────────────────────────────────

/**
 * 解析 <diary=日记内容|批注> 格式，返回 { diaryText, annotationText }
 */
function parseDiaryContent(raw) {
  if (typeof raw !== 'string') return { diaryText: String(raw || ''), annotationText: '' };
  const match = raw.match(/^<diary=([\s\S]*?)>$/);
  if (!match) return { diaryText: raw, annotationText: '' };
  const inner = match[1];
  const pipeIdx = inner.indexOf('|');
  if (pipeIdx === -1) return { diaryText: inner, annotationText: '' };
  return {
    diaryText: inner.substring(0, pipeIdx).trim(),
    annotationText: inner.substring(pipeIdx + 1).trim(),
  };
}

/**
 * 解析 diary_annotation 批注消息，区分直接新增和引用回复
 * 直接新增: <diary=日记内容|新批注>
 * 引用回复: <diary=日记内容|被引用批注原文｜新回复>  ← 全角竖线 ｜ (U+FF5C) 分隔
 */
function parseDiaryAnnotation(raw) {
  const { diaryText, annotationText } = parseDiaryContent(raw);
  const fullWidthPipeIdx = annotationText.indexOf('\uFF5C');
  if (fullWidthPipeIdx !== -1) {
    return {
      diaryText,
      quotedAnn: annotationText.substring(0, fullWidthPipeIdx).trim(),
      replyText: annotationText.substring(fullWidthPipeIdx + 1).trim(),
      isDirect: false,
    };
  }
  return { diaryText, quotedAnn: '', replyText: annotationText, isDirect: true };
}

/** 判断是否为新建批注时写入的占位文本 */
function isPlaceholderAnnotation(text) {
  return !text || text.trim() === '（点击编辑写入批注内容）' || text.trim() === '';
}

/**
 * ① 从 IDB diaries + config 表读取某日记的已有批注摘要
 *    通过 diaryText 前 30 字反查日记条目，再从 config 表取 annotations_<id>
 */
async function fetchExistingAnnotations(db, diaryText) {
  try {
    const diaryEntry = await new Promise(resolve => {
      const tx = db.transaction('diaries', 'readonly');
      const req = tx.objectStore('diaries').getAll();
      req.onsuccess = () => {
        const kw = diaryText.substring(0, 30);
        resolve((req.result || []).find(d => (d.content || '').includes(kw)) || null);
      };
      req.onerror = () => resolve(null);
    });
    if (!diaryEntry) return { annsSummary: '', authorName: '', diaryTitle: '' };

    // 日记标题
    const diaryTitle = diaryEntry.title || '';

    // 查日记作者名（charId → chars 表）
    let authorName = '';
    if (diaryEntry.charId) {
      const authorChar = await dbGet('chars', diaryEntry.charId);
      if (authorChar) authorName = authorChar.name || '';
    }

    const annRecord = await dbGet('config', 'annotations_' + diaryEntry.id);
    const items = (annRecord?.items || []).filter(a => !isPlaceholderAnnotation(a.text));
    const annsSummary = items.length
      ? items.map((a, i) => {
          let line = `[批注${i + 1}·${a.authorName || '?'}] ${(a.text || '').substring(0, 80)}`;
          const replies = (a.replies || []).filter(r => r.text && r.text.trim());
          if (replies.length) {
            line += ' ' + replies
              .map(r => `↳[回复·${r.authorName || '?'}] ${(r.text || '').substring(0, 60)}`)
              .join(' / ');
          }
          return line;
        }).join(' / ')
      : '';

    return { annsSummary, authorName, diaryTitle };
  } catch (e) {
    return { annsSummary: '', authorName: '', diaryTitle: '' }; // 静默忽略
  }
}

/**
 * ① 自动更新批注内容
 *    如果存入时的 annotationText 是占位文本（用户新建后未及时编辑就触发了存库），
 *    则在 allMessages 里向后查找同一日记（diaryText 前 30 字匹配）的
 *    下一条 diary_annotation，取其 annotationText 作为最新内容。
 */
function resolveLatestAnnotationText(msg, allMessages, diaryText, annotationText) {
  if (!isPlaceholderAnnotation(annotationText)) return annotationText;

  const laterMsgs = allMessages.filter(m => m.floor > msg.floor && m.type === 'diary_annotation');
  for (const later of laterMsgs) {
    const { diaryText: ld, annotationText: la } = parseDiaryContent(later.content);
    if (ld.substring(0, 30) === diaryText.substring(0, 30) && !isPlaceholderAnnotation(la)) {
      return la;
    }
  }
  return annotationText; // 没找到更新版本就保持原样
}

// ── 线下剧场(offline)解析工具 ────────────────────────────────────────────────

/**
 * 从 IDB theater_messages 表读取指定剧场、指定楼层范围内的所有消息
 * @param {IDBDatabase} db
 * @param {string} theaterId
 * @param {number|'prologue'} floorStart  stageFloorRange[0]
 * @param {number|null}       floorEnd    stageFloorRange[1]，null 表示读到最末
 */
async function fetchOfflineTheaterMessages(db, theaterId, floorStart, floorEnd) {
  try {
    // ✅ 优先用 window.openDb（完整 SCHEMA），避免传入的残缺 db 不含 theater_messages
    let theaterDb;
    if (typeof window.openDb === 'function') {
      theaterDb = await window.openDb();
      console.log('%c  [fetchOfflineTheaterMessages] ✅ 使用 window.openDb 连接', 'color:#43d9a0');
      console.log('  stores:', Array.from(theaterDb.objectStoreNames));
    } else {
      theaterDb = db;
      console.warn('  [fetchOfflineTheaterMessages] ⚠️ window.openDb 不存在，回退到传入 db（可能缺表！）');
      console.log('  传入 db stores:', Array.from(db.objectStoreNames));
    }
    const allMsgs = await new Promise(resolve => {
      try {
        const tx = theaterDb.transaction('theater_messages', 'readonly');
        const store = tx.objectStore('theater_messages');
        const req = store.index('by_theater').getAll(theaterId);
        req.onsuccess = () => {
          console.log(`  [fetchOfflineTheaterMessages] by_theater index getAll → ${(req.result||[]).length} 条`);
          resolve(req.result || []);
        };
        req.onerror = () => { console.error('  [fetchOfflineTheaterMessages] index getAll 失败', req.error); resolve([]); };
      } catch (e) {
        console.error('  [fetchOfflineTheaterMessages] 事务失败，走全量兜底:', e);
        try {
          const tx2 = theaterDb.transaction('theater_messages', 'readonly');
          const fallback = tx2.objectStore('theater_messages').getAll();
          fallback.onsuccess = () =>
            resolve((fallback.result || []).filter(m => m.theaterId === theaterId));
          fallback.onerror = () => resolve([]);
        } catch (e2) {
          console.error('  [fetchOfflineTheaterMessages] 兜底也失败:', e2);
          resolve([]);
        }
      }
    });

    // 按楼层升序
    const sorted = allMsgs.sort((a, b) => (a.floor || 0) - (b.floor || 0));

    // 过滤楼层范围
    return sorted.filter(m => {
      const f = m.floor || 0;
      const startOk = floorStart === 'prologue' ? true : f >= Number(floorStart);
      const endOk   = floorEnd == null ? true : f <= Number(floorEnd);
      return startOk && endOk;
    });
  } catch (e) {
    console.warn('[fetchOfflineTheaterMessages] 读取失败:', e);
    return [];
  }
}

/**
 * 从 IDB theaters 表读取剧场信息（标题、参与 charIds）
 */
async function fetchTheaterInfo(db, theaterId) {
  try {
    const theater = await new Promise(resolve => {
      const tx = db.transaction('theaters', 'readonly');
      const req = tx.objectStore('theaters').get(theaterId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    return theater;
  } catch (e) {
    return null;
  }
}

/**
 * 将线下剧场消息列表格式化为提示词字符串
 * @param {Array}  msgs      已过滤的 theater_messages
 * @param {Array}  chars     剧场参与的 chars 数组（从 IDB chars 表读出）
 * @param {string} charNames 剧场角色名拼接字符串（用于开头提示）
 * @param {string} stageTitle 剧场标题
 * @param {string} floorRangeLabel  楼层范围描述文本
 */
function formatOfflineMessages(msgs, chars, charNames, stageTitle, floorRangeLabel) {
  const lines = [];

  for (const m of msgs) {
    // 跳过系统辅助型消息（history/summary 卡片本身不需要传给 AI）
    if (m.type === 'history' || m.type === 'summary' || m.type === 'summary_bubble') continue;
    if (m.isSummary || m.isSummarized === true) continue;

    let senderName = '系统';
    if (m.sender === 'user' || m.isUser) {
      senderName = 'User';
    } else if (m.charId) {
      const c = chars.find(ch => ch.id === m.charId);
      if (c) senderName = c.name;
    } else if (m.sender === 'narrator' || m.isNarrator) {
      senderName = '旁白';
    }

    // 内容提取
    let contentStr = '';
    if (typeof m.content === 'string') {
      contentStr = m.content;
    } else if (m.content && typeof m.content === 'object') {
      contentStr = m.content.text || m.content.body || JSON.stringify(m.content);
    }

    const typeLabel = m.type && m.type !== 'text' ? `|${m.type}` : '';
    lines.push(`[${senderName}|${formatTime(m.timestamp || 0)}${typeLabel}] ${contentStr}`);
  }

  return lines.join('\n');
}

/**
 * 将单条 theater_message 转为提示词行字符串。
 * 对齐 StageSend.msgToLine 逻辑：
 *   - history  → [system|前情剧情·来源线上聊天] 内容
 *   - prologue → [narrator|序幕] 内容
 *   - 普通消息 → [发送者|时间] 内容
 * @param {object} m     单条 theater_message
 * @param {Array}  chars 剧场参与的 chars 数组
 * @returns {string|null}
 */
function msgToOfflineLine(m, chars) {
  let content = m.content || '';
  if (typeof content === 'object') {
    content = content.transcript || content.text || content.name || JSON.stringify(content);
  }

  // history 气泡：前置剧情，格式对齐 StageSend
  if (m.type === 'history' || m.type === 'summary') {
    const cleaned = String(content)
      .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `[system|前情剧情·来源线上聊天] ${cleaned}`;
  }

  // prologue 序幕
  if (m.type === 'prologue') {
    const cleanContent = String(content).replace(/<[^>]+>/g, '').trim();
    return `[narrator|序幕] ${cleanContent}`;
  }

  // summary_bubble / isSummary：不输出
  if (m.type === 'summary_bubble' || m.isSummary) return null;

  // 普通消息：确定发送者名
  let senderName = '系统';
  if (m.sender === 'user' || m.isUser) {
    senderName = 'user';
  } else if (m.charId) {
    const c = chars.find(ch => ch.id === m.charId);
    if (c) senderName = c.name;
  } else if (m.sender === 'narrator' || m.isNarrator) {
    senderName = 'narrator';
  }

  const typeLabel = m.type && m.type !== 'text' ? `|${m.type}` : '';
  return `[${senderName}${typeLabel}] ${content}`;
}

/**
 * 主入口：解析一条 offline 类型消息，返回格式化的提示词字符串
 * 结构：
 *   【开头】剧场名 + 参与角色 + 楼层范围提示
 *   【中间】该范围内的所有线下对话
 *   【结尾】标记线下内容结束，提示 AI 后续为线上场景
 */
async function buildOfflineSegment(db, msg) {
  console.log(`%c[buildOfflineSegment] 🎭 offline floor=${msg.floor} 开始解析`, 'color:#fa5bd5;font-weight:bold');

  // ── 从 content 对象读取元数据 ──
  const c = msg.content && typeof msg.content === 'object' ? msg.content : {};
  const stageId         = msg.stageId        || c.stageId        || null;
  const stageTitle      = msg.stageTitle      || c.stageTitle      || c.displayTitle || '线下剧场';
  const stageFloorRange = msg.stageFloorRange || c.stageFloorRange || [null, null];
  const floorStart      = stageFloorRange[0];  // number | 'prologue' | null
  const floorEnd        = stageFloorRange[1];  // number | null

  if (!stageId) {
    console.warn('[buildOfflineSegment] stageId 缺失，跳过 offline 解析');
    return `[系统] 线下剧场记录（元数据不完整，无法展开）`;
  }

  // ── 统一用 window.openDb 取完整 SCHEMA 连接 ──
  let theaterDb;
  if (typeof window.openDb === 'function') {
    theaterDb = await window.openDb();
    console.log('%c  [buildOfflineSegment] ✅ window.openDb 获取成功', 'color:#43d9a0');
    console.log('  DB version:', theaterDb.version, '| stores:', Array.from(theaterDb.objectStoreNames).join(', '));
  } else {
    theaterDb = db;
    console.warn('  [buildOfflineSegment] ⚠️ window.openDb 不存在！回退到传入 db');
    console.log('  传入 db stores:', Array.from(db.objectStoreNames).join(', '));
  }

  // ── 读取剧场信息 ──
  const theater = await fetchTheaterInfo(theaterDb, stageId);
  console.log(`  [buildOfflineSegment] fetchTheaterInfo → `, theater ? `title="${theater.title}"` : '❌ null（theaters 表中找不到此 stageId）');
  const resolvedTitle = theater?.title || stageTitle;
  const theaterCharIds = theater?.charIds || [];

  // ── 读取剧场参与角色 ──
  const chars = [];
  for (const cid of theaterCharIds) {
    const ch = await dbGet(IDB_CONFIG.stores.chars, cid);
    if (ch) chars.push(ch);
  }
  const charNames = chars.length
    ? chars.map(ch => ch.name).join('、')
    : '（角色信息缺失）';

  // ── 楼层范围描述 ──
  const floorRangeLabel = (() => {
    const s = floorStart === 'prologue' ? '开场白' : floorStart != null ? `F·${floorStart}` : '起始';
    const e = floorEnd   != null ? `F·${floorEnd}` : '末尾';
    return `${s} → ${e}`;
  })();

  console.log(`  stageId=${stageId} title="${resolvedTitle}" chars=[${charNames}] range=${floorRangeLabel}`);

  // ── 拉取线下剧场消息（内部也走 window.openDb） ──
  const theaterMsgs = await fetchOfflineTheaterMessages(theaterDb, stageId, floorStart, floorEnd);
  console.log(`  [buildOfflineSegment] theaterMsgs 读取完毕，共 ${theaterMsgs.length} 条`);
  if (theaterMsgs.length > 0) {
    console.log('  前3条预览:', theaterMsgs.slice(0,3).map(m => `[F${m.floor}|${m.type}] ${String(m.content||'').slice(0,40)}`));
  }

  // ── 读取总结记录（theater_summaries）——单独开新裸连接，对齐 StageSend 的做法 ──
  //    不走 window.openDb（它的 SCHEMA 检查可能因版本差异返回不含 theater_summaries 的连接）
  //    直接 indexedDB.open 不带版本号，浏览器会返回当前最高版本的连接，确保 store 存在
  let stageSummaries = [];
  try {
    const summaryDb = await new Promise((res, rej) => {
      const req = indexedDB.open('tsukiphonepromax');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const hasSummaryStore = summaryDb.objectStoreNames.contains('theater_summaries');
    console.log(
      `%c  [buildOfflineSegment] summaryDb ver=${summaryDb.version} | theater_summaries 存在: ${hasSummaryStore}`,
      hasSummaryStore ? 'color:#43d9a0' : 'color:#ff6b6b'
    );
    if (hasSummaryStore) {
      stageSummaries = await new Promise(resolve => {
        try {
          const tx = summaryDb.transaction('theater_summaries', 'readonly');
          const req = tx.objectStore('theater_summaries').index('by_theater').getAll(stageId);
          req.onsuccess = () => {
            const sorted = (req.result || []).sort((a, b) => a.floorStart - b.floorStart);
            console.log(`%c  [buildOfflineSegment] theater_summaries → ${sorted.length} 条`, 'color:#43d9a0');
            sorted.forEach(s => console.log(`    📚 F·${s.floorStart}–F·${s.floorEnd}: ${(s.summaryText || '').slice(0, 60)}…`));
            resolve(sorted);
          };
          req.onerror = () => { console.error('  theater_summaries getAll 失败', req.error); resolve([]); };
        } catch (e) { console.error('  theater_summaries 事务异常:', e); resolve([]); }
      });
    } else {
      console.warn('  [buildOfflineSegment] ⚠️ theater_summaries store 不存在 → 走原文模式');
      console.warn('  → 请先在线下剧场页面执行一次总结操作，或确认 TsukiSummary.js 已完成 DB 升级');
    }
  } catch (e) {
    console.warn('[buildOfflineSegment] 读取 theater_summaries 失败:', e);
  }

  // ── 格式化（有总结则用总结替换覆盖楼层，无则原样输出）──
  // 对齐 StageSend 的 timeline 统一排序逻辑，避免序幕重复和 history 丢失
  let bodyText;
  if (stageSummaries.length > 0) {
    const coveredFloors = new Set();
    for (const s of stageSummaries) {
      for (let f = s.floorStart; f <= s.floorEnd; f++) coveredFloors.add(f);
    }

    // ── 构建统一时间线，每个元素带 sortKey（楼层号）──
    const timeline = [];

    // 1. 遍历所有消息：
    //    - summary_bubble / isSummary 永远跳过（气泡本身不传 AI）
    //    - history 永远保留（前置剧情背景，不受总结覆盖影响）
    //    - prologue 永远保留（序幕只出现一次，不受总结覆盖影响）
    //    - 其他消息：被 isSummarized 标记 或 楼层在 coveredFloors 内 → 跳过
    for (const m of theaterMsgs) {
      if (m.type === 'summary_bubble' || m.type === 'summary') continue;
      if (m.isSummary) continue;
      if (m.type !== 'history' && m.type !== 'prologue' && m.isSummarized === true) continue;
      if (m.type !== 'history' && m.type !== 'prologue' && coveredFloors.has(m.floor)) continue;

      const line = msgToOfflineLine(m, chars);
      if (line) timeline.push({ sortKey: m.floor ?? 0, text: line });
    }

    // 2. 每段总结以 floorStart - 0.5 作为排序位置（确保总结在同楼层消息之前）
    for (const s of stageSummaries) {
      timeline.push({
        sortKey: s.floorStart - 0.5,
        text: `========== 剧情摘要 F·${s.floorStart}–F·${s.floorEnd} ==========\n${s.summaryText}\n========== 摘要结束 ==========`,
      });
    }

    // 3. 按 sortKey 升序排列
    timeline.sort((a, b) => a.sortKey - b.sortKey);

    bodyText = timeline.map(t => t.text).join('\n');
    console.log(
      `%c  [buildOfflineSegment] timeline 拼合完成：摘要=${stageSummaries.length}段，消息条目=${timeline.length - stageSummaries.length}条`,
      'color:#d4ff4d'
    );
  } else {
    // 无总结：过滤掉 isSummary / summary_bubble / summary 类型，原样输出
    const filteredMsgs = theaterMsgs.filter(m =>
      m.type !== 'summary_bubble' &&
      m.type !== 'summary' &&
      !m.isSummary &&
      !(m.isSummarized === true)
    );
    bodyText = filteredMsgs.map(m => msgToOfflineLine(m, chars)).filter(Boolean).join('\n');
  }

  // ── 拼接完整片段 ──
  const header = [
    `========== 线下剧场内容开始 ==========`,
    `【剧场名称】${resolvedTitle}`,
    `【参与角色】${charNames}`,
    `【剧场楼层范围】${floorRangeLabel}`,
    `以下为该线下剧场的完整对话内容，发生在线下真实见面场景中，与线上聊天是独立的：`,
  ].join('\n');

  const footer = [
    ``,
    `========== 线下剧场内容结束 ==========`,
    `[系统提示] 以上是「${resolvedTitle}」线下剧场（${floorRangeLabel}）的全部内容，此后回到线上聊天场景，请勿将线下剧场内容混入线上聊天的续写或推演中。`,
  ].join('\n');

  const result = `${header}\n${bodyText || '（该楼层范围内暂无对话内容）'}${footer}`;
  console.log('%c  → 最终 offline 片段(前200字):\n' + result.substring(0, 200), 'color:#fa5bd5');
  return result;
}

// ────────────────────────────────────────────────────────────────────────────

// ---------------- 核心逻辑 (带详细日志) ----------------

async function assembleCharacterPrompts(ids, latestMessage, chatUserId = null) {
  console.group('%c🧬 [Step 1: 角色与人设组装]', 'color: #00d4ff; font-weight: bold;');
  const charIds = Array.isArray(ids) ? ids : ids ? [ids] : [];
  console.log(`> 待处理角色 IDs:`, charIds);

  let allCharPrompts = [];

  for (const id of charIds) {
    const char = await dbGet(IDB_CONFIG.stores.chars, id);
    if (!char) {
      console.error(`> ❌ 角色 ID [${id}] 在数据库中不存在！`);
      continue;
    }
    console.log(`> ✅ 成功找到角色: ${char.name}`);

    let charSegment = [];
    const wb = char.worldbook || [];

    const preWbAll = wb.filter(s => s.type === 'pre' && s.enabled);
    const preWbTriggered = preWbAll.filter(s => isKeywordTriggered(latestMessage, s.keys)).sort(sortByPriority);
    console.log(`  - 📖 角色私有(Pre): 触发 ${preWbTriggered.length} 条`);
    preWbTriggered.forEach(s => {
      const text = `[Memory Shard: ${s.title}]\n${s.content}`;
      console.log(`%c    [拼接 Pre Wb] ->\n${text}`, 'color: #8a8a8e; font-style: italic;');
      charSegment.push(text);
    });

    const nameInfo = char.remark ? `${char.name} (备注: ${char.remark})` : char.name;
    const nameStr = `[Character Identification]\nName: ${nameInfo}`;
    console.log(`%c    [拼接 角色身份] ->\n${nameStr}`, 'color: #d4ff4d;');
    charSegment.push(nameStr);

    if (char.persona) {
      const personaStr = `[Character Persona]\n${char.persona}`;
      console.log(`%c    [拼接 核心人设] ->\n${personaStr}`, 'color: #d4ff4d;');
      charSegment.push(personaStr);
    }

    if (char.bindId) {
      // ✅ 若绑定的 user 与当前聊天室的 chatUserId 相同，
      //    后面 Active User 块会统一注入，这里跳过避免重复
      if (char.bindId === chatUserId) {
        console.log(`%c    [跳过 绑定主人] bindId === chatUserId (${chatUserId})，由后续 Active User 块统一注入`, 'color: #ff9f43;');
      } else {
        const charUser = await dbGet(IDB_CONFIG.stores.users, char.bindId);
        if (charUser) {
          const ownerStr = `[Character Owner: ${charUser.name}]\nOwner Persona: ${charUser.persona || 'None'}`;
          console.log(`%c    [拼接 绑定主人] bindId(${char.bindId}) ≠ chatUserId(${chatUserId}) ->\n${ownerStr}`, 'color: #ff9f43;');
          charSegment.push(ownerStr);
        }
      }
    }

    const postWbAll = wb.filter(s => s.type === 'post' && s.enabled);
    const postWbTriggered = postWbAll.filter(s => isKeywordTriggered(latestMessage, s.keys)).sort(sortByPriority);
    console.log(`  - 📖 角色私有(Post): 触发 ${postWbTriggered.length} 条`);
    postWbTriggered.forEach(s => {
      const text = `[Author Notes: ${s.title}]\n${s.content}`;
      console.log(`%c    [拼接 Post Wb] ->\n${text}`, 'color: #8a8a8e; font-style: italic;');
      charSegment.push(text);
    });

    allCharPrompts.push(...charSegment);
  }

  if (chatUserId) {
    const activeUser = await dbGet(IDB_CONFIG.stores.users, chatUserId);
    if (activeUser) {
      const activeUserStr = `[Active User in Chat: ${activeUser.name}]\nUser Persona: ${activeUser.persona || 'No persona.'}`;
      console.log(`%c  - 👤 [拼接 活跃用户] ->\n${activeUserStr}`, 'color: #ff9f43;');
      allCharPrompts.push(activeUserStr);
    }
  }

  console.log(`> Step 1 完成，共生成 ${allCharPrompts.length} 个提示词分片`);
  console.groupEnd();
  return allCharPrompts;
}

async function buildFinalPromptStream(
  charIds,
  personaPrompts = [],
  historyCount = 0,
  category = '所有',
  latestMessage = '',
  chatId = null,
) {
  console.group('%c🏗️ [Step 2: 全局流组装]', 'color: #ffa500; font-weight: bold;');
  const db = await getDb();
  const finalStream = [];
  const cIds = Array.isArray(charIds) ? charIds : charIds ? [charIds] : [];

  // 🔍 诊断：拉取所有世界书条目，打印 category 列表，对比当前传入的 category
  console.group('%c🔍 [Step 2: 世界书 category 诊断]', 'color:#ff9f43;font-weight:bold');
  console.log('当前传入 category:', category);
  try {
    const _allWbKeys = ['wb_pre', 'wb_mid', 'wb_global', 'wb_post', 'wb_local'];
    for (const _key of _allWbKeys) {
      const _list = await dbGet(IDB_CONFIG.stores.worldbook, _key);
      if (Array.isArray(_list) && _list.length > 0) {
        console.log(`[${_key}] 共 ${_list.length} 条，category 分布:`);
        _list.forEach(item => {
          console.log(
            `  · "${item.title || '(无标题)'}"  enabled=${item.enabled}  category=${JSON.stringify(item.category ?? '(无)')}`,
          );
        });
      } else {
        console.log(`[${_key}] 空`);
      }
    }
  } catch (_e) {
    console.warn('世界书诊断读取失败:', _e);
  }
  console.groupEnd();

  async function getGlobalWb(key) {
    const data = await dbGet(IDB_CONFIG.stores.worldbook, key);
    return Array.isArray(data) ? data : [];
  }

  /**
   * 分类匹配：支持 item.category 为字符串或数组，大小写不敏感
   * - 无分类 / '所有' → 全局，始终通过
   * - 数组分类 → 只要包含当前 category 就通过
   */
  function matchesCategory(itemCategory, currentCategory) {
    if (!itemCategory) return true;
    const normalize = s => String(s).trim().toLowerCase();
    const currentNorm = normalize(currentCategory);
    const cats = Array.isArray(itemCategory)
      ? itemCategory.map(normalize)
      : [normalize(itemCategory)];
    return cats.includes('所有') || cats.includes(currentNorm);
  }

  const pushWbWithLog = (list, label) => {
    const filtered = list
      .filter(
        item =>
          item.enabled &&
          matchesCategory(item.category, category) &&
          isKeywordTriggered(latestMessage, item.keys),
      )
      .sort(sortByPriority);
    console.log(`  - [${label}] 触发: ${filtered.length} 条`);
    filtered.forEach(item => {
      // ① 修复：content 单独打印，防止 content 内的 %c 吃掉颜色参数导致色号尾缀
      console.log('%c    [注入 ' + label + ' 内容] ->', 'color: #a78bfa;');
      console.log(item.content);
      finalStream.push(item.content);
    });
  };

  pushWbWithLog(await getGlobalWb('wb_pre'), '头部(Pre)');
  pushWbWithLog(await getGlobalWb('wb_mid'), '中部(Mid)');
  pushWbWithLog(await getGlobalWb('wb_global'), '全局(Global)');

  console.log(`  - [人设分片] 准备注入 ${personaPrompts.length} 个块`);
  personaPrompts.forEach((p, idx) => {
    console.log(`%c    [注入 人设块 ${idx + 1}] ->\n${p}`, 'color: #5b7cfa;');
    finalStream.push(p);
  });

  const localWbList = await getGlobalWb('wb_local');
  const filteredLocal = localWbList
    .filter(item => {
      const boundIds = Array.isArray(item.charIds) ? item.charIds : item.charIds ? [item.charIds] : [];
      return item.enabled && cIds.some(id => boundIds.includes(id)) && isKeywordTriggered(latestMessage, item.keys);
    })
    .sort(sortByPriority);
  console.log(`  - [局部(Local)] 触发: ${filteredLocal.length} 条`);
  filteredLocal.forEach(item => {
    console.log('%c    [注入 局部 Wb] ->', 'color: #a78bfa;');
    console.log(item.content);
    finalStream.push(item.content);
  });

  if (chatId) {
    console.log(`  - [历史记录] 拉取 ${historyCount} 条...`);
    const chatHistory = await buildChatHistoryPrompt(chatId, historyCount);
    if (chatHistory.length > 0) {
      finalStream.push(`\n========== CHAT HISTORY START ==========`);
      console.log(`%c    [注入 历史记录块] ->\n${chatHistory.join('\n')}`, 'color: #43d9a0;');
      finalStream.push(...chatHistory);
      finalStream.push(`========== CHAT HISTORY END ==========\n`);
    } else {
      finalStream.push(`\n[System: No chat history.]\n`);
    }
  }

  pushWbWithLog(await getGlobalWb('wb_post'), '尾部(Post)');

  console.log(`%c> Step 2 完成，最终交付流共 ${finalStream.length} 个分片`, 'color: #00ff00;');
  console.groupEnd();
  return finalStream;
}

async function buildChatHistoryPrompt(chatId, historyCount = 0) {
  const db = await getDb();
  let historyPrompts = [];
  const chat = await dbGet(IDB_CONFIG.stores.chats, chatId);
  if (!chat) return [];

  // 读取时间戳开关 + 剧情时间开关（按 chatId 独立读取，支持单聊天室单独控制）
  const chatSettings = await dbGet('config', `chat_settings_${chatId}`);
  const timestampEnabled = chatSettings ? chatSettings.timestampEnabled !== false : true;
  const storyTimeEnabled = chatSettings ? chatSettings.storyTimeEnabled === true : false;
  console.log(`%c[buildChatHistoryPrompt] chatId=${chatId}  时间感知=${timestampEnabled}  剧情时间=${storyTimeEnabled}`, 'color:#43d9a0');

  // 若开启剧情时间，先尝试从该聊天的 story_clock 读 baseRealDate
  let baseTs = null;
  let _storyClockKey = null;
  if (storyTimeEnabled) {
    _storyClockKey = `story_clock_${chatId}`;
    const clock = await dbGet('config', _storyClockKey);
    if (clock && clock.baseRealDate) {
      baseTs = new Date(clock.baseRealDate + 'T00:00:00').getTime();
      console.log(`%c[buildChatHistoryPrompt] 剧情基准: ${clock.baseRealDate}  baseTs=${baseTs}`, 'color:#72c9a0');
    } else {
      console.log(`%c[buildChatHistoryPrompt] story_clock_${chatId} 未找到，将用最早消息日期降级锚定`, 'color:#f9c784');
    }
  }

  const user = await dbGet(IDB_CONFIG.stores.users, chat.userId);
  const userName = user ? user.name : 'User';

  // 群聊支持：预加载所有角色到 Map，key=charId, value=name
  const charMap = {};
  for (const cid of (chat.charIds || [])) {
    const c = await dbGet(IDB_CONFIG.stores.chars, cid);
    if (c) charMap[cid] = c.name;
  }
  // 兜底：单聊时 charName 仍可用（保持原行为）
  const charName = Object.values(charMap)[0] || 'Char';
  console.log(`%c[buildChatHistoryPrompt] 群聊角色 Map: ${JSON.stringify(charMap)}`, 'color:#43d9a0');

  const messages = await new Promise(res => {
    try {
      const tx = db.transaction(IDB_CONFIG.stores.messages, 'readonly');
      const store = tx.objectStore(IDB_CONFIG.stores.messages);
      const req = store.getAll();
      req.onsuccess = () => res((req.result || []).filter(m => m.chatId === chatId));
      req.onerror = () => res([]);
    } catch (e) {
      res([]);
    }
  });

  // 全量升序，resolveLatestAnnotationText 需要向后查找，必须用完整列表
  const allSorted = messages.sort((a, b) => a.floor - b.floor);
  const targetMessages = historyCount > 0 ? allSorted.slice(-historyCount) : allSorted;

  // 剧情时间降级：没有 story_clock 时用最早消息日期作为 D1 锚点并自动保存
  if (storyTimeEnabled && baseTs === null && _storyClockKey) {
    const allTs = allSorted.map(m => m.timestamp).filter(Boolean);
    if (allTs.length > 0) {
      const earliest = Math.min(...allTs);
      const d0 = new Date(earliest);
      d0.setHours(0, 0, 0, 0);
      baseTs = d0.getTime();
      const baseRealDate = `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,'0')}-${String(d0.getDate()).padStart(2,'0')}`;
      try { await dbPut('config', { id: _storyClockKey, baseRealDate, lastSyncStoryMs: 0, lastSyncRealMs: Date.now() }); } catch(e) {}
      console.log(`%c[buildChatHistoryPrompt] 剧情基准(自动锚定): ${baseRealDate}  baseTs=${baseTs}`, 'color:#f9c784');
    }
  }

  console.log(`%c[buildChatHistoryPrompt] 最终模式: ${storyTimeEnabled && baseTs!==null ? '剧情时间' : timestampEnabled ? '真实时间戳' : '无时间'}  共${targetMessages.length}条`, 'color:#43d9a0;font-weight:bold');

  for (const msg of targetMessages) {
    // 群聊支持：优先用消息自带的 charId 查 charMap，区分不同角色发言
    // 兜底：旧消息没有 charId 时，用 charName 字段直接匹配（历史兼容）
    let senderName;
    if (msg.senderRole === 'user') {
      senderName = userName;
    } else if (msg.senderRole === 'char') {
      if (msg.charId && charMap[msg.charId]) {
        senderName = charMap[msg.charId];
      } else if (msg.charName) {
        senderName = msg.charName; // 兜底：旧消息用存库的 charName
      } else {
        senderName = charName;     // 最终兜底：单聊默认角色名
      }
    } else {
      senderName = '系统';
    }
    let content = msg.content;
    let msgType = msg.type;

    // 🌟 兜底：content 字符串以 <diary= 开头时，强制按 diary 类型处理（防止 type 字段值异常）
    const cStr = typeof content === 'string' ? content : '';
    if (cStr.startsWith('<diary=') && msgType !== 'diary' && msgType !== 'diary_annotation') {
      console.warn(`[buildChatHistoryPrompt] floor=${msg.floor} type="${msg.type}" 兜底修正为 diary`);
      msgType = 'diary';
    }

    // 🌟 线下剧场卡片 — 展开对应楼层范围内的所有线下对话内容
    if (msgType === 'offline') {
      console.log(`%c[buildChatHistoryPrompt] 🎭 offline floor=${msg.floor} 开始解析`, 'color:#fa5bd5');
      // ── 详细调试：打印 msg 关键字段，排查 stageId / stageFloorRange 是否正确传入 ──
      const _c = msg.content && typeof msg.content === 'object' ? msg.content : {};
      console.log(
        `%c  offline msg 元数据：stageId=${msg.stageId || _c.stageId || '❌缺失'} ` +
        `stageTitle="${msg.stageTitle || _c.stageTitle || '?'}" ` +
        `stageFloorRange=${JSON.stringify(msg.stageFloorRange || _c.stageFloorRange || [null,null])}`,
        'color:#fa5bd5'
      );
      console.log('  offline msg.content 完整值:', JSON.stringify(_c).slice(0, 300));
      content = await buildOfflineSegment(db, msg);
      senderName = '系统';
      // ✅ offline 内容已经是完整展开的多行文本（含 ========== 分隔符），
      //    直接 push，不加 [系统|时间|offline] 包装，避免破坏格式
      historyPrompts.push(content);
      continue;

    // 🌟 日记转发 — 解析 <diary=日记内容|批注汇总>，实时补全已有批注 + 作者 + 标题
    } else if (msgType === 'diary') {
      console.log(`%c[buildChatHistoryPrompt] 📓 diary floor=${msg.floor} 开始解析`, 'color:#d4ff4d');
      const { diaryText, annotationText } = parseDiaryContent(content);
      const { annsSummary, authorName, diaryTitle } = await fetchExistingAnnotations(db, diaryText);
      console.log('  diaryText(前50):', diaryText.substring(0, 50));
      console.log('  fetchAnnotations →', { diaryTitle, authorName, annsSummary: annsSummary.substring(0, 60) });
      const titlePart  = diaryTitle  ? `\n【日记标题】${diaryTitle}`  : '';
      const authorPart = authorName  ? `\n【日记作者】${authorName}`  : '';
      const annPart    = annsSummary
        ? `\n【已有批注】${annsSummary}`
        : annotationText ? `\n【批注】${annotationText}` : '';
      content = `${senderName}转发了一条日记${titlePart}${authorPart}\n【日记详情】${diaryText}${annPart}`;
      console.log('%c  → 最终 diary 条目:\n' + content, 'color:#43d9a0');
      senderName = '系统';

    // 🌟 日记批注 — 自动修正占位文本 + 实时补全已有批注 + 标题
    } else if (msgType === 'diary_annotation') {
      console.log(`%c[buildChatHistoryPrompt] 💬 diary_annotation floor=${msg.floor} 开始解析`, 'color:#d4ff4d');
      const parsed = parseDiaryAnnotation(content);
      const { diaryText, isDirect, quotedAnn } = parsed;
      let annText = isDirect ? parsed.replyText || parsed.annotationText : parsed.replyText;

      // ① 如果存的是占位文本，向后查找同一日记的下一条批注记录作为最新内容
      if (isDirect) {
        annText = resolveLatestAnnotationText(msg, allSorted, diaryText, annText);
      }

      // ① 从 IDB 实时读取该日记已有的全部批注 + 作者 + 标题
      const { annsSummary: existingAnns, authorName: diaryAuthor, diaryTitle } = await fetchExistingAnnotations(db, diaryText);
      const existingPart = existingAnns  ? `\n【已有批注】${existingAnns}` : '';
      const authorPart   = diaryAuthor   ? `\n【日记作者】${diaryAuthor}`  : '';
      const titlePart    = diaryTitle    ? `\n【日记标题】${diaryTitle}`   : '';
      console.log('  fetchAnnotations →', { diaryTitle, diaryAuthor, existingAnns: existingAnns.substring(0, 60) });

      if (isDirect) {
        content = `${senderName}批注了日记${titlePart}${authorPart}\n【日记原文】${diaryText}\n【本次批注】${annText}${existingPart}`;
      } else {
        content = `${senderName}回复了评论${titlePart}${authorPart}\n【被回复的批注】${quotedAnn}\n【回复内容】${annText}\n【日记原文】${diaryText}${existingPart}`;
      }
      console.log('%c  → 最终 diary_annotation 条目:\n' + content, 'color:#43d9a0');
      senderName = '系统';

    // 🌟 针对文件类型的特殊处理：拆包并读取文本内容
    } else if (msgType === 'file' && content && content.files) {
      let fileDetails = [];
      for (const f of content.files) {
        let fileStr = `[文件名: ${f.name}]`;
        const isTextFile =
          f.type.includes('text') || f.type.includes('json') || f.name.endsWith('.txt') || f.name.endsWith('.md');
        if (isTextFile && f.blob instanceof Blob) {
          try {
            const textContent = await f.blob.text();
            fileStr += `\n--- ${f.name} 内容开始 ---\n${textContent}\n--- ${f.name} 内容结束 ---`;
          } catch (e) {
            fileStr += `\n(读取文件内容失败)`;
          }
        } else {
          fileStr += `\n(非文本文件或无文本内容，无法直接读取)`;
        }
        fileDetails.push(fileStr);
      }
      content = fileDetails.join('\n\n');

    // 🌟 核心修改：针对其他对象类型，严格按照 Prompt 规则拆解为自然字符串！禁止传 JSON！
    } else if (content && typeof content === 'object') {
      if (msgType === 'voice') {
        content = content.transcript || '';
      } else if (msgType === 'image') {
        content = content.text || '';
      } else if (msgType === 'transfer') {
        content = `${content.amount || '0.00'}|${content.note || ''}`;
      } else if (msgType === 'location') {
        content = content.location || '';
      } else if (msgType === 'gacha_pull') {
        // 🌟 祈月台抽卡记录 — 展开完整卡面详情 + char 视角叙事提示
        const c = content;
        const rarity      = c.cardRarity    || '?';
        const identity    = c.cardIdentity  || '未知命轨';
        const outfit      = c.cardOutfit    || '';
        const prop        = c.cardProp      || '';
        const world       = c.cardWorld     || '';
        const story       = c.cardStory     || '';
        const whoDrawn    = c.charName      || senderName;

        // ── 判断卡面归属，给 AI 角色视角提示 ──
        //   如果 identity / outfit / story 含有 char 自己的名字 → 自画像卡
        //   如果含有常见 user 指代词            → user 卡
        //   否则                               → 普通卡
        const selfKeywords = [charName, '自己', '本体'];
        const userKeywords = ['user', 'User', userName, '主人', '你'];
        const textToCheck  = `${identity} ${outfit} ${story}`;

        let perspectiveHint = '';
        if (selfKeywords.some(k => k && textToCheck.includes(k))) {
          perspectiveHint = `\n[叙事视角提示] 这张卡描绘的是 ${whoDrawn} 自身形象/处境。${whoDrawn} 看到这张卡时可能感到荒诞、难以置信或情绪复杂（如抗拒、尴尬、自嘲），可在后续对话中自然流露，但无需过度渲染，抽卡只是引子，生活仍在继续。`;
        } else if (userKeywords.some(k => k && textToCheck.includes(k))) {
          perspectiveHint = `\n[叙事视角提示] 这张卡与 ${userName}（user）相关。${whoDrawn} 看到时可能产生联想、心绪微动或想起某件事，可以在后续对话中不经意提及，但不必专门解释，保持自然即可。`;
        } else {
          const rarityReaction = {
            'SSS': `意外之喜，可能忍不住小小得意一下`,
            'UR':  `还不错，算是今日运气不差`,
            'SSR': `勉强满意，但也不至于大惊小怪`,
            'SR':  `平平无奇，接受现实`,
            'R':   `有点无语，可以悄悄吐槽一句`,
          };
          const react = rarityReaction[rarity] || '反应平淡，无特别感想';
          perspectiveHint = `\n[叙事视角提示] 这是一张 ${rarity} 卡，${whoDrawn} 的心理反应参考：${react}。可在后续对话中自然带过，无需专门讨论抽卡。`;
        }

        // ── 拼接完整卡面信息 ──
        const lines = [
          `${whoDrawn} 在祈月台抽到了一张命轨卡`,
          `【稀有度】${rarity}`,
          `【命轨身份】${identity}`,
        ];
        if (outfit) lines.push(`【服装/状态】${outfit}`);
        if (prop)   lines.push(`【持有道具】${prop}`);
        if (world)  lines.push(`【所在世界/时代背景】${world}`);
        if (story)  lines.push(`【命轨故事片段】${story}`);
        lines.push(perspectiveHint);

        content  = lines.join('\n');
        senderName = '系统';
        console.log(`%c[buildChatHistoryPrompt] 🎴 gacha_pull floor=${msg.floor} rarity=${rarity} identity=${identity}`, 'color:#f6c90e');
      } else if (msgType === 'gift') {
        content = `${content.item || ''}|${content.note || ''}`;
      } else if (msgType === 'sticker') {
        // 🌟🌟🌟 表情包"断头"修复逻辑 🌟🌟🌟
        let rawName = content.name || '表情包';
        let cleanName = rawName
          .split(/http/i)[0]
          .replace(/[:：|]\s*$/, '')
          .replace(/\.(jpg|jpeg|gif|png|webp)$/i, '')
          .trim();
        let stickerUrl = content.url || '';
        if (stickerUrl.startsWith('//')) stickerUrl = 'https:' + stickerUrl;
        content = stickerUrl ? `${cleanName}|${stickerUrl}` : cleanName;
      } else if (msgType === 'call') {
        const callType  = content.callType === 'video' ? '视频通话' : '语音通话';
        const callState = content.callState || 'ringing';
        const duration  = content.duration  || 0;    // 秒数（user 挂断时存入）
        const answeredAt = content.answeredAt || null; // 接通时间戳

        // 格式化秒数为 MM:SS
        function _fmtCallDur(sec) {
          const m = Math.floor(sec / 60), s = sec % 60;
          return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }

        // 正在通话中（answered 且无配对 ended）：计算实时已通话时长
        let stateLabel;
        if (callState === 'answered') {
          if (answeredAt) {
            const elapsedSec = Math.max(0, Math.floor((Date.now() - answeredAt) / 1000));
            stateLabel = `正在通话中（已通话 ${_fmtCallDur(elapsedSec)}）`;
          } else {
            stateLabel = '正在通话中';
          }
        } else if (callState === 'ended') {
          stateLabel = duration > 0 ? `已结束（通话时长 ${_fmtCallDur(duration)}）` : '已结束';
        } else if (callState === 'canceled') {
          stateLabel = msg.senderRole === 'user' ? '已取消（用户撤销）' : '已取消（角色撤销）';
        } else if (callState === 'missed') {
          // ★ missed — renderHistoryBubble 重进页面时将 ringing 升级为此状态
          // 表示 AI 曾发出邀请但用户始终未接听，属于终态
          stateLabel = msg.senderRole === 'char' ? '未接听（用户未接）' : '未接听（角色未接）';
        } else {
          // ringing — DB 里仍为 ringing，说明尚未经过 renderHistoryBubble 的 missed 升级
          // （正常情况下重进页面后都会被升级为 missed；极少数情况下可能刚写库还没刷新）
          // 策略：只查找紧邻该 floor 之后的第一条 call 记录，判断是否是本次通话的接听记录
          // 不跨越多条 call 进行全局匹配，避免把不同次通话的 answered 误判为「已接听」
          const nextCall = allSorted.find(
            m => m.floor > msg.floor && m.type === 'call'
          );
          const thisCallAnswered = nextCall
            && (nextCall.content?.callState === 'answered' || nextCall.content?.callState === 'ended')
            && nextCall.content?.callType === content.callType; // 同一通话类型（voice/video）

          if (thisCallAnswered) {
            stateLabel = msg.senderRole === 'user' ? '呼出中（已接听）' : '呼入中（已接听）';
          } else if (msg.senderRole === 'user') {
    // ★ 修复：user 主动发出的通话，仍在振铃，AI 还没有机会接或拒绝
    stateLabel = '呼出中（振铃中，等待接听）';   // ← 改这里
  } else {
    stateLabel = '未接听（用户未接）';
  }
        }

        msgType = content.callType === 'video' ? 'video_call' : 'voice_call';
        content = `${callType}·${stateLabel}`;
      } else if (msgType === 'camera') {
        content = `[发送了${content.urls?.length || 0}张照片]`;
      } else {
        try {
          content = JSON.stringify(content);
        } catch (e) {
          content = '';
        }
      }
    }

    // 三种模式：剧情时间 > 真实时间戳 > 无时间
    if (storyTimeEnabled && baseTs !== null) {
      let displayTs;
      if (msg.storyTimestamp) {
        // ✅ 新消息：直接用存库时写入的剧情时间戳
        displayTs = msg.storyTimestamp;
      } else {
        // ✅ 旧消息（没有storyTimestamp）：降级用真实时间相对最早消息的偏移来估算
        // 这样旧消息从Day1开始，按真实时间间隔排列，不改库
        const earliestTs = allSorted.length > 0 ? (allSorted[0].timestamp || msg.timestamp) : msg.timestamp;
        displayTs = baseTs + (msg.timestamp - earliestTs);
      }
      historyPrompts.push(`[${senderName}|${formatStoryTime(displayTs, baseTs)}|${msgType}] ${content}`);
    } else if (timestampEnabled) {
      historyPrompts.push(`[${senderName}|${formatTime(msg.timestamp)}|${msgType}] ${content}`);
    } else {
      historyPrompts.push(`[${senderName}|${msgType}] ${content}`);
    }
  }

  return historyPrompts;
}

/**
 * ── 调试启动 ──
 */
(async function initAndDebug() {
  console.clear();
  console.log('%c🚀 [Tsukimi] 开启调试模式...', 'font-size: 20px; font-weight: bold;');

  try {
    const db = await getDb();
    const allChats = await new Promise(res => {
      const tx = db.transaction(IDB_CONFIG.stores.chats, 'readonly');
      const req = tx.objectStore(IDB_CONFIG.stores.chats).getAll();
      req.onsuccess = () => res(req.result || []);
    });

    if (allChats.length === 0) return console.error('无聊天数据');

    // 💡 智能过滤：为了防止再踩到"幽灵"聊天室的坑，我们找一个确保 charIds 有效的聊天室
    const targetChat = allChats.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const mockMsg = '测试一下 pre1 和 aft2 关键词能不能触发';

    // ✅ 新增参数：将 targetChat.userId 传进去
    const personaResults = await assembleCharacterPrompts(targetChat.charIds, mockMsg, targetChat.userId);

    // 运行 Step 2
    const finalPrompts = await buildFinalPromptStream(
      targetChat.charIds,
      personaResults,
      10,
      'Online',
      mockMsg,
      targetChat.id,
    );

    console.log('%c══════════ FINAL OUTPUT ══════════', 'color: #d4ff4d; font-weight: bold;');
    // finalPrompts.forEach((p, i) => console.log(`[#${i + 1}]`, p));
  } catch (err) {
    console.error('致命错误:', err);
  }
})();
