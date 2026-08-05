/**
 * WebDSO Service Worker
 * 离线缓存所有静态资源，支持 PWA 安装与离线使用。
 *
 * 策略:
 * - 预缓存: 核心应用文件 (shell)
 * - 运行时缓存: 按需加载的文件 (bytebeat 大曲目等) 缓存后复用
 * - 导航: 网络优先回退缓存 (保证最新 index.html)
 */

const CACHE_NAME = 'webdso-v3';

// 核心应用 shell: 预缓存
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
    './js/i18n.js',
    './js/lib/fft.js',
    './js/bytebeat/audio-processor.js',
    './js/bytebeat/editor.js',
    './js/bytebeat/library.js',
    './js/mic/noise-suppressor.js',
    './js/render/index.js',
    './js/render/context.js',
    './js/render/dirty.js',
    './js/render/gridRenderer.js',
    './js/render/webglRenderer.js',
    './js/render/canvasRenderer.js',
    './js/render/cursorRenderer.js',
    './js/render/fftRenderer.js',
    './js/render/refWaveRenderer.js',
    './js/render/perfMonitor.js',
    './js/render/quality.js',
    './js/render/xyzRenderer.js',
    './js/serial/protocols.js',
    './js/serial/cache.js',
    './js/serial/audio.js',
    './js/controllers/inputController.js',
    './js/controllers/audioController.js',
    './js/controllers/serialController.js',
    './js/controllers/fftController.js',
    './js/controllers/configController.js',
    './js/controllers/themeController.js',
    './js/controllers/bytebeatController.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-192.svg',
    './icon-512.svg'
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            // 跳过等待，立即激活新版本
            .then(() => self.skipWaiting())
    );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// 请求策略:
// - 导航请求 (HTML): 网络优先, 回退缓存 (保证拿到最新页面)
// - 静态资源: 缓存优先, 网络回退并更新缓存 (运行时缓存)
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 只处理同源请求 (外部资源如 wanghaohan.com 音频不拦截)
    if (url.origin !== self.location.origin) return;

    // 导航请求 (页面跳转/刷新)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // 静态资源: 缓存优先, 网络回退
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                // 只缓存成功的 GET 响应
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            });
        })
    );
});
