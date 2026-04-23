/**
 * gacha-gen.js — 幻月衍化 AI Card Generation  v2
 * ─────────────────────────────────────────────────────────────────
 * § 1  Slider system      — linked sliders, sum locked to 100 %
 * § 2  Perspective state  — CHAR / USER / BOTH toggle chips
 * § 3  API config loader  — reads IDB api.temp
 * § 4  Persona loaders    — char (currentChar) + user (boundUser)
 * § 5  Prompt builders    — _buildCharPrompt / _buildUserPrompt
 * § 6  API call           — fetch + verbose grouped console
 * § 7  Parser             — clean JSON extraction + validation
 * § 8  Main entry         — startGenerateAI()
 * § 9  toggleRarity hook  — re-normalise after on/off
 * ─────────────────────────────────────────────────────────────────
 */

/* ══════════════════════════════════════════════════
   § 1 · SLIDER SYSTEM
══════════════════════════════════════════════════ */

function initGenSliders() {
  _normaliseToHundred();
  _refreshAllSliderUI();

  window.RARITIES.forEach(r => {
    const slider = document.getElementById('rlrange-' + r);
    if (slider) slider.oninput = () => _onSliderInput(r, +slider.value);
  });

  // Clone count node to avoid stacking duplicate event listeners on re-open
  const countEl = document.getElementById('genCount');
  if (countEl) {
    const fresh = countEl.cloneNode(true);
    countEl.parentNode.replaceChild(fresh, countEl);
    fresh.addEventListener('input', _refreshAllSliderUI);
  }

  console.log('[GachaGen/Sliders] Initialised. Distribution:', _getEnabledDist());
}

function _onSliderInput(changedR, newVal) {
  const dist = window.rarityDist;
  newVal = Math.max(0, Math.min(100, newVal));
  dist[changedR].pct = newVal;

  const others       = window.RARITIES.filter(r => r !== changedR && dist[r].on);
  const usedByOthers = others.reduce((s, r) => s + dist[r].pct, 0);
  const usedTotal    = newVal + usedByOthers;

  if (usedTotal > 100) {
    const excess      = usedTotal - 100;
    const totalOthers = usedByOthers || 1;
    others.forEach(r => {
      dist[r].pct = Math.max(0, Math.round(dist[r].pct - excess * (dist[r].pct / totalOthers)));
    });
    _fixRoundingDrift(changedR);
  }
  _refreshAllSliderUI();
}

function _fixRoundingDrift(lockedR) {
  const dist    = window.rarityDist;
  const enabled = window.RARITIES.filter(r => dist[r].on);
  const drift   = 100 - enabled.reduce((s, r) => s + dist[r].pct, 0);
  if (drift === 0) return;
  const target = enabled.find(r => r !== lockedR && dist[r].pct + drift >= 0);
  if (target) dist[target].pct = Math.max(0, dist[target].pct + drift);
}

function _normaliseToHundred() {
  const dist    = window.rarityDist;
  const enabled = window.RARITIES.filter(r => dist[r].on);
  if (!enabled.length) return;
  const sum = enabled.reduce((s, r) => s + dist[r].pct, 0);
  if (sum === 0) {
    const each = Math.floor(100 / enabled.length);
    enabled.forEach((r, i) => {
      dist[r].pct = i === enabled.length - 1 ? 100 - each * (enabled.length - 1) : each;
    });
  } else if (sum !== 100) {
    enabled.forEach(r => { dist[r].pct = Math.round(dist[r].pct * 100 / sum); });
    _fixRoundingDrift(null);
  }
}

function _refreshAllSliderUI() {
  const dist       = window.rarityDist;
  const count      = parseInt(document.getElementById('genCount')?.value) || 10;
  const enabled    = window.RARITIES.filter(r => dist[r].on);
  const sumEnabled = enabled.reduce((s, r) => s + dist[r].pct, 0);
  let   usedSoFar  = 0;

  const RARITY_COLORS = { R:'#94a3b8', SR:'#7dd3fc', SSR:'#c084fc', UR:'#38bdf8', SSS:'#e2eaf8' };

  window.RARITIES.forEach(r => {
    const slider = document.getElementById('rlrange-' + r);
    const valEl  = document.getElementById('rlval-'   + r);
    const cntEl  = document.getElementById('rlcnt-'   + r);
    if (!slider) return;

    const pct = dist[r].pct;
    if (valEl) valEl.textContent = pct + '%';
    if (cntEl) cntEl.textContent = '×' + Math.round(count * pct / 100);
    slider.value = pct;

    if (!dist[r].on) {
      slider.style.background = 'rgba(165,188,227,0.1)';
      slider.disabled = true;
      return;
    }
    slider.disabled = false;

    const b      = usedSoFar + pct;
    const c      = Math.min(sumEnabled, 100);
    const accent = RARITY_COLORS[r] || '#7b93b8';
    slider.style.background = _sliderGradient(usedSoFar, b, c, accent);
    usedSoFar += pct;
  });

  const sumEl = document.getElementById('rlSum');
  const remEl = document.getElementById('rlRem');
  if (sumEl) sumEl.textContent = sumEnabled + '%';
  if (remEl) {
    const rem = 100 - sumEnabled;
    remEl.textContent = rem === 0 ? '✓ 恰好100%' : rem > 0 ? `还剩 ${rem}%` : `超出 ${-rem}%`;
    remEl.style.color = rem === 0 ? '#4ade80' : rem < 0 ? '#f87171' : '#7b93b8';
  }
}

function _sliderGradient(a, b, c, accent) {
  const stops = [];
  if (a > 0)   stops.push(`rgba(165,188,227,0.18) 0%`, `rgba(165,188,227,0.18) ${a}%`);
  if (b > a)   stops.push(`${accent} ${a}%`, `${accent} ${b}%`);
  if (c > b)   stops.push(`rgba(74,222,128,0.32) ${b}%`, `rgba(74,222,128,0.32) ${c}%`);
  if (c < 100) stops.push(`rgba(165,188,227,0.06) ${c}%`, `rgba(165,188,227,0.06) 100%`);
  return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : 'rgba(165,188,227,0.1)';
}

function _getEnabledDist() {
  const dist = window.rarityDist;
  return Object.fromEntries(window.RARITIES.filter(r => dist[r].on).map(r => [r, dist[r].pct]));
}

/* ══════════════════════════════════════════════════
   § 2 · PERSPECTIVE STATE  (char | user | both)
══════════════════════════════════════════════════ */

const _perspectives = new Set(['user']); // default: user card

/** Called from HTML chip onclick. At least one must stay selected. */
function togglePerspective(p) {
  if (_perspectives.has(p)) {
    if (_perspectives.size === 1) return; // can't deselect last
    _perspectives.delete(p);
  } else {
    _perspectives.add(p);
  }
  _renderPerspectiveChips();
}

function _renderPerspectiveChips() {
  ['user', 'char', 'duo'].forEach(p => {
    const el = document.getElementById('genPerspective-' + p);
    if (el) el.classList.toggle('sel', _perspectives.has(p));
  });
}

/* ══════════════════════════════════════════════════
   § 3 · API CONFIG LOADER
══════════════════════════════════════════════════ */

async function _loadApiConfig() {
  const cfg = await window.getConfig();
  const api = cfg?.api?.temp || cfg?.api?.presets?.[cfg?.api?.activePreset] || null;
  if (!api?.url || !api?.key) {
    throw new Error('未配置 API — 请先在 Settings 填写 API URL 和 Key');
  }
  return {
    url:   api.url.replace(/\/+$/, '').replace(/\/v1$/, ''),
    key:   api.key,
    model: api.model || 'gpt-4o',
    temp:  parseFloat(api.temp ?? 0.7),
  };
}

/* ══════════════════════════════════════════════════
   § 4 · PERSONA LOADERS
══════════════════════════════════════════════════ */

function _loadCharPersona() {
  const ch = window.currentChar;
  if (!ch) return null;
  return {
    name:        ch.name        || '',
    remark:      ch.remark      || ch.description || '',
    personality: ch.personality || '',
    background:  ch.background  || ch.bg || '',
    appearance:  ch.appearance  || '',
    isBuiltin:   !!ch._isBuiltin,
    raw:         ch,
  };
}

function _loadUserPersona() {
  const uid  = window.boundUserId;
  const user = uid ? (window.users || []).find(u => u.id === uid) : null;
  if (!user) return null;
  return {
    name:        user.name        || '',
    nickname:    user.nickname    || '',
    gender:      user.gender      || '',
    description: user.description || user.desc || '',
    personality: user.personality || '',
    background:  user.background  || user.bg   || '',
    appearance:  user.appearance  || '',
    raw:         user,
  };
}

/* ══════════════════════════════════════════════════
   § 5 · PROMPT BUILDERS
   ─────────────────────────────────────────────────
   USER  视角：user 是卡面主角。outfit/prop/story 全部作用在 user 身上。
               生成的是「属于 user 的卡」，char 作为陪衬/NPC。
   CHAR  视角：char 是卡面主角。outfit/prop/story 全部作用在 char 身上。
               生成的是「属于 char 的角色卡」，user 作为旁观/对手/命运交汇点。
   DUO   视角：user + char 同时出现在一张卡面里。
               卡面描述两人之间的化学反应与羁绊，outfit/prop/story 包含双方。
══════════════════════════════════════════════════ */

function _distBlock(distribution, count) {
  return Object.entries(distribution)
    .map(([r, pct]) => `  - ${r}: ${Math.max(1, Math.round(count * pct / 100))} 张 (${pct}%)`)
    .join('\n');
}

const _RARITY_GUIDE = `【稀有度风格指引】
- R   : 日常感，轻微张力，普通身份
- SR  : 非凡身份，轻度禁忌感，有化学反应
- SSR : 强烈宿命感，极致美学，情感浓烈
- UR  : 超自然存在，极度依赖/支配/被支配关系，感官冲击
- SSS : 神明/传说级，崩坏与救赎，极致白月光或极致深渊`;

const _JSON_SCHEMA_BASE = `【每张卡片必须包含以下字段，只输出纯 JSON 数组，禁止 Markdown 代码块或任何解释文字】
- rarity   : "R" | "SR" | "SSR" | "UR" | "SSS"
- identity : 卡面标题（月相·身份格式，如"残月·失序之人"）
- outfit   : 服装/外观描写（15-40字，细节丰富）
- prop     : 特殊道具或意象（1-3件）
- world    : 世界观背景（20-50字）
- story    : 剧情/羁绊片段（50-120字，充满张力）`;

/**
 * USER 视角 — user 是卡面主角，outfit/prop/story 都作用在 user 身上。
 * char 若存在则作为 NPC / 对立角色 / 命运推手出现。
 */
function _buildUserPrompt({ themes, customPrompt, distribution, count, user, char }) {
  const themeStr = themes.length ? themes.join('、') : '自由风格';

  // 构建 user 主角信息
  let userBlock = '';
  if (user) {
    const parts = [];
    if (user.name)        parts.push(`姓名：${user.name}`);
    if (user.nickname)    parts.push(`昵称：${user.nickname}`);
    if (user.gender)      parts.push(`性别：${user.gender}`);
    if (user.description) parts.push(`外貌/描述：${user.description}`);
    if (user.personality) parts.push(`性格：${user.personality}`);
    if (user.background)  parts.push(`背景：${user.background}`);
    if (user.appearance)  parts.push(`外貌细节：${user.appearance}`);
    if (parts.length) userBlock = `\n\n【卡面主角人设（所有卡面的服装、道具、剧情都围绕此人展开）】\n${parts.join('\n')}`;
  }

  // char 作为 NPC 线索（可选）
  let charHint = '';
  if (char && !char.isBuiltin && char.name) {
    charHint = `\n\n【NPC 线索（可出现在 story 或 world 中作为对立/羁绊角色，非必须）】\n角色名：${char.name}${char.remark ? '\n描述：' + char.remark : ''}`;
  }

  const schema = `${_JSON_SCHEMA_BASE}
  （注意：outfit 描写的是主角的服装；story 里的"你"就是上方主角本人，故事以主角为中心展开）`;

  return `你是极致清冷月系卡牌内容创作者，专门生成充满张力的命轨卡片数据。

【任务】生成 ${count} 张命轨卡片，以 JSON 数组格式返回。

【视角说明】USER 视角 ——
  卡面的绝对主角是下方「卡面主角」这个人。
  outfit（服装）描写的是他/她的穿着。
  prop（道具）是他/她持有或与他/她相关的物品。
  story（剧情）以第二人称"你"直接指代这个主角，
  描述他/她经历的处境、情感或命运片段，
  可以有 NPC 出现，但主角始终是焦点。${userBlock}${charHint}

【幻境主题】${themeStr}
【氛围祷词】${customPrompt || '银白清冷月光，极致精致的破碎感，命运感强烈。'}

【稀有度分配（共 ${count} 张）】
${_distBlock(distribution, count)}

${schema}

${_RARITY_GUIDE}

请直接输出 JSON 数组：`;
}

/**
 * CHAR 视角 — char 是卡面主角，outfit/prop/story 都作用在 char 身上。
 * 生成的是 char 自己的角色卡。user 若存在则作为命运的对立面/见证者。
 */
function _buildCharPrompt({ themes, customPrompt, distribution, count, char, user }) {
  const themeStr = themes.length ? themes.join('、') : '自由风格';

  // char 主角信息
  let charBlock = '';
  if (char && !char.isBuiltin) {
    const parts = [];
    if (char.name)        parts.push(`姓名：${char.name}`);
    if (char.remark)      parts.push(`描述：${char.remark}`);
    if (char.personality) parts.push(`性格：${char.personality}`);
    if (char.background)  parts.push(`背景：${char.background}`);
    if (char.appearance)  parts.push(`外貌：${char.appearance}`);
    if (parts.length) charBlock = `\n\n【卡面主角人设（所有卡面的服装、道具、剧情都围绕此角色展开）】\n${parts.join('\n')}`;
  }

  // user 作为命运见证者/对立面线索（可选）
  let userHint = '';
  if (user && user.name) {
    userHint = `\n\n【命运对立面（可在 story 中作为主角命运的见证者或交汇点，非必须）】\n姓名：${user.name}${user.description ? '\n描述：' + user.description : ''}`;
  }

  const schema = `${_JSON_SCHEMA_BASE}
  （注意：outfit 描写的是此角色的服装；story 里的主角就是上方这个角色，以第三人称或第二人称叙述其经历）`;

  return `你是极致清冷月系卡牌内容创作者，专门生成充满张力的命轨卡片数据。

【任务】生成 ${count} 张命轨卡片，以 JSON 数组格式返回。

【视角说明】CHAR 视角 ——
  卡面的绝对主角是下方「卡面主角」这个角色。
  outfit（服装）描写的是这个角色自己的服装与外观。
  prop（道具）是这个角色持有或标志性的物品。
  story（剧情）以"你"指代这个角色本人，
  描述其处境、内心、或遭遇的命运片段，
  彰显这个角色自身的魅力与张力，
  identity 的格式是「月相·角色身份标签」。${charBlock}${userHint}

【幻境主题】${themeStr}
【氛围祷词】${customPrompt || '银白清冷月光，极致精致，突出角色本身的存在感与张力。'}

【稀有度分配（共 ${count} 张）】
${_distBlock(distribution, count)}

${schema}

${_RARITY_GUIDE}

请直接输出 JSON 数组：`;
}

/**
 * DUO 视角 — user 与 char 同时出现在一张卡面里。
 * outfit 描写两人各自的装扮，story 描述两人之间的化学反应与羁绊。
 */
function _buildDuoPrompt({ themes, customPrompt, distribution, count, user, char }) {
  const themeStr = themes.length ? themes.join('、') : '自由风格';

  let duoBlock = '';
  const parts = [];

  if (user) {
    const up = [];
    if (user.name)        up.push(`姓名：${user.name}`);
    if (user.gender)      up.push(`性别：${user.gender}`);
    if (user.description) up.push(`描述：${user.description}`);
    if (user.personality) up.push(`性格：${user.personality}`);
    if (user.appearance)  up.push(`外貌：${user.appearance}`);
    if (up.length) parts.push(`【人物甲（玩家）】\n${up.join('\n')}`);
  }

  if (char && !char.isBuiltin) {
    const cp = [];
    if (char.name)        cp.push(`姓名：${char.name}`);
    if (char.remark)      cp.push(`描述：${char.remark}`);
    if (char.personality) cp.push(`性格：${char.personality}`);
    if (char.appearance)  cp.push(`外貌：${char.appearance}`);
    if (cp.length) parts.push(`【人物乙（角色）】\n${cp.join('\n')}`);
  }

  if (parts.length) duoBlock = '\n\n' + parts.join('\n\n');

  const schema = `${_JSON_SCHEMA_BASE}
  （注意：outfit 同时描写两人各自的服装，用"/"或"；"分隔；
    story 以第二人称"你"描述两人之间的羁绊、张力或命运交汇，双方都是焦点）`;

  return `你是极致清冷月系卡牌内容创作者，专门生成充满张力的命轨卡片数据。

【任务】生成 ${count} 张命轨卡片，以 JSON 数组格式返回。

【视角说明】DUO 多人视角 ——
  每张卡面同时包含两个人物：人物甲（玩家）和人物乙（角色）。
  两人共同出现，卡面展现他们之间的化学反应、羁绊、对立或共鸣。
  outfit 同时描写两人的服装（可用"/"分隔）。
  prop 是两人共有的意象或各自的标志物。
  story 以"你"代指玩家，描述两人之间的命运交汇片段。
  identity 格式：「月相·双人场景标签」，如"望月·共谋之夜"。${duoBlock}

【幻境主题】${themeStr}
【氛围祷词】${customPrompt || '银白清冷月光，双人对峙或共鸣的极致张力，化学反应强烈。'}

【稀有度分配（共 ${count} 张）】
${_distBlock(distribution, count)}

${schema}

${_RARITY_GUIDE}

请直接输出 JSON 数组：`;
}

/* ══════════════════════════════════════════════════
   § 6 · API CALL  (all logging inside ONE group, prompt collapsed)
══════════════════════════════════════════════════ */

async function _callGenerateAPI({ url, key, model, temp, systemMsg, userMsg, label }) {
  const endpoint = `${url}/v1/chat/completions`;
  const reqBody  = {
    model,
    temperature: temp,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user',   content: userMsg   },
    ],
  };

  console.group(`[GachaGen] ── API · ${label} ──`);
  console.log(`${endpoint}  |  model: ${model}  |  temp: ${temp}`);

  console.groupCollapsed('▸ Prompt (click to expand)');
  console.log('%cSYSTEM', 'color:#7dd3fc;font-weight:bold', '\n' + systemMsg);
  console.log('%cUSER', 'color:#c084fc;font-weight:bold', '\n' + userMsg);
  console.groupEnd();

  const t0  = performance.now();
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body:    JSON.stringify(reqBody),
  });
  const ms = (performance.now() - t0).toFixed(0);

  console.log(`HTTP ${res.status}  (${ms} ms)`);

  if (!res.ok) {
    const errText = await res.text();
    console.error('Error body:', errText);
    console.groupEnd();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data       = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || '';

  console.groupCollapsed('▸ Raw response (click to expand)');
  console.log(data);
  console.groupEnd();

  console.log(`Content: ${rawContent.length} chars`);
  console.groupEnd(); // close § 6 group
  return rawContent;
}

/* ══════════════════════════════════════════════════
   § 7 · PARSER
══════════════════════════════════════════════════ */

function _parseCards(rawContent, expectedCount, label, meta) {
  // meta = { perspective, charId, userId }
  console.group(`[GachaGen] ── Parse · ${label} ──`);

  let cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const s = cleaned.indexOf('[');
  const e = cleaned.lastIndexOf(']');
  if (s !== -1 && e !== -1) cleaned = cleaned.slice(s, e + 1);

  console.log('JSON excerpt (400):', cleaned.slice(0, 400) + (cleaned.length > 400 ? '…' : ''));

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('JSON.parse failed:', err.message, '\n', cleaned.slice(0, 200));
    console.groupEnd();
    throw new Error(`JSON 解析失败: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    console.error('Not an array:', parsed);
    console.groupEnd();
    throw new Error('模型返回的不是 JSON 数组');
  }

  const VALID = new Set(['R', 'SR', 'SSR', 'UR', 'SSS']);
  const cards = parsed.map((raw, i) => ({
    id:          'uc_' + (Date.now() + i),
    rarity:      VALID.has(raw.rarity) ? raw.rarity : 'SR',
    identity:    String(raw.identity || raw.name || `命轨 ${i + 1}`).trim(),
    outfit:      String(raw.outfit   || '').trim(),
    prop:        String(raw.prop     || '').trim(),
    world:       String(raw.world    || '').trim(),
    story:       String(raw.story    || '').trim(),
    img:         '',
    owners:      [],
    // ── generation metadata tags ──
    perspective: meta?.perspective || label.toLowerCase(), // 'char' | 'user'
    genCharId:   meta?.charId      || null,
    genUserId:   meta?.userId      || null,
    genAt:       Date.now(),
  }));

  console.table(cards.map(c => ({
    rarity:      c.rarity,
    identity:    c.identity,
    perspective: c.perspective,
    charId:      c.genCharId,
    userId:      c.genUserId,
  })));
  console.log(`✓ ${cards.length} / ${expectedCount} cards  [perspective=${meta?.perspective}  char=${meta?.charId}  user=${meta?.userId}]`);
  console.groupEnd();
  return cards;
}

/* ══════════════════════════════════════════════════
   § 8 · MAIN ENTRY — startGenerateAI()
══════════════════════════════════════════════════ */

async function startGenerateAI() {
  const count = Math.max(1, Math.min(100, parseInt(document.getElementById('genCount')?.value) || 10));

  console.group(
    `%c[GachaGen] SESSION  count=${count}  perspectives=[${[..._perspectives].join('+')}]`,
    'color:#a5bce3;font-weight:bold'
  );

  _normaliseToHundred();
  _refreshAllSliderUI();
  const dist = _getEnabledDist();
  console.log('Distribution:', dist);
  console.log('Themes:', [...(window.selThemes || [])]);
  console.log('Perspectives:', [..._perspectives]);

  window.closeAllSheets();
  window.toast(`✦ 衍化中… (${count} 道命轨)`);

  // ── API config ──
  let api;
  try {
    api = await _loadApiConfig();
    console.log('API:', api.url, '|', api.model, '| temp', api.temp);
  } catch (e) {
    console.error('API config error:', e.message);
    console.groupEnd();
    window.toast('✕ ' + e.message);
    return;
  }

  // ── Personas ──
  const charPersona = _loadCharPersona();
  const userPersona = _loadUserPersona();
  console.log('Char persona:', charPersona ? `${charPersona.name || '(unnamed)'}${charPersona.isBuiltin ? ' [builtin]' : ''}` : 'none');
  console.log('User persona:', userPersona ? userPersona.name || '(unnamed)' : 'none');

  // Resolved IDs for tagging
  const resolvedCharId = window.currentChar?.id || null;
  const resolvedUserId = window.boundUserId     || null;

  const themes       = [...(window.selThemes || [])];
  const customPrompt = document.getElementById('genPrompt')?.value?.trim() || '';
  const SYSTEM_MSG   = '你是命轨卡牌创作系统。只输出纯 JSON 数组，不使用 Markdown 代码块，不输出任何解释文字。';
  const allCards     = [];

  // ── USER pass — user 是卡面主角 ──
  if (_perspectives.has('user')) {
    const prompt = _buildUserPrompt({ themes, customPrompt, distribution: dist, count, user: userPersona, char: charPersona });
    const meta   = { perspective: 'user', charId: resolvedCharId, userId: resolvedUserId };
    try {
      const raw   = await _callGenerateAPI({ ...api, systemMsg: SYSTEM_MSG, userMsg: prompt, label: 'USER' });
      const cards = _parseCards(raw, count, 'USER', meta);
      allCards.push(...cards);
    } catch (e) {
      console.error('USER pass failed:', e.message);
      window.toast('✕ USER 衍化失败: ' + e.message.slice(0, 50));
      console.groupEnd();
      return;
    }
  }

  // ── CHAR pass — char 是卡面主角 ──
  if (_perspectives.has('char')) {
    const prompt = _buildCharPrompt({ themes, customPrompt, distribution: dist, count, char: charPersona, user: userPersona });
    const meta   = { perspective: 'char', charId: resolvedCharId, userId: resolvedUserId };
    try {
      const raw   = await _callGenerateAPI({ ...api, systemMsg: SYSTEM_MSG, userMsg: prompt, label: 'CHAR' });
      const cards = _parseCards(raw, count, 'CHAR', meta);
      allCards.push(...cards);
    } catch (e) {
      console.error('CHAR pass failed:', e.message);
      window.toast('✕ CHAR 衍化失败: ' + e.message.slice(0, 50));
      console.groupEnd();
      return;
    }
  }

  // ── DUO pass — user + char 共同出现 ──
  if (_perspectives.has('duo')) {
    const prompt = _buildDuoPrompt({ themes, customPrompt, distribution: dist, count, user: userPersona, char: charPersona });
    const meta   = { perspective: 'duo', charId: resolvedCharId, userId: resolvedUserId };
    try {
      const raw   = await _callGenerateAPI({ ...api, systemMsg: SYSTEM_MSG, userMsg: prompt, label: 'DUO' });
      const cards = _parseCards(raw, count, 'DUO', meta);
      allCards.push(...cards);
    } catch (e) {
      console.error('DUO pass failed:', e.message);
      window.toast('✕ DUO 衍化失败: ' + e.message.slice(0, 50));
      console.groupEnd();
      return;
    }
  }

  // ── Commit to pool ──
  window.userCards.push(...allCards);
  await window.saveState();
  window.renderUserPage();
  window.renderTrayRarityBar();

  console.log(`%c✓ ${allCards.length} cards added to pool`, 'color:#4ade80;font-weight:bold');
  console.groupEnd();
  window.toast(`✦ 衍化完成！已凝刻 ${allCards.length} 道命轨`);
}

/* ══════════════════════════════════════════════════
   § 9 · toggleRarity HOOK
══════════════════════════════════════════════════ */

const _origToggleRarity = window.toggleRarity;
window.toggleRarity = function (r) {
  if (_origToggleRarity) _origToggleRarity(r);
  _normaliseToHundred();
  _refreshAllSliderUI();
  const slider = document.getElementById('rlrange-' + r);
  if (slider) slider.oninput = () => _onSliderInput(r, +slider.value);
};
