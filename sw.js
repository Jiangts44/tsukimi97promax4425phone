// 最简版 Service Worker，只为满足 PWA 安装条件
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {});