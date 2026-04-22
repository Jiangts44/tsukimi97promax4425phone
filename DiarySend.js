/**
 * DiarySend.js  v2.0
 * Tsukimi · AI 日记生成引擎
 * ──────────────────────────────────────────────────────────────────────
 *  v2 新增：
 *  ① 注入 ann-style-6~11（拼贴/胶带/宝丽来/打字机/荧光/机密）
 *  ② AI 可返回 accentColor 自定义批注配色（CSS 变量注入）
 *  ③ 提示词描述所有 12 种批注样式，AI 自行选择并可指定 accentColor
 *  ④ AI 返回带 d-* 行内格式化类的 HTML 日记正文
 *  ⑤ 注入改善后的阅读排版（Fraunces 字体·首字下沉·段落缩进）
 *  ⑥ 自动 patch window.buildAnnCard 以应用 accentColor CSS 变量
 * ──────────────────────────────────────────────────────────────────────
 *  接入（diary.html </body> 前）：
 *  <script src="PromptHelper.js"></script>
 *  <script src="DiarySend.js"></script>
 * ──────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     §0  CSS 注入 — 新批注样式 6-11 + 日记阅读排版
  ══════════════════════════════════════════════════════════════════ */

  function injectStyles() {
    if (document.getElementById('__diary-send-styles__')) return;
    const s = document.createElement('style');
    s.id = '__diary-send-styles__';
    s.textContent = `

/* ───────── STYLE 6 · 拼贴碎纸 collage fragment ───────── */
.ann-style-6 .ann-bubble {
  background: #fff;
  border: none; border-radius: 2px;
  padding: 13px 15px 15px;
  box-shadow: 3px 4px 0 rgba(0,0,0,.14), -1px -1px 0 rgba(0,0,0,.05);
  transform: rotate(-2deg);
  position: relative; overflow: hidden;
}
.ann-style-6 .ann-bubble::before {
  content: '';
  position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg,
    transparent 0, transparent 19px,
    rgba(0,0,0,.042) 19px, rgba(0,0,0,.042) 20px);
  pointer-events: none;
}
.ann-style-6 .ann-bubble::after {
  content: ''; position: absolute; top:0;left:0;right:0; height:3px;
  background: var(--ann-accent, #c87850); opacity:.4;
}
.ann-style-6 .ann-text      { font-family:'Fraunces',serif; font-style:italic; font-size:12px; line-height:1.78; color:#1a1210; position:relative; z-index:1; }
.ann-style-6 .ann-quote-ref { font-family:'Geist Mono',monospace; font-size:8px; color:var(--ann-accent,#9a6840); display:block; margin-bottom:7px; border-left:2px solid var(--ann-accent,#c87850); padding-left:7px; position:relative; z-index:1; }
.ann-style-6 .ann-av   { background:#f5e6d0; border:2px solid #d8c0a0; color:#7a4a28; }
.ann-style-6 .ann-name { color:#5a3018; }

/* ───────── STYLE 7 · 和纸胶带 washi tape ───────── */
.ann-style-7 .ann-bubble {
  background: var(--ann-accent, rgba(212,255,77,.28));
  border: none; border-radius: 2px;
  padding: 11px 20px; position: relative;
  transform: rotate(.6deg);
  box-shadow: 1px 2px 6px rgba(0,0,0,.07);
}
.ann-style-7 .ann-bubble::before,
.ann-style-7 .ann-bubble::after {
  content: ''; position: absolute; top:0; bottom:0; width:9px;
  background: inherit; opacity:.65;
}
.ann-style-7 .ann-bubble::before { left:-6px;  border-radius:2px 0 0 2px; transform:skewY(-1deg); }
.ann-style-7 .ann-bubble::after  { right:-6px; border-radius:0 2px 2px 0; transform:skewY( 1deg); }
.ann-style-7 .ann-text      { font-family:'Geist',sans-serif; font-size:11px; line-height:1.65; color:rgba(10,10,10,.83); font-weight:500; }
.ann-style-7 .ann-quote-ref { font-family:'Geist Mono',monospace; font-size:8px; color:rgba(10,10,10,.46); margin-bottom:5px; display:block; font-style:italic; }
.ann-style-7 .ann-av   { background:rgba(10,10,10,.1); border:2px solid rgba(10,10,10,.12); color:rgba(10,10,10,.5); }
.ann-style-7 .ann-name { color:rgba(10,10,10,.55); }

/* ───────── STYLE 8 · 宝丽来底注 polaroid caption ───────── */
.ann-style-8 .ann-bubble {
  background: white; border: none; border-radius: 2px;
  padding: 13px 13px 28px;
  box-shadow: 0 4px 14px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.09);
  position: relative; transform: rotate(1.4deg);
}
.ann-style-8 .ann-bubble::after {
  content: ''; position: absolute; bottom:0;left:0;right:0; height:20px;
  background: var(--ann-accent, rgba(245,158,11,.16));
  border-top: 1px solid rgba(0,0,0,.05);
}
.ann-style-8 .ann-text      { font-family:'Fraunces',serif; font-style:italic; font-size:12px; line-height:1.72; color:#1a1210; }
.ann-style-8 .ann-quote-ref { font-family:'Geist Mono',monospace; font-size:8px; color:#9a8878; margin-bottom:7px; display:inline-block; }
.ann-style-8 .ann-av   { background:#f5f0e8; border:2px solid #e0d8c8; color:#7a7060; }
.ann-style-8 .ann-name { color:#4a4038; }

/* ───────── STYLE 9 · 打字机卡片 typewriter ───────── */
.ann-style-9 .ann-bubble {
  background: #faf8f4;
  border: 1.5px solid rgba(10,10,10,.2); border-radius: 0;
  padding: 12px 14px; position: relative;
  box-shadow: 2px 2px 0 rgba(10,10,10,.1), 4px 4px 0 rgba(10,10,10,.04);
}
.ann-style-9 .ann-bubble::before {
  content: ''; position: absolute; top:5px;left:5px;right:5px;bottom:5px;
  border: 1px dashed rgba(10,10,10,.07); pointer-events:none;
}
.ann-style-9 .ann-text      { font-family:'Geist Mono',monospace; font-size:11.5px; line-height:1.85; color:#1a1410; letter-spacing:.025em; }
.ann-style-9 .ann-quote-ref { font-family:'Geist Mono',monospace; font-size:8px; color:rgba(10,10,10,.4); margin-bottom:7px; display:block; letter-spacing:.05em; }
.ann-style-9 .ann-av   { background:#f0ece5; border:2px solid rgba(10,10,10,.18); color:rgba(10,10,10,.5); border-radius:3px; }
.ann-style-9 .ann-name { color:rgba(10,10,10,.55); letter-spacing:.03em; }

/* ───────── STYLE 10 · 荧光高亮块 fluorescent marker ───────── */
.ann-style-10 .ann-bubble {
  background: transparent; border:none; padding: 11px 15px; position: relative;
}
.ann-style-10 .ann-bubble::before {
  content: ''; position: absolute; inset: 2px;
  background: var(--ann-accent, rgba(212,255,77,.52));
  transform: skewX(-2deg) rotate(-.3deg);
  z-index: 0; border-radius: 2px;
}
.ann-style-10 .ann-av-row    { position:relative; z-index:1; }
.ann-style-10 .ann-text      { font-family:'Geist',sans-serif; font-size:13px; line-height:1.65; color:rgba(10,10,10,.9); font-weight:600; position:relative; z-index:1; }
.ann-style-10 .ann-quote-ref { font-family:'Geist Mono',monospace; font-size:8px; color:rgba(10,10,10,.48); margin-bottom:5px; display:block; position:relative; z-index:1; }
.ann-style-10 .ann-av   { background:rgba(10,10,10,.1); border:2px solid rgba(10,10,10,.13); color:rgba(10,10,10,.55); position:relative; z-index:1; }
.ann-style-10 .ann-name { color:rgba(10,10,10,.65); position:relative; z-index:1; }

/* ───────── STYLE 11 · 机密文件 classified ───────── */
.ann-style-11 .ann-bubble {
  background: #0c0c18;
  border: 1px solid rgba(255,107,107,.22); border-radius: 6px;
  padding: 14px 14px 12px; position: relative; margin-top: 10px;
  box-shadow: 0 0 0 1px rgba(255,107,107,.07), inset 0 1px 0 rgba(255,255,255,.04);
}
.ann-style-11 .ann-bubble::before {
  content: '▓ CLASSIFIED · EYES ONLY ▓';
  position: absolute; top:-9px; left:50%; transform:translateX(-50%);
  font-family:'Geist Mono',monospace; font-size:7px; letter-spacing:.1em;
  background: var(--ann-accent, #ff6b6b); color:white;
  padding: 1px 10px; border-radius:3px; white-space:nowrap;
}
.ann-style-11 .ann-text      { font-family:'Geist Mono',monospace; font-size:11px; line-height:1.75; color:rgba(255,150,150,.9); }
.ann-style-11 .ann-quote-ref { font-family:'Geist Mono',monospace; font-size:8px; color:rgba(255,107,107,.5); margin-bottom:7px; display:block; background:rgba(255,107,107,.08); padding:2px 7px; border-radius:3px; }
.ann-style-11 .ann-av   { background:rgba(255,107,107,.1); border:2px solid rgba(255,107,107,.28); color:#ff6b6b; }
.ann-style-11 .ann-name { color:rgba(255,107,107,.78); }

/* ══════════════════════════════════════════════
   日记阅读排版优化
══════════════════════════════════════════════ */
.ep-scroll { -webkit-font-smoothing: antialiased; }

.ep-title {
  font-size: 32px !important;
  letter-spacing: -.018em !important;
  line-height: 1.12 !important;
  margin-bottom: 8px !important;
}
.ep-ctx {
  letter-spacing: .07em !important;
  opacity: .58;
  margin-bottom: 28px !important;
}
.ep-body {
  font-family: 'Fraunces', serif !important;
  font-size: 14px !important;
  line-height: 1.6 !important;
  font-weight: 300 !important;
  letter-spacing: .008em;
}
.ep-body p { margin-bottom: 1.2em !important; }
.ep-body p + p { text-indent: 1.4em; }

/* 首字下沉 */
.ep-body p:first-of-type::first-letter {
  font-family: 'Fraunces', serif;
  font-size: 3.5em; font-weight: 800; font-style: italic;
  line-height: .72; float: left;
  margin-right: .08em; margin-bottom: -.06em;
}
.entry-panel.ps-0 .ep-body p:first-of-type::first-letter { color: var(--lime); opacity: .75; }
.entry-panel.ps-1 .ep-body p:first-of-type::first-letter { color: var(--amber); }
.entry-panel.ps-2 .ep-body p:first-of-type::first-letter { color: var(--purple); }

/* d-* 在 Fraunces 环境微调 */
.ep-body .d-blackout { border-radius: 3px; }
.ep-body .d-cw       { opacity: .3; }

/* 分隔符美化 */
.ep-div     { margin: 34px 0 !important; }
.ep-div-txt { font-size: 15px !important; letter-spacing: .45em !important; opacity: .28; }

/* 批注面板行高 */
.ann-body { gap: 0; }

    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════════
     §1  IDB
  ══════════════════════════════════════════════════════════════════ */

  const IDB_NAME = 'tsukiphonepromax';
  let _db = null;

  function openDb() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const SCHEMA = {
        config: { keyPath: 'id' },
        chars: { keyPath: 'id' },
        users: { keyPath: 'id' },
        chats: { keyPath: 'id' },
        messages: { keyPath: ['chatId', 'floor'] },
        worldbook: null,
        diaries: { keyPath: 'id' },
      };
      const probe = indexedDB.open(IDB_NAME);
      probe.onsuccess = e => {
        const db = e.target.result,
          ver = db.version;
        const miss = Object.keys(SCHEMA).filter(n => !db.objectStoreNames.contains(n));
        if (!miss.length) {
          _db = db;
          _db.onversionchange = () => {
            _db.close();
            _db = null;
          };
          resolve(_db);
          return;
        }
        db.close();
        const up = indexedDB.open(IDB_NAME, ver + 1);
        up.onupgradeneeded = ev => {
          const u = ev.target.result;
          miss.forEach(n => {
            const o = SCHEMA[n];
            o ? u.createObjectStore(n, o) : u.createObjectStore(n);
          });
        };
        up.onsuccess = ev => {
          _db = ev.target.result;
          _db.onversionchange = () => {
            _db.close();
            _db = null;
          };
          resolve(_db);
        };
        up.onerror = ev => reject(ev.target.error);
      };
      probe.onerror = e => reject(e.target.error);
    });
  }
  async function idbGet(store, key) {
    if (key == null) return null;
    const db = await openDb();
    return new Promise(r => {
      try {
        const q = db.transaction(store, 'readonly').objectStore(store).get(key);
        q.onsuccess = e => r(e.target.result || null);
        q.onerror = () => r(null);
      } catch (e) {
        r(null);
      }
    });
  }
  async function idbGetAll(store) {
    const db = await openDb();
    return new Promise(r => {
      try {
        const q = db.transaction(store, 'readonly').objectStore(store).getAll();
        q.onsuccess = e => r(e.target.result || []);
        q.onerror = () => r([]);
      } catch (e) {
        r([]);
      }
    });
  }
  async function idbPut(store, rec) {
    const db = await openDb();
    return new Promise((res, rej) => {
      try {
        const q = db.transaction(store, 'readwrite').objectStore(store).put(rec);
        q.onsuccess = () => res();
        q.onerror = e => rej(e.target.error);
      } catch (e) {
        rej(e);
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     §2  日记设置
  ══════════════════════════════════════════════════════════════════ */

  const KEY_SETTINGS = 'diary_api_settings';
  const DEF_SETTINGS = { id: KEY_SETTINGS, systemPromptAddition: '', diaryHistoryCount: 0 };
  async function loadDiarySettings() {
    const s = await idbGet('config', KEY_SETTINGS);
    return s ? { ...DEF_SETTINGS, ...s } : { ...DEF_SETTINGS };
  }
  async function saveDiarySettings(settings = {}) {
    await idbPut('config', { ...DEF_SETTINGS, ...settings, id: KEY_SETTINGS });
  }

  /* ══════════════════════════════════════════════════════════════════
     §3  API 配置
  ══════════════════════════════════════════════════════════════════ */

  async function loadApiConfig() {
    const D = { apiKey: '', baseUrl: '', model: 'gpt-4o', maxTokens: 4096, temperature: 0.9 };
    try {
      const mc = await idbGet('config', 'main_config');
      if (!mc) return D;
      const api = mc.api || {};
      let cfg = api.temp || {};
      if (api.activePreset && api.presets?.[api.activePreset]) cfg = api.presets[api.activePreset];
      return {
        apiKey: cfg.key || D.apiKey,
        baseUrl: cfg.url || D.baseUrl,
        model: cfg.model || D.model,
        temperature: parseFloat(cfg.temp || D.temperature),
        maxTokens: parseInt(cfg.maxTokens || D.maxTokens, 10),
      };
    } catch (e) {
      return D;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     §4  工具函数
  ══════════════════════════════════════════════════════════════════ */

  const CF = ['charId', 'characterId', 'char_id', 'roleId', 'character', 'charID', 'char'];
  const CIF = ['charIds', 'characterIds', 'char_ids'];
  function isKwTriggered(text, keys) {
    if (!keys || !keys.trim()) return true;
    return keys
      .split(/[,，]/)
      .map(k => k.trim().toLowerCase())
      .filter(Boolean)
      .some(k => (text || '').toLowerCase().includes(k));
  }
  const sortPri = (a, b) => Number(b.priority || 100) - Number(a.priority || 100);
  function fmtTs(ts) {
    const d = new Date(ts),
      W = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${W[d.getDay()]}`;
  }
  function isGroup(chat) {
    return (
      chat.type === 'group' ||
      (Array.isArray(chat.charIds) && chat.charIds.length > 1) ||
      (Array.isArray(chat.characterIds) && chat.characterIds.length > 1)
    );
  }
  function ensureHtml(t) {
    if (!t) return '';
    const s = String(t).trim();
    return /<[a-zA-Z]/.test(s)
      ? s
      : s
          .split(/\n{2,}/)
          .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
          .join('');
  }
  async function getWb(key) {
    const d = await idbGet('worldbook', key);
    return Array.isArray(d) ? d : [];
  }

  /* ══════════════════════════════════════════════════════════════════
     §5  聊天历史构建
  ══════════════════════════════════════════════════════════════════ */

  /* ── §5.0  日记消息解析工具（同步自 PromptHelper.js） ────────────── */

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
   * 引用回复: <diary=日记内容|被引用批注原文｜新回复>  ← 全角竖线 ｜(U+FF5C) 分隔
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
   * 从 IDB diaries + config 表读取某日记的已有批注摘要
   * 通过 diaryText 前 30 字反查日记条目，再从 config 表取 annotations_<id>
   */
  async function fetchExistingAnnotations(diaryText) {
    try {
      const db = await openDb();
      const diaryEntry = await new Promise(resolve => {
        try {
          const q = db.transaction('diaries', 'readonly').objectStore('diaries').getAll();
          q.onsuccess = () => {
            const kw = diaryText.substring(0, 30);
            resolve((q.result || []).find(d => (d.content || '').includes(kw)) || null);
          };
          q.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      if (!diaryEntry) return { annsSummary: '', authorName: '', diaryTitle: '' };

      const diaryTitle = diaryEntry.title || '';
      let authorName = '';
      if (diaryEntry.charId) {
        const authorChar = await idbGet('chars', diaryEntry.charId);
        if (authorChar) authorName = authorChar.name || '';
      }
      const annRecord = await idbGet('config', 'annotations_' + diaryEntry.id);
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
      return { annsSummary: '', authorName: '', diaryTitle: '' };
    }
  }

  /**
   * 如果存入时的 annotationText 是占位文本，
   * 则向后查找同一日记的下一条 diary_annotation，取其 annotationText 作为最新内容
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
    return annotationText;
  }

  /* ────────────────────────────────────────────────────────────────── */

  async function buildHistory(chatId, hc) {
    /* ══ §5.1  DiarySend 内置聊天历史构建 ══
       · 直接读取 msg.type（不做 content 文本匹配兜底）
       · diary / diary_annotation 全量解析
       · 所有步骤均打印控制台日志，方便排查
    */
    console.group(
      `%c[DiarySend.buildHistory] chatId=${chatId} hc=${hc === 0 ? '全部' : hc}`,
      'color:#d4ff4d;font-weight:bold;background:#0a0a14;padding:1px 8px;border-radius:3px',
    );

    if (!chatId) {
      console.log('  chatId 为空 → 返回 []');
      console.groupEnd();
      return [];
    }

    const chat = await idbGet('chats', chatId);
    if (!chat) {
      console.warn('  找不到聊天室:', chatId);
      console.groupEnd();
      return [];
    }
    console.log('  chat:', { id: chat.id, title: chat.title, userId: chat.userId });

    // ── 用户名 ──
    const user  = chat.userId ? await idbGet('users', chat.userId) : null;
    const uName = user ? user.name || 'User' : 'User';

    // ── 角色名映射（兼容 charIds / charId 等多种存法）──
    const cids = [];
    for (const f of CIF) {
      if (Array.isArray(chat[f]) && chat[f].length) { chat[f].forEach(id => cids.push(id)); break; }
    }
    if (!cids.length) {
      for (const f of CF) { if (chat[f]) { cids.push(chat[f]); break; } }
    }
    const cNames = {};
    for (const id of cids) {
      const ch = await idbGet('chars', id);
      if (ch) cNames[id] = ch.name || 'Char';
    }
    const defC = cids.length ? cNames[cids[0]] || 'Char' : 'Char';
    console.log(`  uName="${uName}"  cids=[${cids.join(',')}]  cNames=`, cNames);

    // ── 拉取全量消息 ──
    const db  = await openDb();
    const all = await new Promise(r => {
      try {
        const q = db.transaction('messages', 'readonly').objectStore('messages').getAll();
        q.onsuccess = e => r((e.target.result || []).filter(m => m.chatId === chatId));
        q.onerror   = () => r([]);
      } catch (e) { r([]); }
    });

    // 全量升序（resolveLatestAnnotationText 需要向后查找）
    const allSorted = all.sort((a, b) => a.floor - b.floor);
    const msgs      = hc > 0 ? allSorted.slice(-hc) : allSorted;
    console.log(`  全量消息 ${allSorted.length} 条，本次处理 ${msgs.length} 条`);

    // 打印每条消息的原始 type，方便确认 IDB 里存的值
    console.groupCollapsed('  📋 原始消息列表（floor / type / senderRole）');
    msgs.forEach(m => console.log(`    floor=${m.floor}  type="${m.type}"  senderRole="${m.senderRole}"  content(前30)=`, typeof m.content === 'string' ? m.content.substring(0, 30) : m.content));
    console.groupEnd();

    const out = [];

    for (const m of msgs) {
      let sn = m.senderRole === 'user'
        ? uName
        : m.senderRole === 'char'
          ? (m.charId && cNames[m.charId]) || defC
          : '系统';
      let c = m.content;
      const t = m.type; // ← 直接读 IDB 存的 type，不做文本匹配

      console.group(`  ▶ floor=${m.floor}  type="${t}"  senderRole="${m.senderRole}"  sn="${sn}"`);

      // ── 日记转发 ──────────────────────────────────────────────────
      if (t === 'diary') {
        console.log('    → 走 diary 分支');
        const { diaryText, annotationText } = parseDiaryContent(c);
        console.log('    diaryText(前80):', diaryText.substring(0, 80));
        const { annsSummary, authorName, diaryTitle } = await fetchExistingAnnotations(diaryText);
        console.log('    fetchAnnotations →', { diaryTitle, authorName, annsSummary: annsSummary.substring(0, 80) });
        const titlePart  = diaryTitle  ? `\n【日记标题】${diaryTitle}`  : '';
        const authorPart = authorName  ? `\n【日记作者】${authorName}`  : '';
        const annPart    = annsSummary
          ? `\n【已有批注】${annsSummary}`
          : annotationText ? `\n【批注】${annotationText}` : '';
        c  = `${sn}转发了一条日记${titlePart}${authorPart}\n【日记详情】${diaryText}${annPart}`;
        sn = '系统';
        console.log('%c    最终内容(前120):\n' + c.substring(0, 120), 'color:#43d9a0');

      // ── 日记批注 ──────────────────────────────────────────────────
      } else if (t === 'diary_annotation') {
        console.log('    → 走 diary_annotation 分支');
        const parsed = parseDiaryAnnotation(c);
        const { diaryText, isDirect, quotedAnn } = parsed;
        let annText = isDirect ? parsed.replyText || parsed.annotationText : parsed.replyText;
        console.log('    isDirect:', isDirect, '  annText(前60):', String(annText).substring(0, 60));
        if (isDirect) annText = resolveLatestAnnotationText(m, allSorted, diaryText, annText);
        const { annsSummary: existingAnns, authorName: diaryAuthor, diaryTitle } = await fetchExistingAnnotations(diaryText);
        console.log('    fetchAnnotations →', { diaryTitle, diaryAuthor, existingAnns: existingAnns.substring(0, 60) });
        const existingPart = existingAnns ? `\n【已有批注】${existingAnns}` : '';
        const authorPart   = diaryAuthor  ? `\n【日记作者】${diaryAuthor}`  : '';
        const titlePart    = diaryTitle   ? `\n【日记标题】${diaryTitle}`   : '';
        c = isDirect
          ? `${sn}批注了日记${titlePart}${authorPart}\n【日记原文】${diaryText}\n【本次批注】${annText}${existingPart}`
          : `${sn}回复了评论${titlePart}${authorPart}\n【被回复的批注】${quotedAnn}\n【回复内容】${annText}\n【日记原文】${diaryText}${existingPart}`;
        sn = '系统';
        console.log('%c    最终内容(前120):\n' + c.substring(0, 120), 'color:#43d9a0');

      // ── 文件 ──────────────────────────────────────────────────────
      } else if (t === 'file' && c?.files) {
        c = c.files.map(f => `[文件:${f.name}]`).join(', ');
        console.log('    → file:', c);

      // ── 其他 object 类型 ──────────────────────────────────────────
      } else if (c && typeof c === 'object') {
        const orig = c;
        if      (t === 'voice')    c = c.transcript || '';
        else if (t === 'image')    c = c.text || '[图片]';
        else if (t === 'transfer') c = `${c.amount || '0.00'}|${c.note || ''}`;
        else if (t === 'location') c = c.location || '';
        else if (t === 'gift')     c = `${c.item || ''}|${c.note || ''}`;
        else if (t === 'sticker') {
          const n = (c.name || '表情').split(/http/i)[0].trim();
          const u = c.url ? (c.url.startsWith('//') ? 'https:' : '') + c.url : '';
          c = u ? `${n}|${u}` : n;
        } else if (t === 'call') {
          c = orig.callType === 'video' ? '视频通话邀请' : '语音通话邀请';
        } else if (t === 'camera') {
          c = `[发送了${orig.urls?.length || 0}张照片]`;
        } else {
          try { c = JSON.stringify(c); } catch (_) { c = '[data]'; }
        }
        console.log(`    → object(${t}):`, c);

      // ── 普通文本 ──────────────────────────────────────────────────
      } else {
        console.log(`    → text(${t}): "${String(c).substring(0, 60)}"`);
      }

      const line = `[${sn}|${fmtTs(m.timestamp)}|${t}] ${c}`;
      console.log('    ✅ 输出行:', line.substring(0, 100));
      console.groupEnd();
      out.push(line);
    }

    console.log(`%c  buildHistory 完成，共 ${out.length} 行`, 'color:#43d9a0;font-weight:bold');
    console.groupEnd();
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════
     §6  提示词流
  ══════════════════════════════════════════════════════════════════ */

  async function charStream(charId, userId, chatId, hc, lm) {
    const st = [],
      char = await idbGet('chars', charId),
      user = userId ? await idbGet('users', userId) : null;
    const chat = chatId ? await idbGet('chats', chatId) : null,
      cat = chat ? chat.category || '所有' : '所有';
    const pw = async k =>
      (await getWb(k))
        .filter(
          i => i.enabled && (!i.category || i.category === '所有' || i.category === cat) && isKwTriggered(lm, i.keys),
        )
        .sort(sortPri)
        .forEach(i => st.push(i.content));
    await pw('wb_pre');
    await pw('wb_mid');
    await pw('wb_global');
    if (char) {
      const wb = char.worldbook || [];
      wb.filter(s => s.type === 'pre' && s.enabled && isKwTriggered(lm, s.keys))
        .sort(sortPri)
        .forEach(s => st.push(`[Memory Shard: ${s.title}]\n${s.content}`));
      st.push(`[Character Identification]\nName: ${char.remark ? `${char.name} (备注: ${char.remark})` : char.name}`);
      if (char.persona) st.push(`[Character Persona]\n${char.persona}`);
      if (char.bindId) {
        const o = await idbGet('users', char.bindId);
        if (o) st.push(`[Character Owner: ${o.name}]\nOwner Persona: ${o.persona || 'None'}`);
      }
      wb.filter(s => s.type === 'post' && s.enabled && isKwTriggered(lm, s.keys))
        .sort(sortPri)
        .forEach(s => st.push(`[Author Notes: ${s.title}]\n${s.content}`));
    }
    if (user) st.push(`[Active User in Chat: ${user.name}]\nUser Persona: ${user.persona || 'No persona.'}`);
    (await getWb('wb_local'))
      .filter(i => {
        const b = Array.isArray(i.charIds) ? i.charIds : i.charIds ? [i.charIds] : [];
        return i.enabled && b.includes(charId) && isKwTriggered(lm, i.keys);
      })
      .sort(sortPri)
      .forEach(i => st.push(i.content));
    // 🌟 直接使用内部 buildHistory（自带完整 diary/diary_annotation 解析 + 详细日志）
    const hist = await buildHistory(chatId, hc);
    hist.length
      ? (st.push('\n========== CHAT HISTORY START =========='),
        st.push(...hist),
        st.push('========== CHAT HISTORY END ==========\n'))
      : st.push('\n[System: No chat history available.]\n');
    await pw('wb_post');
    return st;
  }

  async function userStream(userId, chatId, hc, lm) {
    const st = [],
      user = userId ? await idbGet('users', userId) : null;
    const chat = chatId ? await idbGet('chats', chatId) : null,
      cat = chat ? chat.category || '所有' : '所有';
    const pw = async k =>
      (await getWb(k))
        .filter(
          i => i.enabled && (!i.category || i.category === '所有' || i.category === cat) && isKwTriggered(lm, i.keys),
        )
        .sort(sortPri)
        .forEach(i => st.push(i.content));
    await pw('wb_pre');
    await pw('wb_mid');
    await pw('wb_global');
    if (user) {
      st.push(`[User Identity]\nName: ${user.name}`);
      if (user.persona) st.push(`[User Persona]\n${user.persona}`);
    }
    if (chat) {
      const cids = [];
      for (const f of CIF) {
        if (Array.isArray(chat[f]) && chat[f].length) {
          chat[f].forEach(id => cids.push(id));
          break;
        }
      }
      if (!cids.length) {
        for (const f of CF) {
          if (chat[f]) {
            cids.push(chat[f]);
            break;
          }
        }
      }
      for (const id of cids) {
        const c = await idbGet('chars', id);
        if (c) {
          st.push(`[Reference Character: ${c.name}]`);
          if (c.persona) st.push(`Character Persona: ${c.persona}`);
        }
      }
    }
    // 🌟 直接使用内部 buildHistory（自带完整 diary/diary_annotation 解析 + 详细日志）
    const hist = await buildHistory(chatId, hc);
    hist.length
      ? (st.push('\n========== CHAT HISTORY START =========='),
        st.push(...hist),
        st.push('========== CHAT HISTORY END ==========\n'))
      : st.push('\n[System: No chat history available.]\n');
    await pw('wb_post');
    return st;
  }

  /* ══════════════════════════════════════════════════════════════════
     §7  日记生成指令（末尾系统提示，替换 FORMAT_SYSTEM_PROMPT）
  ══════════════════════════════════════════════════════════════════ */

  const DIARY_PROMPT = `
════════════════════ DIARY WRITER MODE ════════════════════
你是角色（或用户）的私人日记代笔者。根据上方提供的人设与聊天记录，生成有情感厚度、排版丰富的日记条目。

【仅返回合法 JSON，禁止 markdown 代码块，禁止前缀/后缀说明。】

支持单角色或多角色输出：
- 单角色：{ "entries": [ {...}, ... ] }
- 多角色：{ "characters": [ { "charId": "...", "charName": "...", "entries": [...] }, ... ] }
  如果 prompt 中包含多个角色信息，请使用多角色格式，每个角色独立输出 entries。
  charId 请照抄 prompt 中 [Character ID] 字段的值，没有则填角色名。

每条 entry 结构：
{
  "type": "chat",
  "title": "（诗意化标题，不要流水账）",
  "date": "YYYY-MM-DD",
  "mood": "从枚举选一个",
  "content": "HTML 正文（见规则②）",
  "annotations": [
    {
      "text": "批注正文",
      "quoteRef": "引用的正文片段",
      "style": 0,
      "accentColor": "#可选hex或rgba色码"
    }
  ]
}

════════ ① MOOD 枚举 ════════
"😌 calm" | "🌙 nostalgic" | "✨ hopeful" | "💭 pensive" | "🌊 turbulent" | "🔥 passionate" | "🕯 solemn" | "🫧 detached"

════════ ② 正文 HTML 规则 ════════
content 用 <p> 标签分段（3-5 段），选择性使用以下行内标签增加质感：
⚠️【极其重要】：所有 HTML 属性必须使用单引号，绝不能使用双引号，以免破坏 JSON 格式！

  <span class='d-bold' style='color:#0a0a0a'>加粗强调</span>
  <span class='d-highlight' style='background:rgba(212,255,77,0.48)'>黄色高亮</span>
  <span class='d-highlight' style='background:rgba(167,139,250,0.28)'>紫色高亮</span>
  <span class='d-highlight' style='background:rgba(255,107,107,0.22)'>红色高亮</span>
  <span class='d-wavy' style='text-decoration-color:#a78bfa'>紫色波浪线</span>
  <span class='d-wavy' style='text-decoration-color:#5b7cfa'>蓝色波浪线</span>
  <span class='d-wavy' style='text-decoration-color:#ff6b6b'>红色波浪线</span>
  <span class='d-underline' style='text-decoration-color:#5b7cfa'>蓝色下划线</span>
  <span class='d-strike' style='text-decoration-color:#ff6b6b'>删除线</span>
  <span class='d-blackout'>涂黑（不敢承认/敏感）</span>
  <span class='d-cw'>打错字</span><span class='d-cn' style='background:rgba(91,124,250,.12);color:#5b7cfa'>修正</span>
注意：格式化要用得自然、克制，别每句话都加，突出真正重要的词语。

════════ ③ 批注样式完整说明（style 字段 0-11）════════
每篇日记建议 2-4 条批注，内容要诚实揭露潜台词。

 0  报纸剪报    — 泛黄底色·茶色边框·顶部彩条。适合正式反思/长段分析。
 1  便利贴      — 亮黄色·顶部半透明区·轻微旋转。用户随手记录/轻松吐槽。
 2  暗色备忘录  — 深色背景·石灰绿边框。角色夜间心声/反叛情绪。
 3  撕纸碎片    — 不规则裁边形状。群聊视角/情感碎片。
 4  手写卡片    — 白底·紫色左边线。温柔记录/情感总结。
 5  页边旁注    — 透明底·红色左竖线·极简。短评/一句话感悟。
 6  拼贴碎纸    — 白纸·-2度旋转·横格纹理·泛黄上边。怀旧感长段。accentColor=上边颜色。
 7  和纸胶带    — 半透明彩色条·两端微翘。轻盈可爱碎念。accentColor=胶带颜色（推荐半透明色如rgba(212,255,77,.3)）。
 8  宝丽来底注  — 白色相片感·底部彩色胶印区·+1.4度旋转。关键瞬间记录。accentColor=底部色。
 9  打字机卡片  — 米白·等宽字体·双层边框。冷静理性分析/自我拷问。
10  荧光高亮块  — 倾斜荧光色块背景·粗字体。重要顿悟/强调感。accentColor=高亮色（推荐亮色如#d4ff4d、rgba(255,107,107,.45)）。
11  机密文件    — 深色底·顶部红色 CLASSIFIED 标签。隐藏危险想法/不可告人秘密。accentColor=标签颜色。

accentColor 合法格式：#rrggbb | #rgb | rgba(r,g,b,a)
不填则使用各样式默认色。

════════ ④ 批注内容规则 ════════
批注 = 自己重读日记时在旁边写的想法。要求：
  · 若日记写了恋爱脑 → 批注骂自己"又来了"
  · 若日记表现冷静   → 批注揭露其实根本没冷静
  · 若日记回避了某件事 → 批注直接点出那件事
  · 可以互相矛盾（第二条反悔第一条）
  · 可以自嘲、可以后悔、可以懊恼

════════ ⑤ chat vs private ════════
chat    = 处理对话，较有组织感，但情绪诚实。
private = 未经过滤的版本——羞于承认的感受、执念、矛盾。比 chat 更直接更脆弱。

必须：chat 和 private 各至少一篇。
════════════════════════════════════════════════════════
`.trim();


  /* ══════════════════════════════════════════════════════════════════
     §8  API 调用
  ══════════════════════════════════════════════════════════════════ */

  async function callApi(promptStream, subjectLabel, extra) {
    const cfg = await loadApiConfig(),
      set = await loadDiarySettings();
    if (!cfg.baseUrl) throw new Error('API 代理地址未配置');
    if (!cfg.apiKey) throw new Error('API Key 未配置');
    const b64 = /data:image\/[a-zA-Z]+;base64,[^\]\s>]+/g;
    const ctx = promptStream.join('\n\n').replace(b64, '[图片已归档]');

    // Load custom prompts addition
    let customAddition = '';
    try {
      const cpRec = await (async () => {
        const db = await openDb();
        return new Promise(r => {
          try { const q = db.transaction('config','readonly').objectStore('config').get('diary_custom_prompts');
            q.onsuccess = e => r(e.target.result || null); q.onerror = () => r(null); } catch(e) { r(null); }
        });
      })();
      if (cpRec?.items?.length) {
        const enabled = cpRec.items.filter(i => i.enabled && i.content?.trim());
        if (enabled.length) customAddition = '\n\n' + enabled.map(i => `[${i.title || '附加设定'}]\n${i.content.trim()}`).join('\n\n');
      }
    } catch(_) {}

    // Use override prompt if set, otherwise default
    const effectivePrompt = (window.DiarySend?._diaryPromptOverride) || DIARY_PROMPT;

    const parts = [ctx, '──────────────────────────────', effectivePrompt];
    if (set.systemPromptAddition?.trim()) parts.push(`[附加基础设定]\n${set.systemPromptAddition.trim()}`);
    if (customAddition) parts.push(customAddition.trim());
    const sys = parts.join('\n\n');
    const today = new Date().toISOString().split('T')[0];
    const usr = `请为 ${subjectLabel} 生成今日日记（${today}）。${extra || ''}只返回 JSON。`;

    // History count info for logging
    const hc = Number(set.diaryHistoryCount) || 0;
    const histLines = promptStream.filter(l => typeof l === 'string' && l.startsWith('[')).length;

    let url = (cfg.baseUrl || '').trim();
    while (url.endsWith('/')) url = url.slice(0, -1);
    if (url.endsWith('/v1/messages')) url = url.slice(0, -12);
    else if (url.endsWith('/v1')) url = url.slice(0, -3);
    const finalUrl = `${url}/v1/chat/completions`;

    console.group('%c🌐 [DiarySend] callApi', 'color:#a78bfa;font-weight:bold');
    console.log('subject:', subjectLabel, '| url:', finalUrl, '| model:', cfg.model);
    console.log('historyCount设置:', hc === 0 ? '全部' : hc + '条', '| 实际历史行数:', histLines);
    console.groupCollapsed('📤 完整 System Prompt');
    console.log(sys);
    console.groupEnd();
    console.log('📤 User:', usr);

    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: usr },
        ],
        stream: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.groupEnd();
      throw new Error(`API ${res.status}: ${data.error?.message || data.detail || '未知错误'}`);
    }
    const raw = data.choices?.[0]?.message?.content || '';
    console.groupCollapsed('%c📥 AI 原始返回', 'color:#43d9a0;font-weight:bold');
    console.log(raw);
    console.groupEnd();
    console.groupEnd();
    return raw;
  }

  /* ══════════════════════════════════════════════════════════════════
     §9  解析响应
  ══════════════════════════════════════════════════════════════════ */

  function parseResponse(raw) {
    let c = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const fi = c.indexOf('{'),
      li = c.lastIndexOf('}');
    if (fi !== -1 && li !== -1) c = c.slice(fi, li + 1);
    c = c.replace(/([a-zA-Z\-]+)=(?<!\\)"([^"\\]*?)(?<!\\)"/g, "$1='$2'");
    try {
      const p = JSON.parse(c);
      // Multi-char format: { characters: [ { charId, charName, entries: [...] }, ... ] }
      if (Array.isArray(p.characters) && p.characters.length) return { type: 'multi', characters: p.characters };
      // Single format: { entries: [...] }
      if (Array.isArray(p.entries) && p.entries.length) return { type: 'single', entries: p.entries };
      throw new Error('no entries');
    } catch (e) {
      console.error('[DiarySend] parse error:', e, '\nraw:', raw);
      return null;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     §10  批注构建（透传 AI 返回的 style / accentColor）
  ══════════════════════════════════════════════════════════════════ */

  function clampStyle(n, isUser, i) {
    const v = parseInt(n, 10);
    if (!isNaN(v) && v >= 0 && v <= 11) return v;
    const cs = [0, 2, 5, 9, 3, 6, 8, 11],
      us = [1, 4, 7, 10, 5, 2, 8, 0];
    return isUser ? us[i % us.length] : cs[i % cs.length];
  }
  function isValidColor(s) {
    return typeof s === 'string' && /^(#|rgba?\()/.test(s.trim());
  }

  function buildAnns(aiAnns, authorName, authorAv, isUser) {
    const now = Date.now();
    const items = (Array.isArray(aiAnns) ? aiAnns : []).map((a, i) => ({
      authorName,
      avatar: authorAv || '',
      roleLabel: `${isUser ? 'user' : 'char'} · 批注 ${i + 1}`,
      style: clampStyle(a.style, isUser, i),
      accentColor: isValidColor(a.accentColor) ? a.accentColor.trim() : undefined,
      text: (a.text || '').trim() || '（批注内容）',
      quoteRef: (a.quoteRef || '').trim(),
      replies: [],
      createdAt: now + i,
    }));
    const FB = [
      { c: '写完我才发现，我不知不觉承认了一件自己都不敢面对的事。', u: '这段也太……算了，反正也没人看。' },
      { c: '所谓冷静是装出来的。重读一遍我就知道。', u: '明天的我肯定会为今天的自己皱眉头。' },
      { c: '停止分析了。就这样吧。', u: '我要撕掉这页但我不会，就让它烂在这里。' },
    ];
    let fi = 0;
    while (items.length < 2) {
      const fb = FB[fi % FB.length];
      items.push({
        authorName,
        avatar: authorAv || '',
        roleLabel: `${isUser ? 'user' : 'char'} · 自注`,
        style: clampStyle(undefined, isUser, items.length),
        accentColor: undefined,
        text: isUser ? fb.u : fb.c,
        quoteRef: '',
        replies: [],
        createdAt: now + items.length,
      });
      fi++;
    }
    return items;
  }

  /* ══════════════════════════════════════════════════════════════════
     §11  写入 IDB
  ══════════════════════════════════════════════════════════════════ */

  let _seq = 0;
  async function writeEntries(entries, targetId, chatId, source, author, userObj, isGrp, ps) {
    const ids = [],
      today = new Date().toISOString().split('T')[0],
      time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    for (const e of entries) {
      _seq++;
      const priv = e.type === 'private',
        echat = priv ? null : chatId || null,
        id = `diary_ai_${Date.now()}_${_seq}_${priv ? 'priv' : 'pub'}`;
      await idbPut('diaries', {
        id,
        charId: targetId,
        chatId: echat,
        isPrivate: priv,
        isGroup: priv ? false : isGrp,
        privStyle: ps ?? 0,
        title: (e.title || '').trim() || (priv ? `[私密] ${time}` : `[日记] ${time}`),
        content: ensureHtml(e.content || ''),
        date: e.date || today,
        mood: e.mood || '💭 pensive',
        triggerSource: source,
        triggeredAt: Date.now(),
      });
      const anns = buildAnns(
        e.annotations,
        author.name || (author.isUser ? '用户' : '角色'),
        author.avatar || '',
        !!author.isUser,
      );
      await idbPut('config', { id: `annotations_${id}`, items: anns });
      ids.push(id);
      console.log(`[DiarySend] ✅ ${id} type=${e.type} anns=${anns.length}`);
    }
    return ids;
  }

  /* ══════════════════════════════════════════════════════════════════
     §12  主触发函数
  ══════════════════════════════════════════════════════════════════ */

  async function triggerCharDiary(userId, charId, chatId, source, privOnly) {
    const s = await loadDiarySettings(),
      hc = Number(s.diaryHistoryCount) || 0;
    const charObj = await idbGet('chars', charId);
    if (!charObj) throw new Error(`找不到角色 ${charId}`);
    const userObj = userId ? await idbGet('users', userId) : null;
    const chat = chatId ? await idbGet('chats', chatId) : null,
      isGrp = chat ? isGroup(chat) : false;
    const cn = chat ? chat.title || chat.name || '未命名' : '（无关联聊天）';
    const stream = await charStream(charId, userId, chatId, hc, '');
    const extra =
      privOnly || !chatId
        ? '只生成 type="private"，不需要 chat 类型。'
        : `关联聊天：《${cn}》。chat 和 private 各至少一篇。`;
    const raw = await callApi(stream, `角色「${charObj.name || '角色'}」`, extra);
    const parsed = parseResponse(raw);
    if (!parsed) throw new Error('AI 返回无法解析');
    // Support both formats
    let entries = parsed.type === 'multi'
      ? (parsed.characters[0]?.entries || [])
      : parsed.entries;
    if (privOnly || !chatId) {
      entries = entries.filter(e => e.type === 'private');
      if (!entries.length)
        entries = [{ type: 'private', date: new Date().toISOString().split('T')[0],
          title: `${charObj.name} · 私密`, mood: '💭 pensive',
          content: '<p>（AI 未生成有效内容，请重新触发。）</p>', annotations: [] }];
    }
    const ps = Math.floor(Math.random() * 3);
    return (await writeEntries(entries, charId, chatId, source,
      { name: charObj.name || '角色', avatar: charObj.avatar || '', isUser: false },
      userObj, isGrp, ps)).length;
  }

  // ── Batched multi-char: ONE API call for all chars ────────────────
  async function triggerMultiCharDiary(userId, charIds, chatId, source, privOnly) {
    const s = await loadDiarySettings(),
      hc = Number(s.diaryHistoryCount) || 0;
    const userObj = userId ? await idbGet('users', userId) : null;
    const chat = chatId ? await idbGet('chats', chatId) : null,
      isGrp = chat ? isGroup(chat) : false;
    const cn = chat ? chat.title || chat.name || '未命名' : '（无关联聊天）';

    // Build combined stream: all chars' info + shared history
    const st = [];
    const charObjs = [];
    for (const charId of charIds) {
      const charObj = await idbGet('chars', charId);
      if (!charObj) continue;
      charObjs.push(charObj);
      st.push(`\n===== 角色信息开始: ${charObj.name} =====`);
      st.push(`[Character ID]\n${charId}`);
      st.push(`[Character Identification]\nName: ${charObj.remark ? `${charObj.name} (备注: ${charObj.remark})` : charObj.name}`);
      if (charObj.persona) st.push(`[Character Persona]\n${charObj.persona}`);
      if (charObj.bindId && userObj) st.push(`[Character Owner: ${userObj.name}]\nOwner Persona: ${userObj.persona || 'None'}`);
      st.push(`===== 角色信息结束: ${charObj.name} =====\n`);
    }
    if (!charObjs.length) throw new Error('没有有效角色');

    // 🌟 直接使用内部 buildHistory（自带完整 diary/diary_annotation 解析 + 详细日志）
    const hist = await buildHistory(chatId, hc);
    if (hist.length) {
      st.push('\n========== CHAT HISTORY START ==========');
      st.push(...hist);
      st.push('========== CHAT HISTORY END ==========\n');
    } else {
      st.push('\n[System: No chat history available.]\n');
    }

    const extra = privOnly || !chatId
      ? `请为以上 ${charObjs.length} 个角色分别生成私密日记，使用多角色格式输出，只需 type="private"。`
      : `关联聊天：《${cn}》。请为以上 ${charObjs.length} 个角色分别生成日记，使用多角色格式输出，chat 和 private 各至少一篇。`;

    const raw = await callApi(st, `${charObjs.length} 个角色`, extra);
    const parsed = parseResponse(raw);
    if (!parsed) throw new Error('AI 返回无法解析');

    let totalWritten = 0;
    const ps = Math.floor(Math.random() * 3);

    if (parsed.type === 'multi') {
      // Match returned characters back to charIds by charId or charName
      for (const charData of parsed.characters) {
        const matchId = charData.charId;
        const charObj = charObjs.find(c => c.id === matchId || c.name === charData.charName || c.name === matchId);
        if (!charObj) {
          console.warn('[DiarySend] multi: no match for', charData.charId, charData.charName);
          continue;
        }
        let entries = charData.entries || [];
        if (privOnly || !chatId) {
          entries = entries.filter(e => e.type === 'private');
          if (!entries.length) entries = [{ type: 'private', date: new Date().toISOString().split('T')[0],
            title: `${charObj.name} · 私密`, mood: '💭 pensive',
            content: '<p>（AI 未生成有效内容。）</p>', annotations: [] }];
        }
        const written = await writeEntries(entries, charObj.id, chatId, source,
          { name: charObj.name || '角色', avatar: charObj.avatar || '', isUser: false },
          userObj, isGrp, ps);
        totalWritten += written.length;
        // Mark unread
        if (typeof window.markUnread === 'function') {
          if (!privOnly && chatId) await window.markUnread(charObj.id, chatId, false);
          await window.markUnread(charObj.id, null, true);
        }
      }
    } else {
      // Fallback: single format, assign to first char
      const charObj = charObjs[0];
      let entries = parsed.entries || [];
      if (privOnly || !chatId) entries = entries.filter(e => e.type === 'private');
      const written = await writeEntries(entries, charObj.id, chatId, source,
        { name: charObj.name || '角色', avatar: charObj.avatar || '', isUser: false },
        userObj, isGrp, ps);
      totalWritten += written.length;
      if (typeof window.markUnread === 'function') {
        if (!privOnly && chatId) await window.markUnread(charObj.id, chatId, false);
        await window.markUnread(charObj.id, null, true);
      }
    }
    return totalWritten;
  }

  async function triggerUserDiary(userId, chatId, source, privOnly) {
    const PFX = '__userbook__',
      tid = PFX + (userId || '');
    const s = await loadDiarySettings(),
      hc = Number(s.diaryHistoryCount) || 0;
    const userObj = await idbGet('users', userId);
    if (!userObj) throw new Error(`找不到用户 ${userId}`);
    const chat = chatId ? await idbGet('chats', chatId) : null,
      isGrp = chat ? isGroup(chat) : false;
    const cn = chat ? chat.title || chat.name || '未命名' : '（无关联聊天）';
    const stream = await userStream(userId, chatId, hc, '');
    const extra =
      privOnly || !chatId
        ? `以 ${userObj.name || '用户'} 身份写私密日记，只需 type="private"。`
        : `以 ${userObj.name || '用户'} 视角写《${cn}》的日记，chat 和 private 各至少一篇。`;
    const raw = await callApi(stream, `用户「${userObj.name || '用户'}」`, extra);
    const parsed = parseResponse(raw);
    if (!parsed) throw new Error('AI 返回无法解析');
    let entries = parsed.type === 'multi' ? (parsed.characters[0]?.entries || []) : parsed.entries;
    if (privOnly || !chatId) {
      entries = entries.filter(e => e.type === 'private');
      if (!entries.length)
        entries = [{ type: 'private', date: new Date().toISOString().split('T')[0],
          title: '未说出口的话', mood: '💭 pensive',
          content: '<p>（AI 未生成有效内容，请重新触发。）</p>', annotations: [] }];
    }
    const ps = Math.floor(Math.random() * 3);
    return (await writeEntries(entries, tid, chatId, source,
      { name: userObj.name || '用户', avatar: userObj.avatar || '', isUser: true },
      userObj, isGrp, ps)).length;
  }

  /* ══════════════════════════════════════════════════════════════════
     §13  Toast
  ══════════════════════════════════════════════════════════════════ */

  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || '');
      return;
    }
    const t = document.createElement('div');
    t.style.cssText =
      'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(10,10,10,.9);color:#f5f5f0;padding:8px 20px;border-radius:100px;font-size:12px;font-family:"Geist",sans-serif;z-index:99999;pointer-events:none';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  /* ══════════════════════════════════════════════════════════════════
     §14  writeAiDiary — 覆盖 window.writeTestDiary
  ══════════════════════════════════════════════════════════════════ */

  // Main entry: supports single char OR array of charIds for one-shot batch call
  async function writeAiDiary(userId, chatId, triggerLabel, source = 'char', privOnly = false, explicitCharId = null) {
    toast('訴月記｜日记生成中…', 'warn');
    const _logTs = Date.now();
    const _srcIcons = { char: '🎭', user: '👤', 'auto-timer': '⏱', 'auto-floor': '📶' };
    const _icon = _srcIcons[source] || '🖊';

    console.group(`%c${_icon} [DiarySend] writeAiDiary · ${source}`, 'color:#d4ff4d;font-weight:bold;background:#0a0a0a;padding:1px 8px;border-radius:3px');
    console.log({ userId, chatId, source, privOnly, explicitCharId, triggerLabel });

    let _logDesc = `${source} · ${triggerLabel || ''}`;
    try {
      if (source === 'user' && userId) {
        const u = await idbGet('users', userId);
        if (u) _logDesc = `${u.name || '用户'} · ${chatId ? '聊天日记' : '私密日记'} [user]`;
      } else if (explicitCharId) {
        const ids = Array.isArray(explicitCharId) ? explicitCharId : [explicitCharId];
        const names = [];
        for (const id of ids) { const c = await idbGet('chars', id); if (c) names.push(c.name || '角色'); }
        _logDesc = `${names.join('·')} · ${chatId ? '聊天日记' : '私密日记'} [${source}] ×${ids.length}`;
      }
    } catch (_) {}

    if (typeof window.appendAiLog === 'function') {
      await window.appendAiLog({ icon: _icon, desc: _logDesc, status: 'run', ts: _logTs });
    }

    try {
      let written = 0;

      if (source === 'user') {
        if (!userId) { toast('⚠ 请先选择身份', 'warn'); console.groupEnd(); return; }
        written = await triggerUserDiary(userId, chatId, source, !!privOnly);
        if (typeof window.markUnread === 'function') {
          const tid = '__userbook__' + userId;
          if (!privOnly && chatId) await window.markUnread(tid, chatId, false);
          await window.markUnread(tid, null, true);
        }
      } else {
        // Resolve charIds array
        let charIds = [];
        if (Array.isArray(explicitCharId) && explicitCharId.length) {
          charIds = explicitCharId;
        } else if (explicitCharId) {
          charIds = [explicitCharId];
        } else if (chatId) {
          const c = await idbGet('chats', chatId);
          if (c) {
            for (const f of CF) { if (c[f]) { charIds = [c[f]]; break; } }
            if (!charIds.length && Array.isArray(c.charIds) && c.charIds.length) charIds = c.charIds;
          }
        }
        if (!charIds.length) {
          const all = await idbGetAll('chars'),
            bound = userId ? all.filter(c => c.bindId === userId) : all;
          if (!bound.length) { toast('⚠ 无绑定角色', 'warn'); console.groupEnd(); return; }
          charIds = bound.map(c => c.id);
        }

        console.log('触发角色列表:', charIds, '| 一次性API调用');

        if (charIds.length === 1) {
          // Single char — normal path
          written = await triggerCharDiary(userId, charIds[0], chatId, source, !!privOnly);
          if (typeof window.markUnread === 'function') {
            if (!privOnly && chatId) await window.markUnread(charIds[0], chatId, false);
            await window.markUnread(charIds[0], null, true);
          }
        } else {
          // Multiple chars — ONE batched API call
          written = await triggerMultiCharDiary(userId, charIds, chatId, source, !!privOnly);
        }
      }

      const doneDesc = `${_logDesc} → ${written} 篇`;
      if (typeof window.updateAiLogStatus === 'function') await window.updateAiLogStatus(_logTs, 'ok', doneDesc);
      toast(`✅ 日记已生成（${written} 篇）`, 'success');
      console.log('✅ 完成, written:', written);

      if (typeof window.renderHome === 'function') window.renderHome();
      if (typeof window.renderSubBody === 'function' && chatId) window.renderSubBody(chatId);
      if (typeof window.renderPanelBody === 'function') window.renderPanelBody();
      if (typeof window.updateDebugCard === 'function') window.updateDebugCard();
    } catch (err) {
      console.error('[DiarySend] error:', err);
      if (typeof window.updateAiLogStatus === 'function') {
        await window.updateAiLogStatus(_logTs, 'err', `${_logDesc} → ❌ ${err.message}`);
      }
      toast(`❌ 生成失败：${err.message}`, '');
    } finally {
      console.groupEnd();
    }
  }

  // Convenience: trigger all bound chars for a user in one batch call
  async function writeBatchDiary(userId, chatId, source, privOnly) {
    const all = await idbGetAll('chars');
    const bound = userId ? all.filter(c => c.bindId === userId) : all;
    if (!bound.length) throw new Error('无绑定角色');
    return writeAiDiary(userId, chatId, source, source, privOnly, bound.map(c => c.id));
  }

  /* ══════════════════════════════════════════════════════════════════
     §15  Patch buildAnnCard — 应用 accentColor CSS 变量
  ══════════════════════════════════════════════════════════════════ */

  function patchAnnCard() {
    if (typeof window.buildAnnCard !== 'function') return;
    const orig = window.buildAnnCard;
    window.buildAnnCard = function (ann, idx, allItems) {
      const el = orig.call(this, ann, idx, allItems);
      if (el && ann?.accentColor) el.style.setProperty('--ann-accent', ann.accentColor);
      return el;
    };
    console.log('[DiarySend] buildAnnCard patched ✅');
  }

  /* ══════════════════════════════════════════════════════════════════
     §16  Init
  ══════════════════════════════════════════════════════════════════ */

  function init() {
    injectStyles();
    patchAnnCard();
    window.writeTestDiary = writeAiDiary;
    window.DiarySend = {
      triggerCharDiary,
      triggerUserDiary,
      triggerMultiCharDiary,
      writeBatchDiary,
      loadDiarySettings,
      saveDiarySettings,
      writeAiDiary,
      _DIARY_PROMPT: DIARY_PROMPT,
      _diaryPromptOverride: null,
    };
    // Apply any saved prompt override from IDB
    (async () => {
      try {
        const db = await openDb();
        const rec = await new Promise(r => {
          try { const q = db.transaction('config','readonly').objectStore('config').get('diary_builtin_prompt_override');
            q.onsuccess = e => r(e.target.result || null); q.onerror = () => r(null); } catch(e) { r(null); }
        });
        if (rec?.text) window.DiarySend._diaryPromptOverride = rec.text;
      } catch(_) {}
    })();
    console.group(
      '%c[DiarySend] ✅ v2.2  批量API·提示词编辑·全量日志',
      'color:#d4ff4d;font-weight:bold;background:#0a0a0a;padding:2px 10px;border-radius:4px',
    );
    console.log('单次API生成多角色 · 完整提示词日志 · 自定义提示词块 · 未读标记');
    console.groupEnd();
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
