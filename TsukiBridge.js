/**
 * TsukiBridge.js
 * 功能：将 Iframe 子页面的日志转发至父页面的 vConsole
 */
(function () {
  'use strict';

  // 检查是否存在父页面，且自己确实是在 iframe 中
  if (window.parent && window.parent !== window) {
    const methods = ['log', 'info', 'warn', 'error', 'debug'];

    methods.forEach(method => {
      // 备份子页面原始的 console 方法
      const originalMethod = console[method];

      // 重写子页面 console 方法
      console[method] = function (...args) {
        // 1. 先在浏览器原生的开发工具里打印（方便 PC 调试）
        originalMethod.apply(console, args);

        // 2. 核心转发：如果父页面有 console，就传给父页面
        // 因为父页面的 console 已经被 vConsole 接管了，所以这里传过去后 vConsole 就能抓到
        if (window.parent.console && typeof window.parent.console[method] === 'function') {
          // 在消息前面加一个标记，方便你在 vConsole 里区分这是哪个页面的日志
          const sourceTag = `[${window.location.pathname.split('/').pop()}]`;
          window.parent.console[method].apply(window.parent.console, [sourceTag, ...args]);
        }
      };
    });

    console.log('✅ Console Bridge 已连接，日志将转发至父级 vConsole');
  }
})();
