/**
 * WebDSO Service Worker
 * 离线缓存所有静态资源，支持 PWA 桌面安装
 */

const CACHE_NAME = 'webdso-v2';

const PRECACHE_URLS = [
    './',
    './index.html',
    './styles/layout.css',
    './styles/osd.css',
    './styles/controls.css',
    './js/main.js',
    './js/core.js',
    './js/store.js',
    './js/constants.js',
    './js/channel.js',
    './js/signal.js',
    './js/audio.js',
    './js/serial.js',
    './js/utils.js',
    './js/shaders.js',
    './js/lib/fft.js',
    './js/render/index.js',
    './js/render/context.js',
    './js/render/dirty.js',
    './js/render/gridRenderer.js',
    './js/render/webglRenderer.js',
    './js/render/canvasRenderer.js',
    './js/render/cursorRenderer.js',
    './js/render/fftRenderer.js',
    './js/render/mathRenderer.js',
    './js/render/refWaveRenderer.js',
    './js/serial/protocols.js',
    './js/serial/cache.js',
    './js/serial/audio.js',
    './js/controllers/inputController.js',
    './js/controllers/audioController.js',
    './js/controllers/serialController.js',
    './js/controllers/fftController.js',
    './js/controllers/configController.js',
    './js/controllers/themeController.js',
    './manifest.json',
    './icon-192.svg',
    './icon-512.svg'
];

// 安装：预缓存所有资源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// 拦截请求：缓存优先，网络回退
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((cached) => cached || fetch(event.request))
    );
});
