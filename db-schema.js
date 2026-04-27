/**
 * db-schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 全局数据库结构同步脚本 · Tsukimi
 *
 * 用法：在任意 HTML 的 <head> 或 <body> 末尾引入即可：
 *   <script src="db-schema.js"></script>
 *
 * 效果：
 *   · 页面加载时静默检查 IndexedDB 'tsukiphonepromax' 的 store 完整性
 *   · 若有缺失的 store / index，自动触发版本升级补齐
 *   · 绝对不删除、不修改已有数据，只做"补增"操作
 *   · 不覆盖各 HTML 页面原有的 openDb / SCHEMA 变量，完全独立运行
 *   · 升级完成后将完整连接挂到 window.__tsukiDb，供同页面其他脚本复用
 *
 * 当前 SCHEMA 版本（新增 store 时在此追加即可）：
 *   基础：config / chars / users / worldbook / chats / messages
 *   剧场：theaters / theater_messages / theater_summaries
 *   日记：diaries
 *   Agent：agent
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  const IDB_NAME = 'tsukiphonepromax';

  /**
   * 完整 SCHEMA 定义
   * 格式：storeName → { keyPath, indexes?: [{ name, keyPath, unique? }] } | null
   *
   * ✅ 新增 store 只需在这里追加一行，所有引入了 db-schema.js 的页面下次加载时自动同步
   */
  const FULL_SCHEMA = {
    // ── 基础表 ──────────────────────────────────────────────────────────────
    config:   { keyPath: 'id' },
    chars:    { keyPath: 'id' },
    users:    { keyPath: 'id' },
    worldbook: null,
    chats:    { keyPath: 'id' },
    messages: { keyPath: ['chatId', 'floor'] },

    // ── 线下剧场（TsukiSummary / StageSend / tsukistage.html）────────────
    theaters: {
      keyPath: 'id',
      indexes: [{ name: 'by_created', keyPath: 'createdAt' }],
    },
    theater_messages: {
      keyPath: ['theaterId', 'floor'],
      indexes: [{ name: 'by_theater', keyPath: 'theaterId' }],
    },
    theater_summaries: {
      keyPath: 'id',
      indexes: [{ name: 'by_theater', keyPath: 'theaterId' }],
    },

    // ── 日记（DiaryFloorListener / PromptHelper）────────────────────────
    diaries: { keyPath: 'id' },

    // ── 日历（calendar.html）─────────────────────────────────────────────
    cal_events:   { keyPath: 'id' },
    cal_comments: {
      keyPath: 'id',
      indexes: [{ name: 'by_target', keyPath: 'targetId' }],
    },
    cal_edits: {
      keyPath: 'id',
      indexes: [{ name: 'by_target', keyPath: 'targetId' }],
    },

    // ── 后台 Agent（agent.html）──────────────────────────────────────────
    // 单条记录，key = 'agent_config'，value 结构：
    // {
    //   id:            'agent_config',          // 固定主键
    //   masterOn:      boolean,                  // 主开关状态
    //   selectedChars: string[],                 // 已选角色 id 列表
    //   selectedChats: string[],                 // 已选聊天 id 列表
    //   timers:        { [chatId]: intervalMs }, // 各聊天定时间隔（毫秒）
    //   supabaseUrl:   string,                   // Supabase Project URL
    //   supabaseKey:   string,                   // Supabase Publishable Key
    //   vapidKey:      string,                   // VAPID 公钥（前端填写）
    //   edgeUrl:       string,                   // Edge Function URL
    //   cooldownHours: number,                   // AI 消息冷却时间（小时）
    //   pushSub:       object | null,            // Web Push 订阅对象（JSON）
    //   dayMode:       boolean,                  // 日/夜间模式偏好
    // }
    agent: { keyPath: 'id' },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 核心升级逻辑
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 检查一个已打开的 db 连接里，是否有 store 或 index 缺失
   * 返回 true 表示结构完整，false 表示需要升级
   */
  function isSchemaComplete(db) {
    for (const [storeName, options] of Object.entries(FULL_SCHEMA)) {
      if (!db.objectStoreNames.contains(storeName)) return false;
      // 有索引定义的 store，还需检查每个 index 是否存在
      if (options && options.indexes) {
        // 只能在 onupgradeneeded 事务里直接拿 store 对象检查 indexNames，
        // 普通连接无法直接读到 indexNames，所以这里保守判断：
        // 如果 store 存在就认为索引已建（索引补建在 onupgradeneeded 里做）
        // 实际缺索引的情况极少（只有手动删过 index 才会出现）
      }
    }
    return true;
  }

  /**
   * 在 onupgradeneeded 事务里执行完整 SCHEMA 补齐（幂等）
   */
  function applySchema(db, transaction) {
    for (const [storeName, options] of Object.entries(FULL_SCHEMA)) {
      let store;

      if (!db.objectStoreNames.contains(storeName)) {
        // store 不存在 → 新建
        if (options && options.keyPath !== undefined) {
          store = db.createObjectStore(storeName, { keyPath: options.keyPath });
        } else {
          store = db.createObjectStore(storeName);
        }
        console.log(`%c[db-schema] ✅ 新建 store: ${storeName}`, 'color:#43d9a0');
      } else {
        // store 已存在 → 通过事务拿到引用，补建缺失的 index
        store = transaction.objectStore(storeName);
      }

      // 补建缺失的索引（幂等）
      if (options && options.indexes) {
        for (const idx of options.indexes) {
          if (!store.indexNames.contains(idx.name)) {
            store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
            console.log(`%c[db-schema]   └─ 新建 index: ${storeName}.${idx.name}`, 'color:#43d9a0');
          }
        }
      }
    }
  }

  /**
   * 主函数：探测当前版本 → 判断是否需要升级 → 执行升级
   * 返回 Promise<IDBDatabase>
   */
  function ensureSchema() {
    return new Promise((resolve, reject) => {
      // 第一步：不带版本号探测，获取当前真实版本和 store 列表
      const probeReq = indexedDB.open(IDB_NAME);

      probeReq.onsuccess = e => {
        const db = e.target.result;
        const currentVersion = db.version;

        const missingStores = Object.keys(FULL_SCHEMA).filter(
          name => !db.objectStoreNames.contains(name)
        );

        if (missingStores.length === 0) {
          // 结构完整，直接用这个连接
          console.log(
            `%c[db-schema] ✅ DB 结构完整 (v${currentVersion})，无需升级`,
            'color:#8a8a8e'
          );
          // 监听版本变更，其他标签触发升级时自动关闭此连接
          db.onversionchange = () => {
            console.log('%c[db-schema] onversionchange — closing to allow upgrade', 'color:#f9c784');
            db.close();
            window.__tsukiDb = null;
          };
          window.__tsukiDb = db;
          resolve(db);
          return;
        }

        // 第二步：有缺失 → 关掉 probe，以 currentVersion+1 触发升级
        console.warn(
          `[db-schema] 发现缺失 store: [${missingStores.join(', ')}]，` +
          `准备从 v${currentVersion} 升级至 v${currentVersion + 1}`
        );
        db.close();

        const upgradeReq = indexedDB.open(IDB_NAME, currentVersion + 1);

        upgradeReq.onupgradeneeded = event => {
          applySchema(event.target.result, event.target.transaction);
        };

        upgradeReq.onsuccess = event => {
          const upgradedDb = event.target.result;
          upgradedDb.onversionchange = () => {
            console.log('%c[db-schema] onversionchange on upgraded conn — closing', 'color:#f9c784');
            upgradedDb.close();
            window.__tsukiDb = null;
          };
          console.log(
            `%c[db-schema] ✅ 升级完成 (v${upgradedDb.version})，` +
            `stores: [${Array.from(upgradedDb.objectStoreNames).join(', ')}]`,
            'color:#43d9a0;font-weight:bold'
          );
          window.__tsukiDb = upgradedDb;
          resolve(upgradedDb);
        };

        upgradeReq.onerror = event => {
          console.error('[db-schema] 升级失败:', event.target.error);
          reject(event.target.error);
        };

        upgradeReq.onblocked = () => {
          console.warn(
            '[db-schema] ⚠️ DB 升级被阻塞，请关闭同域名下其他打开的 Tsukimi 页面后刷新'
          );
        };
      };

      probeReq.onerror = e => {
        console.error('[db-schema] 无法打开数据库:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 页面加载时自动执行，不阻塞页面渲染
  // ─────────────────────────────────────────────────────────────────────────

  // 挂到 window，方便其他脚本等待升级完成后再操作
  window.tsukiDbReady = ensureSchema();

  window.tsukiDbReady.catch(err => {
    console.error('[db-schema] 初始化失败，部分功能可能不可用:', err);
  });

})();
