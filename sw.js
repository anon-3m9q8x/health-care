/* Offline support for the main app; OCR is fetched separately when requested. */
const CACHE='nutripath-v13-body-1';
const ASSETS=['./','./index.html','./styles.css','./data.js','./data_teishoku.js','./data_fastfood.js','./data_lawson.js','./data_sachifukuya.js','./health_ocr.js','./food_ocr.js','./nutrients_info.js','./app.js','./account.js','./account.css','./theme.css','./config.js','./vendor/supabase.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('nutripath-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();e.waitUntil(caches.open(CACHE).then(cache=>cache.put(e.request,c)))}return r}).catch(()=>caches.open(CACHE).then(c=>c.match(e.request)).then(r=>r||Response.error()))) });
