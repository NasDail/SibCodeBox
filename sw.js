/*
 * Service Worker СибКодБокс.
 * 1) Shell-кэш поддерживает повторное открытие автомата после первого HTTPS-визита.
 * 2) IndexedDB хранит файлы игр; kiosk.js собирает из них srcdoc внутри sandboxed iframe.
 * 3) CDN-библиотеки сохраняются после первого успешного получения; без сети отдаются из Cache API.
 */
'use strict';
const DB_NAME = 'sibkodbox-assets';
const DB_VERSION = 1;
const SHELL_CACHE = 'scbb-shell-v1';
const CDN_CACHE = 'scbb-cdn-v1';
const ROUTE_MARKER = '/__scbb_offline__/';
const SHELL_FILES = [
  './', './index.html', './app-config.js', './assets/kiosk.css',
  './js/shared.js', './js/audio.js', './js/kiosk.js', './sw.js',
  './games/snake/index.html', './games/snake/icon.png',
  './games/reaction/index.html', './games/reaction/icon.png',
  './games/guess-number/index.html', './games/guess-number/icon.png'
];
const CDN_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const urls = SHELL_FILES.map(path => new URL(path, self.registration.scope).href);
    await Promise.all(urls.map(async url => {
      try { const response = await fetch(url, { cache: 'reload' }); if (response.ok) await cache.put(url, response); }
      catch (error) { console.warn('SCBB shell precache skipped:', url, error); }
    }));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_PREFIXES.map(async url => {
      try { const response = await fetch(url, { mode: 'cors', cache: 'reload' }); if (response.ok || response.type === 'opaque') await cdn.put(url, response); }
      catch (error) { console.warn('SCBB CDN precache skipped:', url, error); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('scbb-') && ![SHELL_CACHE, CDN_CACHE].includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readGameFile(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function shellFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return await cache.match(request) || await cache.match(new URL('./index.html', self.registration.scope).href) || Response.error();
  }
}

async function cdnFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return await cache.match(request) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // JS SDK and QR decoder fetched from CDN are cached after the first online load.
  if (CDN_PREFIXES.some(prefix => request.url.startsWith(prefix))) {
    event.respondWith(cdnFirst(request));
    return;
  }

  // HTML entry points for bundled demo games are also fetched by cacheGameFiles;
  // serve those from the precache when the kiosk is booting offline.
  if (url.origin === self.location.origin && url.pathname.includes('/games/')) {
    event.respondWith(shellFirst(request));
    return;
  }

  // Normal shell navigations and local assets: network-first, then shell cache.
  if (url.origin === self.location.origin && (request.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    event.respondWith(shellFirst(request));
    return;
  }

  const markerIndex = url.pathname.indexOf(ROUTE_MARKER);
  if (markerIndex < 0) return;
  event.respondWith((async () => {
    try {
      const relative = decodeURIComponent(url.pathname.slice(markerIndex + ROUTE_MARKER.length));
      const parts = relative.split('/').filter(Boolean);
      const slug = parts.shift();
      const filePath = parts.join('/') || 'index.html';
      if (!slug || filePath.split('/').some(part => part === '..')) return new Response('Bad path', { status: 400 });
      const file = await readGameFile(`${slug}/${filePath}`);
      if (!file || !file.body) return new Response('Файл игры не найден в IndexedDB. Подключитесь к сети и выполните синхронизацию.', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
      return new Response(file.body, { status: 200, headers: {
        'Content-Type': file.mime || 'application/octet-stream',
        'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      }});
    } catch (error) {
      return new Response(`Ошибка офлайн-кэша: ${error.message}`, { status: 500 });
    }
  })());
});
