/* Service Worker — 離線快取 + 通知處理 */
const CACHE_NAME = "expiry-cache-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./guide.html",
];

// 安裝：快取 App 基本檔案
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// 啟用：清除舊版快取
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 取用：快取優先，沒有再走網路；導覽請求失敗時回傳首頁
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() => {
        if (req.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});

// 收到「立即更新」訊息時跳過等待
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// 背景定期同步（盡力而為）：提醒使用者開啟 App 確認退貨清單
// 註：Service Worker 無法讀取 localStorage，因此這裡只能發出通用提醒，
//     真正「哪些商品到退貨日」的精準提醒由 App 開啟時計算。
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-expiry") {
    event.waitUntil(
      self.registration.showNotification("效期管理提醒", {
        body: "請開啟 App 確認今日是否有商品到退貨日。",
        icon: "icon.svg",
        badge: "icon.svg",
        tag: "check-expiry",
      })
    );
  }
});

// 點擊通知：聚焦或開啟 App
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
