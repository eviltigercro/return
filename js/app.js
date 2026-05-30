"use strict";

/* =========================================================
   商品效期管理 PWA — 主程式
   資料分兩層：商品主檔(products) + 批次(batches)
   全部存在 localStorage
   ========================================================= */

// ---------- 儲存鍵 ----------
const LS_PRODUCTS = "em_products";
const LS_BATCHES = "em_batches";
const LS_SETTINGS = "em_settings";

// ---------- 共用工具 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------- 資料層 ----------
const DB = {
  products: loadJSON(LS_PRODUCTS, []),
  batches: loadJSON(LS_BATCHES, []),
  settings: Object.assign(
    { defaultLeadDays: 30, notifyTime: "09:00", notifyEnabled: true, lastNotifyDate: "" },
    loadJSON(LS_SETTINGS, {})
  ),

  saveProducts() { saveJSON(LS_PRODUCTS, this.products); },
  saveBatches() { saveJSON(LS_BATCHES, this.batches); },
  saveSettings() { saveJSON(LS_SETTINGS, this.settings); },

  // 依條碼或貨號找商品主檔
  findProduct(barcode, code) {
    return this.products.find(
      (p) =>
        (barcode && p.barcode && p.barcode === barcode) ||
        (code && p.code && p.code === code)
    );
  },

  // 取得或建立商品主檔
  upsertProduct({ barcode, code, name }) {
    let p = this.findProduct(barcode, code);
    if (p) {
      p.barcode = barcode || p.barcode;
      p.code = code || p.code;
      p.name = name || p.name;
    } else {
      p = { id: uid(), barcode: barcode || "", code: code || "", name: name || "", createdAt: new Date().toISOString() };
      this.products.push(p);
    }
    this.saveProducts();
    return p;
  },

  productOf(batch) {
    return this.products.find((p) => p.id === batch.productId);
  },
};

// ---------- 日期與狀態計算 ----------
function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function parseYMD(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmtYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// 退貨日 = 有效日期 − 提前提醒天數
function returnDateOf(batch) {
  const exp = parseYMD(batch.expiry);
  if (!exp) return null;
  return addDays(exp, -(Number(batch.leadDays) || 0));
}

// 燈號與狀態文字
function statusOf(batch) {
  const ret = returnDateOf(batch);
  const today = todayMidnight();
  if (!ret) return { level: "green", text: "—", returnStr: "—" };
  const diff = daysBetween(today, ret); // 正=還有幾天，負或0=已到/已過
  const returnStr = fmtYMD(ret);
  if (diff <= 0) {
    const over = -diff;
    return { level: "red", text: over === 0 ? "今天到退貨日" : `已過退貨日 ${over} 天`, returnStr };
  } else if (diff <= 7) {
    return { level: "yellow", text: `距退貨日剩 ${diff} 天`, returnStr };
  }
  return { level: "green", text: `距退貨日剩 ${diff} 天`, returnStr };
}

// ---------- 畫面切換（簡易路由）----------
const screens = ["list", "form", "detail", "alerts", "settings"];
let navStack = ["list"];

function showScreen(name, push = true) {
  screens.forEach((s) => $("#screen-" + s).classList.toggle("active", s === name));
  if (push) navStack.push(name);
  window.scrollTo(0, 0);
}
function goBack() {
  if (navStack.length > 1) navStack.pop();
  const prev = navStack[navStack.length - 1] || "list";
  showScreen(prev, false);
  if (prev === "list") renderList();
  if (prev === "alerts") renderAlerts();
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------- 列表 ----------
function getDecoratedBatches() {
  return DB.batches.map((b) => {
    const p = DB.productOf(b) || {};
    const st = statusOf(b);
    return { batch: b, product: p, status: st };
  });
}

function renderList() {
  const container = $("#list-container");
  const keyword = ($("#search-input").value || "").trim().toLowerCase();
  const sort = $("#sort-select").value;
  const filter = $("#filter-select").value;
  const group = $("#group-select").value;

  let items = getDecoratedBatches();

  // 搜尋
  if (keyword) {
    items = items.filter(({ product }) =>
      (product.name || "").toLowerCase().includes(keyword) ||
      (product.barcode || "").toLowerCase().includes(keyword) ||
      (product.code || "").toLowerCase().includes(keyword)
    );
  }
  // 篩選
  if (filter !== "all") {
    items = items.filter(({ status }) => {
      if (filter === "overdue") return status.level === "red";
      if (filter === "soon") return status.level === "yellow";
      if (filter === "safe") return status.level === "green";
      return true;
    });
  }
  // 排序
  items.sort((a, b) => {
    if (sort === "name") return (a.product.name || "").localeCompare(b.product.name || "", "zh-Hant");
    if (sort === "created") return (b.batch.createdAt || "").localeCompare(a.batch.createdAt || "");
    if (sort === "expiry") return (a.batch.expiry || "").localeCompare(b.batch.expiry || "");
    // returnDate（預設）
    return (a.status.returnStr || "").localeCompare(b.status.returnStr || "");
  });

  container.innerHTML = "";
  $("#list-empty").hidden = items.length !== 0;

  if (group === "product") {
    const groups = {};
    items.forEach((it) => {
      const key = it.product.name || "（未命名）";
      (groups[key] = groups[key] || []).push(it);
    });
    Object.keys(groups).sort((a, b) => a.localeCompare(b, "zh-Hant")).forEach((name) => {
      const title = document.createElement("div");
      title.className = "group-title";
      title.textContent = `${name}（${groups[name].length} 批）`;
      container.appendChild(title);
      groups[name].forEach((it) => container.appendChild(buildCard(it)));
    });
  } else {
    items.forEach((it) => container.appendChild(buildCard(it)));
  }

  updateAlertBadge();
}

function buildCard({ batch, product, status }) {
  const card = document.createElement("div");
  card.className = "card " + status.level;
  const idLine = [product.barcode && `條碼 ${product.barcode}`, product.code && `貨號 ${product.code}`]
    .filter(Boolean).join("　");
  card.innerHTML = `
    <div class="name"><span class="dot ${status.level}"></span>${escapeHTML(product.name || "（未命名）")}</div>
    <div class="meta">
      效期 ${batch.expiry || "—"}　數量 ${batch.qty ?? "—"}<br>
      退貨日 ${status.returnStr}　<span class="status-text ${status.level}">${status.text}</span>
      ${idLine ? "<br>" + escapeHTML(idLine) : ""}
    </div>`;
  card.addEventListener("click", () => openDetail(batch.id));
  return card;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- 詳情 ----------
let currentBatchId = null;

function openDetail(batchId) {
  const batch = DB.batches.find((b) => b.id === batchId);
  if (!batch) return;
  currentBatchId = batchId;
  const product = DB.productOf(batch) || {};
  const st = statusOf(batch);
  $("#detail-container").innerHTML = `
    <div class="detail-card">
      <h2><span class="dot ${st.level}"></span>${escapeHTML(product.name || "（未命名）")}</h2>
      ${row("國際條碼", escapeHTML(product.barcode || "—"))}
      ${row("自設貨號", escapeHTML(product.code || "—"))}
      ${row("有效日期", batch.expiry || "—")}
      ${row("提前天數", (batch.leadDays ?? "—") + " 天")}
      ${row("退貨日", st.returnStr)}
      ${row("狀態", `<span class="status-text ${st.level}">${st.text}</span>`)}
      ${row("數量", batch.qty ?? "—")}
      ${row("備註", escapeHTML(batch.note || "—"))}
      ${row("建立時間", (batch.createdAt || "").slice(0, 10) || "—")}
    </div>
    <button id="btn-add-calendar" class="block-btn calendar-btn">📅 加入行事曆（退貨日提醒）</button>`;
  $("#btn-add-calendar").addEventListener("click", addToCalendar);
  showScreen("detail");
}
function row(label, value) {
  return `<div class="detail-row"><span class="label">${label}</span><span>${value}</span></div>`;
}

// ---------- 新增 / 編輯 ----------
function openForm(batchId = null) {
  const form = $("#product-form");
  form.reset();
  $("#code-error").hidden = true;
  $("#f-batch-id").value = "";

  if (batchId) {
    const batch = DB.batches.find((b) => b.id === batchId);
    const product = DB.productOf(batch) || {};
    $("#form-title").textContent = "編輯商品";
    $("#f-batch-id").value = batch.id;
    $("#f-barcode").value = product.barcode || "";
    $("#f-code").value = product.code || "";
    $("#f-name").value = product.name || "";
    $("#f-expiry").value = batch.expiry || "";
    $("#f-lead").value = batch.leadDays ?? DB.settings.defaultLeadDays;
    $("#f-qty").value = batch.qty ?? 1;
    $("#f-note").value = batch.note || "";
    const cal = $("#f-calendar"); if (cal) cal.checked = false; // 編輯時預設不勾
  } else {
    $("#form-title").textContent = "新增商品";
    $("#f-lead").value = DB.settings.defaultLeadDays;
    $("#f-qty").value = 1;
    const cal = $("#f-calendar"); if (cal) cal.checked = true;  // 新增時預設勾選
  }
  updateReturnPreview();
  showScreen("form");
}

function updateReturnPreview() {
  const exp = $("#f-expiry").value;
  const lead = Number($("#f-lead").value) || 0;
  const expDate = parseYMD(exp);
  $("#return-preview").textContent = expDate ? fmtYMD(addDays(expDate, -lead)) : "—";
}

function validCode(code) {
  return /^[A-Za-z0-9]{5,8}$/.test(code);
}

function saveForm() {
  const barcode = $("#f-barcode").value.trim();
  const code = $("#f-code").value.trim();
  const name = $("#f-name").value.trim();
  const expiry = $("#f-expiry").value;
  const leadDays = Number($("#f-lead").value);
  const qty = Number($("#f-qty").value);
  const note = $("#f-note").value.trim();

  // 驗證
  if (!name) return toast("請輸入商品名稱");
  if (!expiry) return toast("請選擇有效日期");
  if (!barcode && !code) return toast("請輸入條碼或貨號（擇一）");
  if (code && !validCode(code)) {
    $("#code-error").hidden = false;
    return toast("貨號需為 5~8 碼英數字");
  }
  if (Number.isNaN(leadDays) || leadDays < 0) return toast("提前天數不正確");

  const addToCalendarChecked = $("#f-calendar")?.checked || false;
  const product = DB.upsertProduct({ barcode, code, name });
  const editingId = $("#f-batch-id").value;
  let savedBatch;

  if (editingId) {
    savedBatch = DB.batches.find((b) => b.id === editingId);
    Object.assign(savedBatch, { productId: product.id, expiry, leadDays, qty, note });
    toast("已更新");
  } else {
    savedBatch = { id: uid(), productId: product.id, expiry, leadDays, qty, note,
      createdAt: new Date().toISOString() };
    DB.batches.push(savedBatch);
    toast("已新增");
  }
  DB.saveBatches();
  navStack = ["list"];
  showScreen("list", false);
  renderList();

  // 勾選「加入行事曆」時自動下載 .ics
  if (addToCalendarChecked) {
    setTimeout(() => downloadCalendarICS(savedBatch, product), 300);
  }
}

function deleteCurrent() {
  if (!currentBatchId) return;
  if (!confirm("確定要刪除這筆商品批次嗎？此動作無法復原。")) return;
  DB.batches = DB.batches.filter((b) => b.id !== currentBatchId);
  DB.saveBatches();
  toast("已刪除");
  navStack = ["list"];
  showScreen("list", false);
  renderList();
}

// ---------- 加入行事曆（.ics）----------

// 共用：根據 batch + product 產生 .ics 並觸發下載
function downloadCalendarICS(batch, product) {
  const name = product.name || "商品";
  const expDate = parseYMD(batch.expiry);
  if (!expDate) return toast("此批次無法計算退貨日");
  const returnDate = fmtYMD(addDays(expDate, -(batch.leadDays ?? 0)));

  const notifyTime = DB.settings.notifyTime || "09:00";
  const [hh, mm] = notifyTime.split(":").map(Number);
  const hStr  = String(hh).padStart(2, "0");
  const mStr  = String(mm).padStart(2, "0");
  const hStr2 = String(hh + 1).padStart(2, "0");

  const d       = returnDate.replace(/-/g, "");
  const dtStart = `${d}T${hStr}${mStr}00`;
  const dtEnd   = `${d}T${hStr2}${mStr}00`;
  const dtstamp = new Date().toISOString()
    .replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  const desc = [
    `商品：${name}`,
    product.barcode ? `條碼：${product.barcode}` : "",
    product.code    ? `貨號：${product.code}`    : "",
    `有效期限：${batch.expiry || "—"}`,
    batch.qty  ? `數量：${batch.qty}`  : "",
    batch.note ? `備註：${batch.note}` : "",
  ].filter(Boolean).join("\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//商品效期管理 v1.0//TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:batch-${batch.id}@expiry-app`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:退貨提醒：${name}`,
    `DESCRIPTION:${desc}`,
    "BEGIN:VALARM",
    "TRIGGER:PT0S",
    "ACTION:DISPLAY",
    `DESCRIPTION:退貨提醒：${name}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  // 加上分鐘時間戳避免 Chrome 跳「再次下載確認」
  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  a.download = `退貨提醒_${name}_${returnDate}_${ts}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`已產生行事曆（${returnDate} ${hStr}:${mStr}），請選擇行事曆 App 開啟`);
}

// 詳情頁按鈕：用 currentBatchId
function addToCalendar() {
  const batch = DB.batches.find((b) => b.id === currentBatchId);
  if (!batch) return;
  const product = DB.productOf(batch) || {};
  downloadCalendarICS(batch, product);
}

// 條碼/貨號輸入後，若已建檔過則自動帶出名稱
function autoFillName() {
  if ($("#f-name").value.trim()) return;
  const p = DB.findProduct($("#f-barcode").value.trim(), $("#f-code").value.trim());
  if (p && p.name) {
    $("#f-name").value = p.name;
    toast("已帶出商品名稱：" + p.name);
  }
}

// ---------- 提醒中心 ----------
function dueBatches() {
  // 已到退貨日（紅）
  return getDecoratedBatches().filter((it) => it.status.level === "red");
}
function soonBatches() {
  return getDecoratedBatches().filter((it) => it.status.level === "yellow");
}

function renderAlerts() {
  const c = $("#alerts-container");
  const due = dueBatches();
  const soon = soonBatches();
  c.innerHTML = "";

  const sec = (title) => {
    const t = document.createElement("div");
    t.className = "group-title";
    t.textContent = title;
    c.appendChild(t);
  };

  sec(`❗ 已到退貨日（${due.length}）`);
  if (due.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.style.marginTop = "12px";
    p.textContent = "目前沒有到退貨日的商品。";
    c.appendChild(p);
  } else {
    due.forEach((it) => c.appendChild(buildCard(it)));
  }

  sec(`⏰ 即將到期（7 天內，${soon.length}）`);
  soon.forEach((it) => c.appendChild(buildCard(it)));
}

function updateAlertBadge() {
  const n = dueBatches().length;
  const badge = $("#alert-badge");
  badge.textContent = n;
  badge.hidden = n === 0;
}

// ---------- 通知 ----------
async function ensureNotifyPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const res = await Notification.requestPermission();
  return res === "granted";
}

function showNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: "icon.svg", badge: "icon.svg" }));
  } else {
    new Notification(title, { body, icon: "icon.svg" });
  }
}

// 開啟 App 時檢查，每天最多提醒一次
function checkDueAndNotify() {
  if (!DB.settings.notifyEnabled) return;
  if (Notification.permission !== "granted") return;
  const todayStr = fmtYMD(todayMidnight());
  if (DB.settings.lastNotifyDate === todayStr) return; // 今天已提醒過

  const due = dueBatches();
  if (due.length === 0) return;
  const names = due.slice(0, 5).map((it) => it.product.name || "（未命名）").join("、");
  const more = due.length > 5 ? ` 等 ${due.length} 項` : "";
  showNotification("有商品已到退貨日", `${names}${more}`);
  DB.settings.lastNotifyDate = todayStr;
  DB.saveSettings();
}

// ---------- 設定 ----------
function loadSettingsUI() {
  $("#s-lead").value = DB.settings.defaultLeadDays;
  $("#s-time").value = DB.settings.notifyTime;
  $("#s-notify").checked = DB.settings.notifyEnabled;
}
function bindSettings() {
  $("#s-lead").addEventListener("change", () => {
    DB.settings.defaultLeadDays = Number($("#s-lead").value) || 0;
    DB.saveSettings();
  });
  $("#s-time").addEventListener("change", () => {
    DB.settings.notifyTime = $("#s-time").value || "09:00";
    DB.saveSettings();
  });
  $("#s-notify").addEventListener("change", async () => {
    if ($("#s-notify").checked) {
      const ok = await ensureNotifyPermission();
      if (!ok) {
        $("#s-notify").checked = false;
        toast("瀏覽器未允許通知權限");
        return;
      }
    }
    DB.settings.notifyEnabled = $("#s-notify").checked;
    DB.saveSettings();
  });
  $("#btn-test-notify").addEventListener("click", async () => {
    const ok = await ensureNotifyPermission();
    if (!ok) return toast("瀏覽器未允許通知權限");
    const time = DB.settings.notifyTime || "09:00";
    showNotification("✅ 效期管理 — 通知功能正常", `真實提醒會在每天 ${time} 發出，告知您哪些商品已到退貨日。`);
    toast("已發送測試通知");
  });

  // 匯出
  $("#btn-export").addEventListener("click", () => {
    const data = { version: 1, exportedAt: new Date().toISOString(), products: DB.products, batches: DB.batches, settings: DB.settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `效期備份_${fmtYMD(todayMidnight())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("已匯出備份檔");
  });

  // 還原
  $("#import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.products) || !Array.isArray(data.batches)) throw new Error("格式不符");
        if (!confirm("還原會覆蓋目前所有資料，確定嗎？")) return;
        DB.products = data.products;
        DB.batches = data.batches;
        if (data.settings) DB.settings = Object.assign(DB.settings, data.settings);
        DB.saveProducts(); DB.saveBatches(); DB.saveSettings();
        loadSettingsUI();
        toast("已還原資料");
        navStack = ["list"];
        showScreen("list", false);
        renderList();
      } catch (err) {
        toast("還原失敗：檔案格式不正確");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });
}

// ---------- 掃碼 ----------
let scanStream = null;
let scanRAF = null;

async function openScan() {
  if (!("BarcodeDetector" in window)) {
    toast("此瀏覽器不支援掃碼，請直接在下方輸入條碼");
    focusBarcodeField();
    return;
  }
  const overlay = $("#scan-overlay");
  const video = $("#scan-video");
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = scanStream;
    await video.play();
    overlay.hidden = false;

    const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e", "code_39"] });
    const tick = async () => {
      if (overlay.hidden) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          const value = codes[0].rawValue;
          $("#f-barcode").value = value;
          closeScan();
          autoFillName();
          toast("已掃到條碼：" + value);
          return;
        }
      } catch (e) { /* 偵測中斷，繼續下一幀 */ }
      scanRAF = requestAnimationFrame(tick);
    };
    scanRAF = requestAnimationFrame(tick);
  } catch (e) {
    toast("無法開啟相機（需 localhost 或 HTTPS 並允許權限）");
    closeScan();
  }
}
function closeScan() {
  $("#scan-overlay").hidden = true;
  if (scanRAF) cancelAnimationFrame(scanRAF);
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
}

// 關閉掃碼後，引導使用者到條碼欄位手動輸入
function focusBarcodeField() {
  const field = $("#f-barcode");
  field.scrollIntoView({ behavior: "smooth", block: "center" });
  field.focus();
  // 移除後重加 class，讓動畫可以重複觸發
  field.classList.remove("field-highlight");
  void field.offsetWidth; // 強制 reflow
  field.classList.add("field-highlight");
  field.addEventListener("animationend", () => field.classList.remove("field-highlight"), { once: true });
}

// ---------- 語音 ----------
function getRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "zh-TW";
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

// 將 Web Speech API 的錯誤碼轉成使用者看得懂的說明
function voiceErrorMsg(errorCode) {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return "麥克風權限被拒絕，請到手機設定 → 瀏覽器 → 權限，開啟麥克風";
    case "audio-capture":
      return "找不到麥克風，請確認設備有麥克風且未被其他 App 佔用";
    case "network":
      return "語音辨識需要連線至伺服器，請確認網路連線後再試";
    case "no-speech":
      return "沒有偵測到聲音，請靠近麥克風並放大音量再試一次";
    case "aborted":
      return "語音辨識已取消";
    default:
      return `語音辨識失敗（${errorCode}），請再試一次`;
  }
}

function voiceName() {
  const r = getRecognition();
  if (!r) return toast("此瀏覽器不支援語音輸入（建議用 Chrome）");
  toast("請說出商品名稱…");
  r.onresult = (e) => {
    const text = e.results[0][0].transcript.trim();
    $("#f-name").value = text;
    toast("辨識結果：" + text);
  };
  r.onerror = (e) => toast(voiceErrorMsg(e.error));
  r.start();
}

// 中文數字轉阿拉伯數字（支援常見 0~99）
function cnNumToInt(s) {
  const map = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    const tens = a === "" ? 1 : (map[a] ?? (parseInt(a, 10) || 0));
    const ones = b === "" ? 0 : (map[b] ?? (parseInt(b, 10) || 0));
    return tens * 10 + ones;
  }
  let n = 0;
  for (const ch of s) { if (map[ch] != null) n = n * 10 + map[ch]; }
  return n || NaN;
}

// 解析口述日期，例如「2026年8月15日」「八月十五」「2026 8 15」
function parseSpokenDate(text) {
  text = text.replace(/\s/g, "");
  let y, m, d;
  const ym = text.match(/(\d{4})年/);
  if (ym) y = parseInt(ym[1], 10);
  const mm = text.match(/([0-9一二兩三四五六七八九十]+)月/);
  if (mm) m = cnNumToInt(mm[1]);
  const dd = text.match(/([0-9一二兩三四五六七八九十]+)[日號]/);
  if (dd) d = cnNumToInt(dd[1]);

  // 退而求其次：抓純數字
  if (m == null || d == null) {
    const nums = (text.match(/\d+/g) || []).map(Number);
    if (nums.length >= 3) { y = nums[0]; m = nums[1]; d = nums[2]; }
    else if (nums.length === 2) { m = nums[0]; d = nums[1]; }
  }
  if (y == null) y = new Date().getFullYear();
  if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function voiceDate() {
  const r = getRecognition();
  if (!r) return toast("此瀏覽器不支援語音輸入");
  toast("請說出日期，例如「2026 年 8 月 15 日」…");
  r.onresult = (e) => {
    const text = e.results[0][0].transcript.trim();
    const ymd = parseSpokenDate(text);
    if (ymd) {
      $("#f-expiry").value = ymd;
      updateReturnPreview();
      toast(`辨識日期：${ymd}（請確認）`);
    } else {
      toast(`聽到「${text}」但無法解析日期，請手動選擇`);
    }
  };
  r.onerror = (e) => toast(voiceErrorMsg(e.error));
  r.start();
}

// ---------- Service Worker ----------
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").then(async (reg) => {
    // 偵測新版本：新 SW 安裝完畢且正在等待時，顯示更新橫幅
    const showUpdateBanner = () => {
      const banner = $("#update-banner");
      if (banner) banner.removeAttribute("hidden");
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner();
    }
    reg.addEventListener("updatefound", () => {
      const newSW = reg.installing;
      newSW.addEventListener("statechange", () => {
        if (newSW.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      });
    });

    // 點「立即更新」：通知 SW 跳過等待，然後重新載入
    $("#btn-update")?.addEventListener("click", () => {
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
    });

    // 嘗試註冊背景定期同步（盡力而為，瀏覽器多半需安裝成 App 才生效）
    if ("periodicSync" in reg) {
      try {
        const status = await navigator.permissions.query({ name: "periodic-background-sync" });
        if (status.state === "granted") {
          await reg.periodicSync.register("check-expiry", { minInterval: 12 * 60 * 60 * 1000 });
        }
      } catch (e) { /* 不支援則略過 */ }
    }
  }).catch(() => {});
}

// ---------- 事件綁定與啟動 ----------
function bindEvents() {
  $("#btn-add").addEventListener("click", () => openForm());
  $("#btn-open-alerts").addEventListener("click", () => { renderAlerts(); showScreen("alerts"); });
  $("#btn-open-settings").addEventListener("click", () => { loadSettingsUI(); showScreen("settings"); });
  $$("[data-back]").forEach((b) => b.addEventListener("click", goBack));

  $("#btn-save").addEventListener("click", saveForm);
  $("#btn-edit").addEventListener("click", () => openForm(currentBatchId));
  $("#btn-delete").addEventListener("click", deleteCurrent);

  $("#search-input").addEventListener("input", renderList);
  $("#sort-select").addEventListener("change", renderList);
  $("#filter-select").addEventListener("change", renderList);
  $("#group-select").addEventListener("change", renderList);

  $("#f-expiry").addEventListener("change", updateReturnPreview);
  $("#f-lead").addEventListener("input", updateReturnPreview);
  $("#f-barcode").addEventListener("blur", autoFillName);
  $("#f-code").addEventListener("blur", autoFillName);

  $("#btn-scan").addEventListener("click", openScan);
  $("#btn-scan-close").addEventListener("click", closeScan);
  $("#btn-scan-manual").addEventListener("click", () => { closeScan(); focusBarcodeField(); });

  $("#btn-voice-name").addEventListener("click", voiceName);
  $("#btn-voice-date").addEventListener("click", voiceDate);

  bindSettings();
}

function init() {
  bindEvents();
  loadSettingsUI();
  renderList();
  registerSW();
  // 啟動時若已授權通知，檢查是否有到退貨日的商品
  if (DB.settings.notifyEnabled && "Notification" in window && Notification.permission === "granted") {
    checkDueAndNotify();
  }
}

document.addEventListener("DOMContentLoaded", init);
