const CACHE='mi-probador-shein-fashn-v2';
const FILES=['./','./index.html','./style.css','./app.js','./manifest.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.pathname.includes('/.netlify/functions/')) return;
  event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));
});
