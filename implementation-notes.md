# 實作工作日誌（implementation-notes）

> 專案：商品效期管理 App（Android 單機版）
> 規格見 `規格文件.md`
> 最後更新：2026-05-24

---

## [目前進度（2026-05-24 暫停點，已 git 存檔）]

**已完成的檔案：**
- `規格文件.md`、`implementation-notes.md`
- `index.html`（全部畫面結構）
- `css/styles.css`（全部樣式）
- `js/app.js`（核心邏輯：資料層、列表、新增/編輯/詳情/刪除、掃碼、語音、提醒中心與通知、設定、備份/還原）
- `manifest.webmanifest`（PWA 安裝設定）
- `sw.js`（Service Worker：離線快取 + 通知處理）

**還沒做（下次接續）：**
1. `icon.svg`（App 圖示）← **尚未建立**
   - ⚠️ 重要：`sw.js` 的 APP_SHELL 與 `manifest` 都參照 `icon.svg`。由於 `cache.addAll` 只要有一個檔案抓不到就整批失敗，**在補上 `icon.svg` 之前，Service Worker 會安裝失敗、PWA 無法離線**；但主頁面與大部分功能仍可在瀏覽器運作。
2. 啟動測試：在專案資料夾執行 `python -m http.server 8000`，瀏覽器開 `http://localhost:8000/`
3. 測試項目：新增 / 列表 / 燈號 / 編輯 / 刪除 / 搜尋排序篩選 / 備份還原 / 通知（掃碼與語音需相機與麥克風權限）

**注意事項：**
- 相機掃碼與語音需在 `localhost` 或 HTTPS 下才能用。

---

## [待釐清問題]

### Q1.（已解決）開發環境尚未安裝，要選哪條路徑起步？
- 現況：本機只有 git，**Flutter / Dart / Java(JDK) / Android Studio 皆未安裝**。
- ✅ 需求方決定：採 **路徑 B（PWA 網頁版）** 作為 v1 起步。

### Q2.（待釐清）手機端要怎麼實際使用？
- v1 先在桌機 `localhost` 測試（可用桌機網路攝影機試掃碼）。
- 手機要完整使用（相機/語音/安裝成 App）需在 **HTTPS** 環境，屆時需部署到靜態主機（如 GitHub Pages / Netlify）。
- 目前假設：先在桌機驗證功能，手機部署留到功能穩定後再處理。

---

## [決定]
- **採路徑 B：PWA 網頁版**作為 v1。
- 技術選型：純 HTML + CSS + JavaScript，**無建置工具**（不需 Node 編譯），可直接以瀏覽器執行。
- 資料儲存：瀏覽器 `localStorage`（JSON），符合單機、離線、1000 筆以內的需求。
- 掃碼：優先使用瀏覽器原生 `BarcodeDetector`（支援 EAN-13 等），不支援時自動退回手動輸入。
- 語音：使用瀏覽器 Web Speech API（Chrome/Edge）。
- 通知：Notification API + Service Worker；App 開啟時可靠檢查並提醒，背景提醒為「盡力而為」。
- 沿用先前決定（規格文件第十二節）：批次兩層資料結構、退貨日當天通知、手動刪除、備份匯出檔案。

---

## [偏離]
- **原訂 Flutter 原生 → 改為 PWA 網頁版。**
  - 理由：需求方選擇免安裝、可立即試用的方案。
  - 影響需求 4（自動提醒）：PWA 在「App 完全關閉時」的排程通知不可靠，故降級為「開啟 App 時一定能看到並提醒哪些到退貨日 + 盡力背景通知」。
  - 未來若要與原 Flutter 規格相同的可靠背景提醒，需轉原生重寫（成本：中～高）。

---

## [取捨]
- PWA 起步最快、零安裝、跨 Android/桌機；代價是背景自動通知不可靠。
- 相機與語音需在 `localhost` 或 HTTPS 安全環境才能用；`file://` 直接開會被擋 → 需跑本機伺服器測試。
- 用 localStorage 而非 IndexedDB：開發最快、足夠 v1；若未來資料量大或要複雜查詢，效能與彈性會受限。
- 不引入第三方掃碼函式庫（用瀏覽器原生 API）：維持離線、零相依；代價是舊瀏覽器可能不支援掃碼，需退回手動輸入。
