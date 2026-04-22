/**
 * Tsukimi 提示词管理调试脚本 - 全链路监控版
 * v4.2: diary/diary_annotation 解析 + 批注内容自动更新 + 已有批注注入
 */

const IDB_CONFIG = {
  name: 'tsukiphonepromax',
  stores: {
    chars: 'chars',
    users: 'users',
    chats: 'chats',
    messages: 'messages',
    worldbook: 'worldbook',
  },
};

// ---------------- 基础工具函数 ----------------

async function getDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_CONFIG.name);
    request.onsuccess = () => resolve(request.result);
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
      const charUser = await dbGet(IDB_CONFIG.stores.users, char.bindId);
      if (charUser) {
        const ownerStr = `[Character Owner: ${charUser.name}]\nOwner Persona: ${charUser.persona || 'None'}`;
        console.log(`%c    [拼接 绑定主人] ->\n${ownerStr}`, 'color: #ff9f43;');
        charSegment.push(ownerStr);
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

  async function getGlobalWb(key) {
    const data = await dbGet(IDB_CONFIG.stores.worldbook, key);
    return Array.isArray(data) ? data : [];
  }

  const pushWbWithLog = (list, label) => {
    const filtered = list
      .filter(
        item =>
          item.enabled &&
          (!item.category || item.category === '所有' || item.category === category) &&
          isKeywordTriggered(latestMessage, item.keys),
      )
      .sort(sortByPriority);
    console.log(`  - [${label}] 触发: ${filtered.length} 条`);
    filtered.forEach(item => {
      console.log(`%c    [注入 ${label} 内容] ->\n${item.content}`, 'color: #a78bfa;');
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
    console.log(`%c    [注入 局部 Wb] ->\n${item.content}`, 'color: #a78bfa;');
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

  const user = await dbGet(IDB_CONFIG.stores.users, chat.userId);
  const userName = user ? user.name : 'User';
  const char = await dbGet(IDB_CONFIG.stores.chars, chat.charIds[0]);
  const charName = char ? char.name : 'Char';

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

  for (const msg of targetMessages) {
    let senderName = msg.senderRole === 'user' ? userName : msg.senderRole === 'char' ? charName : '系统';
    let content = msg.content;
    let msgType = msg.type;

    // 🌟 兜底：content 字符串以 <diary= 开头时，强制按 diary 类型处理（防止 type 字段值异常）
    const cStr = typeof content === 'string' ? content : '';
    if (cStr.startsWith('<diary=') && msgType !== 'diary' && msgType !== 'diary_annotation') {
      console.warn(`[buildChatHistoryPrompt] floor=${msg.floor} type="${msg.type}" 兜底修正为 diary`);
      msgType = 'diary';
    }

    // 🌟 日记转发 — 解析 <diary=日记内容|批注汇总>，实时补全已有批注 + 作者 + 标题
    if (msgType === 'diary') {
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
        msgType = content.callType === 'video' ? 'video_call' : 'voice_call';
        content = content.callType === 'video' ? '视频通话邀请' : '语音通话邀请';
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

    // 格式：[角色/用户名/系统消息|时间|消息类别] 消息完整内容
    historyPrompts.push(`[${senderName}|${formatTime(msg.timestamp)}|${msgType}] ${content}`);
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
