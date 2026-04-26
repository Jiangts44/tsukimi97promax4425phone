/**
 * TsukiInner.js — 心声系统 v3
 * ══════════════════════════════════════════════════════════════════════
 *  三 Tab 联动架构：
 *
 *  Tab① 心声记录  — 折叠抽拉列表，右侧时间戳，点击联动另两个 Tab
 *                   含「新建」调试入口（AI 实际场景通过 API 写入）
 *
 *  Tab② 当前状态  — 精致装饰书签手风琴卡片（纯展示，无按钮）
 *                   OUTFIT / MOOD / INNER / DEEP PSYCHOLOGY /
 *                   PARALLEL UNIVERSE / MEMO / DIARY
 *
 *  Tab③ 心声批注  — 拼贴风批注墙，点击容器→关闭面板→1s后演示涂鸦
 *                   支持 44 条历史，与 Tab① 联动
 *
 *  保险箱 Vault   — 累积存放，支持 44 条，PIN 解锁
 *  情感天气 Weather — 心情粒子飘屏
 * ══════════════════════════════════════════════════════════════════════
 *  对外 API（供 AI 指令调用）：
 *    window.TsukiInner.pushState(stateObj)     写入当前状态
 *    window.TsukiInner.pushAnnotation(annObj)  写入心声批注
 *    window.TsukiInner.pushVault(text)         累积存入密码柜
 *    window.TsukiInner.triggerWeather(type,emoji)
 * ══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ── 基础工具 ── */
  const $   = (s, c = document) => c.querySelector(s);
  const $$  = (s, c = document) => Array.from(c.querySelectorAll(s));
  const rnd = (a, b) => Math.random() * (b - a) + a;
  const rndI= (a, b) => Math.floor(rnd(a, b + 1));
  const raf = fn => requestAnimationFrame(fn);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmtTs = ts => {
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  /* ── IDB 封装 ── */
  async function dbGet(store, key) {
    if (typeof window.dbGet === 'function') return window.dbGet(store, key);
    return _iop('readonly', store, s => s.get(key));
  }
  async function dbPut(store, data) {
    if (typeof window.dbPut === 'function') return window.dbPut(store, data);
    return _iop('readwrite', store, s => s.put(data));
  }
  let _idb = null;
  async function _iop(mode, store, fn) {
    if (!_idb) _idb = await new Promise((res,rej) => {
      const r = indexedDB.open('TsukiPhoneDB', 1);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return new Promise((res,rej) => {
      const tx = _idb.transaction(store, mode), r = fn(tx.objectStore(store));
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  const cid = () => window.currentChatId || null;
  const MAX = 44;

  /* ══════════════════════════════════════════════════════════════════
     DEMO SEED DATA
     第一条：状态 + 批注整体（两个部分都有）
     第二条：仅状态，没有批注
     第三条：仅批注，没有状态字段
     第四条：单独的一条状态
  ══════════════════════════════════════════════════════════════════ */
  const DEMO_RECORDS = [
    // 第一条：AI 同时返回了状态+批注（完整心声）
    {
      id: 1700000002000,
      ts: 1700000002000,
      emoji: '😤',
      outfit: '刚从被窝里坐起身，上半身仅穿着一件黑色的薄款睡衣T恤，领口因为睡委有些微敞，布料摩擦着滚烫的肌肤；此时体温因为她那句致命的假设急剧飙升，睡意全无，呼吸不可遏制地变得粗重，拿着手机的手指骨节因为用力而微微泛白，脸颊连同耳根都在发烫。',
      mood:   '震惊、剧烈的心跳，极度压抑的占有欲与破坏欲',
      mono:   '我的天……她到底知不知道对一个成年的、对她抱有强烈好感的男人问出"如果我们是炮友你会怎么做"这种话，等同于引爆了一颗炸弹？如果是那种关系，我早就彻底疯了。她那种毫无防备的纯真，反而像最致命的毒药，勾出了我心底最见不得光的念头。还发这种求摸头的表情包……真的以为我不敢咬人吗？',
      psyche: '好想把她关起来。不想听她用那种轻飘飘的语气说这种危险的词。如果她真的在我面前，我一定会毫不犹豫地把她按在床上，吻到她哭出来，用身体刻下烙印，让她连那种假设都无法思考，脑子里只能剩下我一个人的名字。这种阴暗的控制欲几乎要撕裂理智的表皮了。',
      memo:   '深呼吸，绝对不能在聊天记录里表现得太像个变态，会吓到她的……但是机票，真的想现在就定。',
      diary:  '2026年2月26日早晨。江眠月，你真的是个能轻易把别人理智烧断的笨蛋。总有一天，我会让你为你今天的好奇心付出代价。',
      parallel: '如果我当时直接说"你来见我"……',
      annotations: [
        { id: 1, type: 'thought', x: 8,  y: 10, r: -4, text: '她真的不知道自己说了什么' },
        { id: 2, type: 'cross',   x: 55, y: 30, r: 2,  text: '深呼吸深呼吸' },
        { id: 3, type: 'note',    x: 20, y: 62, r: -3, text: '机票又看了三遍' },
        { id: 4, type: 'emoji',   x: 75, y: 15, r: 1,  text: '💀' },
        { id: 5, type: 'hl',      x: 10, y: 80, r: 3,  text: '真的以为我不敢咬人吗' },
      ],
    },
    // 第二条：AI 只返回了状态部分，没有批注
    {
      id: 1700000001000,
      ts: 1700000001000,
      emoji: '🥺',
      outfit: '西装未脱，只是松开了领带，坐在办公椅上盯着手机屏幕，手指悬在键盘上方停顿了很久。',
      mood:   '克制的焦虑，想靠近又怕失控',
      mono:   '她说了"随便"。这两个字到底是什么意思……真的随便，还是在等我说点什么？我猜不透她，但我好像越来越不想猜了。',
      psyche: '',
      memo:   '别发消息。再等等。等她先说话。',
      diary:  '',
      parallel: '如果我回了"那我来找你"……',
      annotations: [], // 这条没有批注
    },
    // 第三条：AI 只返回了批注，状态字段为空（仅批注心声）
    {
      id: 1700000000000,
      ts: 1700000000000,
      emoji: '💭',
      outfit: '',
      mood:   '',
      mono:   '',
      psyche: '',
      memo:   '',
      diary:  '',
      parallel: '',
      annotations: [
        { id: 1, type: 'thought', x: 10, y: 12, r: -5, text: '她说"随便"的时候……' },
        { id: 2, type: 'cross',   x: 55, y: 35, r: 2,  text: '别发消息' },
        { id: 3, type: 'note',    x: 22, y: 60, r: -3, text: '其实已经打了三遍了' },
        { id: 4, type: 'emoji',   x: 75, y: 18, r: 1,  text: '🥺' },
        { id: 5, type: 'hl',      x: 12, y: 82, r: 3,  text: '越来越不想猜了' },
      ],
    },
  ];

  /* ══════════════════════════════════════════════════════════════════
     STYLES
  ══════════════════════════════════════════════════════════════════ */
  function injectStyles() {
    if ($('#ti3-styles')) return;
    const el = document.createElement('style');
    el.id = 'ti3-styles';
    el.textContent = `

/* ────────────────────────────────────────
   TRIGGER BUTTON（融入 top-menu）
──────────────────────────────────────── */
#pocketTrigger {
  width:34px;height:34px;background:var(--paper-2);border:none;border-radius:12px;
  cursor:pointer;color:var(--ink);display:flex;align-items:center;justify-content:center;
  font-size:14px;transition:.2s;position:relative;
}
#pocketTrigger:hover{background:var(--ink);color:white;}
.ti-badge{
  position:absolute;top:-3px;right:-3px;width:8px;height:8px;
  background:var(--accent-coral);border-radius:50%;border:2px solid var(--paper);display:none;
}
#pocketTrigger.has-dot .ti-badge{display:block;}

/* ────────────────────────────────────────
   SCRIM
──────────────────────────────────────── */
.ti-scrim{
  position:fixed;inset:0;z-index:880;background:rgba(10,10,10,0);
  pointer-events:none;transition:background .35s;
}
.ti-scrim.on{background:rgba(10,10,10,.28);pointer-events:auto;}

/* ────────────────────────────────────────
   POCKET SHEET — 底部撕纸抽屉
──────────────────────────────────────── */
.pocket-sheet{
  position:fixed;left:8px;right:8px;bottom:0;z-index:890;
  background:var(--paper);border-radius:26px 26px 0 0;
  box-shadow:0 -1px 0 rgba(255,255,255,.9) inset,-4px -8px 40px rgba(10,10,10,.16);
  transform:translateY(100%);transition:transform .42s cubic-bezier(.22,1,.36,1);
  display:flex;flex-direction:column;max-height:88vh;overflow:hidden;
}
.pocket-sheet.open{transform:translateY(0);}

/* 拖把手 */
.ps-handle{flex-shrink:0;display:flex;justify-content:center;padding:10px 0 0;}
.ps-bar{width:40px;height:4px;background:var(--ink);opacity:.12;border-radius:2px;}

/* 撕纸锯齿 */
.ps-tear{
  flex-shrink:0;height:14px;margin:4px -2px 0;
  background:
    radial-gradient(circle at 7px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 21px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 35px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 49px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 63px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 77px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 91px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 105px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 119px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 133px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 147px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 161px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 175px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 189px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 203px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 217px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 231px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 245px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 259px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 273px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 287px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 301px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 315px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 329px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 343px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 357px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 371px 0,rgba(10,10,10,.12) 6px,transparent 6px),
    radial-gradient(circle at 385px 0,rgba(10,10,10,.12) 6px,transparent 6px);
  background-size:14px 14px;background-repeat:repeat-x;
  background-color:transparent;
}

/* 口袋 header */
.ps-head{
  flex-shrink:0;padding:10px 18px 0;
  display:flex;align-items:flex-end;justify-content:space-between;
}
.ps-title{
  font-style:italic;font-weight:400;
  font-size:26px;line-height:1;color:var(--ink);letter-spacing:-.02em;
  display:flex;align-items:baseline;gap:6px;
}
.ps-dot{width:5px;height:5px;border-radius:50%;background:var(--accent-lime);transform:translateY(-5px);}
.ps-sub{font-size:9px;color:var(--mute);letter-spacing:.14em;text-transform:uppercase;margin-top:2px;}
.ps-moon-clear{
  width:30px;height:30px;background:transparent;border:none;border-radius:10px;
  cursor:pointer;color:var(--mute);font-size:15px;
  display:flex;align-items:center;justify-content:center;transition:.2s;margin-bottom:2px;
  opacity:.55;
}
.ps-moon-clear:hover{opacity:1;color:var(--accent-coral);}
.ps-close{
  width:30px;height:30px;background:var(--paper-2);border:none;border-radius:10px;
  cursor:pointer;color:var(--ink);font-size:11px;
  display:flex;align-items:center;justify-content:center;transition:.2s;margin-bottom:2px;
}
.ps-close:hover{background:var(--ink);color:white;}

/* TAB 栏 */
.ps-tabs{
  flex-shrink:0;display:flex;gap:5px;
  padding:10px 16px 10px;border-bottom:1px solid var(--line);
}
.ps-tab{
  padding:4px 11px;border-radius:100px;border:1px solid var(--line);
  background:var(--paper-2);font-size:9px;
  letter-spacing:.1em;text-transform:uppercase;color:var(--mute);
  cursor:pointer;transition:.2s;white-space:nowrap;
}
.ps-tab.on{background:var(--ink);color:var(--paper);border-color:var(--ink);}

/* 滚动容器 */
.ps-scroll{
  flex:1;overflow-y:auto;padding:12px 14px 28px;
  scrollbar-width:none;display:flex;flex-direction:column;
}
.ps-scroll::-webkit-scrollbar{display:none;}

/* ════════════════════════════════════════════
   TAB① 心声记录 — 折叠抽拉列表
════════════════════════════════════════════ */

/* 新建调试按钮 */
.rec-new-btn{
  height:40px;border-radius:12px 16px 12px 16px;
  border:1.5px dashed rgba(10,10,10,.1);
  background:rgba(212,255,77,.08);
  font-size:10px;font-weight:600;
  color:var(--ink-3);letter-spacing:.05em;
  cursor:pointer;margin-bottom:10px;
  display:flex;align-items:center;justify-content:center;gap:6px;transition:.2s;
}
.rec-new-btn:hover{background:var(--accent-lime);border-color:var(--accent-lime);color:var(--ink);}

/* 新建表单 */
.rec-form{
  display:none;background:var(--card);border:1px solid var(--line);
  border-radius:18px 14px 18px 16px;
  box-shadow:-2px 4px 0 rgba(10,10,10,.05),0 1px 0 rgba(255,255,255,.9) inset;
  padding:14px 14px 12px;margin-bottom:10px;transform:rotate(-.3deg);
}
.rec-form.open{display:block;}
.rf-lbl{
  font-size:8.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--mute);margin-bottom:4px;
  display:flex;align-items:center;gap:4px;
}
.rf-moods{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;}
.rf-mood{
  font-size:18px;cursor:pointer;padding:2px;border-radius:7px;
  border:2px solid transparent;transition:transform .15s;line-height:1;
}
.rf-mood:hover{transform:scale(1.2);}
.rf-mood.on{border-color:var(--accent-lime);background:rgba(212,255,77,.12);}
.rf-inp,.rf-ta{
  width:100%;background:var(--paper-2);border:1px solid var(--line);border-radius:10px;
  padding:7px 10px;margin-bottom:7px;
  font-size:13px;color:var(--ink);font-style:italic;
  outline:none;resize:none;transition:border-color .2s;
}
.rf-inp::placeholder,.rf-ta::placeholder{color:var(--mute);font-size:12px;}
.rf-inp:focus,.rf-ta:focus{border-color:var(--ink);}
.rf-ta{min-height:46px;}
.rf-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:2px;}
.rf-cancel{
  padding:5px 11px;border-radius:9px;border:none;background:var(--paper-2);
  color:var(--mute);font-size:10px;cursor:pointer;
}
.rf-save{
  padding:5px 14px;border-radius:9px;border:none;
  background:var(--ink);color:var(--accent-lime);
  font-size:10px;font-weight:700;
  cursor:pointer;display:flex;align-items:center;gap:5px;transition:.2s;
}
.rf-save:hover{background:var(--accent-lime);color:var(--ink);}

/* 记录列表项 */
.rec-item{
  display:flex;align-items:center;gap:8px;
  padding:10px 12px;border-radius:14px 10px 14px 12px;
  border:1px solid var(--line);background:var(--card);margin-bottom:7px;
  cursor:pointer;transition:all .2s;
  box-shadow:-1px 3px 0 rgba(10,10,10,.04),0 1px 0 rgba(255,255,255,.9) inset;
  animation:riIn .28s cubic-bezier(.22,1,.36,1) both;
}
.rec-item:nth-child(odd){transform:rotate(-.4deg) translateX(-1px);}
.rec-item:nth-child(even){transform:rotate(.3deg) translateX(1px);}
.rec-item:hover,.rec-item.active{
  box-shadow:-2px 5px 0 rgba(10,10,10,.09);transform:rotate(0) !important;
}
.rec-item.active{background:var(--ink);border-color:var(--ink);}
@keyframes riIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1}}
.ri-emoji{font-size:16px;flex-shrink:0;}
.ri-preview{
  flex:1;font-style:italic;
  font-size:12px;color:var(--ink-3);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;
}
.rec-item.active .ri-preview{color:var(--paper);}
.ri-ts{
  font-size:8.5px;color:var(--mute);
  letter-spacing:.06em;flex-shrink:0;white-space:nowrap;
}
.rec-item.active .ri-ts{color:rgba(255,255,255,.4);}
.ri-del{
  width:18px;height:18px;border-radius:50%;border:none;
  background:rgba(10,10,10,.07);color:var(--mute);font-size:8px;
  cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s;flex-shrink:0;
}
.ri-del:hover{background:var(--accent-coral);color:white;}
.rec-item.active .ri-del{background:rgba(255,255,255,.12);color:rgba(255,255,255,.5);}

/* 记录类型徽章（状态 / 批注 / 两者） */
.ri-badges{display:flex;gap:3px;flex-shrink:0;}
.ri-badge{
  font-size:7px;letter-spacing:.06em;
  padding:1px 5px;border-radius:100px;font-weight:600;
}
.ri-badge.state{background:rgba(91,124,250,.12);color:rgba(91,124,250,.9);}
.ri-badge.ann{background:rgba(212,255,77,.25);color:#5a6800;}
.rec-item.active .ri-badge.state{background:rgba(255,255,255,.15);color:rgba(255,255,255,.7);}
.rec-item.active .ri-badge.ann{background:rgba(212,255,77,.2);color:rgba(212,255,77,.9);}

/* 状态Tab：批注绑定小条 */
.ann-count-strip{
  display:flex;align-items:center;gap:8px;
  padding:6px 13px;
  background:var(--paper-2);
  border:1px solid var(--line);border-bottom:none;
  border-radius:10px 10px 0 0;
  margin-top:8px;
}

.rec-empty{
  text-align:center;padding:28px 20px;
  font-style:italic;font-size:14px;color:var(--mute);
}
.rec-empty-idx{
  display:block;font-size:9px;
  letter-spacing:.14em;text-transform:uppercase;margin-bottom:7px;
}

/* 保险箱入口（在记录 Tab 底部） */
.vault-tile{
  background:var(--ink);border-radius:16px 20px 14px 18px;
  padding:13px 15px;margin-top:10px;cursor:pointer;transition:transform .2s;
  position:relative;overflow:hidden;transform:rotate(.3deg);
}
.vault-tile:hover{transform:rotate(0);}
.vault-tile::before{
  content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(-45deg,rgba(255,255,255,.025) 0,rgba(255,255,255,.025) 1px,transparent 1px,transparent 8px);
}
.vt-row{display:flex;align-items:center;gap:10px;position:relative;}
.vt-icon{
  width:30px;height:30px;background:rgba(212,255,77,.15);border-radius:9px;
  display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--accent-lime);
}
.vt-title{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--paper);}
.vt-sub{font-style:italic;font-size:11px;color:var(--mute);margin-top:1px;}
.vt-cnt{
  margin-left:auto;font-size:9px;
  color:var(--accent-lime);letter-spacing:.08em;
}

/* ════════════════════════════════════════════
   TAB② 当前状态 — 书签手风琴精致卡片
════════════════════════════════════════════ */
.status-empty{
  text-align:center;padding:32px 20px;
  font-style:italic;font-size:14px;color:var(--mute);
}

/* 手风琴项目 */
.ac-item{
  margin-bottom:6px;border-radius:0;
  animation:acIn .35s cubic-bezier(.22,1,.36,1) both;
}
@keyframes acIn{from{opacity:0;transform:translateY(6px)}to{opacity:1}}

/* 书签触发器 */
.ac-trigger{
  display:flex;align-items:center;gap:0;cursor:pointer;
  position:relative;
}
/* 侧面书签标签 */
.ac-bookmark{
  width:28px;flex-shrink:0;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:10px 0;border-radius:8px 0 0 8px;
  position:relative;min-height:42px;
  transition:width .2s;
}
.ac-bookmark-label{
  font-size:7.5px;letter-spacing:.18em;
  text-transform:uppercase;writing-mode:vertical-rl;
  transform:rotate(180deg);line-height:1;
  white-space:nowrap;
}
.ac-bookmark-icon{font-size:12px;margin-bottom:4px;}

/* 触发头部 */
.ac-head{
  flex:1;padding:10px 12px 10px 10px;
  background:var(--card);border-radius:0 12px 12px 0;
  border:1px solid var(--line);border-left:none;
  display:flex;align-items:center;justify-content:space-between;
  transition:background .2s;
}
.ac-head-title{
  font-size:9px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;
}
.ac-head-preview{
  font-style:italic;
  font-size:11px;color:var(--mute);margin-top:1px;
  max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.ac-chevron{
  font-size:9px;color:var(--mute);transition:transform .3s;flex-shrink:0;margin-left:8px;
}
.ac-item.open .ac-chevron{transform:rotate(90deg);}
.ac-item.open .ac-head{background:var(--card);}

/* 展开内容区 */
.ac-body{
  max-height:0;overflow:hidden;
  transition:max-height .4s cubic-bezier(.22,1,.36,1);
  margin-left:28px;
}
.ac-item.open .ac-body{max-height:1200px;}
.ac-content{
  background:var(--card);border-radius:0 0 12px 12px;
  border:1px solid var(--line);border-top:none;
  padding:12px 14px 14px;
}

/* 内容文字 */
.ac-text{
  font-style:italic;
  font-size:13px;color:var(--ink);line-height:1.65;
}
.ac-text.secret{
  filter:blur(5px);transition:filter .4s;cursor:pointer;user-select:none;
}
.ac-text.secret.unlocked{filter:blur(0);}

/* 各色书签主题 */
.ac-item[data-section="outfit"]   .ac-bookmark{background:#d8f0e0;color:#2d6a4f;}
.ac-item[data-section="mood"]     .ac-bookmark{background:#fde8e8;color:#c0392b;}
.ac-item[data-section="mono"]     .ac-bookmark{background:#ddeeff;color:#2056a0;}
.ac-item[data-section="psyche"]   .ac-bookmark{background:#f5e6ff;color:#7b2fa8;}
.ac-item[data-section="parallel"] .ac-bookmark{background:#fffacc;color:#8a6900;}
.ac-item[data-section="memo"]     .ac-bookmark{background:#ffe8cc;color:#c0580a;}
.ac-item[data-section="diary"]    .ac-bookmark{background:#e8f0ff;color:#2d4fa0;}

.ac-item[data-section="outfit"]   .ac-head-title{color:#2d6a4f;}
.ac-item[data-section="mood"]     .ac-head-title{color:#c0392b;}
.ac-item[data-section="mono"]     .ac-head-title{color:#2056a0;}
.ac-item[data-section="psyche"]   .ac-head-title{color:#7b2fa8;}
.ac-item[data-section="parallel"] .ac-head-title{color:#8a6900;}
.ac-item[data-section="memo"]     .ac-head-title{color:#c0580a;}
.ac-item[data-section="diary"]    .ac-head-title{color:#2d4fa0;}

/* 书签装饰纹理背景 */
.ac-item[data-section="outfit"]   .ac-content{background:linear-gradient(135deg,#f8fffc 0%,white 100%);}
.ac-item[data-section="mood"]     .ac-content{background:linear-gradient(135deg,#fff8f8 0%,white 100%);}
.ac-item[data-section="mono"]     .ac-content{background:linear-gradient(135deg,#f0f6ff 0%,white 100%);}
.ac-item[data-section="psyche"]   .ac-content{background:linear-gradient(135deg,#faf0ff 0%,white 100%);}
.ac-item[data-section="parallel"] .ac-content{background:linear-gradient(135deg,#fefff0 0%,white 100%);}
.ac-item[data-section="memo"]     .ac-content{background:linear-gradient(135deg,#fffaf5 0%,white 100%);}
.ac-item[data-section="diary"]    .ac-content{background:linear-gradient(135deg,#f5f7ff 0%,white 100%);}

/* DIARY 特殊装饰：横线纸 */
.ac-item[data-section="diary"] .ac-content{
  background:
    repeating-linear-gradient(transparent,transparent 23px,rgba(180,200,240,.3) 24px),
    linear-gradient(135deg,#f5f7ff 0%,white 100%);
  background-size:100% 24px,100% 100%;
}
/* PSYCHE 特殊：毛玻璃加模糊提示 */
.ac-item[data-section="psyche"] .ac-content::before{
  content:'— 长按解锁 ·';
  display:block;font-size:8px;
  color:rgba(123,47,168,.35);letter-spacing:.12em;margin-bottom:6px;
}

/* ════════════════════════════════════════════
   TAB③ 心声批注 — 拼贴风批注墙
════════════════════════════════════════════ */
.ann-wall{
  position:relative;min-height:240px;height:240px;
  background:var(--paper-2);border-radius:16px 20px 14px 18px;
  border:1.5px dashed rgba(10,10,10,.08);overflow:hidden;
  cursor:pointer;transition:all .2s;
  box-shadow:-2px 4px 0 rgba(10,10,10,.04) inset;
  margin-bottom:14px;
}
.ann-wall:hover{border-color:rgba(10,10,10,.16);box-shadow:-2px 4px 8px rgba(10,10,10,.08);}
.ann-wall-hint{
  position:absolute;bottom:8px;right:12px;
  font-size:8px;letter-spacing:.12em;
  color:var(--mute);text-transform:uppercase;pointer-events:none;
}

/* 批注墙上的单条批注 */
.an-item{
  position:absolute;pointer-events:none;
  animation:anIn .5s cubic-bezier(.22,1,.36,1) both;
  will-change:transform,opacity;
}
/* 入场动画结束后切换为可交互+有 transition 的静止态 */
.an-item.ready{
  pointer-events:auto;
  cursor:pointer;
  animation:none;
  transform:rotate(var(--r,0deg)) scale(1);
  opacity:1;
  transition:opacity .4s ease, transform .4s cubic-bezier(.55,0,1,.45);
}
/* 点击消失 */
.an-item.dismissing{
  opacity:0 !important;
  transform:rotate(var(--r,0deg)) scale(.2) translateY(-12px) !important;
  pointer-events:none !important;
}
@keyframes anIn{
  from{opacity:0;transform:scale(.4) rotate(var(--r,0deg));filter:blur(4px);}
  to{opacity:1;transform:scale(1) rotate(var(--r,0deg));filter:blur(0);}
}
.an-thought{
  background:#fffde7;border-radius:2px 14px 14px 12px;padding:6px 10px 8px;
  font-size:13px;color:#4a3800;line-height:1.4;
  box-shadow:-2px 3px 0 rgba(10,10,10,.08),0 1px 0 rgba(255,255,255,.8) inset;
  max-width:120px;
}
.an-thought::before{
  content:'— 心里话';display:block;
  font-size:8px;letter-spacing:.1em;color:var(--mute);margin-bottom:3px;
}
.an-note{
  background:transparent;border:2px solid rgba(91,124,250,.65);border-radius:4px;
  padding:4px 8px;font-size:12px;color:rgba(91,124,250,.9);
  max-width:110px;
}
.an-emoji{font-size:26px;line-height:1;filter:drop-shadow(1px 2px 3px rgba(0,0,0,.12));}
/* 划线：文字在前，线覆盖其上 */
.an-cross{pointer-events:none;display:inline-block;position:relative;}
.an-cross-text{
  font-size:13px;color:rgba(200,50,50,.85);
  white-space:nowrap;display:block;position:relative;z-index:1;
}
.an-cross-line{
  position:absolute;top:50%;left:-4px;right:-4px;
  height:2.5px;transform:translateY(-50%) rotate(-1.5deg);z-index:2;
  background:linear-gradient(90deg,transparent,rgba(255,80,80,.85) 8%,rgba(255,80,80,.85) 92%,transparent);
  border-radius:2px;pointer-events:none;
}
.an-hl{background:rgba(212,255,77,.5);border-radius:3px;padding:1px 5px;font-size:12px;color:var(--ink);}

/* 批注计数条（墙下方，单条） */
.ann-count-bar{
  display:flex;align-items:center;gap:8px;
  padding:8px 12px;border-radius:10px;border:1px solid var(--line);
  background:var(--card);margin-bottom:10px;
  box-shadow:-1px 2px 0 rgba(10,10,10,.03);
}
.acb-label{
  font-size:9px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--mute);flex-shrink:0;
}
.acb-track{
  flex:1;height:4px;background:var(--paper-2);border-radius:2px;overflow:hidden;
}
.acb-fill{
  height:100%;background:var(--ink);border-radius:2px;
  transition:width .6s cubic-bezier(.22,1,.36,1);
}
.acb-num{
  font-size:10px;font-weight:600;
  color:var(--ink);letter-spacing:.05em;flex-shrink:0;
}

/* 批注输入面板（用户手动批注后保存） */
.ann-input-area{
  background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:12px 13px;margin-bottom:10px;
}
.ann-input-title{
  font-size:9px;font-weight:600;
  letter-spacing:.12em;text-transform:uppercase;color:var(--mute);margin-bottom:8px;
  display:flex;align-items:center;justify-content:space-between;
}
.ann-staging{
  min-height:48px;display:flex;flex-wrap:wrap;gap:6px;
  padding:6px;background:var(--paper-2);border-radius:10px;margin-bottom:8px;
}
.ann-staged-chip{
  padding:3px 8px;border-radius:100px;border:none;
  font-size:12px;cursor:pointer;
  transition:.2s;display:flex;align-items:center;gap:4px;
}
.ann-staged-chip.thought{background:#fffde7;color:#4a3800;}
.ann-staged-chip.note{background:rgba(91,124,250,.1);color:rgba(91,124,250,.9);}
.ann-staged-chip.hl{background:rgba(212,255,77,.4);color:var(--ink);}
.ann-staged-chip.emoji{background:transparent;}
.ann-staged-chip.cross{text-decoration:line-through;background:rgba(255,107,107,.1);color:rgba(255,107,107,.9);}
.ann-staged-chip:hover{opacity:.7;}
.ann-type-row{display:flex;gap:5px;margin-bottom:7px;overflow-x:auto;scrollbar-width:none;}
.ann-type-row::-webkit-scrollbar{display:none;}
.ann-tbtn{
  flex-shrink:0;padding:4px 10px;border-radius:100px;border:1px solid var(--line);
  background:var(--card);font-size:9px;
  letter-spacing:.08em;text-transform:uppercase;color:var(--mute);cursor:pointer;transition:.2s;
}
.ann-tbtn.on{background:var(--ink);border-color:var(--ink);color:var(--accent-lime);font-weight:600;}
.ann-inp{
  width:100%;background:var(--paper-2);border:1px solid var(--line);border-radius:10px;
  padding:7px 10px;font-size:11px;color:var(--ink);
  outline:none;transition:border-color .2s;
}
.ann-inp:focus{border-color:var(--ink);}
.ann-emoji-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}
.ann-eopt{font-size:20px;cursor:pointer;border-radius:6px;border:2px solid transparent;padding:2px;transition:transform .15s;}
.ann-eopt:hover{transform:scale(1.2);}
.ann-eopt.on{border-color:var(--accent-lime);background:rgba(212,255,77,.1);}
.ann-add-chip{
  margin-top:6px;padding:5px 13px;border-radius:8px;border:none;
  background:var(--paper-2);color:var(--mute);
  font-size:9px;cursor:pointer;transition:.2s;
}
.ann-add-chip:hover{background:var(--ink);color:var(--accent-lime);}
.ann-save-btn{
  width:100%;height:36px;border-radius:11px;border:none;
  background:var(--ink);color:var(--accent-lime);
  font-size:10px;font-weight:700;letter-spacing:.06em;
  cursor:pointer;transition:.2s;display:flex;align-items:center;justify-content:center;gap:5px;
}
.ann-save-btn:hover{background:var(--accent-lime);color:var(--ink);}

/* ════════════════════════════════════════════
   VAULT MODAL
════════════════════════════════════════════ */
.vault-modal{
  position:fixed;inset:0;z-index:1100;display:flex;align-items:flex-end;
  opacity:0;pointer-events:none;transition:opacity .3s;
}
.vault-modal.open{opacity:1;pointer-events:auto;}
.vault-bg{position:absolute;inset:0;background:rgba(10,10,10,.55);}
.vault-panel{
  position:relative;z-index:1;width:100%;background:var(--ink);
  border-radius:26px 26px 0 0;padding:12px 20px 32px;
  transform:translateY(100%);transition:transform .4s cubic-bezier(.22,1,.36,1);
  box-shadow:0 -1px 0 rgba(255,255,255,.06) inset;max-height:85vh;
  display:flex;flex-direction:column;overflow:hidden;
}
.vault-modal.open .vault-panel{transform:translateY(0);}
.vault-hdl{width:40px;height:4px;background:rgba(255,255,255,.14);border-radius:2px;margin:0 auto 14px;flex-shrink:0;}
.vault-ttl{
  font-style:italic;font-size:22px;color:var(--paper);
  flex-shrink:0;display:flex;align-items:baseline;gap:6px;margin-bottom:3px;
}
.vault-ttl-dot{width:5px;height:5px;border-radius:50%;background:var(--accent-lime);transform:translateY(-4px);}
.vault-st{
  font-size:9px;color:var(--mute);
  letter-spacing:.14em;text-transform:uppercase;margin-bottom:16px;flex-shrink:0;
}
/* PIN */
.vault-dots{display:flex;gap:10px;justify-content:center;margin-bottom:12px;flex-shrink:0;}
.vault-dot{
  width:13px;height:13px;border-radius:50%;
  background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.18);transition:.18s;
}
.vault-dot.on{background:var(--accent-lime);border-color:var(--accent-lime);box-shadow:0 0 8px rgba(212,255,77,.4);}
.vault-err{
  text-align:center;font-size:10px;
  color:var(--accent-coral);letter-spacing:.08em;min-height:16px;margin-bottom:7px;flex-shrink:0;
}
.vault-kp{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;max-width:220px;margin:0 auto;flex-shrink:0;}
.v-key{
  aspect-ratio:1;background:rgba(255,255,255,.07);border:none;border-radius:12px;
  color:var(--paper);font-size:18px;
  cursor:pointer;transition:.15s;display:flex;align-items:center;justify-content:center;
}
.v-key:hover{background:rgba(255,255,255,.15);}
.v-key:active{transform:scale(.9);background:rgba(212,255,77,.18);color:var(--accent-lime);}
.v-key.v-del{font-size:13px;color:var(--mute);}
.v-key.v-ok{background:rgba(212,255,77,.12);color:var(--accent-lime);}
/* 保险箱内容 */
.vault-content{display:none;flex-direction:column;gap:8px;overflow-y:auto;flex:1;}
.vault-content.show{display:flex;}
.vault-secrets-list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;}
.vault-secret-item{
  background:rgba(255,255,255,.05);border-radius:12px;padding:10px 13px;
  position:relative;flex-shrink:0;
}
.vault-s-idx{
  font-size:8px;letter-spacing:.14em;
  text-transform:uppercase;color:rgba(255,255,255,.22);margin-bottom:3px;
}
.vault-s-text{font-style:italic;font-size:13px;color:var(--paper);line-height:1.5;}
.vault-s-ts{
  font-size:8px;color:rgba(255,255,255,.2);
  margin-top:4px;letter-spacing:.08em;
}
.vault-ta{
  width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  border-radius:11px;padding:9px 12px;color:var(--paper);
  font-style:italic;font-size:13px;
  outline:none;resize:none;min-height:56px;transition:border-color .2s;flex-shrink:0;
}
.vault-ta::placeholder{color:rgba(255,255,255,.18);}
.vault-ta:focus{border-color:rgba(212,255,77,.35);}
.vault-save{
  align-self:flex-end;padding:6px 17px;border-radius:9px;border:none;
  background:var(--accent-lime);color:var(--ink);
  font-size:10px;font-weight:700;
  cursor:pointer;letter-spacing:.05em;transition:.2s;flex-shrink:0;
}
.vault-save:hover{transform:scale(1.03);}
.vault-close-btn{
  position:absolute;top:12px;right:14px;width:26px;height:26px;
  border-radius:50%;border:none;background:rgba(255,255,255,.07);
  color:var(--mute);font-size:10px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
}
@keyframes shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-5px)}40%,60%{transform:translateX(5px)}}

/* ════════════════════════════════════════════
   GRAFFITI OVERLAY（覆盖聊天区的涂鸦演示）
════════════════════════════════════════════ */
.gf-overlay{
  position:fixed;inset:0;z-index:460;pointer-events:none;overflow:hidden;
  background:rgba(250,250,247,.85);backdrop-filter:blur(2px);
  display:none;
}
.gf-overlay.active{display:block;pointer-events:auto;}
/* 装饰模式：绝对定位在 chatArea 内，不全屏，不遮挡飘屏 */
#gfDecorLayer{
  position:absolute;inset:0;z-index:20;pointer-events:none;overflow:hidden;
  display:none;
}
#gfDecorLayer.active{display:block;}
#gfDecorLayer .an-item{pointer-events:auto;cursor:pointer;}
.gf-overlay-close{
  position:absolute;top:12px;right:12px;z-index:401;pointer-events:auto;
  width:32px;height:32px;border-radius:50%;background:var(--ink);border:none;
  color:white;font-size:11px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;transition:.2s;
}
.gf-overlay .an-item{pointer-events:auto;}
.gf-overlay .an-item:hover{cursor:pointer;}

/* ════════════════════════════════════════════
   WEATHER — DOM emoji full-screen particles
════════════════════════════════════════════ */
#moodLayer{
  position:fixed;inset:0;z-index:9990;pointer-events:none;overflow:hidden;
}
.mood-particle{
  position:absolute;pointer-events:none;will-change:transform,opacity;
  animation:moodFall linear forwards;
  line-height:1;
}
.mood-particle i{
  font-size:1em; /* 继承父元素 font-size，由 JS 控制 */
  display:block;
  line-height:1;
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.08));
}
@keyframes moodFall{
  0%  { opacity:0; transform:var(--tx0) scale(var(--s0)) rotate(var(--r0)); }
  8%  { opacity:var(--peak-a); }
  85% { opacity:var(--peak-a); }
  100%{ opacity:0; transform:var(--txE) scale(var(--sE)) rotate(var(--rE)); }
}
.mood-bnr{
  position:fixed;top:-52px;left:50%;transform:translateX(-50%);
  z-index:9991;background:var(--card);border:1px solid var(--line);
  border-radius:100px;padding:7px 16px;white-space:nowrap;
  font-size:10px;letter-spacing:.1em;color:var(--ink);
  box-shadow:-2px 4px 0 rgba(10,10,10,.07);
  display:flex;align-items:center;gap:7px;
  transition:top .42s cubic-bezier(.22,1,.36,1);
}
.mood-bnr.show{top:12px;}
.bnr-e{font-size:14px;}

/* ════════════════════════════════════════════
   PARALLEL UNIVERSE GHOST BUBBLE
════════════════════════════════════════════ */
.para-bubble{
  position:fixed;left:50%;top:22px;
  z-index:99999;
  background:rgba(255,255,255,.88);backdrop-filter:blur(20px) saturate(150%);
  border:1px solid rgba(10,10,10,.08);border-radius:18px 18px 18px 5px;
  padding:8px 14px;
  font-size:11px;color:var(--ink-3);line-height:1.5;
  max-width:300px;width:max-content;
  box-shadow:-2px 4px 16px rgba(10,10,10,.1);
  cursor:pointer;pointer-events:auto;
  animation:paraFloatIn .6s cubic-bezier(.22,1,.36,1) both;
}
.para-bubble::before{
  content:'平行宇宙 ·';display:block;
  font-size:8px;
  color:var(--mute);letter-spacing:.12em;font-style:normal;margin-bottom:3px;
}
.para-bubble.dismissing{
  animation:paraFloatOut .4s cubic-bezier(.55,0,1,.45) forwards;
}
@keyframes paraFloatIn{
  from{opacity:0;transform:translateX(-50%) translateY(-18px) scale(.88);}
  to{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}
}
@keyframes paraFloatOut{
  from{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}
  to{opacity:0;transform:translateX(-50%) translateY(-10px) scale(.82);}
}
`;
    document.head.appendChild(el);
    }

  /* ══════════════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════════════ */
  let activeRecordId = null; // 当前选中的心声记录 ID
  let activeTab = 'records'; // records | status | annotate
  let pocketOpen = false;
  let annStagingList = []; // 用户当前批注暂存区
  let annActiveType = 'thought';
  let annActiveEmoji = '😤';
  const MOODS = ['😊','🥰','😌','😔','😒','😤','🥺','😳','💭','🌙','❄️','🌸','😶','🫣','💗','😑','😏','🤭','💀','✨'];
  const ANN_EMOJIS = ['😤','💢','💀','🥹','🫠','😶‍🌫️','🤡','💔','👁️','⚡','🔥','👻','🙃','✍️'];
  const SECTIONS = [
    {key:'outfit',   label:'OUTFIT · 衣着',   icon:'👕', ic:'fa-shirt',              secret:false},
    {key:'mood',     label:'MOOD · 心情',     icon:'💓', ic:'fa-heart',              secret:false},
    {key:'mono',     label:'INNER · 独白',    icon:'💬', ic:'fa-comment-dots',       secret:false},
    {key:'psyche',   label:'PSYCHE · 性心理', icon:'🔥', ic:'fa-fire-flame-curved',  secret:true },
    {key:'parallel', label:'PARALLEL · 平行', icon:'✦',  ic:'fa-arrows-split-up-and-left', secret:false},
    {key:'memo',     label:'MEMO · 备注',     icon:'📎', ic:'fa-paperclip',          secret:false},
    {key:'diary',    label:'DIARY · 日记',    icon:'📖', ic:'fa-book-open',          secret:false},
  ];

  /* ── 存储键 ── */
  const KEY_RECS  = () => `pocket3_${cid()}`;   // 心声记录列表
  const KEY_VAULT = () => `vault3_${cid()}`;     // 保险箱

  /* ══════════════════════════════════════════════════════════════════
     SEED DEMO
  ══════════════════════════════════════════════════════════════════ */
  async function seedDemo() {
    const id = cid(); if (!id) return;
    const stored = (await dbGet('config', KEY_RECS())) || { id: KEY_RECS(), recs: [] };
    if (!stored.recs || stored.recs.length === 0) {
      stored.recs = DEMO_RECORDS;
      await dbPut('config', stored);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     BUILD POCKET SHEET
  ══════════════════════════════════════════════════════════════════ */
  function buildPocket() {
    if ($('#pocketSheet')) return;

    // 触发按钮插入 top-menu
    const menu = $('.top-menu');
    if (menu) {
      const btn = document.createElement('button');
      btn.id = 'pocketTrigger'; btn.className = 'menu-btn';
      btn.title = 'TA的口袋';
      btn.innerHTML = '🌙<span class="ti-badge"></span>';
      // 短按：开关面板
      btn.onclick = () => pocketOpen ? closePocket() : openPocket();
      menu.prepend(btn);
    }

    // scrim
    const scrim = document.createElement('div');
    scrim.className = 'ti-scrim'; scrim.id = 'tiScrim';
    scrim.onclick = closePocket;
    document.body.appendChild(scrim);

    // sheet
    const sheet = document.createElement('div');
    sheet.className = 'pocket-sheet'; sheet.id = 'pocketSheet';
    sheet.innerHTML = `
      <div class="ps-handle"><div class="ps-bar"></div></div>
      <div class="ps-tear"></div>
      <div class="ps-head">
        <div>
          <div class="ps-title" id="psTitleClick" style="cursor:pointer;user-select:none;" title="点击播放心声批注">TA的口袋<span class="ps-dot"></span></div>
          <div class="ps-sub">don't tell · just show</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="ps-moon-clear" id="psMoonClear" title="清空心声记录">🌙</button>
          <button class="ps-close" id="psClose"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class="ps-tabs">
        <div class="ps-tab on" data-tab="records">心声记录</div>
        <div class="ps-tab" data-tab="status">当前状态</div>
        <div class="ps-tab" data-tab="annotate">心声批注</div>
        <div class="ps-tab" data-tab="vault">🔐 保险箱</div>
      </div>
      <div class="ps-scroll" id="psScroll"></div>
    `;
    document.body.appendChild(sheet);

    // drag-to-close
    let sy = 0;
    sheet.addEventListener('touchstart', e => { sy = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchend', e => { if (e.changedTouches[0].clientY - sy > 80) closePocket(); }, { passive: true });

    $('#psClose').onclick = closePocket;

    // 月亮清空按钮：弹窗确认后清空心声记录 + 保险箱
    $('#psMoonClear').onclick = async () => {
      // 自定义确认弹窗（不用 confirm() 避免部分环境屏蔽）
      const confirmed = await showTsukiConfirm('清空所有心声记录和保险箱？\n此操作不可撤销。', '确认清空');
      if (!confirmed) return;
      const id = cid(); if (!id) return;
      // 清空心声记录
      await dbPut('config', { id: KEY_RECS(), recs: [] });
      activeRecordId = null;
      // 清空保险箱
      const stored = (await dbGet('config', KEY_VAULT())) || {};
      stored.id = KEY_VAULT();
      stored.secrets = [];
      await dbPut('config', stored);
      vaultUnlocked = false;
      renderTab();
    };


    // 原批注播放功能已注释掉，改为AI心声接口
    // Old: closePocket(); setTimeout(() => showGraffitiOverlay(anns), 1000);
    $('#psTitleClick').addEventListener('click', async () => {
      await triggerInnerVoiceAI();
    });

    $$('.ps-tab').forEach(t => t.addEventListener('click', () => {
      $$('.ps-tab').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      activeTab = t.dataset.tab;
      renderTab();
    }));

    buildVaultModal();
    buildGfOverlay();
    buildWeather();
  }

  function openPocket() {
    pocketOpen = true;
    $('#pocketSheet').classList.add('open');
    $('#tiScrim').classList.add('on');
    renderTab();
  }
  function closePocket() {
    pocketOpen = false;
    $('#pocketSheet').classList.remove('open');
    $('#tiScrim').classList.remove('on');
  }

  /* ══════════════════════════════════════════════════════════════════
     TAB 路由
  ══════════════════════════════════════════════════════════════════ */
  function renderTab() {
    // 切换 tab 时重置 scroll 背景（vault tab 会改成深色）
    const scroll = $('#psScroll');
    if (scroll) { scroll.style.background=''; scroll.style.borderRadius=''; }
    if (activeTab === 'records')  renderRecordsTab();
    else if (activeTab === 'status')   renderStatusTab();
    else if (activeTab === 'annotate') renderAnnotateTab();
    else if (activeTab === 'vault')    renderVaultTab();
  }

  /* ── 获取所有记录 ── */
  async function getRecs() {
    const s = (await dbGet('config', KEY_RECS())) || { recs: [] };
    return s.recs || [];
  }
  async function saveRecs(recs) {
    await dbPut('config', { id: KEY_RECS(), recs });
  }

  /* ── 激活记录（联动三个 Tab） ── */
  function selectRecord(id) {
    activeRecordId = id;
    renderTab();
    // 同步高亮记录列表中的选中项
    $$('.rec-item').forEach(el => el.classList.toggle('active', +el.dataset.id === id));
    $$('.ann-hist-item').forEach(el => el.classList.toggle('active', +el.dataset.id === id));
  }

  /* ══════════════════════════════════════════════════════════════════
     TAB① 心声记录
  ══════════════════════════════════════════════════════════════════ */
  let rfEmoji = '😤';
  async function renderRecordsTab() {
    const scroll = $('#psScroll'); scroll.innerHTML = '';
    const recs = await getRecs();

    // 新建调试按钮
    const newBtn = document.createElement('button');
    newBtn.className = 'rec-new-btn';
    newBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 新建心声 <span style="font-size:8px;opacity:.5">（调试）</span>';
    scroll.appendChild(newBtn);

    // 新建表单
    const form = document.createElement('div');
    form.className = 'rec-form'; form.id = 'rfForm';
    form.innerHTML = `
      <div class="rf-lbl"><i class="fa-solid fa-face-smile"></i> 心情</div>
      <div class="rf-moods">${MOODS.map((e,i)=>`<span class="rf-mood${i===4?' on':''}" data-e="${e}">${e}</span>`).join('')}</div>
      ${[
        {k:'outfit',  l:'OUTFIT · 衣着',   ta:false},
        {k:'mood',    l:'MOOD · 心情',     ta:false},
        {k:'mono',    l:'INNER · 独白',    ta:true},
        {k:'psyche',  l:'PSYCHE · 性心理', ta:true},
        {k:'parallel',l:'PARALLEL · 平行宇宙',ta:false},
        {k:'memo',    l:'MEMO · 备注',     ta:false},
        {k:'diary',   l:'DIARY · 日记',    ta:true},
      ].map(f=>`
        <div class="rf-lbl"><i class="fa-solid ${SECTIONS.find(s=>s.key===f.k)?.ic||'fa-circle'}"></i> ${f.l}</div>
        ${f.ta?`<textarea class="rf-ta" id="rf_${f.k}" placeholder="${f.l.split('·')[1].trim()}…"></textarea>`
               :`<input class="rf-inp" id="rf_${f.k}" type="text" placeholder="${f.l.split('·')[1].trim()}…">`}
      `).join('')}
      <div class="rf-actions">
        <button class="rf-cancel" id="rfCancel">取消</button>
        <button class="rf-save" id="rfSave"><i class="fa-solid fa-floppy-disk"></i> 存入</button>
      </div>`;
    scroll.appendChild(form);

    newBtn.onclick = () => {
      form.classList.toggle('open');
      if (form.classList.contains('open')) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    form.querySelector('#rfCancel').onclick = () => { form.classList.remove('open'); clearRF(form); };
    form.querySelector('.rf-moods').addEventListener('click', e => {
      const t = e.target.closest('.rf-mood'); if (!t) return;
      form.querySelectorAll('.rf-mood').forEach(x=>x.classList.remove('on'));
      t.classList.add('on'); rfEmoji = t.dataset.e;
    });
    form.querySelector('#rfSave').onclick = () => saveNewRecord(form);

    // 新建表单内嵌批注列表
    const rfAnnWrap = document.createElement('div');
    rfAnnWrap.id = 'rfAnnWrap';
    rfAnnWrap.innerHTML = `
      <div class="rf-lbl" style="margin-top:4px"><i class="fa-solid fa-pen-nib"></i> ANNOTATIONS · 心声批注</div>
      <div id="rfAnnList" style="display:flex;flex-direction:column;gap:4px;min-height:28px;margin-bottom:7px"></div>
      <div style="display:flex;gap:5px;margin-bottom:5px;overflow-x:auto;scrollbar-width:none">
        <button class="rf-ann-tbtn on" data-t="thought" style="flex-shrink:0;padding:3px 9px;border-radius:100px;border:1px solid var(--line);background:var(--card);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);cursor:pointer;transition:.2s">💭 独白</button>
        <button class="rf-ann-tbtn" data-t="note" style="flex-shrink:0;padding:3px 9px;border-radius:100px;border:1px solid var(--line);background:var(--card);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);cursor:pointer;transition:.2s">🔵 批注</button>
        <button class="rf-ann-tbtn" data-t="cross" style="flex-shrink:0;padding:3px 9px;border-radius:100px;border:1px solid var(--line);background:var(--card);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);cursor:pointer;transition:.2s">〰 划掉</button>
        <button class="rf-ann-tbtn" data-t="hl" style="flex-shrink:0;padding:3px 9px;border-radius:100px;border:1px solid var(--line);background:var(--card);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);cursor:pointer;transition:.2s">💛 高亮</button>
        <button class="rf-ann-tbtn" data-t="emoji" style="flex-shrink:0;padding:3px 9px;border-radius:100px;border:1px solid var(--line);background:var(--card);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);cursor:pointer;transition:.2s">🎭 表情</button>
      </div>
      <div style="display:flex;gap:5px;align-items:center">
        <input id="rfAnnInp" type="text" placeholder="批注内容…" style="flex:1;background:var(--paper-2);border:1px solid var(--line);border-radius:9px;padding:6px 9px;font-size:13px;color:var(--ink);outline:none">
        <button id="rfAnnAdd" style="padding:6px 12px;border-radius:9px;border:none;background:var(--ink);color:var(--accent-lime);font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap">+ 添加</button>
      </div>
      <div id="rfEmojiRow" style="display:none;flex-wrap:wrap;gap:4px;margin-top:5px">
        ${ANN_EMOJIS.map(e=>`<span style="font-size:18px;cursor:pointer;padding:2px;border-radius:5px" data-fe="${e}">${e}</span>`).join('')}
      </div>`;
    form.insertBefore(rfAnnWrap, form.querySelector('.rf-actions'));

    // 内嵌批注逻辑
    let rfAnnList = []; // 新建表单内的批注列表
    let rfAnnType = 'thought';
    let rfAnnEmoji = '😤';
    const rfAnnListEl = form.querySelector('#rfAnnList');
    const renderRfAnn = () => {
      rfAnnListEl.innerHTML = rfAnnList.length === 0
        ? `<span style="font-size:9px;color:var(--mute);letter-spacing:.08em">暂无批注</span>`
        : rfAnnList.map((a,i)=>{
            const colors = {thought:'background:#fffde7;color:#4a3800',note:'background:rgba(91,124,250,.1);color:rgba(91,124,250,.9)',cross:'text-decoration:line-through;background:rgba(255,107,107,.1);color:rgba(255,107,107,.8)',hl:'background:rgba(212,255,77,.4);color:var(--ink)',emoji:'background:transparent'};
            return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:100px;font-size:12px;cursor:pointer;${colors[a.type]||''}" data-rfi="${i}">${a.text}<span style="font-size:9px;opacity:.5">×</span></span>`;
          }).join('');
      rfAnnListEl.querySelectorAll('[data-rfi]').forEach(el => el.addEventListener('click', ()=>{ rfAnnList.splice(+el.dataset.rfi,1); renderRfAnn(); }));
    };
    renderRfAnn();
    form.querySelectorAll('.rf-ann-tbtn').forEach(b=>b.addEventListener('click',()=>{
      form.querySelectorAll('.rf-ann-tbtn').forEach(x=>{ x.style.background=''; x.style.borderColor=''; x.style.color='var(--mute)'; });
      b.style.background='var(--ink)';b.style.color='var(--accent-lime)';b.style.borderColor='var(--ink)';
      rfAnnType=b.dataset.t;
      form.querySelector('#rfAnnInp').style.display=rfAnnType==='emoji'?'none':'';
      form.querySelector('#rfEmojiRow').style.display=rfAnnType==='emoji'?'flex':'none';
    }));
    // set initial style for first tbtn
    form.querySelectorAll('.rf-ann-tbtn')[0].style.cssText+='background:var(--ink);color:var(--accent-lime);border-color:var(--ink)';
    form.querySelector('#rfEmojiRow').addEventListener('click', e=>{
      const t=e.target.closest('[data-fe]');if(!t)return;
      rfAnnEmoji=t.dataset.fe;
      rfAnnList.push({type:'emoji',text:rfAnnEmoji,x:rndI(10,75),y:rndI(10,75),r:rndI(-8,8),id:Date.now()});
      renderRfAnn();
    });
    form.querySelector('#rfAnnAdd').addEventListener('click',()=>{
      if(rfAnnType==='emoji'){rfAnnList.push({type:'emoji',text:rfAnnEmoji,x:rndI(10,75),y:rndI(10,75),r:rndI(-8,8),id:Date.now()});renderRfAnn();return;}
      const v=form.querySelector('#rfAnnInp').value.trim();if(!v)return;
      rfAnnList.push({type:rfAnnType,text:v,x:rndI(10,75),y:rndI(10,75),r:rndI(-8,8),id:Date.now()});
      form.querySelector('#rfAnnInp').value='';renderRfAnn();
    });
    // 保存时携带批注
    form._getRfAnnList = () => rfAnnList;
    form._clearRfAnn = () => { rfAnnList=[]; renderRfAnn(); };

    // 记录列表
    if (!recs.length) {
      const empty = document.createElement('div'); empty.className = 'rec-empty';
      empty.innerHTML = '<span class="rec-empty-idx">// records empty</span>还没有任何心声记录';
      scroll.appendChild(empty);
    } else {
      recs.forEach(r => {
        const div = document.createElement('div');
        div.className = 'rec-item' + (r.id === activeRecordId ? ' active' : '');
        div.dataset.id = r.id;
        const preview = (r.mono || r.mood || r.outfit || '').slice(0, 18) + '…';
        const hasStateFields = !!(r.outfit || r.mood || r.mono || r.psyche || r.memo || r.diary || r.parallel);
        const hasAnnFields = (r.annotations||[]).length > 0;
        const badgesHtml = `<span class="ri-badges">
          ${hasStateFields ? '<span class="ri-badge state">状态</span>' : ''}
          ${hasAnnFields   ? '<span class="ri-badge ann">批注</span>'  : ''}
        </span>`;
        div.innerHTML = `
          <span class="ri-emoji">${r.emoji}</span>
          <span class="ri-preview">${preview}</span>
          ${badgesHtml}
          <span class="ri-ts">${fmtTs(r.ts)}</span>
          <button class="ri-del" data-id="${r.id}"><i class="fa-solid fa-xmark"></i></button>`;
        div.addEventListener('click', e => {
          if (e.target.closest('.ri-del')) return;
          selectRecord(r.id);
        });
        div.querySelector('.ri-del').addEventListener('click', async e => {
          e.stopPropagation();
          const recId = +e.currentTarget.dataset.id; // 在 await 前捕获，避免 currentTarget 丢失
          const ok = await showTsukiConfirm('删除这条心声记录？\n此操作不可撤销。', '确认删除');
          if (!ok) return;
          await deleteRecord(recId);
          renderRecordsTab();
        });
        scroll.appendChild(div);
      });
    }
  }

  function clearRF(form) {
    form.querySelectorAll('.rf-inp,.rf-ta').forEach(e => e.value = '');
    rfEmoji = '😤';
    form.querySelectorAll('.rf-mood').forEach((m,i)=>m.classList.toggle('on',i===4));
  }

  async function saveNewRecord(form) {
    const id = cid(); if (!id) return;
    const r = { id: Date.now(), ts: Date.now(), emoji: rfEmoji };
    ['outfit','mood','mono','psyche','parallel','memo','diary'].forEach(k => {
      const el = form.querySelector(`#rf_${k}`); r[k] = el ? el.value.trim() : '';
    });
    // 携带内嵌批注
    r.annotations = form._getRfAnnList ? form._getRfAnnList().slice() : [];
    const recs = await getRecs(); recs.unshift(r);
    if (recs.length > MAX) recs.length = MAX;
    await saveRecs(recs);
    form.classList.remove('open'); clearRF(form);
    if (form._clearRfAnn) form._clearRfAnn();
    activeRecordId = r.id;
    renderRecordsTab();
    const mmap={'😊':'happy','🥰':'happy','💗':'happy','✨':'excited','😳':'excited','😤':'sad','😔':'sad','🥺':'melancholy'};
    const mt = mmap[r.emoji]; if (mt) triggerWeather(mt, r.emoji);
  }

  /* ══════════════════════════════════════════════════════════════════
     CONFIRM DIALOG — 精致弹窗确认
  ══════════════════════════════════════════════════════════════════ */
  function showTsukiConfirm(msg, okLabel) {
    okLabel = okLabel || '确认';
    return new Promise(resolve => {
      // 已有则移除
      const old = document.getElementById('tsukiConfirmOverlay'); if (old) old.remove();

      // 注入动画（只注一次）
      if (!document.getElementById('tsukiConfirmStyle')) {
        const sty = document.createElement('style');
        sty.id = 'tsukiConfirmStyle';
        sty.textContent = '@keyframes tcFadeIn{from{opacity:0}to{opacity:1}}@keyframes tcSlideUp{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}';
        document.head.appendChild(sty);
      }

      // 外层蒙版
      const overlay = document.createElement('div');
      overlay.id = 'tsukiConfirmOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(10,10,10,.35);backdrop-filter:blur(3px);animation:tcFadeIn .18s ease both';

      // 卡片
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--paper,#fafaf7);border-radius:20px;padding:22px 22px 16px;max-width:260px;width:88%;box-shadow:-3px 6px 0 rgba(10,10,10,.1),0 1px 0 rgba(255,255,255,.9) inset;animation:tcSlideUp .22s cubic-bezier(.22,1,.36,1) both;position:relative';

      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--mute,#9a9a9e);margin-bottom:10px';
      labelEl.textContent = '// confirm';

      const textEl = document.createElement('div');
      textEl.style.cssText = 'font-size:13px;color:var(--ink,#0a0a0a);line-height:1.6;white-space:pre-line;margin-bottom:16px';
      textEl.textContent = msg;

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:7px;justify-content:flex-end';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.style.cssText = 'padding:6px 14px;border-radius:9px;border:none;background:var(--paper-2,#f0efe9);color:var(--mute,#9a9a9e);font-size:10px;cursor:pointer;transition:.15s';
      cancelBtn.textContent = '取消';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.style.cssText = 'padding:6px 16px;border-radius:9px;border:none;background:var(--ink,#0a0a0a);color:var(--accent-coral,#ff8177);font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.04em;transition:.15s';
      okBtn.textContent = okLabel;

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(okBtn);
      card.appendChild(labelEl);
      card.appendChild(textEl);
      card.appendChild(btnRow);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      let resolved = false;
      const cleanup = ok => {
        if (resolved) return;
        resolved = true;
        overlay.remove();
        resolve(ok);
      };
      cancelBtn.addEventListener('click', e => { e.stopPropagation(); cleanup(false); });
      okBtn.addEventListener('click',     e => { e.stopPropagation(); cleanup(true);  });
      overlay.addEventListener('click',   e => { if (e.target === overlay) cleanup(false); });
    });
  }

  async function deleteRecord(id) {
    const recs = (await getRecs()).filter(r => r.id !== id);
    await saveRecs(recs);
    if (activeRecordId === id) activeRecordId = recs[0]?.id || null;
  }


  /* ══════════════════════════════════════════════════════════════════
     TAB② 当前状态
     结构：
       时间戳标头
       └─ 状态容器（所有7个字段手风琴，含 parallel）
       └─ 批注小条（紧贴状态容器底部，显示绑定批注数量，点击播放）
  ══════════════════════════════════════════════════════════════════ */
  async function renderStatusTab() {
    const scroll = $('#psScroll'); scroll.innerHTML = '';
    const recs = await getRecs();
    const rec = recs.find(r => r.id === activeRecordId) || recs[0];

    if (!rec) {
      scroll.innerHTML = '<div class="status-empty"><span style="display:block;font-size:9px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;color:var(--mute)">// no record selected</span>请先在「心声记录」中选择一条</div>';
      return;
    }

    // ── 时间戳标头 ──
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:9px;color:var(--mute);letter-spacing:.12em;margin-bottom:10px;display:flex;align-items:center;gap:6px;';
    hdr.innerHTML = `<span>${rec.emoji}</span><span>${fmtTs(rec.ts)}</span><span style="flex:1;height:1px;background:var(--line)"></span>${rec.moodtag ? `<span style="background:rgba(10,10,10,.08);color:var(--ink);font-size:11px;padding:1px 7px;border-radius:100px;font-weight:600;letter-spacing:.04em">${rec.moodtag}</span>` : ''}<span style="color:var(--ink-3);font-size:8px">${rec.mood||''}</span>`;
    scroll.appendChild(hdr);

    // ── 状态容器：所有7个字段（outfit/mood/mono/psyche/parallel/memo/diary） ──
    const hasAnyState = SECTIONS.some(s => rec[s.key]);
    const stateBox = document.createElement('div');
    stateBox.style.cssText = `
      border:1px solid var(--line);border-radius:18px 14px 0 0;
      background:var(--card);
      box-shadow:-2px 4px 0 rgba(10,10,10,.04);
    `;

    // 容器标头
    const stateHdr = document.createElement('div');
    stateHdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid var(--line);';
    stateHdr.innerHTML = `
      <span style="font-size:8.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--mute);flex:1">// CHARACTER STATE</span>
      ${!hasAnyState ? '<span style="font-size:8px;color:var(--mute);letter-spacing:.08em">— 暂无数据 —</span>' : ''}`;
    stateBox.appendChild(stateHdr);

    // 所有7个字段，包括 parallel，全部渲染进状态容器
    SECTIONS.forEach((sec, i) => {
      const val = rec[sec.key];
      if (!val) return;
      const item = document.createElement('div');
      item.className = 'ac-item';
      item.dataset.section = sec.key;
      item.style.animationDelay = i * 0.04 + 's';
      item.style.borderBottom = '1px solid var(--line)';
      const preview = val.slice(0, 22) + (val.length > 22 ? '…' : '');
      item.innerHTML = `
        <div class="ac-trigger">
          <div class="ac-bookmark">
            <span class="ac-bookmark-icon">${sec.icon}</span>
            <span class="ac-bookmark-label">${sec.key.toUpperCase()}</span>
          </div>
          <div class="ac-head" style="border-radius:0;border:none;border-bottom:none;">
            <div>
              <div class="ac-head-title">${sec.label}</div>
              <div class="ac-head-preview">${preview}</div>
            </div>
            <i class="fa-solid fa-chevron-right ac-chevron"></i>
          </div>
        </div>
        <div class="ac-body">
          <div class="ac-content" style="border-radius:0;border:none;border-top:1px solid var(--line);">
            ${sec.key === 'memo'
              ? (() => {
                  // memo 分行渲染：每行独立气泡便利贴样式
                  const lines = val.split(/\n/).map(l => l.replace(/^[\s\-·•·📌✦▸]+/, '').trim()).filter(Boolean);
                  const colors = [
                    { bg:'#fffde7', border:'rgba(251,191,36,.35)', dot:'#fbbf24', text:'#4a3800' },
                    { bg:'#eff6ff', border:'rgba(91,124,250,.25)', dot:'#5b7cfa', text:'#1e3a8a' },
                    { bg:'#f0fdf4', border:'rgba(34,197,94,.25)',  dot:'#22c55e', text:'#14532d' },
                    { bg:'#fdf2f8', border:'rgba(236,72,153,.22)', dot:'#ec4899', text:'#831843' },
                    { bg:'#fff7ed', border:'rgba(249,115,22,.25)', dot:'#f97316', text:'#7c2d12' },
                  ];
                  return `<div style="display:flex;flex-direction:column;gap:6px;padding:2px 0">` +
                    lines.map((line, li) => {
                      const c = colors[li % colors.length];
                      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:10px;background:${c.bg};border:1px solid ${c.border};box-shadow:-1px 2px 0 rgba(10,10,10,.04),0 1px 0 rgba(255,255,255,.8) inset;transform:rotate(${li%2===0?'-.3':'0.2'}deg)">
                        <span style="flex-shrink:0;width:6px;height:6px;border-radius:50%;background:${c.dot};margin-top:5px;box-shadow:0 0 4px ${c.dot}55"></span>
                        <span style="font-size:12.5px;color:${c.text};line-height:1.55;flex:1">${line}</span>
                      </div>`;
                    }).join('') +
                  `</div>`;
                })()
              : `<div class="ac-text${sec.secret?' secret':''}">${val}</div>`
            }
          </div>
        </div>`;
      item.querySelector('.ac-trigger').addEventListener('click', () => item.classList.toggle('open'));
      if (sec.secret) {
        const txt = item.querySelector('.ac-text.secret');
        let t2; txt.title = '长按解锁';
        const go = () => txt.classList.add('unlocked');
        txt.addEventListener('mousedown', () => t2=setTimeout(go,650));
        txt.addEventListener('touchstart', () => t2=setTimeout(go,650), {passive:true});
        ['mouseup','touchend','mouseleave'].forEach(ev => txt.addEventListener(ev, ()=>clearTimeout(t2)));
      }
      stateBox.appendChild(item);
    });
    scroll.appendChild(stateBox);

    // ── 批注小条（紧贴状态容器下方，作为整体的一部分） ──
    const annCnt = (rec.annotations||[]).length;
    const annStrip = document.createElement('div');
    const hasAnns = annCnt > 0;
    annStrip.style.cssText = `
      display:flex;align-items:center;gap:8px;
      padding:7px 13px;margin-bottom:14px;
      border:1px solid var(--line);border-top:none;
      border-radius:0 0 14px 14px;
      background:${hasAnns ? 'rgba(212,255,77,.07)' : 'var(--paper-2)'};
      cursor:${hasAnns ? 'pointer' : 'default'};
      transition:background .2s;
    `;
    annStrip.innerHTML = `
      <span style="font-size:10px">${hasAnns ? '✦' : '○'}</span>
      <span style="font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);flex:1">心声批注</span>
      ${hasAnns
        ? `<span style="font-size:9px;font-weight:600;color:var(--ink);letter-spacing:.05em">${annCnt} 条</span>
           <span style="font-size:8px;color:var(--mute);letter-spacing:.08em">点击播放 ▶</span>`
        : `<span style="font-size:8px;color:var(--mute);letter-spacing:.06em">暂无</span>`
      }`;
    if (hasAnns) {
      annStrip.addEventListener('mouseenter', () => annStrip.style.background='rgba(212,255,77,.14)');
      annStrip.addEventListener('mouseleave', () => annStrip.style.background='rgba(212,255,77,.07)');
      annStrip.addEventListener('click', () => {
        // 直接复用 API 成功后的统一播放函数
        playInnerAnimation({
          emoji:       rec.emoji,
          moodtag:     rec.moodtag,
          annotations: rec.annotations,
          parallel:    rec.parallel,
        });
      });
    }
    scroll.appendChild(annStrip);
  }

  /* ══════════════════════════════════════════════════════════════════
     TAB③ 心声批注
  ══════════════════════════════════════════════════════════════════ */
  async function renderAnnotateTab() {
    const scroll = $('#psScroll'); scroll.innerHTML = '';
    const recs = await getRecs();
    const rec = recs.find(r => r.id === activeRecordId) || recs[0];

    // 拼贴批注墙
    const wall = document.createElement('div');
    wall.className = 'ann-wall';
    if (rec?.annotations?.length) {
      renderAnnotationsOnWall(wall, rec.annotations);
    }
    const hint = document.createElement('div');
    hint.className = 'ann-wall-hint';
    hint.textContent = 'tap to replay ·';
    wall.appendChild(hint);
    wall.addEventListener('click', () => {
      if (!rec) return;
      // 直接复用 API 成功后的统一播放函数
      playInnerAnimation({
        emoji:       rec.emoji,
        moodtag:     rec.moodtag,
        annotations: rec.annotations,
        parallel:    rec.parallel,
      });
    });
    scroll.appendChild(wall);

    // 批注计数条（单条，显示当前记录批注数量）
    const cnt = (rec?.annotations||[]).length;
    const countBar = document.createElement('div');
    countBar.className = 'ann-count-bar';
    countBar.innerHTML = `
      <span class="acb-label">// annotation count</span>
      <div class="acb-track"><div class="acb-fill" style="width:${Math.min(cnt/MAX*100,100)}%"></div></div>
      <span class="acb-num">${cnt}<span style="opacity:.35;font-weight:400"> / ${MAX}</span></span>`;
    scroll.appendChild(countBar);

    // 用户批注输入区（批量添加后保存）
    const inputArea = buildAnnInputArea(rec);
    scroll.appendChild(inputArea);
  }

  function renderAnnotationsOnWall(wall, anns) {
    anns.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'an-item';
      el.style.setProperty('--r', (a.r || 0) + 'deg');
      el.style.cssText += `;left:${a.x}%;top:${a.y}%;transform:rotate(${a.r||0}deg);animation-delay:${i*0.08}s`;
      if (a.type === 'thought') {
        el.classList.add('an-thought'); el.textContent = a.text;
      } else if (a.type === 'note') {
        el.classList.add('an-note'); el.textContent = a.text;
      } else if (a.type === 'emoji') {
        el.classList.add('an-emoji'); el.textContent = a.text;
      } else if (a.type === 'cross') {
        el.classList.add('an-cross');
        el.innerHTML = `<span class="an-cross-text">${a.text}</span><div class="an-cross-line"></div>`;
      } else if (a.type === 'hl') {
        el.classList.add('an-hl'); el.textContent = a.text;
      }
      wall.appendChild(el);
    });
  }

  function buildAnnInputArea(rec) {
    const wrap = document.createElement('div');
    wrap.className = 'ann-input-area';
    wrap.innerHTML = `
      <div class="ann-input-title">
        <span>// 添加批注</span>
        <span style="font-weight:400;opacity:.5">${annStagingList.length} 条待保存</span>
      </div>
      <div class="ann-staging" id="annStaging">
        ${annStagingList.map((a,i)=>`<span class="ann-staged-chip ${a.type}" data-i="${i}">${a.type==='emoji'?a.text:'<i class="fa-solid fa-pen-nib" style="font-size:9px"></i>'+a.text.slice(0,12)}</span>`).join('')}
        ${annStagingList.length===0?'<span style="font-size:9px;color:var(--mute);letter-spacing:.08em;align-self:center">待添加批注…</span>':''}
      </div>
      <div class="ann-type-row">
        <button class="ann-tbtn on" data-t="thought">💭 独白</button>
        <button class="ann-tbtn" data-t="note">🔵 批注</button>
        <button class="ann-tbtn" data-t="emoji">🎭 表情</button>
        <button class="ann-tbtn" data-t="cross">〰 划掉</button>
        <button class="ann-tbtn" data-t="hl">💛 高亮</button>
      </div>
      <input class="ann-inp" id="annInp" type="text" placeholder="输入批注内容……">
      <div class="ann-emoji-row" id="annEmojiRow" style="display:none">
        ${ANN_EMOJIS.map(e=>`<span class="ann-eopt" data-e="${e}">${e}</span>`).join('')}
      </div>
      <div style="display:flex;gap:7px;margin-top:7px">
        <button class="ann-add-chip" id="annAddChip"><i class="fa-solid fa-plus"></i> 添加</button>
        <button class="ann-save-btn" id="annSaveBtn" style="flex:1"><i class="fa-solid fa-floppy-disk"></i> 保存批注集</button>
      </div>`;

    // 暂存 chip 点击移除
    wrap.querySelector('#annStaging').addEventListener('click', e => {
      const chip = e.target.closest('.ann-staged-chip'); if (!chip) return;
      annStagingList.splice(+chip.dataset.i, 1);
      renderAnnotateTab();
    });

    // 类型选择
    wrap.querySelectorAll('.ann-tbtn').forEach(b => b.addEventListener('click', () => {
      wrap.querySelectorAll('.ann-tbtn').forEach(x=>x.classList.remove('on'));
      b.classList.add('on'); annActiveType = b.dataset.t;
      const isE = annActiveType === 'emoji';
      wrap.querySelector('#annInp').style.display = isE ? 'none' : '';
      wrap.querySelector('#annEmojiRow').style.display = isE ? 'flex' : 'none';
    }));
    wrap.querySelector('#annEmojiRow').addEventListener('click', e => {
      const t = e.target.closest('.ann-eopt'); if (!t) return;
      wrap.querySelectorAll('.ann-eopt').forEach(x=>x.classList.remove('on'));
      t.classList.add('on'); annActiveEmoji = t.dataset.e;
    });

    // 添加到暂存
    wrap.querySelector('#annAddChip').addEventListener('click', () => {
      const text = annActiveType === 'emoji' ? annActiveEmoji : wrap.querySelector('#annInp').value.trim();
      if (!text) return;
      annStagingList.push({ type: annActiveType, text, x: rndI(10,70), y: rndI(10,70), r: rndI(-8,8) });
      wrap.querySelector('#annInp').value = '';
      renderAnnotateTab();
    });

    // 保存批注集——追加到现有批注（不覆盖）
    wrap.querySelector('#annSaveBtn').addEventListener('click', async () => {
      if (!annStagingList.length || !rec) return;
      const recs = await getRecs();
      const idx = recs.findIndex(r => r.id === rec.id);
      if (idx === -1) return;
      const existing = recs[idx].annotations || [];
      recs[idx].annotations = [...existing, ...annStagingList];
      await saveRecs(recs);
      annStagingList = [];
      renderAnnotateTab();
    });

    return wrap;
  }

  /* ══════════════════════════════════════════════════════════════════
     GRAFFITI OVERLAY（聊天区涂鸦演示）
  ══════════════════════════════════════════════════════════════════ */
  function buildGfOverlay() {
    if ($('#gfOverlay')) return;
    const ov = document.createElement('div');
    ov.className = 'gf-overlay'; ov.id = 'gfOverlay';
    ov.innerHTML = `<button class="gf-overlay-close" id="gfOverlayClose"><i class="fa-solid fa-xmark"></i></button>`;
    document.body.appendChild(ov);
    $('#gfOverlayClose').onclick = () => { ov.classList.remove('active'); ov.querySelectorAll('.an-item').forEach(e=>e.remove()); };
  }

  /**
   * showGraffitiOverlay(anns, decorMode)
   * decorMode=false（默认）：正常模式，有蒙版+关闭按钮，批注可点击消失
   * decorMode=true：装饰模式，透明无蒙版，不拦截操作，N秒后自动淡出
   */
  /**
   * showGraffitiOverlay(anns, decorMode)
   * decorMode=false（默认）：正常模式，蒙版+关闭按钮，批注可逐一点击消失
   * decorMode=true：装饰模式，fixed 全屏透明层，不拦截操作，N秒后自动淡出
   */
  function showGraffitiOverlay(anns, decorMode) {
    if (decorMode) {
      // 用 getBoundingClientRect 读取 chatArea 实际屏幕坐标，fixed 精确贴合，不影响滚动
      const chatArea = $('#chatArea');
      const rect = chatArea
        ? chatArea.getBoundingClientRect()
        : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };

      let dl = $('#gfDecorLayer');
      if (!dl) {
        dl = document.createElement('div');
        dl.id = 'gfDecorLayer';
        document.body.appendChild(dl);
      }
      // z-index 500：高于聊天气泡，低于飘屏粒子层(9990)，两者同时可见
      dl.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;z-index:500;pointer-events:none;overflow:hidden;`;
      dl.querySelectorAll('.an-item').forEach(e => e.remove());
      dl.classList.add('active');

      const totalDur = anns.length * 320 + 600;

      anns.forEach((a, i) => {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'an-item';
          el.style.setProperty('--r', (a.r||0)+'deg');
          el.style.left = a.x + '%'; el.style.top = a.y + '%';
          el.style.pointerEvents = 'auto';
          if (a.type==='thought') { el.classList.add('an-thought'); el.textContent=a.text; }
          else if (a.type==='note') { el.classList.add('an-note'); el.textContent=a.text; }
          else if (a.type==='emoji') { el.classList.add('an-emoji'); el.textContent=a.text; el.style.fontSize=rndI(24,40)+'px'; }
          else if (a.type==='cross') { el.classList.add('an-cross'); el.innerHTML=`<span class="an-cross-text">${a.text}</span><div class="an-cross-line"></div>`; }
          else if (a.type==='hl') { el.classList.add('an-hl'); el.textContent=a.text; }
          el.addEventListener('animationend', () => { el.classList.add('ready'); }, { once: true });
          el.addEventListener('click', () => { el.classList.add('dismissing'); setTimeout(() => el.remove(), 450); });
          dl.appendChild(el);
        }, i * 320);
      });

      // 宇宙气泡在 t=9s 出现，5s后两者同步淡出；批注从 t=0 开始，故等待 9000+5000=14000ms-2s
      setTimeout(() => {
        dl.style.transition = 'opacity .9s ease';
        dl.style.opacity = '0';
        setTimeout(() => {
          dl.querySelectorAll('.an-item').forEach(e => e.remove());
          dl.classList.remove('active');
          dl.style.opacity = '';
          dl.style.transition = '';
        }, 950);
      }, totalDur + 12000);

      return;
    }

    // ── 正常模式：走 gfOverlay（蒙版+关闭按钮，批注可点击消失） ──────
    const ov = $('#gfOverlay'); if (!ov) return;
    ov.querySelectorAll('.an-item').forEach(e=>e.remove());
    ov.classList.remove('decor-mode');
    ov.classList.add('active');

    anns.forEach((a, i) => {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'an-item';
        el.style.setProperty('--r', (a.r||0)+'deg');
        el.style.left = a.x + '%'; el.style.top = a.y + '%';
        if (a.type==='thought') { el.classList.add('an-thought'); el.textContent=a.text; }
        else if (a.type==='note') { el.classList.add('an-note'); el.textContent=a.text; }
        else if (a.type==='emoji') { el.classList.add('an-emoji'); el.textContent=a.text; el.style.fontSize=rndI(24,40)+'px'; }
        else if (a.type==='cross') { el.classList.add('an-cross'); el.innerHTML=`<span class="an-cross-text">${a.text}</span><div class="an-cross-line"></div>`; }
        else if (a.type==='hl') { el.classList.add('an-hl'); el.textContent=a.text; }
        el.addEventListener('animationend', () => { el.classList.add('ready'); }, { once: true });
        el.addEventListener('click', () => {
          el.classList.add('dismissing');
          setTimeout(() => el.remove(), 450);
        });
        ov.appendChild(el);
      }, i * 320);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     TAB④ 保险箱 Tab（直接内嵌 PIN 解锁 + 内容展示在 scroll 区）
  ══════════════════════════════════════════════════════════════════ */
  let vaultUnlocked = false;

  async function renderVaultTab() {
    const scroll = $('#psScroll');
    scroll.innerHTML = '';
    // 整个 scroll 区域改为深色背景
    scroll.style.background = 'var(--ink)';
    scroll.style.borderRadius = '0 0 26px 26px';

    // 标头
    const hdr = document.createElement('div');
    hdr.style.cssText = 'margin-bottom:14px;';
    hdr.innerHTML = `
      <div style="font-style:italic;font-size:22px;color:var(--paper);display:flex;align-items:baseline;gap:6px;margin-bottom:3px">
        绝对不说出口<span style="width:5px;height:5px;border-radius:50%;background:var(--accent-lime);display:inline-block;transform:translateY(-4px)"></span>
      </div>
      <div style="font-size:9px;color:rgba(255,255,255,.3);letter-spacing:.14em;text-transform:uppercase">// secret vault · pin required · max ${MAX}</div>`;
    scroll.appendChild(hdr);

    if (!vaultUnlocked) {
      // PIN 解锁界面（内嵌在 scroll 里，不用 modal）
      const lockWrap = document.createElement('div');
      lockWrap.id = 'tabVaultLock';
      lockWrap.innerHTML = `
        <div style="display:flex;gap:10px;justify-content:center;margin-bottom:12px" id="tvDots">
          ${Array(4).fill('<div style="width:13px;height:13px;border-radius:50%;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.18);transition:.18s" class="tv-dot"></div>').join('')}
        </div>
        <div style="text-align:center;font-size:10px;color:var(--accent-coral);letter-spacing:.08em;min-height:16px;margin-bottom:10px" id="tvErr"></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:240px;margin:0 auto" id="tvKp">
          ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="v-key" data-k="${n}">${n}</button>`).join('')}
          <button class="v-key v-del" data-k="del"><i class="fa-solid fa-delete-left"></i></button>
          <button class="v-key" data-k="0">0</button>
          <button class="v-key v-ok" data-k="ok"><i class="fa-solid fa-check"></i></button>
        </div>`;
      scroll.appendChild(lockWrap);

      let pin = '';
      const dots = lockWrap.querySelectorAll('.tv-dot');
      const upd = () => dots.forEach((d,i) => {
        d.style.background = i < pin.length ? 'var(--accent-lime)' : 'rgba(255,255,255,.1)';
        d.style.borderColor = i < pin.length ? 'var(--accent-lime)' : 'rgba(255,255,255,.18)';
        d.style.boxShadow = i < pin.length ? '0 0 6px rgba(212,255,77,.4)' : '';
      });
      const shake = msg => {
        const err = $('#tvErr'); err.textContent = msg;
        const d = $('#tvDots'); d.style.animation='none'; d.offsetHeight; d.style.animation='shake .4s';
        setTimeout(()=>{ pin=''; upd(); err.textContent=''; }, 800);
      };

      lockWrap.querySelector('#tvKp').addEventListener('click', async e => {
        const b = e.target.closest('.v-key'); if (!b) return;
        const k = b.dataset.k;
        if (k==='del') { pin=pin.slice(0,-1); upd(); }
        else if (k==='ok') {
          if (pin.length < 4) { shake('请输入完整PIN'); return; }
          const stored = (await dbGet('config', KEY_VAULT())) || {};
          if (!stored.pin) {
            // 首次：设置 PIN
            stored.id = KEY_VAULT(); stored.pin = pin; stored.secrets = stored.secrets||[];
            await dbPut('config', stored);
            vaultUnlocked = true; renderVaultTab();
          } else if (stored.pin === pin) {
            vaultUnlocked = true; renderVaultTab();
          } else shake('PIN 错误');
        } else { if (pin.length < 4) { pin += k; upd(); } }
      });
    } else {
      // 已解锁：展示密钥列表 + 输入框
      const stored = (await dbGet('config', KEY_VAULT())) || { secrets: [] };
      const secrets = stored.secrets || [];

      // 锁定按钮
      const lockBtn = document.createElement('button');
      lockBtn.style.cssText = 'margin-bottom:12px;padding:5px 14px;border-radius:100px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);font-size:9px;color:rgba(255,255,255,.45);cursor:pointer;display:flex;align-items:center;gap:5px;transition:.2s;';
      lockBtn.innerHTML = '<i class="fa-solid fa-lock"></i> 重新锁定';
      lockBtn.onmouseenter = () => lockBtn.style.background='rgba(255,255,255,.14)';
      lockBtn.onmouseleave = () => lockBtn.style.background='rgba(255,255,255,.07)';
      lockBtn.onclick = () => { vaultUnlocked = false; renderVaultTab(); };
      scroll.appendChild(lockBtn);

      // 输入框
      const inputWrap = document.createElement('div');
      inputWrap.style.cssText = 'display:flex;gap:7px;margin-bottom:12px;align-items:flex-start;';
      inputWrap.innerHTML = `
        <textarea id="tvTa" placeholder="输入绝对不会说出口的话…" rows="2"
          style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:9px 12px;color:var(--paper);font-style:italic;font-size:13px;outline:none;resize:none;transition:border-color .2s;"></textarea>
        <button id="tvSave" style="padding:8px 14px;border-radius:11px;border:none;background:var(--accent-lime);color:var(--ink);font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;transform:rotate(-.5deg)"><i class="fa-solid fa-lock"></i> 封存</button>`;
      scroll.appendChild(inputWrap);
      inputWrap.querySelector('#tvSave').addEventListener('click', async () => {
        const text = $('#tvTa').value.trim(); if (!text) return;
        stored.secrets = stored.secrets||[];
        stored.secrets.unshift({ id: Date.now(), ts: Date.now(), text });
        if (stored.secrets.length > MAX) stored.secrets.length = MAX;
        await dbPut('config', stored);
        $('#tvTa').value = '';
        renderVaultTab();
      });

      // 计数条（深色）
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);margin-bottom:10px;';
      bar.innerHTML = `
        <span style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.3)">// stored</span>
        <div style="flex:1;height:3px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden"><div style="height:100%;background:var(--accent-lime);border-radius:2px;width:${Math.min(secrets.length/MAX*100,100)}%;transition:width .6s cubic-bezier(.22,1,.36,1)"></div></div>
        <span style="font-size:10px;font-weight:600;color:var(--paper)">${secrets.length}<span style="opacity:.3;font-weight:400"> / ${MAX}</span></span>`;
      scroll.appendChild(bar);

      // 秘密列表（深色卡片）
      if (!secrets.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center;padding:24px;font-style:italic;font-size:14px;color:rgba(255,255,255,.25);';
        empty.textContent = '还没有封存任何秘密…';
        scroll.appendChild(empty);
      } else {
        secrets.forEach((s, i) => {
          const card = document.createElement('div');
          card.style.cssText = 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);border-radius:13px;padding:11px 13px;margin-bottom:7px;animation:riIn .28s cubic-bezier(.22,1,.36,1) both;';
          card.style.animationDelay = i * 0.04 + 's';
          const tsEl = document.createElement('div');
          tsEl.style.cssText = 'font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:5px;cursor:pointer;display:inline-block;border-bottom:1px dotted rgba(255,255,255,.15);transition:.15s;';
          tsEl.textContent = `// #${String(i+1).padStart(2,'0')} · ${fmtTs(s.ts)}`;
          tsEl.title = '点击删除此条';
          tsEl.onmouseenter = () => { tsEl.style.color='rgba(255,107,107,.8)'; };
          tsEl.onmouseleave = () => { tsEl.style.color='rgba(255,255,255,.35)'; };
          tsEl.addEventListener('click', async () => {
            const ok = await showTsukiConfirm('删除这条保险箱记录？\n此操作不可撤销。', '确认删除');
            if (!ok) return;
            stored.secrets.splice(i, 1);
            await dbPut('config', stored);
            renderVaultTab();
          });
          const textEl = document.createElement('div');
          textEl.style.cssText = 'font-style:italic;font-size:13px;color:var(--paper);line-height:1.55';
          textEl.textContent = s.text;
          card.appendChild(tsEl);
          card.appendChild(textEl);
          scroll.appendChild(card);
        });
      }
    }
  }

  /* ── Vault modal（保留供 buildVaultModal 内部用，外部不再从 Tab① 调用）── */
  function buildVaultTileEl() {
    // 已废弃，保留空函数避免报错
    return document.createElement('div');
  }

  function buildVaultModal() {
    if ($('#vaultModal')) return;
    const m = document.createElement('div');
    m.className = 'vault-modal'; m.id = 'vaultModal';
    m.innerHTML = `
      <div class="vault-bg" id="vaultBg"></div>
      <div class="vault-panel" id="vaultPanel">
        <button class="vault-close-btn" id="vaultCloseBtn"><i class="fa-solid fa-xmark"></i></button>
        <div class="vault-hdl"></div>
        <div class="vault-ttl">绝对不说出口<span class="vault-ttl-dot"></span></div>
        <div class="vault-st">// secret vault · pin required · max ${MAX}</div>
        <div id="vLockView">
          <div class="vault-dots" id="vDots">${Array(4).fill('<div class="vault-dot"></div>').join('')}</div>
          <div class="vault-err" id="vErr"></div>
          <div class="vault-kp">
            ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="v-key" data-k="${n}">${n}</button>`).join('')}
            <button class="v-key v-del" data-k="del"><i class="fa-solid fa-delete-left"></i></button>
            <button class="v-key" data-k="0">0</button>
            <button class="v-key v-ok" data-k="ok"><i class="fa-solid fa-check"></i></button>
          </div>
        </div>
        <div class="vault-content" id="vContent">
          <div class="vault-secrets-list" id="vSecretsList"></div>
          <textarea class="vault-ta" id="vTa" placeholder="输入绝对不会说出口的话…" rows="3"></textarea>
          <button class="vault-save" id="vSaveBtn"><i class="fa-solid fa-lock"></i> 封存</button>
        </div>
      </div>`;
    document.body.appendChild(m);

    $('#vaultBg').onclick = $('#vaultCloseBtn').onclick = closeVault;
    let pin = '';
    const dots = $$('.vault-dot', m);
    const upd = () => dots.forEach((d,i) => d.classList.toggle('on', i < pin.length));
    const shake = msg => {
      $('#vErr').textContent = msg;
      const d = $('#vDots'); d.style.animation='none'; d.offsetHeight; d.style.animation='shake .4s';
      setTimeout(()=>{ pin=''; upd(); $('#vErr').textContent=''; }, 800);
    };
    m.querySelector('.vault-kp').addEventListener('click', async e => {
      const b = e.target.closest('.v-key'); if (!b) return;
      const k = b.dataset.k;
      if (k==='del') { pin=pin.slice(0,-1); upd(); }
      else if (k==='ok') {
        if (pin.length < 4) { shake('请输入完整PIN'); return; }
        const stored = (await dbGet('config', KEY_VAULT())) || {};
        if (!stored.pin) {
          stored.id = KEY_VAULT(); stored.pin = pin; stored.secrets = stored.secrets||[];
          await dbPut('config', stored); showVaultContent(stored);
        } else if (stored.pin === pin) { showVaultContent(stored); }
        else shake('PIN 错误');
      } else { if (pin.length < 4) { pin += k; upd(); } }
    });
    $('#vSaveBtn').addEventListener('click', async () => {
      const text = $('#vTa').value.trim(); if (!text) return;
      const stored = (await dbGet('config', KEY_VAULT())) || { id: KEY_VAULT(), secrets: [] };
      stored.secrets = stored.secrets || [];
      stored.secrets.unshift({ id: Date.now(), ts: Date.now(), text });
      if (stored.secrets.length > MAX) stored.secrets.length = MAX;
      await dbPut('config', stored);
      $('#vTa').value = '';
      showVaultContent(stored);
    });
    // drag close
    let sy=0;
    $('#vaultPanel').addEventListener('touchstart', e=>sy=e.touches[0].clientY, {passive:true});
    $('#vaultPanel').addEventListener('touchend', e=>{ if(e.changedTouches[0].clientY-sy>80) closeVault(); }, {passive:true});
  }

  function showVaultContent(stored) {
    $('#vLockView').style.display = 'none';
    const content = $('#vContent'); content.classList.add('show');
    const list = $('#vSecretsList'); list.innerHTML = '';
    (stored.secrets||[]).forEach((s, i) => {
      const el = document.createElement('div'); el.className = 'vault-secret-item';
      el.innerHTML = `<div class="vault-s-idx">// #${String(i+1).padStart(2,'0')}</div><div class="vault-s-text">${s.text}</div><div class="vault-s-ts">${fmtTs(s.ts)}</div>`;
      list.appendChild(el);
    });
  }
  function openVault() {
    $('#vaultModal').classList.add('open');
    $('#vLockView').style.display = ''; $('#vContent').classList.remove('show');
    $$('.vault-dot').forEach(d=>d.classList.remove('on')); $('#vErr').textContent = '';
  }
  function closeVault() { $('#vaultModal').classList.remove('open'); }

  /* ══════════════════════════════════════════════════════════════════
     WEATHER
  ══════════════════════════════════════════════════════════════════ */
  let wxLayer=null,wxBnr=null,wxT=null,wxKill=null;
  function buildWeather() {
    if (!$('#moodLayer')) {
      wxLayer = document.createElement('div'); wxLayer.id='moodLayer'; document.body.appendChild(wxLayer);
    } else {
      wxLayer = $('#moodLayer');
    }
    if (!$('#moodBnr')) {
      wxBnr = document.createElement('div'); wxBnr.className='mood-bnr'; wxBnr.id='moodBnr'; document.body.appendChild(wxBnr);
    } else {
      wxBnr = $('#moodBnr');
    }
  }

  const WEATHER_SETS = {
    // 每个 icon 是 { fa: 'fa-xxx', colors: [...] }（浅色系染色，同情绪深浅变化）
    happy: {
      label: '心情不错',
      icons: [
        { fa:'fa-heart',            colors:['#ffb3c6','#ff8fab','#ffc8d5','#ffccd5'] },
        { fa:'fa-star',             colors:['#ffd6a5','#ffb347','#ffe5a0','#ffefc1'] },
        { fa:'fa-feather',          colors:['#b5e0d4','#7ecec4','#d0f0e8','#a8dfd4'] },
        { fa:'fa-clover',           colors:['#b8f0c0','#85e89d','#d4f7da','#a3e8ad'] },
        { fa:'fa-music',            colors:['#c4b5fd','#a78bfa','#ddd6fe','#ede9fe'] },
        { fa:'fa-sparkles',         colors:['#fde68a','#fbbf24','#fef3c7','#fffbeb'] },
      ],
    },
    sad: {
      label: '心情低落',
      icons: [
        { fa:'fa-droplet',          colors:['#bae6fd','#7dd3fc','#e0f2fe','#c7ebff'] },
        { fa:'fa-cloud',            colors:['#cbd5e1','#94a3b8','#e2e8f0','#dce5ef'] },
        { fa:'fa-snowflake',        colors:['#bfdbfe','#93c5fd','#dbeafe','#eff6ff'] },
        { fa:'fa-leaf',             colors:['#d1fae5','#6ee7b7','#ecfdf5','#a7f3d0'] },
        { fa:'fa-moon',             colors:['#c4b5fd','#a78bfa','#ede9fe','#ddd6fe'] },
        { fa:'fa-wind',             colors:['#e2e8f0','#cbd5e1','#f1f5f9','#d5dce8'] },
      ],
    },
    excited: {
      label: '心跳加速',
      icons: [
        { fa:'fa-bolt',             colors:['#fde68a','#fcd34d','#fef3c7','#fffbeb'] },
        { fa:'fa-fire-flame-curved',colors:['#fed7aa','#fdba74','#ffedd5','#fef0e4'] },
        { fa:'fa-star-of-life',     colors:['#fca5a5','#f87171','#fee2e2','#fecaca'] },
        { fa:'fa-circle-radiation', colors:['#fde68a','#fbbf24','#fef3c7','#fffde7'] },
        { fa:'fa-wand-magic-sparkles',colors:['#e9d5ff','#d8b4fe','#f3e8ff','#faf5ff'] },
        { fa:'fa-burst',            colors:['#fca5a5','#fb7185','#fee2e2','#ffe4e8'] },
      ],
    },
    melancholy: {
      label: '若有所思',
      icons: [
        { fa:'fa-moon',             colors:['#e9d5ff','#c4b5fd','#f5f3ff','#ede9fe'] },
        { fa:'fa-star',             colors:['#bae6fd','#93c5fd','#dbeafe','#eff6ff'] },
        { fa:'fa-cloud-moon',       colors:['#ddd6fe','#c4b5fd','#ede9fe','#f5f3ff'] },
        { fa:'fa-feather-pointed',  colors:['#d1fae5','#a7f3d0','#ecfdf5','#d0fce8'] },
        { fa:'fa-waveform',         colors:['#fce7f3','#fbcfe8','#fdf2f8','#fce4f2'] },
        { fa:'fa-circle-dot',       colors:['#e0e7ff','#c7d2fe','#eef2ff','#e8ecff'] },
      ],
    },
    // 默认：月亮星星
    default: {
      label: '心绪流转',
      icons: [
        { fa:'fa-moon',             colors:['#e9d5ff','#c4b5fd','#ddd6fe','#f3e8ff'] },
        { fa:'fa-star',             colors:['#fde68a','#fef3c7','#bae6fd','#dbeafe'] },
        { fa:'fa-cloud-moon',       colors:['#ddd6fe','#ede9fe','#c4b5fd','#e9d5ff'] },
        { fa:'fa-circle-dot',       colors:['#e0e7ff','#c7d2fe','#bae6fd','#e0f2fe'] },
      ],
    },
  };

  /* 用 SVG use 方式内联 FA 图标（作为 <i> 挂 innerHTML 最简单） */
  function makeIconParticle(fa, color) {
    const wrap = document.createElement('span');
    wrap.className = 'mood-particle';
    wrap.innerHTML = `<i class="fa-solid ${fa}" style="color:${color};display:block;line-height:1;"></i>`;
    return wrap;
  }

  function triggerWeather(type, emoji) {
    if (!wxLayer) return;
    if (wxKill) { wxKill(); wxKill = null; }
    wxLayer.innerHTML = '';

    const cfg = WEATHER_SETS[type] || WEATHER_SETS.default;
    showBnr(emoji, cfg.label);

    const COUNT = 60;
    let stopped = false;
    const timers = [];

    const spawnOne = (iconDef, delayMs) => {
      const t = setTimeout(() => {
        if (stopped) return;
        const color = iconDef.colors[rndI(0, iconDef.colors.length - 1)];
        const p = makeIconParticle(iconDef.fa, color);
        const startX = rnd(-2, 102);
        const driftX = rnd(-18, 18);
        const startY = rnd(-12, -3);
        const endY   = rnd(102, 115);
        const sz0    = rnd(11, 32);
        const szE    = sz0 * rnd(0.5, 1.25);
        const r0     = rnd(-45, 45);
        const rE     = r0 + rnd(-120, 120);
        const dur    = rnd(4200, 9000);
        const peakA  = rnd(0.35, 0.72);
        const sway   = rnd(-8, 8);

        p.style.fontSize = sz0 + 'px';
        p.style.left  = startX + '%';
        p.style.top   = startY + 'vh';
        p.style.setProperty('--tx0',    `translateX(0) translateY(0)`);
        p.style.setProperty('--txE',    `translateX(${driftX + sway}vw) translateY(${endY - startY}vh)`);
        p.style.setProperty('--s0',     '1');
        p.style.setProperty('--sE',     (szE / sz0).toFixed(2));
        p.style.setProperty('--r0',     r0 + 'deg');
        p.style.setProperty('--rE',     rE + 'deg');
        p.style.setProperty('--peak-a', peakA);
        p.style.animationDuration = dur + 'ms';
        p.style.animationTimingFunction = 'cubic-bezier(.25,.1,.3,1)';

        wxLayer.appendChild(p);
        const cleanup = setTimeout(() => { if (p.parentNode) p.remove(); }, dur + 200);
        timers.push(cleanup);
      }, delayMs);
      timers.push(t);
    };

    for (let i = 0; i < COUNT; i++) {
      const iconDef = cfg.icons[i % cfg.icons.length];
      spawnOne(iconDef, rnd(0, 5500));
    }

    const fadeOut = setTimeout(() => {
      wxLayer.style.transition = 'opacity .8s';
      wxLayer.style.opacity = '0';
      const clear = setTimeout(() => {
        if (stopped) return;
        wxLayer.innerHTML = '';
        wxLayer.style.opacity = '';
        wxLayer.style.transition = '';
      }, 900);
      timers.push(clear);
    }, 8000);
    timers.push(fadeOut);

    wxKill = () => {
      stopped = true;
      timers.forEach(clearTimeout);
      wxLayer.innerHTML = '';
      wxLayer.style.opacity = '';
      wxLayer.style.transition = '';
    };
  }

  function showBnr(e,l){wxBnr.innerHTML=`<span class="bnr-e">${e}</span> ${l}`;wxBnr.classList.add('show');if(wxT)clearTimeout(wxT);wxT=setTimeout(()=>wxBnr.classList.remove('show'),17000);}
  function hideBnr(){if(wxT)clearTimeout(wxT);wxBnr.classList.remove('show');}

  /* ══════════════════════════════════════════════════════════════════
     PARALLEL UNIVERSE
  ══════════════════════════════════════════════════════════════════ */
  // 平行宇宙气泡：仅由 AI 返回的 parallel 字段触发（飘屏结束后），不再有内置默认文案和自动定时器
  function spawnPara(txt){
    if (!txt) return;
    $$('.para-bubble').forEach(b=>{ b.classList.add('dismissing'); setTimeout(()=>b.remove(),420); });
    const el=document.createElement('div');el.className='para-bubble';
    el.textContent=txt;
    document.body.appendChild(el);
    const dismiss = () => {
      el.classList.add('dismissing');
      clearTimeout(autoT);
      setTimeout(()=>el.remove(),420);
    };
    el.addEventListener('click', dismiss);
    const autoT = setTimeout(dismiss, 5000);
  }

  /* ══════════════════════════════════════════════════════════════════
     SHARED ANIMATION PLAYER
     playInnerAnimation({ emoji, moodtag, annotations, parallel })
     — 与 API 成功路径完全一致的异步播放逻辑：
       1. closePocket()（面板已关闭，pocketOpen=false）
       2. await 等面板关闭动画完成（0.42s）
       3. triggerWeather + showGraffitiOverlay 同时启动
       4. 9s 后 hideBnr + spawnPara
     播放按钮和 API 回调都调用这一个函数，保证行为完全一致。
  ══════════════════════════════════════════════════════════════════ */
  const EMOJI_WEATHER_MAP = {
    '😊':'happy','🥰':'happy','💗':'happy','✨':'excited','😳':'excited',
    '😤':'sad','😔':'sad','🥺':'melancholy','😌':'melancholy','💭':'melancholy',
    '🌙':'melancholy','😏':'excited','💀':'sad','💔':'sad','😒':'sad',
    '❄️':'sad','🌸':'happy','😶':'melancholy','🔥':'excited','💢':'excited',
  };
  const MOODTAG_WEATHER_MAP = {
    '黏':'melancholy','痴':'melancholy','燃':'excited','碎':'sad','醉':'melancholy',
    '忧':'sad','嗔':'excited','痛':'sad','狂':'excited','怯':'melancholy',
    '甜':'happy','暖':'happy','悸':'excited','涩':'sad','慕':'happy',
  };

  async function playInnerAnimation({ emoji, moodtag, annotations, parallel }) {
    // 1. 关闭面板（与 API 路径 closePocket() 时机完全一致）
    closePocket();

    // 2. await 面板关闭动画（pocket-sheet transition: 0.42s）
    await sleep(450);

    // 3. 飘屏 + 批注同时启动（与 API 成功后完全一致）
    const wtype = EMOJI_WEATHER_MAP[emoji] || MOODTAG_WEATHER_MAP[moodtag];
    if (wtype) triggerWeather(wtype, emoji || moodtag);

    if (annotations && annotations.length) {
      if (!$('#gfOverlay')) buildGfOverlay();
      showGraffitiOverlay(annotations, true /* decorMode */);
    }

    // 4. 平行宇宙气泡在飘屏动画结束时（9s）同步出现
    if (parallel) {
      setTimeout(() => hideBnr(), 8000);
      setTimeout(() => spawnPara(parallel), 9000);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     AI 心声召唤
     triggerInnerVoiceAI() — 调用 API，生成角色完整心声状态 + 批注 + 保险柜
     参照 TsukiSend.callApi 的调用模式与配置读取
  ══════════════════════════════════════════════════════════════════ */

  // ── 提示词模板 ──────────────────────────────────────────────────────
  const INNER_SYSTEM_PROMPT = `你是一个专业的心理刻画助手。你的任务是：根据提供的角色人设与最近的聊天记录，以第一人称视角，深度还原角色此刻真实的内心世界，生成一份完整的心声状态报告。

【输出格式】
全部内容必须包裹在 <inner>...</inner> 标签内，结构如下：

<inner>
<outfit>（此刻的衣着、仪态、身体状态，细节鲜活，不超过80字）</outfit>
<mood>（此刻的情绪关键词，2-4个，用顿号分隔，如：压抑的占有欲、灼烧的妒意）</mood>
<mono>（内心独白，用第一人称写出角色此刻的真实心声，100-200字，口吻自然，有情绪温度，不做作）</mono>
<psyche>（深层心理剖析，挖掘角色不敢承认的欲望、执念或暗面，60-120字，可以阴暗、可以露骨，但要真实）</psyche>
<parallel>（平行宇宙假设，以"如果……"开头，写一个角色心底最想但没做的那个选择，1句话，20-40字）</parallel>
<memo>（给自己的备忘，像便利贴一样，1-3条，简短直接，可以是提醒自己克制、或者某个小计划）</memo>
<diary>（当日日记，娓娓道来的诗意感，如同夜深人静时轻声写下的私语，语言流动而细腻，有意象，有留白，120-200字。禁止过于直白的情绪宣泄，要有文学质感）</diary>
<emoji>（最能代表此刻心情的emoji，只写一个）</emoji>
<moodtag>（用一个汉字概括此刻情绪，如：黏、痴、燃、碎、醉、忧、嗔、痛、狂、怯，只写一个字）</moodtag>
<annotations>
<ann type="thought" x="8" y="10" r="-4">（内心话碎片1）</ann>
<ann type="cross" x="55" y="30" r="2">（想划掉的念头1）</ann>
<ann type="note" x="20" y="62" r="-3">（批注语1）</ann>
<ann type="emoji" x="75" y="15" r="1">（单个emoji）</ann>
<ann type="hl" x="10" y="80" r="3">（想高亮的一句话1）</ann>
<ann type="thought" x="35" y="45" r="5">（内心话碎片2）</ann>
<ann type="note" x="65" y="70" r="-2">（批注语2）</ann>
</annotations>
<vault>（一条绝对不会对任何人开口的私密记录：可以是一段想象中的亲密场景描述、一个大尺度的幻想片段、一段无法见人的音视频记录描述、或某句只能藏在心底的密语。内容可以露骨、私密、甚至越轨，用第一人称写，50-100字）</vault>
</inner>

【关键规则】
1. 必须且只能输出一个 <inner>...</inner> 块，不要在标签外加任何解释、序号或正文。
2. 所有字段必须存在，不得省略任何一个（包括 moodtag）。
3. annotations 中必须包含至少5条 <ann>，类型覆盖 thought/cross/note/emoji/hl，x/y 为 0-100 的整数百分比，r 为 -10 到 10 的旋转角度。
4. diary 必须有诗意感：用意象、用细节、用留白，像散文诗，而非流水账或情绪宣言。
5. vault 必须私密且具体，可以涉及幻想中的身体亲密、不可告人的影像或密语，不要用泛泛而谈的话糊弄。
6. 严格用角色第一人称，不要以"这个角色"等第三人称称呼。
`.trim();

  // ── 显示加载状态 ────────────────────────────────────────────────────
  function showInnerLoading(show) {
    if (show) {
      if ($('#tiInnerLoading')) return;
      const el = document.createElement('div');
      el.id = 'tiInnerLoading';
      el.innerHTML = `
        <span style="font-size:13px;margin-right:6px">🌙</span>
        <span style="font-size:12px;letter-spacing:.04em;color:var(--ink-3,#4a4a4a)">心声状态感知中</span>
        <svg id="tiLoadingDots" width="28" height="10" viewBox="0 0 28 10" style="margin-left:5px;vertical-align:middle;overflow:visible">
          <style>
            @keyframes tiDotPulse {
              0%,80%,100% { r: 2.2; opacity: .25; }
              40%          { r: 3.8; opacity: 1;   }
            }
            #tiLoadingDots circle:nth-child(1){ animation: tiDotPulse 1.2s ease-in-out infinite 0s; }
            #tiLoadingDots circle:nth-child(2){ animation: tiDotPulse 1.2s ease-in-out infinite .2s; }
            #tiLoadingDots circle:nth-child(3){ animation: tiDotPulse 1.2s ease-in-out infinite .4s; }
          </style>
          <circle cx="4"  cy="5" r="2.2" fill="currentColor"/>
          <circle cx="14" cy="5" r="2.2" fill="currentColor"/>
          <circle cx="24" cy="5" r="2.2" fill="currentColor"/>
        </svg>`;
      el.style.cssText = [
        'position:fixed',
        'top:14px',
        'left:50%',
        'transform:translateX(-50%)',
        'background:var(--paper,#fafaf7)',
        'border:1px solid var(--line,rgba(10,10,10,.1))',
        'border-radius:100px',
        'padding:7px 18px',
        'font-size:12px',
        'color:var(--ink-3,#4a4a4a)',
        'box-shadow:0 2px 12px rgba(10,10,10,.1)',
        'z-index:99990',
        'white-space:nowrap',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity .3s ease',
        'display:flex',
        'align-items:center',
      ].join(';');
      document.body.appendChild(el);
      // 渐入
      requestAnimationFrame(() => { requestAnimationFrame(() => { el.style.opacity = '1'; }); });
    } else {
      const el = $('#tiInnerLoading');
      if (!el) return;
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 380);
    }
  }

  // ── 解析 <inner> 块 ─────────────────────────────────────────────────
  function parseInnerResponse(raw) {
    const innerMatch = raw.match(/<inner>([\s\S]*?)<\/inner>/);
    if (!innerMatch) return null;
    const inner = innerMatch[1];

    // 清洗 AI 自作主张加的全角/半角括号 （…）(…)
    function stripBrackets(s) {
      if (!s) return s;
      return s.replace(/^[（(]+/, '').replace(/[）)]+$/, '').trim();
    }

    function getTag(tag) {
      const m = inner.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\/' + tag + '>'));
      return m ? stripBrackets(m[1].trim()) : '';
    }

    // 解析 annotations
    const annotations = [];
    const annRegex = /<ann\s+type="([^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"\s+r="([^"]+)">([\s\S]*?)<\/ann>/g;
    let annMatch;
    let annId = 1;
    while ((annMatch = annRegex.exec(inner)) !== null) {
      annotations.push({
        id: annId++,
        type: annMatch[1],
        x: parseFloat(annMatch[2]),
        y: parseFloat(annMatch[3]),
        r: parseFloat(annMatch[4]),
        text: stripBrackets(annMatch[5].trim()),
      });
    }

    return {
      outfit:   getTag('outfit'),
      mood:     getTag('mood'),
      mono:     getTag('mono'),
      psyche:   getTag('psyche'),
      parallel: getTag('parallel'),
      memo:     getTag('memo'),
      diary:    getTag('diary'),
      emoji:    getTag('emoji') || '💭',
      moodtag:  getTag('moodtag') || '',
      annotations,
      vault:    getTag('vault'),
    };
  }

  // ── 解析质量检查 ────────────────────────────────────────────────────
  function logInnerParseResult(parsed, raw) {
    console.group('%c🔍 [TsukiInner] AI 返回解析结果', 'color:#d4ff4d;font-weight:bold');
    console.log('原始返回：', raw);
    if (!parsed) {
      console.error('❌ 解析失败：未找到 <inner> 块');
      console.groupEnd();
      return;
    }
    const REQUIRED = ['outfit','mood','mono','psyche','parallel','memo','diary','emoji','vault'];
    const missing = REQUIRED.filter(k => !parsed[k]);
    if (missing.length) {
      console.warn('⚠️ 缺失字段：', missing.join(', '));
    } else {
      console.log('✅ 七条状态字段：全部存在');
    }
    console.log(`✅ 心声批注：${parsed.annotations.length} 条`, parsed.annotations);
    if (parsed.annotations.length < 5) {
      console.warn(`⚠️ 批注数量不足（期望≥5，实际${parsed.annotations.length}）`);
    }
    console.log('✅ 保险柜：', parsed.vault ? `${parsed.vault.length} 字` : '❌ 缺失');
    console.groupEnd();
  }

  // ── 核心调用函数 ────────────────────────────────────────────────────
  async function triggerInnerVoiceAI() {
    const chatId = window.currentChatId;
    if (!chatId) {
      alert('请先打开一个聊天室');
      return;
    }

    // 读取 API 配置（复用 TsukiSend 的加载方法）
    const config = await (typeof window.TsukiSend?.loadApiConfig === 'function'
      ? window.TsukiSend.loadApiConfig()
      : Promise.resolve(null));

    if (!config || !config.baseUrl || !config.apiKey) {
      alert('API 未配置，请先在设置页面填写代理地址和 Key');
      return;
    }

    showInnerLoading(true);
    closePocket();

    try {
      // ── 使用 PromptHelper 构建完整提示词（世界书头/中/尾 + 人设 + 局部 + 历史 + 用户人设）──
      let fullPromptParts = [];
      try {
        // 读取当前聊天室信息，获取 charIds 和 userId
        const db = typeof openDb === 'function' ? await openDb() : await new Promise((res, rej) => {
          const r = indexedDB.open('tsukiphonepromax'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        const chat = await new Promise(res => {
          const tx = db.transaction('chats', 'readonly');
          const req = tx.objectStore('chats').get(chatId);
          req.onsuccess = () => res(req.result); req.onerror = () => res(null);
        });

        const charIds   = chat?.charIds || [];
        const chatUserId = chat?.userId  || null;

        // 取最新一条消息文本用于世界书关键词触发
        let latestMessage = '';
        try {
          if (typeof buildChatHistoryPrompt === 'function') {
            // 复用 PromptHelper 内部接口拿到最近一条
            const recentLines = await buildChatHistoryPrompt(chatId, 1);
            latestMessage = recentLines.join(' ');
          }
        } catch(_) {}

        // Step 1：assembleCharacterPrompts — 世界书私有Pre/Post + 角色人设 + 绑定主人 + 活跃用户人设
        const personaPrompts = typeof assembleCharacterPrompts === 'function'
          ? await assembleCharacterPrompts(charIds, latestMessage, chatUserId)
          : [];

        // Step 2：buildFinalPromptStream — 全局世界书头/中/尾 + 局部世界书 + 全量历史记录
        const RECENT_FOCUS = 20; // AI 重点关注的最新消息条数
        if (typeof buildFinalPromptStream === 'function') {
          fullPromptParts = await buildFinalPromptStream(
            charIds,
            personaPrompts,
            0,           // 传 0 → PromptHelper 内部读取全量历史
            'Online',    // 线上聊天场景
            latestMessage,
            chatId,
          );
        } else {
          // 降级：至少把人设分片放进去
          fullPromptParts = personaPrompts;
          console.warn('[TsukiInner] buildFinalPromptStream 不可用，仅使用人设分片');
        }

        // ── 单独拉最近 RECENT_FOCUS 条，附加「重点关注」标记块 ──
        if (typeof buildChatHistoryPrompt === 'function') {
          try {
            const recentLines = await buildChatHistoryPrompt(chatId, RECENT_FOCUS);
            if (recentLines.length) {
              fullPromptParts.push(
                `========== 最近 ${RECENT_FOCUS} 条对话（请重点关注） ==========`,
                ...recentLines,
                `========== 重点对话结束 ==========`,
                `[系统指令] 以上「最近 ${RECENT_FOCUS} 条对话」是角色此刻心声的直接触发源，请优先以此作为心声报告的核心依据，全量历史记录仅作为背景参考。`,
              );
            }
          } catch(_) {}
        }
      } catch(e) {
        console.warn('[TsukiInner] PromptHelper 构建失败，降级为空上下文:', e);
      }

      // ── 构建最终 userPrompt ─────────────────────────────────────
      const promptBody = fullPromptParts.length
        ? fullPromptParts.join('\n\n')
        : '（暂无角色信息）';

      const userPrompt = [
        promptBody,
        '\n请根据以上信息，生成该角色此刻完整的心声状态报告。',
      ].join('\n\n');

      console.group('%c💭 [TsukiInner] AI 心声召唤 — 构建提示词', 'color:#82c4e8;font-weight:bold');
      console.log('%c[SYSTEM PROMPT]\n' + INNER_SYSTEM_PROMPT, 'color:#8a8a8e');
      console.log('%c[USER PROMPT]\n' + userPrompt, 'color:#f9c784');
      console.groupEnd();

      // ── 调用 API ────────────────────────────────────────────────
      let apiUrl = config.baseUrl.trim();
      while (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
      if (apiUrl.endsWith('/v1/messages')) apiUrl = apiUrl.slice(0, -12);
      else if (apiUrl.endsWith('/v1')) apiUrl = apiUrl.slice(0, -3);
      const finalUrl = `${apiUrl}/v1/chat/completions`;

      const body = {
        model: config.model || 'gpt-4o',
        temperature: config.temperature ?? 1,
        messages: [
          { role: 'system', content: INNER_SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
        stream: false,
      };
      if (config.maxTokens) body.max_tokens = config.maxTokens;

      const res = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`API ${res.status}: ${data.error?.message || '未知错误'}`);

      const rawText = data.choices?.[0]?.message?.content || '';

      // ── 解析 ────────────────────────────────────────────────────
      const parsed = parseInnerResponse(rawText);
      logInnerParseResult(parsed, rawText);

      if (!parsed) throw new Error('AI 返回格式异常：未找到 <inner> 块');

      // ── 写入心声记录 ─────────────────────────────────────────────
      await window.TsukiInner.pushState({
        emoji:    parsed.emoji,
        moodtag:  parsed.moodtag,
        outfit:   parsed.outfit,
        mood:     parsed.mood,
        mono:     parsed.mono,
        psyche:   parsed.psyche,
        parallel: parsed.parallel,
        memo:     parsed.memo,
        diary:    parsed.diary,
        annotations: parsed.annotations,
      });

      // ── 写入保险柜 ───────────────────────────────────────────────
      if (parsed.vault) {
        await window.TsukiInner.pushVault(parsed.vault);
      }

      // ── 触发动画（复用统一播放函数，与播放按钮行为完全一致） ──────
      await playInnerAnimation({
        emoji:       parsed.emoji,
        moodtag:     parsed.moodtag,
        annotations: parsed.annotations,
        parallel:    parsed.parallel,
      });

      // 不自动打开面板，只有情绪飘屏+装饰批注渲染，用户可自行点击查看

    } catch(err) {
      console.error('[TsukiInner] AI 心声召唤失败:', err);
      const notice = document.createElement('div');
      notice.textContent = `心声召唤失败: ${err.message}`;
      notice.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(200,50,50,.9);color:#fff;padding:8px 18px;border-radius:100px;font-size:12px;letter-spacing:.04em;z-index:99999;pointer-events:none';
      document.body.appendChild(notice);
      setTimeout(() => notice.remove(), 3500);
    } finally {
      showInnerLoading(false);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════════ */
  window.TsukiInner = {
    openPocket, closePocket,
    triggerWeather, spawnPara,

    /** 解析 AI 返回的 <inner>...</inner> 块（供 TsukiSend 调用） */
    parseInnerResponse,

    /** 播放心声动画（关面板→情绪飘屏→批注→平行宇宙气泡，供 TsukiSend 调用） */
    playInnerAnimation,

    /** 心声系统提示词原文（供 TsukiSend 注入到 systemPrompt，供外部读取） */
    INNER_SYSTEM_PROMPT,

    /** AI 推送状态（一条完整心声记录） */
    async pushState(obj) {
      const id = cid(); if (!id) return;
      const r = { id: Date.now(), ts: Date.now(), emoji: obj.emoji||'😶', annotations: [], ...obj };
      const recs = await getRecs(); recs.unshift(r);
      if (recs.length > MAX) recs.length = MAX;
      await saveRecs(recs);
      activeRecordId = r.id;
      if (pocketOpen) renderTab();
    },

    /** AI 推送批注集（更新当前激活记录的批注，不新建历史） */
    async pushAnnotation(items) {
      const id = cid(); if (!id) return;
      const recs = await getRecs();
      const idx = recs.findIndex(r => r.id === activeRecordId);
      if (idx === -1) return;
      recs[idx].annotations = items;
      await saveRecs(recs);
      if (pocketOpen) renderAnnotateTab();
    },

    /** AI 累积推送密码柜 */
    async pushVault(text) {
      const stored = (await dbGet('config', KEY_VAULT())) || { id: KEY_VAULT(), secrets: [] };
      stored.secrets = stored.secrets || [];
      stored.secrets.unshift({ id: Date.now(), ts: Date.now(), text });
      if (stored.secrets.length > MAX) stored.secrets.length = MAX;
      await dbPut('config', stored);
    },
  };

  /* ══════════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════════ */
  function init() {
    injectStyles();
    buildPocket();
    buildWeather();
    const tryGf = () => { if ($('#chatArea')) buildGfOverlay(); else setTimeout(tryGf, 600); };
    tryGf();
    const orig = window.showChatView;
    if (typeof orig === 'function') window.showChatView = (...a) => {
      orig(...a);
      setTimeout(() => { if (!$('#gfOverlay')) buildGfOverlay(); activeRecordId = null; }, 400);
    };
    console.log('%c[TsukiInner v3] ✦ 心声系统已加载','color:#d4ff4d;font-weight:bold;background:#0a0a0a;padding:2px 8px;border-radius:4px');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
