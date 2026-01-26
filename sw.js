const CACHE_NAME = 'recipe-book-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/supabase.js',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/tesseract.js@2.1.1/dist/tesseract.min.js'
];

// התקנת Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
      .catch((err) => {
        console.error('Cache installation failed:', err);
      })
  );
  self.skipWaiting();
});

// הפעלת Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// טיפול בבקשות רשת
self.addEventListener('fetch', (event) => {
  // התעלם מבקשות שאינן GET
  if (event.request.method !== 'GET') {
    return;
  }

  // התעלם מבקשות ל-API של Supabase (צריכות להיות מקוונות)
  if (event.request.url.includes('supabase.co') || 
      event.request.url.includes('supabase')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // החזר מהמטמון אם קיים
        if (response) {
          return response;
        }

        // נסה לטעון מהרשת
        return fetch(event.request)
          .then((response) => {
            // בדוק אם התשובה תקינה
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // שמור במטמון
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // אם נכשל, נסה להחזיר דף ברירת מחדל
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// עדכון אוטומטי של המטמון
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
