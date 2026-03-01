/* =========================================================
   Injective Portfolio • v2.0.2
   app.js — FULL FILE (Definitivo + Advanced settings + crosshair + per-address isolation)
   ========================================================= */

// Boot flag for index.FIX.html warning
try{ window.__APP_STARTED__ = true; }catch(_){}


/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;

const ACCOUNT_POLL_MS = 2000;
const TAM_POLL_MS = 2000; // Total Asset Management refresh
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

/* ================= CHAIN ENDPOINTS (LCD) ================= */
// Mainnet public endpoints (Injective docs):
// - https://sentry.lcd.injective.network:443  (recommended)
// - https://lcd.injective.network             (legacy / may vary)
// - https://1rpc.io/inj-lcd                   (privacy relay alternative)
const LCD_ENDPOINTS = [
  "https://sentry.lcd.injective.network:443",
  "https://lcd.injective.network",
  "https://1rpc.io/inj-lcd"
];
let lcdBase = LCD_ENDPOINTS[0];

async function fetchLCD(path) {
  const p = path.startsWith("/") ? path : ("/" + path);

  // try last-known-good first
  const first = await fetchJSON(lcdBase + p);
  if (first) return first;

  // fallback across endpoints
  for (const base of LCD_ENDPOINTS) {
    if (base === lcdBase) continue;
    const r = await fetchJSON(base + p);
    if (r) { lcdBase = base; return r; }
  }

  return null;
}

/* ================= INDEXER / EXPLORER ENDPOINTS (REST) ================= */
// Used for robust fees accounting (includes gas_fee per tx).
// Public endpoints are documented by Injective (Indexer Swagger is hosted under sentry.exchange.grpc-web.injective.network).
const EXPLORER_ENDPOINTS = [
  "https://sentry.exchange.grpc-web.injective.network",
  "https://api.injective.network"
];
let explorerBase = EXPLORER_ENDPOINTS[0];

async function fetchExplorer(path){
  const p = path.startsWith("/") ? path : ("/" + path);

  // try last-known-good first
  const first = await fetchJSON(explorerBase + p);
  if (first) return first;

  // fallback across endpoints
  for (const base of EXPLORER_ENDPOINTS){
    if (base === explorerBase) continue;
    const r = await fetchJSON(base + p);
    if (r) { explorerBase = base; return r; }
  }
  return null;
}


const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const STAKE_TARGET_MAX = 1000;
const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

/* persistence versions */
const STAKE_LOCAL_VER = 3;
const REWARD_WD_LOCAL_VER = 2;
const NW_LOCAL_VER = 2;
const EV_LOCAL_VER = 1;

/* net worth limits */
const NW_MAX_POINTS = 12000;

/* Net Worth live window */
const NW_LIVE_WINDOW_MS = 15 * 60 * 1000; // ✅ 15 minutes live window

/* cloud */
const CLOUD_API = "/api/point";
const CLOUD_PUSH_DEBOUNCE_MS = 1200;
const CLOUD_PULL_INTERVAL_MS = 45_000;
const CLOUD_FAIL_COOLDOWN_MS = 120_000;
let cloudLastFailAt = 0;

/* refresh mode staging */
const REFRESH_RED_MS = 220;

/* perf throttles */
const NW_DRAW_MIN_MS = 650;
const NW_POINT_MIN_MS = 2500;

/* Net Worth: market-based backfill (no visible gaps) */
const NW_MKT_BACKFILL_MIN_GAP_MS = 2 * 60 * 1000;     // only if gap > 2 min
const NW_MKT_BACKFILL_MAX_SPAN_MS = 24 * 60 * 60 * 1000; // max 24h backfill per run
const NW_MKT_BACKFILL_COOLDOWN_MS = 15 * 1000;        // avoid spam
const NW_MKT_BACKFILL_FAIL_COOLDOWN_MS = 60 * 1000;   // if fails, don't block points
let nwBackfilling = false;
let nwLastBackfillReqAt = 0;
let nwLastBackfillFailAt = 0;

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

/* ---- UI: main price direction arrow (robust across tabs/devices) ---- */
function ensureArrowAnimCSS(){
  if (document.getElementById("inj-arrow-anim-css")) return;
  const st = document.createElement("style");
  st.id = "inj-arrow-anim-css";
  st.textContent = `
    /* Main INJ price direction arrow (matches perf arrow glyph) */
    #priceDirArrow{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      width:1.45em;
      margin-right:.28rem;
      font-weight:950;
      font-size:1.15em;
      line-height:1;
      opacity:1;
      transform-origin:50% 50%;
      will-change: transform, filter, opacity;
      filter: drop-shadow(0 0 18px rgba(250,204,21,.0));
    }
    #priceDirArrow.hidden{ display:none; }

    #priceDirArrow.up{
      color: var(--green);
      transform: rotate(-90deg);
      filter: drop-shadow(0 0 18px rgba(34,197,94,.55));
    }
    #priceDirArrow.down{
      color: var(--red);
      transform: rotate(90deg);
      filter: drop-shadow(0 0 18px rgba(239,68,68,.55));
    }

    @keyframes priceArrowUpPulse{
      0%{ transform: rotate(-90deg) translateY(0) scale(1); filter: drop-shadow(0 0 0 rgba(34,197,94,0)); }
      35%{ transform: rotate(-90deg) translateY(-7px) scale(1.08); filter: drop-shadow(0 0 22px rgba(34,197,94,.95)); }
      100%{ transform: rotate(-90deg) translateY(0) scale(1); filter: drop-shadow(0 0 18px rgba(34,197,94,.55)); }
    }
    @keyframes priceArrowDownPulse{
      0%{ transform: rotate(90deg) translateY(0) scale(1); filter: drop-shadow(0 0 0 rgba(239,68,68,0)); }
      35%{ transform: rotate(90deg) translateY(7px) scale(1.08); filter: drop-shadow(0 0 22px rgba(239,68,68,.95)); }
      100%{ transform: rotate(90deg) translateY(0) scale(1); filter: drop-shadow(0 0 18px rgba(239,68,68,.55)); }
    }

    #priceDirArrow.pulse.up{ animation: priceArrowUpPulse .78s ease-out 1; }
    #priceDirArrow.pulse.down{ animation: priceArrowDownPulse .78s ease-out 1; }

    @media (prefers-reduced-motion: reduce){
      #priceDirArrow.pulse.up, #priceDirArrow.pulse.down{ animation: none !important; }
    }
  `;
  document.head.appendChild(st);
}

function ensurePriceDirArrow(){
  let el = $("priceDirArrow");
  if (el) return el;
  const priceEl = $("price");
  if (!priceEl || !priceEl.parentElement) return null;
  el = document.createElement("span");
  el.id = "priceDirArrow";
  el.className = "hidden";
  el.textContent = "►"; // same glyph used by the perf arrows, rotated via CSS
  // insert before the main price number
  priceEl.parentElement.insertBefore(el, priceEl);
  return el;
}

const ROME_TZ = "Europe/Rome";

function fmtTrim(n, maxDecimals = 6){
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  // Use fixed then trim trailing zeros and dot
  let s = x.toFixed(maxDecimals);
  s = s.replace(/\.0+$/, "");
  s = s.replace(/(\.\d*?)0+$/, "$1");
  return s;
}

function flashGreen(el){
  if (!el) return;
  el.classList.remove("flash-green");
  // force reflow
  void el.offsetWidth;
  el.classList.add("flash-green");
}

function hashStr(s){
  // djb2
  let h = 5381;
  for (let i=0;i<s.length;i++){
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

// Timezone helpers (no libs) — stable across devices
function tzParts(ts, tz){
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(new Date(ts));
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return {
    y: Number(out.year), m: Number(out.month), d: Number(out.day),
    hh: Number(out.hour), mm: Number(out.minute), ss: Number(out.second)
  };
}
function tzOffsetMs(ts, tz){
  const p = tzParts(ts, tz);
  const asUTC = Date.UTC(p.y, p.m-1, p.d, p.hh, p.mm, p.ss);
  return asUTC - ts;
}
function zonedToUtcMs(y, m, d, hh, mm, ss, tz){
  // Iterative correction (handles DST shifts)
  let guess = Date.UTC(y, m-1, d, hh, mm, ss);
  let off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  let off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}
function ymdRome(ts){
  const p = tzParts(ts, ROME_TZ);
  const pad = (n)=>String(n).padStart(2,"0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
function startOfDayRome(ts){
  const p = tzParts(ts, ROME_TZ);
  return zonedToUtcMs(p.y, p.m, p.d, 0, 0, 0, ROME_TZ);
}
function at21Rome(ts){
  const p = tzParts(ts, ROME_TZ);
  return zonedToUtcMs(p.y, p.m, p.d, 21, 0, 0, ROME_TZ);
}

// Reward-withdrawals deterministic timestamp (cross-device dedupe)
function wdDeterministicTs(tsIn, amount){
  const t = Number(tsIn) || Date.now();
  const bucket = Math.floor(t / 60000) * 60000;
  const a = Number(amount);
  const micro = Math.abs(Math.round((Number.isFinite(a) ? a : 0) * 1e6));
  const aStr = (Number.isFinite(a) ? a.toFixed(6) : "0.000000");
  const off = (micro + (hashStr(aStr) & 0xFFFF)) % 59000; // keep inside minute
  return bucket + off;
}
function wdDeterministicId(tsIn, amount){
  const t = Number(tsIn) || Date.now();
  const bucket = Math.floor(t / 60000) * 60000;
  const a = Number(amount);
  const micro = Math.abs(Math.round((Number.isFinite(a) ? a : 0) * 1e6));
  return `wd_${bucket}_${micro}`;
}

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtHHMMSS(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }

function tsLabel(ms = Date.now()) { return String(Math.floor(ms)); }
function labelToTs(lbl) {
  if (lbl == null) return 0;
  const s = String(lbl).trim();
  if (/^\d{10,13}$/.test(s)) return safe(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function nowLabel() { return new Date().toLocaleTimeString(); }
function shortAddr(a) { return a && a.length > 18 ? (a.slice(0, 10) + "…" + a.slice(-6)) : (a || ""); }
function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

function fmtSmart(v){
  v = safe(v);
  const av = Math.abs(v);
  if (av >= 1000) return v.toFixed(0);
  if (av >= 100) return v.toFixed(1);
  if (av >= 10) return v.toFixed(2);
  if (av >= 1) return v.toFixed(3);
  if (av >= 0.1) return v.toFixed(4);
  return v.toFixed(6);
}

function hasInternet() { return navigator.onLine === true; }

function pushToast(msg){
  const host = $("toastHost");
  if (!host) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(()=>t.remove(), 250); }, 1100);
}

/* ================= GLOBAL ERROR GUARDS ================= */
// Non usare questi handler per cambiare lo stato "Offline/Loading/Online".
// Servono solo per evitare errori non gestiti in console.
window.addEventListener("error", (e) => {
  console.error("JS Error:", e?.error || e);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("Promise Error:", e?.reason || e);
  try{ e.preventDefault?.(); } catch {}
});



/* ================= ONLINE / OFFLINE ================= */
window.addEventListener("online", () => {
  try{ refreshConnUI(); } catch {}
  // TAM update (global)
  safeAsync(() => loadTAM(false), "loadTAM(online)");
  if (!address) return;

  // When internet returns: rebuild Net Worth curve from market to cover the offline gap
  try{ nwStartMarketBackfill(Date.now(), false); } catch {}

  // When internet returns: auto-reload the last address data in both LIVE and REFRESH
  if (liveMode){
    safeAsync(() => loadAccount(false), "loadAccount(online)");
    safeAsync(() => loadCandleSnapshot(false), "loadCandleSnapshot(online)");
    safeAsync(() => loadChartToday(false), "loadChartToday(online)");
    safeAsync(() => loadPriceChart(true), "loadPriceChart(online)");
  } else {
    safeAsync(() => refreshLoadAllOnce(), "refreshLoadAllOnce(online)");
  }
}, { passive:true });

window.addEventListener("offline", () => {
  try{ refreshConnUI(); } catch {}
  // Keep last values; UI will show Offline
}, { passive:true });
function setBarBeam(el, dir){
  if (!el) return;
  const d = (dir === "rtl") ? "rtl" : "ltr";
  el.setAttribute("data-beam", d);
}

/* ================= SAFE ASYNC ================= */
function safeAsync(fn, label=""){
  try{
    const p = Promise.resolve().then(() => fn?.());
    return p.catch((err) => {
      console.warn(label ? `[safeAsync] ${label}` : "[safeAsync]", err);
      try{ refreshConnUI(); } catch {}
    });
  }catch(err){
    console.warn(label ? `[safeAsync] ${label}` : "[safeAsync]", err);
    try{ refreshConnUI(); } catch {}
    return Promise.resolve();
  }
}
let lastOkTs = 0;
function markLastOk(){
  const ts = Date.now();
  try{ localStorage.setItem(LAST_OK_KEY, String(ts)); } catch {}
  lastOkTs = ts;
}
function getLastOk(){
  if (Number.isFinite(lastOkTs) && lastOkTs > 0) return lastOkTs;
  const v = Number(localStorage.getItem(LAST_OK_KEY) || 0);
  if (Number.isFinite(v) && v > 0) { lastOkTs = v; return v; }
  return 0;
}
function fmtLastOk(){
  const ts = getLastOk();
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}
function saveAccountSnapshot(){
  if (!address) return;
  const snap = {
    ts: Date.now(),
    address,
    price: Number(displayed?.price || 0),
    availableInj: Number(availableInj || 0),
    stakeInj: Number(stakeInj || 0),
    rewardsInj: Number(rewardsInj || 0),
    apr: Number(apr || 0),
    netWorthUsd: Number(displayed?.netWorthUsd || 0)
  };
  try{ localStorage.setItem(SNAP_KEY_PREFIX + address, JSON.stringify(snap)); }catch{}
}
function loadAccountSnapshot(addr){
  const a = String(addr||"").trim();
  if (!a) return null;
  try{
    const raw = localStorage.getItem(SNAP_KEY_PREFIX + a);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.address !== a) return null;
    return s;
  }catch{ return null; }
}
function applyAccountSnapshot(snap){
  if (!snap) return;
  // set core vars used by animate()
  if (Number.isFinite(snap.availableInj)) availableInj = snap.availableInj;
  if (Number.isFinite(snap.stakeInj)) stakeInj = snap.stakeInj;
  if (Number.isFinite(snap.rewardsInj)) rewardsInj = snap.rewardsInj;
  if (Number.isFinite(snap.apr)) apr = snap.apr;
  if (Number.isFinite(snap.price) && snap.price > 0) displayed.price = snap.price;
  if (Number.isFinite(snap.netWorthUsd) && snap.netWorthUsd > 0) displayed.netWorthUsd = snap.netWorthUsd;
}



/* ================= THEME / MODE ================= */
const THEME_KEY = "inj_theme";
const MODE_KEY  = "inj_mode"; // live | refresh
const VIEW_KEY  = "inj_view"; // pro | lite
const LAST_OK_KEY = "inj_last_ok_ts";
const TICKER_SPEED_KEY = "inj_ticker_speed_mult";
const CARD_FX_ON_KEY = "inj_card_border_fx_on";
const CARD_BORDER_FX_SPEED_KEY = "inj_card_fx_speed_s";
const CARD_BORDER_FX_LEN_KEY   = "inj_card_fx_len_deg";
const SNAP_KEY_PREFIX = "inj_snap_";

let theme = localStorage.getItem(THEME_KEY) || "dark";
let tickerSpeedMult = (()=>{ const v = parseFloat(localStorage.getItem(TICKER_SPEED_KEY)||""); return Number.isFinite(v) ? clamp(v, 0.50, 1.80) : 1.00; })();
let cardFxEnabled = (()=>{ const v = String(localStorage.getItem(CARD_FX_ON_KEY) ?? "1").toLowerCase(); return !(v === "0" || v === "false" || v === "off"); })();
let cardBorderFxSpeedS = (()=>{ const v = parseFloat(localStorage.getItem(CARD_BORDER_FX_SPEED_KEY)||""); return Number.isFinite(v) ? clamp(v, 2.5, 16.0) : 6.8; })();
let cardBorderFxLenDeg = (()=>{ const v = parseFloat(localStorage.getItem(CARD_BORDER_FX_LEN_KEY)||"");   return Number.isFinite(v) ? clamp(v, 18, 140) : 56; })();
let liveMode = (localStorage.getItem(MODE_KEY) || "live") === "live";
try{ document.body.dataset.mode = liveMode ? "live" : "refresh"; } catch {}
let viewMode = (localStorage.getItem(VIEW_KEY) || "pro");

function axisGridColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.14)" : "rgba(249,250,251,.10)";
}
function axisTickColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.65)" : "rgba(249,250,251,.60)";
}

function applyTheme(t){
  theme = (t === "light") ? "light" : "dark";
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const themeIcon = $("themeIcon");
  if (themeIcon) themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";
  refreshChartsTheme();
  renderSettingsSnapshot(); // keep settings updated
}

function applyView(v){
  viewMode = (v === "lite") ? "lite" : "pro";
  document.body.dataset.view = viewMode;
  localStorage.setItem(VIEW_KEY, viewMode);

  const icon = $("viewIcon");
  const btn  = $("viewToggle");
  if (icon) icon.textContent = (viewMode === "lite") ? "⚡" : "🧠";
  if (btn) btn.setAttribute("aria-label", `View mode: ${viewMode.toUpperCase()}`);
}


/* ================= CARD BORDER FX SETTINGS (global ON/OFF) ================= */
function _syncCardFxToggleUI(){
  const btn = $("cardFxToggle");
  if (!btn) return;
  const on = !!cardFxEnabled;
  btn.textContent = on ? "ON" : "OFF";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.classList.toggle("primary", on);
  btn.classList.toggle("is-off", !on);
}
function applyCardFxEnabled(on, persist=true){
  cardFxEnabled = !!on;
  try{ document.body.dataset.cardFx = cardFxEnabled ? "on" : "off"; }catch(_){}
  _syncCardFxToggleUI();
  if (persist){
    try{ localStorage.setItem(CARD_FX_ON_KEY, cardFxEnabled ? "1" : "0"); }catch(_){}
  }
}
function initCardFxSettings(){
  // Apply saved state immediately (also works if FX runtime comes from CSS-only patches)
  applyCardFxEnabled(cardFxEnabled, false);
  const btn = $("cardFxToggle");
  if (btn && !btn.dataset.cardFxWired){
    btn.addEventListener("click", (e)=>{
      e?.preventDefault?.();
      applyCardFxEnabled(!cardFxEnabled, true);
      try{ renderSettingsSnapshot(); }catch(_){}
    }, { passive:false });
    btn.dataset.cardFxWired = "1";
  }
}

/* ================= CHARTJS ZOOM REGISTER (NO CRASH) ================= */
let ZOOM_OK = false;
function tryRegisterZoom(){
  try{
    if (!window.Chart) return false;
    const plug = window.ChartZoom || window["chartjs-plugin-zoom"];
    if (plug) Chart.register(plug);
    const has = !!(Chart?.registry?.plugins?.get && Chart.registry.plugins.get("zoom"));
    return has;
  } catch (e){
    console.warn("Zoom plugin not available:", e);
    return false;
  }
}

/* ================= CONNECTION UI ================= */
const statusDot  = $("statusDot");
const statusText = $("statusText");
const connectionStatus = $("connectionStatus");

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

let refreshLoaded = false;
let refreshLoading = false;
let modeLoading = false;

function liveReady(){
  // Consider "ready" if we have at least one live channel OR REST data is ok.
  const socketsOk = (wsTradeOnline || wsKlineOnline);
  const accountOk = !address || accountOnline;
  const priceOk = Number.isFinite(targetPrice) && targetPrice > 0;
  return (socketsOk || priceOk) && accountOk;
}

function refreshConnUI() {
  if (!statusDot || !statusText) return;

  const wrap = connectionStatus || $("connectionStatus");
  const setState = (state, text) => {
    if (wrap) {
      wrap.classList.remove("conn-offline", "conn-loading", "conn-online");
      wrap.classList.add(
        state === "offline" ? "conn-offline" :
        state === "loading" ? "conn-loading" : "conn-online"
      );
      wrap.setAttribute("data-conn", state);
    }
    statusText.textContent = text;

    // keep inline as fallback (CSS will override via classes)
    statusDot.style.background =
      state === "offline" ? "#ef4444" :
      state === "loading" ? "#f59e0b" : "#22c55e";
  };

  if (!hasInternet()) {
    const last = fmtLastOk();
    setState("offline", last ? `Offline • Last: ${last}` : "Offline");
    try{ updateConnRefreshBtn(); }catch{}
    return;
  }

  const loadingNow =
    modeLoading ||
    refreshLoading ||
    (!liveMode && !refreshLoaded);

  if (loadingNow) {
    setState("loading", "Loading...");
    try{ updateConnRefreshBtn(); }catch{}
    return;
  }

  setState("online", "Online");
  try{ updateConnRefreshBtn(); }catch{}
}

/* Manual refresh icon (visible only in REFRESH mode on My Dashboard) */
const connRefreshBtn = $("connRefreshBtn");
if (connRefreshBtn && !connRefreshBtn._bound){
  connRefreshBtn._bound = true;
  connRefreshBtn.addEventListener("click", (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    try{ window.location.reload(); } catch { location.reload(); }
  }, { passive:false });
}
function updateConnRefreshBtn(){
  const wrap = connectionStatus || $("connectionStatus");
  if (!wrap) return;
  const dash = $("pageDashboard");
  const onDash = !!(dash && dash.classList.contains("active"));
  let mode = "live";
  try{ mode = (localStorage.getItem("inj_mode") || "live"); }catch{}
  const show = (mode !== "live") && onDash;
  wrap.classList.toggle("has-refresh", show);
}

/* ================= SAFE FETCH ================= */
async function fetchJSON(url, opts = {}) {
  try {
    const res = await fetch(url, { cache: "no-store", ...opts });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) {
    console.warn("[fetchJSON] failed:", url, e);
    return null;
  }
}

/* ================= SMOOTH DISPLAY ================= */
let settleStart = Date.now();
function scrollSpeed() {
  const t = Math.min((Date.now() - settleStart) / INITIAL_SETTLE_TIME, 1);
  const base = 0.08;
  const maxExtra = 0.80;
  return base + (t * t) * maxExtra;
}
function tick(cur, tgt) {
  if (!Number.isFinite(tgt)) return cur;
  return cur + (tgt - cur) * scrollSpeed();
}

/* ================= COLORED DIGITS ================= */
function colorNumber(el, n, o, d) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i]
      ? (n > o ? "#22c55e" : "#ef4444")
      : (document.body.dataset.theme === "light" ? "#0f172a" : "#f9fafb");
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}
function colorMoney(el, n, o, decimals = 2){
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(decimals);
  const os = o.toFixed(decimals);
  if (ns === os) { el.textContent = `$${ns}`; return; }

  const baseCol = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  const upCol = "#22c55e";
  const dnCol = "#ef4444";
  const dir = (n > o) ? "up" : "down";

  const out = [`<span style="color:${baseCol}">$</span>`];
  for (let i = 0; i < ns.length; i++){
    const c = ns[i];
    const oc = os[i];
    const col = (c !== oc) ? (dir === "up" ? upCol : dnCol) : baseCol;
    out.push(`<span style="color:${col}">${c}</span>`);
  }
  el.innerHTML = out.join("");
}

/* ================= PERF ================= */
function pctChange(price, open) {
  const p = safe(price), o = safe(open);
  if (!o) return 0;
  const v = ((p - o) / o) * 100;
  return Number.isFinite(v) ? v : 0;
}
function updatePerf(arrowId, pctId, v) {
  const arrow = $(arrowId), pct = $(pctId);
  if (!arrow || !pct) return;

  if (v > 0) { arrow.textContent = "▲"; arrow.className = "arrow up"; pct.className = "pct up"; }
  else if (v < 0) { arrow.textContent = "▼"; arrow.className = "arrow down"; pct.className = "pct down"; }
  else { arrow.textContent = "►"; arrow.className = "arrow flat"; pct.className = "pct flat"; }

  pct.textContent = Math.abs(v).toFixed(2) + "%";
}

/* ================= MARKET TICKER (global) ================= */
const COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global";


// Like safe(), but returns NaN instead of 0 (prevents the ticker from flashing to 0 on transient missing data)
const fin = (n) => (Number.isFinite(+n) ? +n : NaN);

// Smooth, continuous ticker motion (no visible "restart")
let marketTickerAnim = null;
function marketTickerSetPaused(v){
  if (marketTickerAnim) marketTickerAnim.paused = !!v;
}
function startMarketTickerLoop(){
  const track = $("tickerTrack");
  if (!track) return;

  // disable CSS animation when JS loop is active
  track.classList.add("js-ticker");

  if (!marketTickerAnim){
    marketTickerAnim = { x:0, last:0, half:0, speed:70, raf:0, paused:false, compute:null };
  }

  const compute = () => {
    const half = track.scrollWidth / 2;
    marketTickerAnim.half = (half && Number.isFinite(half)) ? half : 0;
    if (marketTickerAnim.half){
      marketTickerAnim.x = marketTickerAnim.x % marketTickerAnim.half;
    } else {
      marketTickerAnim.x = 0;
      track.style.transform = "translateX(0px)";
    }

    // speed tuned for readability: slower on small screens
    const w = Math.min(1400, Math.max(360, window.innerWidth || 900));
    const base = (w < 520) ? 42 : 70;
    marketTickerAnim.speed = base * (Number.isFinite(tickerSpeedMult) ? tickerSpeedMult : 1);
  };
  marketTickerAnim.compute = compute;
  compute();

  // pause on hover (desktop)
  const wrap = $("marketTicker");
  if (wrap && !wrap.dataset.mtHoverBound){
    wrap.dataset.mtHoverBound = "1";
    wrap.addEventListener("mouseenter", () => marketTickerSetPaused(true));
    wrap.addEventListener("mouseleave", () => marketTickerSetPaused(false));
  }

  // restart RAF cleanly
  cancelAnimationFrame(marketTickerAnim.raf);
  marketTickerAnim.last = 0;

  const step = (ts) => {
    marketTickerAnim.raf = requestAnimationFrame(step);
    if (!marketTickerAnim.last) marketTickerAnim.last = ts;
    let dt = (ts - marketTickerAnim.last) / 1000;
    if (dt > 0.08) dt = 0.08;
    marketTickerAnim.last = ts;

    if (marketTickerAnim.paused) return;
    const half = marketTickerAnim.half;
    if (!half || dt <= 0) return;

    let x = marketTickerAnim.x + marketTickerAnim.speed * dt;
    if (x >= half) x = x % half; // seamless wrap (content duplicated)
    marketTickerAnim.x = x;

    track.style.transform = `translate3d(${-x}px,0,0)`;
  };

  marketTickerAnim.raf = requestAnimationFrame(step);
}
let marketTickerCfg = null;
let marketTickerRefs = {}; // key -> { valueEls:[], arrowEls:[], pctEls:[] }

let marketTarget = {
  // Dashboard summary (realtime)
  netWorthUsd: NaN,
  netWorthInj: NaN,
  availableInj: NaN,
  stakeInj: NaN,
  rewardsInj: NaN,
  totalRewardsAcc: NaN,
  feesTotal: NaN,
  apr: NaN,
  tamInj: NaN,
  injPrice: NaN,
  validatorName: ""
};

let marketPerf = {
  btcDom: 0,      // % change since last fetch
  mktCap24h: 0,   // 24h % (from provider)
  vol24h: 0,      // % change since last fetch
  inj24h: 0       // % vs daily open
};

let marketLastFetchAt = 0;

// compact formatting helpers
function fmtCompactUsdParts(n){
  n = safe(n);
  const abs = Math.abs(n);
  if (abs >= 1e12) return { v: n / 1e12, s: "T" };
  if (abs >= 1e9)  return { v: n / 1e9,  s: "B" };
  if (abs >= 1e6)  return { v: n / 1e6,  s: "M" };
  if (abs >= 1e3)  return { v: n / 1e3,  s: "K" };
  return { v: n, s: "" };
}
function colorSuffixNumber(el, n, o, decimals, prefix, suffix){
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = `${prefix}${n.toFixed(decimals)}${suffix}`;
  const os = `${prefix}${o.toFixed(decimals)}${suffix}`;
  if (ns === os) { el.textContent = ns; return; }

  const baseCol = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  const upCol = "#22c55e";
  const dnCol = "#ef4444";
  const dir = (n > o) ? "up" : "down";

  const out = [];
  const max = Math.max(ns.length, os.length);
  for (let i = 0; i < max; i++){
    const c = ns[i] ?? "";
    const oc = os[i] ?? "";
    const isDigitish = /[0-9.]/.test(c);
    const col = (c !== oc && isDigitish) ? (dir === "up" ? upCol : dnCol) : baseCol;
    out.push(`<span style="color:${col}">${c}</span>`);
  }
  el.innerHTML = out.join("");
}
function colorMoneyCompact(el, n, o, decimals = 2){
  if (!el) return;
  const np = fmtCompactUsdParts(n);
  const op = fmtCompactUsdParts(o);
  // compare the compacted number within its own scale
  colorSuffixNumber(el, np.v, op.v, decimals, "$", np.s);
}
function colorPercent(el, n, o, decimals = 2){
  if (!el) return;
  colorSuffixNumber(el, n, o, decimals, "", "%");
}
function updatePerfEl(arrowEl, pctEl, v){
  if (!arrowEl || !pctEl) return;
  if (v > 0) { arrowEl.textContent = "▲"; arrowEl.className = "arrow up"; pctEl.className = "pct up"; }
  else if (v < 0) { arrowEl.textContent = "▼"; arrowEl.className = "arrow down"; pctEl.className = "pct down"; }
  else { arrowEl.textContent = "►"; arrowEl.className = "arrow flat"; pctEl.className = "pct flat"; }
  pctEl.textContent = Math.abs(v).toFixed(2) + "%";
}

function initMarketTicker(){
  const track = $("tickerTrack");
  if (!track) return;
  if (track.dataset.mtInit === "1"){
    // already built; just ensure the smooth loop is running
    startMarketTickerLoop();
    tuneTickerSpeed();
    return;
  }
  track.dataset.mtInit = "1";
  if (!marketTickerCfg){
    // Dashboard summary ticker (realtime card values)
    marketTickerCfg = [
      { key:"netWorthUsd",      label:"NET WORTH", kind:"usd",  decimals:2, perfKey:null },
      { key:"netWorthInj",      label:"TOTAL INJ", kind:"inj",  decimals:4, perfKey:null },
      { key:"availableInj",     label:"AVAILABLE", kind:"inj",  decimals:6, perfKey:null },
      { key:"stakeInj",         label:"STAKED",    kind:"inj",  decimals:4, perfKey:null },
      { key:"rewardsInj",       label:"REWARDS",   kind:"inj",  decimals:6, perfKey:null },
      { key:"totalRewardsAcc",  label:"TOT REW",   kind:"inj",  decimals:6, perfKey:null },
      { key:"feesTotal",        label:"FEES",      kind:"inj",  decimals:6, perfKey:null },
      { key:"apr",              label:"APR",       kind:"pct",  decimals:2, perfKey:null },
      { key:"tamInj",           label:"TAM",       kind:"inj",  decimals:4, perfKey:null },
      { key:"injPrice",         label:"INJ PRICE", kind:"usd",  decimals:4, perfKey:null },
      { key:"validatorName",    label:"VALIDATOR", kind:"text", decimals:0, perfKey:null }
    ];
  }

  // build once
  track.innerHTML = "";
  for (const it of marketTickerCfg){
    const item = document.createElement("div");
    item.className = "ticker-item";

    const k = document.createElement("span");
    k.className = "ticker-k";
    k.textContent = it.label;

    const v = document.createElement("span");
    v.className = "ticker-v";

    const arrow = document.createElement("span");
    arrow.className = "arrow flat";
    arrow.textContent = "►";
    arrow.dataset.mtKey = it.key;
    arrow.dataset.mtRole = "arrow";

    const pct = document.createElement("span");
    pct.className = "pct flat";
    pct.textContent = "0.00%";
    pct.dataset.mtKey = it.key;
    pct.dataset.mtRole = "pct";

    const val = document.createElement("span");
    val.className = "num";
    if (it.kind === "text") val.classList.add("text");
    val.textContent = "—";
    val.dataset.mtKey = it.key;
    val.dataset.mtRole = "value";

    if (!it.perfKey){
      arrow.style.display = "none";
      pct.style.display = "none";
    }

    v.appendChild(arrow);
    v.appendChild(pct);
    v.appendChild(val);

    item.appendChild(k);
    item.appendChild(v);
    track.appendChild(item);
  }

  // duplicate items for seamless scroll
  const children = [...track.children].map(n => n.cloneNode(true));
  for (const c of children) track.appendChild(c);

  // cache refs
  marketTickerRefs = {};
  for (const it of marketTickerCfg){
    marketTickerRefs[it.key] = {
      valueEls: [...track.querySelectorAll(`[data-mt-key="${it.key}"][data-mt-role="value"]`)],
      arrowEls: [...track.querySelectorAll(`[data-mt-key="${it.key}"][data-mt-role="arrow"]`)],
      pctEls:   [...track.querySelectorAll(`[data-mt-key="${it.key}"][data-mt-role="pct"]`)]
    };
  }

  tuneTickerSpeed();
  startMarketTickerLoop();

  try{
    const ro = new ResizeObserver(() => tuneTickerSpeed());
    ro.observe(track);
  } catch {}
}
function initTickerSpeedSettings(){
  const r = $("tickerSpeedRange");
  const out = $("tickerSpeedReadout");
  if (!r) return;

  const apply = (raw, persist=true) => {
    const v = clamp(parseFloat(raw), 0.50, 1.80);
    tickerSpeedMult = Number.isFinite(v) ? v : 1.00;
    if (persist){
      try{ localStorage.setItem(TICKER_SPEED_KEY, String(tickerSpeedMult)); }catch(_){ }
    }
    if (out) out.textContent = `${tickerSpeedMult.toFixed(2)}×`;
    tuneTickerSpeed();
    if (marketTickerAnim) marketTickerAnim.last = 0;
  };

  // initial UI sync
  r.value = String(tickerSpeedMult.toFixed(2));
  if (out) out.textContent = `${tickerSpeedMult.toFixed(2)}×`;

  // live preview
  r.addEventListener("input", () => apply(r.value, true), { passive:true });
  r.addEventListener("change", () => apply(r.value, true), { passive:true });

  // iOS/Safari: ensure we apply at touch end as well
  r.addEventListener("touchend", () => apply(r.value, true), { passive:true });
}

function applyCardBorderFxVars(persist = false){
  cardBorderFxSpeedS = clamp(Number(cardBorderFxSpeedS), 2.5, 16.0);
  cardBorderFxLenDeg = clamp(Number(cardBorderFxLenDeg), 18, 140);

  try{
    document.documentElement.style.setProperty("--card-fx-speed", `${cardBorderFxSpeedS.toFixed(2)}s`);
    document.documentElement.style.setProperty("--card-fx-tail", `${Math.round(cardBorderFxLenDeg)}deg`);
  }catch(_){ }

  const rs = $("cardBorderFxSpeedRange") || $("cardFxSpeedRange");
  const rl = $("cardBorderFxLenRange") || $("cardFxLenRange");
  const os = $("cardBorderFxSpeedReadout") || $("cardFxSpeedReadout");
  const ol = $("cardBorderFxLenReadout") || $("cardFxLenReadout");

  if (rs) rs.value = String(cardBorderFxSpeedS.toFixed(1));
  if (rl) rl.value = String(Math.round(cardBorderFxLenDeg));
  if (os) os.textContent = `${cardBorderFxSpeedS.toFixed(1)}s/giro`;
  if (ol) ol.textContent = `${Math.round(cardBorderFxLenDeg)}°`;

  if (persist){
    try{ localStorage.setItem(CARD_BORDER_FX_SPEED_KEY, String(cardBorderFxSpeedS)); }catch(_){ }
    try{ localStorage.setItem(CARD_BORDER_FX_LEN_KEY,   String(cardBorderFxLenDeg)); }catch(_){ }
  }
}

function initCardBorderFxSettings(){
  const rs = $("cardBorderFxSpeedRange") || $("cardFxSpeedRange");
  const rl = $("cardBorderFxLenRange") || $("cardFxLenRange");
  if (!rs && !rl){
    applyCardBorderFxVars(false);
    return;
  }

  const apply = (persist=true) => {
    if (rs){
      const v = clamp(parseFloat(rs.value), 2.5, 16.0);
      if (Number.isFinite(v)) cardBorderFxSpeedS = v;
    }
    if (rl){
      const v = clamp(parseFloat(rl.value), 18, 140);
      if (Number.isFinite(v)) cardBorderFxLenDeg = v;
    }
    applyCardBorderFxVars(persist);
  };

  apply(false);
  rs?.addEventListener("input", () => apply(true), { passive:true });
  rs?.addEventListener("change", () => apply(true), { passive:true });
  rs?.addEventListener("touchend", () => apply(true), { passive:true });

  rl?.addEventListener("input", () => apply(true), { passive:true });
  rl?.addEventListener("change", () => apply(true), { passive:true });
  rl?.addEventListener("touchend", () => apply(true), { passive:true });
}


function tuneTickerSpeed(){
  const track = $("tickerTrack");
  if (!track) return;

  // If JS ticker loop is active, just recompute half-width + speed
  if (marketTickerAnim?.compute){
    marketTickerAnim.compute();
    return;
  }

  // Fallback (CSS animation) if JS loop isn't active
  const half = track.scrollWidth / 2;
  if (!half || !Number.isFinite(half)) return;
  const w = Math.min(1400, Math.max(360, window.innerWidth || 900));
  const base = (w < 520) ? 42 : 70;
  const pxPerSec = base * (Number.isFinite(tickerSpeedMult) ? tickerSpeedMult : 1);
  const dur = Math.max(22, Math.min(70, half / pxPerSec));
  track.style.setProperty("--ticker-dur", `${dur}s`);
}

async function loadMarketGlobal(force=false){
  if (!hasInternet()) return;
  const now = Date.now();
  if (!force && (now - marketLastFetchAt) < 25_000) return;
  marketLastFetchAt = now;

  const j = await fetchJSON(COINGECKO_GLOBAL_URL);
  const d = j?.data;
  if (!d) return;

  const newBtcDom = safe(d.market_cap_percentage?.btc);
  const newMktCap = safe(d.total_market_cap?.usd);
  const newVol24h = safe(d.total_volume?.usd);
  const newMktCapChg = safe(d.market_cap_change_percentage_24h_usd);

  // perf vs last fetched values (avoid noisy per-frame comparisons)
  if (Number.isFinite(newBtcDom) && Number.isFinite(marketTarget.btcDom) && marketTarget.btcDom > 0){
    marketPerf.btcDom = ((newBtcDom - marketTarget.btcDom) / marketTarget.btcDom) * 100;
  }
  if (Number.isFinite(newVol24h) && Number.isFinite(marketTarget.vol24hUsd) && marketTarget.vol24hUsd > 0){
    marketPerf.vol24h = ((newVol24h - marketTarget.vol24hUsd) / marketTarget.vol24hUsd) * 100;
  }
  if (Number.isFinite(newMktCapChg)) marketPerf.mktCap24h = newMktCapChg;

  // update targets (never reset to 0 on failures)
  if (Number.isFinite(newBtcDom)) marketTarget.btcDom = newBtcDom;
  if (Number.isFinite(newMktCap)) marketTarget.mktCapUsd = newMktCap;
  if (Number.isFinite(newVol24h)) marketTarget.vol24hUsd = newVol24h;

  // render immediately
  try{ updateMarketTickerUI(); } catch {}
}

function updateMarketInjTargets(){
  // Update ticker targets from the same realtime values shown in cards (no extra APIs)
  try{
    const nwUsd = safe(displayed?.netWorthUsd);
    if (Number.isFinite(nwUsd) && nwUsd >= 0) marketTarget.netWorthUsd = nwUsd;

    const totInj = safe(displayed?.available) + safe(displayed?.stake) + safe(displayed?.rewards);
    if (Number.isFinite(totInj) && totInj >= 0) marketTarget.netWorthInj = totInj;

    const av = safe(displayed?.available);
    if (Number.isFinite(av) && av >= 0) marketTarget.availableInj = av;

    const st = safe(displayed?.stake);
    if (Number.isFinite(st) && st >= 0) marketTarget.stakeInj = st;

    const rw = safe(displayed?.rewards);
    if (Number.isFinite(rw) && rw >= 0) marketTarget.rewardsInj = rw;

    try{
      const tr = totalRewardsAccumulated();
      if (Number.isFinite(tr) && tr >= 0) marketTarget.totalRewardsAcc = tr;
    }catch{}

    try{
      let ft = Number.isFinite(feesTotalCache) ? feesTotalCache : NaN;
      if (!Number.isFinite(ft) && Array.isArray(feesValuesAll) && feesValuesAll.length){
        ft = feesValuesAll.reduce((a,b)=>a + (Number.isFinite(+b) ? +b : 0), 0);
      }
      if (Number.isFinite(ft) && ft >= 0) marketTarget.feesTotal = ft;
    }catch{}

    const a = safe(apr);
    if (Number.isFinite(a) && a >= 0) marketTarget.apr = a;

    const tam = Number.isFinite(+tamDisplayedInj) ? +tamDisplayedInj : safe(tamTargetInj);
    if (Number.isFinite(tam) && tam >= 0) marketTarget.tamInj = tam;

    const px = safe(displayed?.price) || safe(targetPrice);
    if (Number.isFinite(px) && px > 0) marketTarget.injPrice = px;

    const vn = String($("validatorName")?.textContent || "").trim();
    if (vn && vn !== "—") marketTarget.validatorName = vn;
  }catch{}
}

function renderTickerValue(key, kind, n, o, decimals){
  const refs = marketTickerRefs[key];
  if (!refs?.valueEls?.length) return;

  for (const el of refs.valueEls){
    if (kind === "usd") colorMoney(el, n, o, decimals);
    else if (kind === "usdCompact") colorMoneyCompact(el, n, o, decimals);
    else if (kind === "pct") colorPercent(el, n, o, decimals);
    else if (kind === "inj") colorSuffixNumber(el, n, o, decimals, "", " INJ");
    else colorNumber(el, n, o, decimals);
  }
}
function renderTickerPerf(key, v){
  const refs = marketTickerRefs[key];
  if (!refs) return;
  for (let i = 0; i < Math.min(refs.arrowEls.length, refs.pctEls.length); i++){
    updatePerfEl(refs.arrowEls[i], refs.pctEls[i], v);
  }
}

function updateMarketTickerUI(){
  if (!marketTickerCfg) return;

  for (const it of marketTickerCfg){
    const key = it.key;

    // TEXT items (e.g., validator)
    if (it.kind === "text"){
      const refs = marketTickerRefs[key];
      if (!refs?.valueEls?.length) continue;
      const t = String(marketTarget[key] || "—");
      for (const el of refs.valueEls){
        el.textContent = t || "—";
      }
      continue;
    }

    // numeric items
    const tgt = fin(marketTarget[key]);
    const cur = fin(marketTarget[key + "__disp"]);
    const prev = Number.isFinite(cur) ? cur : tgt;

    // "realtime": display immediately (cards are already smoothed)
    const disp = Number.isFinite(tgt) ? tgt : cur;
    if (Number.isFinite(disp)){
      marketTarget[key + "__disp"] = disp;
      renderTickerValue(key, it.kind, disp, Number.isFinite(prev) ? prev : disp, it.decimals);
    }

    if (it.perfKey){
      const pv = fin(marketPerf[it.perfKey]);
      renderTickerPerf(key, Number.isFinite(pv) ? pv : 0);
    }
  }

  if (marketTickerAnim?.compute){
    requestAnimationFrame(() => { try{ marketTickerAnim.compute(); }catch(_){ } });
  }
}

/* ================= BAR RENDER ================= */
function renderBar(bar, line, val, open, low, high, gradUp, gradDown) {
  if (!bar || !line) return;

  const vIn = safe(val);
  let o = safe(open);
  let lo = safe(low);
  let hi = safe(high);

  // basic guards
  if (!Number.isFinite(vIn) || !Number.isFinite(o) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
    line.style.left = "50%";
    bar.style.width = "0%";
    bar.style.left = "50%";
    return;
  }

  // normalize low/high order
  if (hi < lo) { const t = hi; hi = lo; lo = t; }

  // clamp inputs to visible range (so ATH/ATL always snap to edges)
  const v = clamp(vIn, lo, hi);
  o = clamp(o, lo, hi);

  // We keep OPEN centered (50%) but map ATL/ATH to edges using a piecewise scale:
  // - left side uses (open - low)
  // - right side uses (high - open)
  const center = 50;
  let pos = center;

  if (v >= o) {
    const denom = (hi - o);
    if (denom > 0) {
      const t = clamp((v - o) / denom, 0, 1);
      pos = center + (t * center); // 50..100
    } else {
      // degenerate (open==high): fall back to full-range mapping
      pos = clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
    }
  } else {
    const denom = (o - lo);
    if (denom > 0) {
      const t = clamp((o - v) / denom, 0, 1);
      pos = center - (t * center); // 50..0
    } else {
      // degenerate (open==low): fall back to full-range mapping
      pos = clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
    }
  }

  line.style.left = pos.toFixed(3) + "%";

  if (v >= o) {
    bar.style.left = center + "%";
    bar.style.width = Math.max(0, pos - center).toFixed(3) + "%";
    bar.style.background = gradUp;
    try { setBarBeam(bar, "ltr"); } catch {}
  } else {
    bar.style.left = pos.toFixed(3) + "%";
    bar.style.width = Math.max(0, center - pos).toFixed(3) + "%";
    bar.style.background = gradDown;
    try { setBarBeam(bar, "rtl"); } catch {}
  }
}


/* ================= ADDRESS / SEARCH ================= */
const searchWrap = $("searchWrap");
const searchBtn = $("searchBtn");
const addressInput = $("addressInput");
// Never restore address into search input
try{ if (addressInput) addressInput.value = ""; }catch{}
const addressDisplay = $("addressDisplay");
const menuBtn = $("menuBtn");

/* ================= PER-TAB ADDRESS ISOLATION =================
   Fixes multi-tab mixing on refresh:
   - Each tab keeps its own address in sessionStorage
   - Also mirrors it into the URL (?a=inj...) so it survives browser/device restore
   - localStorage keeps only the "last used" address as a default for NEW tabs
*/
const LAST_ADDR_KEY = "inj_last_address";     // global default for new tabs (safe)
const TAB_ADDR_KEY  = "inj_tab_address";      // per-tab (sessionStorage) address

function isValidInjAddr(a){
  return /^inj[a-z0-9]{20,80}$/i.test(String(a||"").trim());
}
function getUrlAddr(){
  try{
    const u = new URL(location.href);
    return (u.searchParams.get("a") || "").trim();
  }catch{ return ""; }
}
function setUrlAddr(a){
  try{
    const u = new URL(location.href);
    const v = String(a||"").trim();
    if (v) u.searchParams.set("a", v);
    else u.searchParams.delete("a");
    history.replaceState(null, "", u.toString());
  }catch{}
}
function resolveInitialAddr(){
  const u = getUrlAddr();
  if (isValidInjAddr(u)) return u;

  try{
    const tabA = (sessionStorage.getItem(TAB_ADDR_KEY) || "").trim();
    if (isValidInjAddr(tabA)) return tabA;
  }catch{}

  // legacy migration (old builds used inj_address)
  try{
    const legacy = (localStorage.getItem("inj_address") || "").trim();
    if (isValidInjAddr(legacy)) return legacy;
  }catch{}

  try{
    const last = (localStorage.getItem(LAST_ADDR_KEY) || "").trim();
    if (isValidInjAddr(last)) return last;
  }catch{}

  return "";
}

let address = resolveInitialAddr();
let pendingAddress = address || "";

// If we resolved an address, lock it to this tab + URL (so refresh never mixes)
if (address){
  try{ sessionStorage.setItem(TAB_ADDR_KEY, address); }catch{}
  setUrlAddr(address);
  try{ localStorage.setItem(LAST_ADDR_KEY, address); }catch{}
}
function maskAddr(a){
  const s = String(a||"").trim();
  if (!s) return "";
  if (s.length <= 14) return s;
  return s.slice(0, 8) + "…" + s.slice(-6);
}
function setCopyButtonState(ok){
  const ids = ["copyWalletBtn", "copyAddrBtn"];
  for (const id of ids){
    const btn = $(id);
    if (!btn) continue;
    btn.classList.toggle("copied", !!ok);
    if (ok){
      setTimeout(() => btn.classList.remove("copied"), 900);
    }
  }
}

function setAddressDisplay(addr) {
  if (!addressDisplay) return;
  if (!addr) { addressDisplay.innerHTML = ""; return; }
  addressDisplay.innerHTML = `
    <span class="tag"><strong>Wallet:</strong> ${shortAddr(addr)}</span>
    <button class="addr-copy" id="copyWalletBtn" type="button" aria-label="Copy wallet" title="Copy wallet">⧉</button>
  `;
}
setAddressDisplay(address);

function openSearch() {
  if (!searchWrap) return;
  searchWrap.classList.add("open");
  document.body.classList.add("search-open");

  if (addressInput) {
    addressInput.value = "";
    pendingAddress = "";
  }

  setTimeout(() => addressInput?.focus(), 20);
}
function closeSearch() {
  if (!searchWrap) return;
  searchWrap.classList.remove("open");
  document.body.classList.remove("search-open");
  addressInput?.blur();
}

if (addressInput) addressInput.value = "";

searchBtn?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  if (!searchWrap.classList.contains("open")) openSearch();
  else addressInput?.focus();
}, { passive: false });

addressInput?.addEventListener("focus", () => openSearch(), { passive: true });
addressInput?.addEventListener("input", (e) => { pendingAddress = e.target.value.trim(); }, { passive: true });

addressInput?.addEventListener("keydown", async (e) => {
  try{

  if (e.key === "Enter") {
    e.preventDefault();
    const v = (addressInput?.value || pendingAddress || "").trim();
    await commitAddress(v);
    addressInput.value = "";
    pendingAddress = "";
    closeSearch(); /* ✅ torna normale dopo ricerca */
  } else if (e.key === "Escape") {
    e.preventDefault();
    addressInput.value = "";
    pendingAddress = "";
    if (addressInput) addressInput.value = "";
    closeSearch();
  }
  }catch(err){
    console.warn("[address keydown] async error", err);
  }
});
document.addEventListener("click", (e) => {
  if (!searchWrap) return;
  if (searchWrap.contains(e.target)) return;
  closeSearch();
}, { passive: true });

/* ================= DRAWER MENU ================= */
const backdrop = $("backdrop");
const drawer = $("drawer");
const drawerNav = $("drawerNav");
const themeToggle = $("themeToggle");
const liveToggle = $("liveToggle");
const viewToggle = $("viewToggle");
const viewIcon = $("viewIcon");
const liveIcon = $("liveIcon");
const modeHint = $("modeHint");

const cloudDotMenu = $("cloudMenuDot");
const cloudTextMenu = $("cloudMenuStatus");
const cloudLastMenu = $("cloudMenuLast");

let isDrawerOpen = false;
function openDrawer(){
  isDrawerOpen = true;
  document.body.classList.add("drawer-open");
  drawer?.setAttribute("aria-hidden", "false");
  backdrop?.setAttribute("aria-hidden", "false");
}
function closeDrawer(){
  isDrawerOpen = false;
  document.body.classList.remove("drawer-open");
  drawer?.setAttribute("aria-hidden", "true");
  backdrop?.setAttribute("aria-hidden", "true");
}
function toggleDrawer(){ isDrawerOpen ? closeDrawer() : openDrawer(); }

menuBtn?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  toggleDrawer();
}, { passive: false });

backdrop?.addEventListener("click", () => closeDrawer(), { passive:true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDrawer();
    closeComingSoon();
    exitFullscreenCard();
    closeSearch();
  }
});

themeToggle?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyTheme(theme === "dark" ? "light" : "dark");
}, { passive:false });

viewToggle?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyView(viewMode === "lite" ? "pro" : "lite");
}, { passive:false });

// Copy wallet address (header + optional legacy button)
const copyWalletToClipboard = async (e) => {
  e?.preventDefault?.();
  const a = String(address||"").trim();
  if (!a) return;
  try{
    if (navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(a);
    } else {
      throw new Error("clipboard_unavailable");
    }
    setCopyButtonState(true);
    pushToast?.("Address copied");
  }catch(err){
    console.warn("[copy]", err);
    try{
      const ta = document.createElement("textarea");
      ta.value = a;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopyButtonState(true);
      pushToast?.("Address copied");
    }catch(e2){
      console.warn("[copy2]", e2);
      pushToast?.("Copy failed");
    }
  }
};

$("copyAddrBtn")?.addEventListener("click", copyWalletToClipboard, { passive:false });
document.addEventListener("click", (e) => {
  const btn = e?.target?.closest?.("#copyWalletBtn");
  if (btn) copyWalletToClipboard(e);
}, { passive:false });

/* ================= COMING SOON overlay ================= */
const comingSoon = $("comingSoon");
const comingTitle = $("comingTitle");
const comingSub = $("comingSub");
const comingClose = $("comingClose");

function pageLabel(key){
  if (key === "home") return "HOME";
  if (key === "market") return "MARKET";
  return "PAGE";
}
function openComingSoon(pageKey){
  if (!comingSoon) return;
  if (comingTitle) comingTitle.textContent = `COMING SOON 🚀`;
  if (comingSub) comingSub.textContent = `${pageLabel(pageKey)} is coming soon.`;
  comingSoon.classList.add("show");
  comingSoon.setAttribute("aria-hidden", "false");
}
function closeComingSoon(){
  if (!comingSoon) return;
  comingSoon.classList.remove("show");
  comingSoon.setAttribute("aria-hidden", "true");
}
comingClose?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  closeComingSoon();
}, { passive:false });
comingSoon?.addEventListener("click", (e) => {
  if (e.target === comingSoon) closeComingSoon();
}, { passive:true });

/* ================= PAGES ================= */
const pageDashboard = $("pageDashboard");
const pageEvents = $("pageEvents");
const pageSettings = $("pageSettings");
const pageTools = $("pageTools");

function showPage(key){
  pageDashboard?.classList.remove("active");
  pageEvents?.classList.remove("active");
  pageSettings?.classList.remove("active");
  pageTools?.classList.remove("active");
if (key === "events") pageEvents?.classList.add("active");
  else if (key === "settings") pageSettings?.classList.add("active");
  else if (key === "tools") pageTools?.classList.add("active");
  else pageDashboard?.classList.add("active");
  try{ updateConnRefreshBtn(); }catch{}
}
function setActivePage(pageKey){
  const items = drawerNav?.querySelectorAll(".nav-item") || [];
  items.forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageKey));
}

drawerNav?.addEventListener("click", (e) => {
  const btn = e.target?.closest(".nav-item");
  if (!btn) return;


  const page = btn.dataset.page || "dashboard";
  setActivePage(page);
  closeDrawer();

  if (page === "dashboard") {
    closeComingSoon();
    showPage("dashboard");
  } else if (page === "event" || page === "events") {
    closeComingSoon();
    showPage("events");
    renderEvents();
  } else if (page === "tools") {
    closeComingSoon();
    showPage("tools");
    renderTools();
  } else if (page === "settings") {
    closeComingSoon();
    showPage("settings");
    renderSettingsSnapshot();
  } else {
    showPage("dashboard");
    openComingSoon(page);
  }
}, { passive:true });

/* ================= TOOLS ================= */
let fgSeries = []; // [{t,v}]
let toolsFx = 0;
let toolsFgTimer = 0;
let toolsFxTimer = 0;
let activeVolTF = "d";
    let activeFgTF  = "d";

function toolsFmt(n, d=2){
  const x = Number(n);
  if(!isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function toolsFmtPct(n, d=2){
  const x = Number(n);
  if(!isFinite(x)) return "—";
  return (x).toFixed(d) + "%";
}

function convRecalc(){
  const eur = safe(parseFloat(($("convEur")?.value || "0").replace(",", ".")));
  const fx = safe(toolsFx);
  const usd = eur * fx;
  const px = safe(displayed?.price || targetPrice || 0);
  const inj = px ? (usd / px) : 0;

  setText("convUsd", usd ? "$ " + toolsFmt(usd, 2) : "—");
  setText("convInj", (eur && fx && px) ? toolsFmt(inj, 4) : "—");
  setText("convFx", fx ? toolsFmt(fx, 4) : "—");
  setText("convInjPx", px ? "$ " + toolsFmt(px, 4) : "—");
}

async function fetchFx(){
  // frankfurter: base EUR -> USD
  try{
    const r = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD", { cache:"no-store" });
    const j = await r.json();
    const fx = safe(j?.rates?.USD);
    if (fx) toolsFx = fx;
  }catch{}
  convRecalc();
}

function fgLabelFrom(v){
  const x = Number(v);
  if(!isFinite(x)) return "—";
  if(x <= 25) return "Extreme Fear";
  if(x <= 45) return "Fear";
  if(x <= 55) return "Neutral";
  if(x <= 75) return "Greed";
  return "Extreme Greed";
}

async function fetchFearGreed(){
  try{
    const r = await fetch("https://api.alternative.me/fng/?limit=400&format=json", { cache:"no-store" });
    const j = await r.json();
    const arr = Array.isArray(j?.data) ? j.data : [];
    if(!arr.length) return;

    const latest = arr[0];
    const val = safe(latest?.value);
    setText("fgScore", val ? String(Math.round(val)) : "—");
    setText("fgLabel", fgLabelFrom(val));
    
      try{ setText("fgUpdated", "Updated: " + nowLabel()); }catch{}setText("fgUpdated", "Updated: " + nowLabel());

    }catch{}
}

function fgAgg(tfKey){
  // tfKey: d/w/m/y. Uses average of last N days (d=latest)
  if(!Array.isArray(fgSeries) || !fgSeries.length) return null;
  const vals = fgSeries.map(p => p.v).filter(v => isFinite(v));
  if(!vals.length) return null;

  if(tfKey === "d") return vals[vals.length-1];

  const days = (tfKey === "w") ? 7 : (tfKey === "m") ? 30 : 365;
  const take = Math.min(days, vals.length);
  const slice = vals.slice(vals.length - take);
  const avg = slice.reduce((a,b)=>a+b,0) / slice.length;
  return avg;
}

function fgRender(tfKey){
  activeFgTF = tfKey;

  // button active
  document.querySelectorAll('#toolsFgCard .tf-btn').forEach(b => {
    if(!b.dataset.fgtf) return;
    b.classList.toggle("active", b.dataset.fgtf === tfKey);
  });

  const v = fgAgg(tfKey);
  if(!isFinite(v)){
    setText("fgScore","—");
    setText("fgLabel","—");
    return;
  }
  const val = clamp(v, 0, 100);
  setText("fgScore", String(Math.round(val)));
  setText("fgLabel", fgLabelFrom(val));

  const fill = $("fgFill");
  const needle = $("fgNeedle");
  if(fill) fill.style.width = val.toFixed(2) + "%";
  if(needle) needle.style.left = val.toFixed(2) + "%";
}

function volCompute(tfKey){
  const c = candle?.[tfKey];
  if(!c) return null;
  const o = safe(c.open);
  const h = safe(c.high);
  const l = safe(c.low);
  if(!o || !h || !l) return { o, h, l, v: 0 };
  // Range volatility: (high-low)/open * 100
  const v = ((h - l) / o) * 100;
  return { o, h, l, v };
}

function volRender(tfKey){
  activeVolTF = tfKey;
  const b = document.querySelectorAll('#toolsVolCard .tf-btn');
  b.forEach(x => x.classList.toggle("active", x.dataset.voltf === tfKey));

  const r = volCompute(tfKey);
  if(!r){
    setText("volValue","—"); setText("volHigh","—"); setText("volLow","—"); setText("volOpen","—");
    return;
  }
  setText("volValue", toolsFmtPct(r.v, 2));
  setText("volHigh", r.h ? "$ " + toolsFmt(r.h, 4) : "—");
  setText("volLow", r.l ? "$ " + toolsFmt(r.l, 4) : "—");
  setText("volOpen", r.o ? "$ " + toolsFmt(r.o, 4) : "—");

  // map to 0..100 with soft cap (0..25% range -> 0..100)
  const pct = clamp((r.v / 25) * 100, 0, 100);
  const fill = $("volFill"); const needle = $("volNeedle");
  if(fill) fill.style.width = pct.toFixed(2) + "%";
  if(needle) needle.style.left = pct.toFixed(2) + "%";
}

function renderTools(){
  // Converter
  const inp = $("convEur");
  if(inp && !inp._bound){
    inp._bound = true;
    inp.addEventListener("input", convRecalc, { passive:true });
  }

  // TF buttons
  const tfWrap = $("toolsVolCard");
  if(tfWrap && !tfWrap._bound){
    tfWrap._bound = true;
    tfWrap.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".tf-btn");
      if(!btn) return;
      volRender(btn.dataset.voltf || "d");
    });
  }

  // initial render
  convRecalc();
  volRender(activeVolTF);

  // schedule refresh
  if(!toolsFxTimer){
    fetchFx();
    toolsFxTimer = setInterval(fetchFx, 60_000);
  }
  if(!toolsFgTimer){
    fetchFearGreed();
    toolsFgTimer = setInterval(fetchFearGreed, 30_000);
  }
}




/* ================= CARD ORDER (user layout) ================= */
const CARD_ORDER_KEY = "inj_card_order_v1";
const CARD_CATALOG = [
  { id:"netWorthCard",         name:"Net Worth" },
  { id:"availableCard",        name:"Available" },
  { id:"stakedCard",           name:"Staked" },
  { id:"rewardsCard",          name:"Rewards" },
  { id:"totalRewardsAccCard",  name:"Total Reward Accumulate" },
  { id:"feesCard",             name:"Fees" },
  { id:"aprCard",              name:"APR" },
  { id:"validatorCard",        name:"Validator" },
  { id:"tamCard",              name:"Total Asset Management" },
  { id:"priceChartCard",       name:"1D Price Chart" },
  { id:"injPriceCard",         name:"INJ Price" },
];

function defaultCardOrderIds(){
  return CARD_CATALOG.map(x => x.id).filter(id => !!document.getElementById(id));
}
function loadCardOrder(){
  try{
    const raw = localStorage.getItem(CARD_ORDER_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : null;
  } catch { return null; }
}
function saveCardOrder(orderIds){
  try{ localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(orderIds || [])); } catch {}
}
function normalizeCardOrder(orderIds){
  const wrap = document.querySelector("#pageDashboard .cards-wrapper");
  if (!wrap) return defaultCardOrderIds();

  const existing = [...wrap.children]
    .filter(n => n && n.classList && n.classList.contains("card"))
    .map(n => n.id)
    .filter(Boolean);

  const out = [];
  const seen = new Set();

  const pushId = (id) => {
    if (!id || typeof id !== "string") return;
    if (seen.has(id)) return;
    if (!existing.includes(id)) return;
    out.push(id);
    seen.add(id);
  };

  if (Array.isArray(orderIds)) orderIds.forEach(pushId);

  // Add missing known cards
  defaultCardOrderIds().forEach(pushId);

  // Add any remaining cards (future-proof)
  existing.forEach(pushId);

  return out;
}
function applyCardOrder(orderIds){
  const wrap = document.querySelector("#pageDashboard .cards-wrapper");
  if (!wrap) return;
  const ids = normalizeCardOrder(orderIds);
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) wrap.appendChild(el);
  }
}

let cardOrderDraft = null;
let cardOrderBound = false;

function renderCardOrderUI(){
  const list = $("cardOrderList");
  const note = $("cardOrderNote");
  if (!list) return;

  const saved = loadCardOrder();
  cardOrderDraft = normalizeCardOrder(cardOrderDraft || saved || defaultCardOrderIds());

  list.innerHTML = "";
  for (let i=0; i<cardOrderDraft.length; i++){
    const id = cardOrderDraft[i];

    const row = document.createElement("div");
    row.className = "order-row";

    const nameEl = document.createElement("div");
    nameEl.className = "order-name";
    nameEl.textContent =
      (CARD_CATALOG.find(c => c.id === id)?.name) ||
      (document.getElementById(id)?.querySelector(".label")?.textContent?.trim()) ||
      id;

    const actions = document.createElement("div");
    actions.className = "order-actions";

    const up = document.createElement("button");
    up.className = "order-btn";
    up.type = "button";
    up.dataset.act = "up";
    up.dataset.id = id;
    up.setAttribute("aria-label", "Move up");
    up.textContent = "▲";
    up.disabled = (i === 0);

    const down = document.createElement("button");
    down.className = "order-btn";
    down.type = "button";
    down.dataset.act = "down";
    down.dataset.id = id;
    down.setAttribute("aria-label", "Move down");
    down.textContent = "▼";
    down.disabled = (i === cardOrderDraft.length - 1);

    actions.appendChild(up);
    actions.appendChild(down);

    row.appendChild(nameEl);
    row.appendChild(actions);
    list.appendChild(row);
  }

  if (note) note.textContent = saved ? "Saved order loaded." : "Using default order.";

  if (!cardOrderBound){
    cardOrderBound = true;

    list.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".order-btn");
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (!id || !act) return;

      const idx = cardOrderDraft.indexOf(id);
      if (idx < 0) return;

      if (act === "up" && idx > 0){
        [cardOrderDraft[idx-1], cardOrderDraft[idx]] = [cardOrderDraft[idx], cardOrderDraft[idx-1]];
      } else if (act === "down" && idx < cardOrderDraft.length - 1){
        [cardOrderDraft[idx+1], cardOrderDraft[idx]] = [cardOrderDraft[idx], cardOrderDraft[idx+1]];
      }

      renderCardOrderUI();
    }, { passive:true });

    $("cardOrderApply")?.addEventListener("click", (e) => {
      e?.preventDefault?.();
      const ids = normalizeCardOrder(cardOrderDraft);
      saveCardOrder(ids);
      applyCardOrder(ids);
      if (note) note.textContent = "Applied ✓";
    }, { passive:false });

    $("cardOrderReset")?.addEventListener("click", (e) => {
      e?.preventDefault?.();
      cardOrderDraft = defaultCardOrderIds();
      const ids = normalizeCardOrder(cardOrderDraft);
      saveCardOrder(ids);
      applyCardOrder(ids);
      renderCardOrderUI();
      if (note) note.textContent = "Reset ✓";
    }, { passive:false });
  }
}


/* ================= FULLSCREEN CARD ================= */
let expandedCard = null;
let expandedBackdrop = null;
const expandedHiddenMap = new Map();

function buildExpandedBackdrop(){
  if (expandedBackdrop) return;
  const bd = document.createElement("div");
  bd.style.position = "fixed";
  bd.style.inset = "0";
  bd.style.background = "rgba(0,0,0,0.50)";
  bd.style.backdropFilter = "blur(10px)";
  bd.style.zIndex = "190";
  bd.addEventListener("click", () => exitFullscreenCard(), { passive:true });
  document.body.appendChild(bd);
  expandedBackdrop = bd;
}
function hideNonChartContent(card){
  const hidden = [];
  const keepSet = new Set();
  const tools = card.querySelector(".card-tools");
  if (tools) keepSet.add(tools);

  const canvases = card.querySelectorAll("canvas");
  canvases.forEach(cv => {
    keepSet.add(cv);
    let p = cv.parentElement;
    while (p && p !== card) { keepSet.add(p); p = p.parentElement; }
  });

  [...card.children].forEach(ch => {
    if (keepSet.has(ch)) return;
    let ok = false;
    for (const k of keepSet) {
      if (k && k !== ch && k.contains && k.contains(ch)) { ok = true; break; }
    }
    if (ok) return;
    hidden.push([ch, ch.style.display]);
    ch.style.display = "none";
  });

  expandedHiddenMap.set(card, hidden);
}
function restoreNonChartContent(card){
  const hidden = expandedHiddenMap.get(card) || [];
  hidden.forEach(([el, disp]) => { el.style.display = disp || ""; });
  expandedHiddenMap.delete(card);
}
function enterFullscreenCard(card){
  if (!card) return;
  if (expandedCard) exitFullscreenCard();
  expandedCard = card;

  buildExpandedBackdrop();
  expandedBackdrop.style.display = "block";

  document.body.classList.add("card-expanded");
  card.classList.add("fullscreen");
  hideNonChartContent(card);

  setTimeout(() => {
    try { chart?.resize?.(); } catch {}
    try { stakeChart?.resize?.(); } catch {}
    try { rewardChart?.resize?.(); } catch {}
    try { netWorthChart?.resize?.(); } catch {}
  }, 120);
}
function exitFullscreenCard(){
  if (!expandedCard) return;
  restoreNonChartContent(expandedCard);
  expandedCard.classList.remove("fullscreen");
  document.body.classList.remove("card-expanded");
  expandedBackdrop && (expandedBackdrop.style.display = "none");
  expandedCard = null;

  setTimeout(() => {
    try { chart?.resize?.(); } catch {}
    try { stakeChart?.resize?.(); } catch {}
    try { rewardChart?.resize?.(); } catch {}
    try { netWorthChart?.resize?.(); } catch {}
  }, 120);
}
function bindExpandButtons(){
  const btns = document.querySelectorAll(".card-expand");
  btns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest(".card");
      if (!card) return;
      if (card === expandedCard) exitFullscreenCard();
      else enterFullscreenCard(card);
    }, { passive:false });
  });
}

/* ================= EVENTS SYSTEM (per-address isolation + cloud) ================= */
let eventsAll = [];

function evStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_events_v${EV_LOCAL_VER}_${a}` : null;
}
function loadEvents(){
  const key = evStoreKey(address);
  if (!key) { eventsAll = []; return; }
  try{
    const raw = localStorage.getItem(key);
    if (!raw) { eventsAll = []; return; }
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj?.events)) { eventsAll = []; return; }
    eventsAll = obj.events.slice(0, 1200);
  } catch { eventsAll = []; }
}
function saveEvents(){
  const key = evStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: EV_LOCAL_VER, t: Date.now(), events: eventsAll.slice(0, 1200) }));
  } catch {}
  cloudBumpLocal(1);
  cloudMarkDirty({ events:true });
}

function saveEventsSilent(){
  const key = evStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: EV_LOCAL_VER, t: Date.now(), events: (eventsAll || []).slice(0, 1200) }));
  } catch {}
}
function saveWdAllLocalSilent(){
  const key = wdStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: REWARD_WD_LOCAL_VER, t: Date.now(), labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll }));
  } catch {}
}
function saveNWLocalSilent(){
  const key = nwStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: NW_LOCAL_VER, t: Date.now(), times: nwTAll, usd: nwUsdAll, inj: nwInjAll, tf: nwTf, scale: nwScale }));
  } catch {}
}
function showToast(ev){
  const host = $("toastHost");
  if (!host) return;

  const el = document.createElement("div");
  el.className = "toast";

  const when = fmtHHMMSS(ev.ts || Date.now());
  const title = ev.title || "Event";
  const sub = ev.detail || "";

  el.innerHTML = `
    <div class="toast-row">
      <div class="toast-title">${title}</div>
      <div style="font-weight:900;opacity:.82;font-size:.82rem">${when}</div>
    </div>
    <div class="toast-sub">${sub}</div>
  `;
  host.appendChild(el);
  setTimeout(() => { try { host.removeChild(el); } catch {} }, 2600);
}
function pushEvent(ev){
  if (!address) return;
  const obj = {
    id: ev.id || (String(Date.now()) + "_" + Math.random().toString(16).slice(2)),
    ts: ev.ts || Date.now(),
    kind: ev.kind || "info",
    title: ev.title || "Event",
    detail: ev.detail || "",
    dir: ev.dir || null,
    status: ev.status || "pending"
  };
  eventsAll.unshift(obj);
  eventsAll = eventsAll.slice(0, 1200);
  saveEvents();
  renderEvents();
  showToast(obj);

  if (obj.status === "pending" && obj.kind !== "price") {
    setTimeout(() => {
      const idx = eventsAll.findIndex(x => x.id === obj.id);
      if (idx >= 0) {
        eventsAll[idx].status = hasInternet() ? "ok" : "err";
        saveEvents();
        renderEvents();
      }
    }, 1500);
  }
}
function renderEvents(){
  const body = $("eventsTbody");
  const empty = $("eventsEmpty");
  if (!body) return;

  body.innerHTML = "";
  const list = eventsAll || [];

  if (empty) empty.style.display = list.length ? "none" : "block";
  if (!list.length) return;

  for (const ev of list){
    const tr = document.createElement("tr");
    const dt = new Date(ev.ts || Date.now());
    const when = `${dt.toLocaleDateString()} ${fmtHHMMSS(ev.ts || Date.now())}`;

    const k = (ev.kind || "info").toUpperCase();
    const st = (ev.status || "pending").toUpperCase();

    tr.innerHTML = `
      <td>${k}</td>
      <td style="white-space:nowrap">${when}</td>
      <td>${ev.detail || ev.title || ""}</td>
      <td>${st}</td>
    `;
    body.appendChild(tr);
  }
}
$("eventsClearBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  eventsAll = [];

  // fees (reward-withdraw txs)
  try{ feesIdsAll = []; feesTimesAll = []; feesLabelsAll = []; feesValuesAll = []; } catch {}
  try{ feesLabels = []; feesValues = []; feesTimes = []; } catch {}
  try{ feesTotalCache = NaN; feesLastSyncAt = 0; } catch {}

  // validator cache (used by APR)
  try{ primaryValidator = { valoper:"", moniker:"", commissionRate: NaN }; } catch {}
  saveEvents();
  renderEvents();
}, { passive:false });

/* ================= MODE SWITCH ================= */
let accountPollTimer = null;
let tamPollTimer = null;
let restSyncTimer = null;
let chartSyncTimer = null;
let ensureChartTimer = null;
let cloudPullTimer = null;
const REFRESH_LOOP_MS = 30_000; // refresh mode periodic sync
let refreshLoopTimer = null;

function startRefreshLoop(){
  
  refreshLoopTimer = setInterval(() => safeAsync(() => refreshLoadAllOnce(), "refreshLoadAllOnce"), REFRESH_LOOP_MS);
}
function stopRefreshLoop(){
  if (refreshLoopTimer) { clearInterval(refreshLoopTimer); refreshLoopTimer = null; }
}

function nwValueAtOrBefore(ts){
  const t = Number(ts) || 0;
  for (let i = nwTAll.length - 1; i >= 0; i--){
    const ti = safe(nwTAll[i]);
    if (ti && ti <= t){
      const u = safe(nwUsdAll[i]);
      return (Number.isFinite(u) && u > 0) ? u : null;
    }
  }
  return null;
}
function nwValueAtOrAfter(ts){
  const t = Number(ts) || 0;
  for (let i = 0; i < nwTAll.length; i++){
    const ti = safe(nwTAll[i]);
    if (ti && ti >= t){
      const u = safe(nwUsdAll[i]);
      return (Number.isFinite(u) && u > 0) ? u : null;
    }
  }
  return null;
}
function ensureDailyPerfEvent(){
  if (!address) return;
  const now = Date.now();

  const ts21 = at21Rome(now);
  if (now < ts21) return;

  const day = ymdRome(now);
  const id = `daily_${day}`;
  if (eventsAll?.some(e => e?.id === id)) return;

  const start = startOfDayRome(now);

  const base = nwValueAtOrBefore(start) ?? nwValueAtOrAfter(start);
  const end  = nwValueAtOrBefore(ts21) ?? (Number.isFinite(displayed?.netWorthUsd) && displayed.netWorthUsd > 0 ? displayed.netWorthUsd : null);

  if (!Number.isFinite(base) || !Number.isFinite(end) || base <= 0 || end <= 0) return;

  const delta = end - base;
  const pct = (delta / base) * 100;

  pushEvent({
    id,
    ts: ts21,
    kind: "perf",
    title: "Daily performance (Net Worth)",
    detail: `Δ $${(delta>=0?"+":"")}${delta.toFixed(2)} (${(pct>=0?"+":"")}${pct.toFixed(2)}%) • Start $${base.toFixed(2)} • End $${end.toFixed(2)}`,
    dir: delta >= 0 ? "up" : "down",
    status: "done"
  });
}


function stopAllTimers(){
  if (accountPollTimer) { clearInterval(accountPollTimer); accountPollTimer = null; }
  if (tamPollTimer) { clearInterval(tamPollTimer); tamPollTimer = null; }
  if (restSyncTimer) { clearInterval(restSyncTimer); restSyncTimer = null; }
  if (chartSyncTimer) { clearInterval(chartSyncTimer); chartSyncTimer = null; }
  if (ensureChartTimer) { clearInterval(ensureChartTimer); ensureChartTimer = null; }
  if (cloudPullTimer) { clearInterval(cloudPullTimer); cloudPullTimer = null; }
  
}
function startAllTimers(){
  
  stopAllTimers();
  accountPollTimer = setInterval(() => safeAsync(() => loadAccount(false), "loadAccount"), ACCOUNT_POLL_MS);
  tamPollTimer = setInterval(() => safeAsync(() => loadTAM(false), "loadTAM"), TAM_POLL_MS);
  restSyncTimer = setInterval(() => {
    safeAsync(() => loadCandleSnapshot(false), "loadCandleSnapshot");
    safeAsync(() => feesBackfill(false), "feesBackfill");
}, REST_SYNC_MS);
  chartSyncTimer = setInterval(() => safeAsync(() => loadChartToday(false), "loadChartToday"), CHART_SYNC_MS);
  ensureChartTimer = setInterval(() => safeAsync(() => ensureChartBootstrapped(), "ensureChartBootstrapped"), 1500);
  cloudPullTimer = setInterval(() => { if (address) safeAsync(() => cloudPull(), "cloudPull"); }, CLOUD_PULL_INTERVAL_MS);
}

async function refreshLoadAllOnce(){
  if (refreshLoading) return;
  if (!hasInternet()) {
    refreshLoaded = false;
    modeLoading = false;
    // Offline: show last saved values (if any) and wait for reconnection
    try{
      const snap = loadAccountSnapshot(address);
      if (snap) applyAccountSnapshot(snap);
    } catch {}
    refreshConnUI();
    cloudSetState("synced");
    return;
  }

  refreshLoading = true;
  refreshLoaded = false;
  modeLoading = true;
  refreshConnUI();

  try{
    await loadCandleSnapshot(true);
    await loadChartToday(true);
await loadTAM(true);
    if (address) await loadAccount(true);
    if (address) await feesBackfill(true);
    refreshLoaded = true;
    modeLoading = false;
    refreshConnUI();
    cloudSetState("synced");
  } finally {
    refreshLoading = false;
    refreshConnUI();
  }
}

function setMode(isLive){
  liveMode = !!isLive;
  try{ document.body.dataset.mode = liveMode ? "live" : "refresh"; } catch {}
  localStorage.setItem(MODE_KEY, liveMode ? "live" : "refresh");

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  modeLoading = true;
  refreshConnUI();
  try{ updateConnRefreshBtn(); }catch{}
  renderSettingsSnapshot();

  if (!liveMode) {
    stopAllTimers();
    stopAllSockets();
    wsTradeOnline = false;
    wsKlineOnline = false;
    accountOnline = false;

    refreshLoaded = false;
    refreshLoading = false;

    setTimeout(() => {
      refreshConnUI();
      safeAsync(() => refreshLoadAllOnce(), "refreshLoadAllOnce");
      
    }, REFRESH_RED_MS);

  } else {
    
    refreshLoaded = false;
    refreshLoading = false;

    startTradeWS();
    startKlineWS();
    loadCandleSnapshot();
    loadChartToday();
    if (address) safeAsync(() => loadAccount(false), "loadAccount");
    startAllTimers();
    refreshConnUI();
  }
}

$("liveToggle")?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  setMode(!liveMode);
}, { passive:false });

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0, netWorthUsd: 0, apr: 0 };

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

const candle = {
  d: { t: 0, open: 0, high: 0, low: 0 },
  w: { t: 0, open: 0, high: 0, low: 0 },
  m: { t: 0, open: 0, high: 0, low: 0 },
  y: { t: 0, open: 0, high: 0, low: 0 },
};
const tfReady = { d: false, w: false, m: false, y: false };

/* ================= WS (price + klines) ================= */
let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

function stopAllSockets(){
  try { wsTrade?.close(); } catch {}
  try { wsKline?.close(); } catch {}
  wsTrade = null; wsKline = null;
  if (tradeRetryTimer) { clearTimeout(tradeRetryTimer); tradeRetryTimer = null; }
  if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; }
}
function scheduleTradeRetry() {
  if (tradeRetryTimer) clearTimeout(tradeRetryTimer);
  tradeRetryTimer = setTimeout(() => { if (liveMode) startTradeWS(); }, 1200);
}
function startTradeWS() {
  if (!liveMode) return;
  try { wsTrade?.close(); } catch {}

  wsTradeOnline = false;
  refreshConnUI();
  if (!hasInternet()) return;

  wsTrade = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  wsTrade.onopen = () => {
    wsTradeOnline = true;
    modeLoading = address ? !accountOnline : false;
    refreshConnUI();
  };
  wsTrade.onclose = () => { wsTradeOnline = false; refreshConnUI(); scheduleTradeRetry(); };
  wsTrade.onerror = () => { wsTradeOnline = false; refreshConnUI(); try { wsTrade.close(); } catch {} scheduleTradeRetry(); };

  wsTrade.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const p = safe(msg?.p);
    if (!p) return;

    targetPrice = p;

    if (tfReady.d) { candle.d.high = Math.max(candle.d.high, p); candle.d.low = Math.min(candle.d.low, p); }
    if (tfReady.w) { candle.w.high = Math.max(candle.w.high, p); candle.w.low = Math.min(candle.w.low, p); }
    if (tfReady.m) { candle.m.high = Math.max(candle.m.high, p); candle.m.low = Math.min(candle.m.low, p); }
  };
}
function scheduleKlineRetry() {
  if (klineRetryTimer) clearTimeout(klineRetryTimer);
  klineRetryTimer = setTimeout(() => { if (liveMode) startKlineWS(); }, 1200);
}
function applyKline(intervalKey, k) {
  const t = safe(k.t);
  const o = safe(k.o);
  const h = safe(k.h);
  const l = safe(k.l);
  if (o && h && l) {
    candle[intervalKey].t = t || candle[intervalKey].t;
    candle[intervalKey].open = o;
    candle[intervalKey].high = h;
    candle[intervalKey].low  = l;
    if (!tfReady[intervalKey]) {
      tfReady[intervalKey] = true;
      settleStart = Date.now();
    }
  }
}
function startKlineWS() {
  if (!liveMode) return;
  try { wsKline?.close(); } catch {}

  wsKlineOnline = false;
  refreshConnUI();
  if (!hasInternet()) return;

  const url =
    "wss://stream.binance.com:9443/stream?streams=" +
    "injusdt@kline_1m/" +
    "injusdt@kline_1d/" +
    "injusdt@kline_1w/" +
    "injusdt@kline_1M";

  wsKline = new WebSocket(url);

  wsKline.onopen = () => {
    wsKlineOnline = true;
    modeLoading = address ? !accountOnline : false;
    refreshConnUI();
  };
  wsKline.onclose = () => { wsKlineOnline = false; refreshConnUI(); scheduleKlineRetry(); };
  wsKline.onerror = () => { wsKlineOnline = false; refreshConnUI(); try { wsKline.close(); } catch {} scheduleKlineRetry(); };

  wsKline.onmessage = (e) => {
    let payload;
    try { payload = JSON.parse(e.data); } catch { return; }
    const data = payload?.data;
    const stream = payload?.stream || "";
    const k = data?.k;
    if (!k) return;

    if (stream.includes("@kline_1m")) {
      updateChartFrom1mKline(k);
      return;
    }

    if (stream.includes("@kline_1d")) applyKline("d", k);
    else if (stream.includes("@kline_1w")) applyKline("w", k);
    else if (stream.includes("@kline_1M")) applyKline("m", k);
  };
}

/* ================= ACCOUNT (Injective LCD) ================= */
async function loadAccount(isRefresh=false) {
  if (!isRefresh && !liveMode) return;

  // Always resolve loading state even if something fails
  try{
    if (!address || !hasInternet()) {
      // Offline: keep last saved values (offline-friendly) and wait for reconnection
      accountOnline = false;
      modeLoading = false;
      try{
        const snap = loadAccountSnapshot(address);
        if (snap) applyAccountSnapshot(snap);
      } catch {}
      refreshConnUI();
      return;
    }

    // Fetch via LCD with fallback endpoints
    const bankP = fetchLCD(`/cosmos/bank/v1beta1/balances/${address}`);
    const delP  = fetchLCD(`/cosmos/staking/v1beta1/delegations/${address}`);
    const rewP  = fetchLCD(`/cosmos/distribution/v1beta1/delegators/${address}/rewards`);

    // For APR we use annual provisions / bonded tokens (minus community tax).
    const annP  = fetchLCD(`/cosmos/mint/v1beta1/annual_provisions`);
    const poolP = fetchLCD(`/cosmos/staking/v1beta1/pool`);
    const distP = fetchLCD(`/cosmos/distribution/v1beta1/params`);

    const [b, s, r, ap, pool, dist] = await Promise.all([bankP, delP, rewP, annP, poolP, distP]);

    // We consider account OK if balances + delegations arrived
    if (!b || !s) {
      accountOnline = false;
      modeLoading = false;
      refreshConnUI();
      return;
    }

    accountOnline = true;
    markLastOk();
    modeLoading = false;
    refreshConnUI();

    const bal = b.balances?.find(x => x.denom === "inj");
    availableInj = safe(bal?.amount) / 1e18;

    const del = (s.delegation_responses || []);
    stakeInj = del.reduce((a, d) => a + safe(d?.balance?.amount), 0) / 1e18;

    // ✅ Validator card (top delegation) + cache (used by APR)
    let pv = null;
    try { pv = await updateValidatorFromDelegations(del); } catch { pv = primaryValidator; }

    // Rewards may fail sometimes; keep last known if so
    if (r) {
      const newRewards = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
      rewardsInj = newRewards;
    }

    // APR may fail; keep last known
    try{
      const annual = safe(ap?.annual_provisions);
      const bonded = safe(pool?.pool?.bonded_tokens);
      const cTax   = safe(dist?.params?.community_tax); // fraction (0..1)
      if (annual > 0 && bonded > 0){
        const gross = (annual / bonded) * (1 - cTax) * 100;
        const comm  = (pv && Number.isFinite(pv.commissionRate)) ? pv.commissionRate :
                      (Number.isFinite(primaryValidator?.commissionRate) ? primaryValidator.commissionRate : NaN);
        const net = Number.isFinite(comm) ? gross * (1 - comm) : gross;
        if (Number.isFinite(net) && net > 0) apr = net;
      }
    } catch {}

    // ✅ APR change event
    if (lastAprSeen == null) lastAprSeen = apr;
    else {
      const dApr = apr - lastAprSeen;
      if (Math.abs(dApr) >= 0.05) {
        pushEvent({
          kind: "apr",
          title: dApr > 0 ? "APR increased" : "APR decreased",
          detail: `${(dApr>0?"+":"")}${dApr.toFixed(2)}% • Now ${apr.toFixed(2)}%`,
          dir: dApr > 0 ? "up" : "down",
          status: "done"
        });
        lastAprSeen = apr;
      }
    }

    try { recordAprPoint(); } catch {}

    maybeAddStakePoint(stakeInj);
    maybeRecordRewardWithdrawal(rewardsInj);
    recordNetWorthPoint();
    try { ensureDailyPerfEvent(); } catch {}
    saveAccountSnapshot();

  }catch(err){
    console.warn("[loadAccount] error", err);
    accountOnline = false;
  }finally{
    // Never keep the UI stuck in loading
    modeLoading = false;
    refreshConnUI();
  }
}

/* ================= BINANCE REST: snapshot candele 1D/1W/1M ================= */
async function loadCandleSnapshot(isRefresh=false) {
  if (!isRefresh && !liveMode) return;
  if (!hasInternet()) return;

  const [d, w, m, y] = await Promise.all([
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1d&limit=1"),
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1w&limit=1"),
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1M&limit=1"),
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1w&limit=52")
  ]);
  // ✅ network ok
  markLastOk();

  if (Array.isArray(d) && d[0]) {
    candle.d.t = safe(d[0][0]);
    candle.d.open = safe(d[0][1]);
    candle.d.high = safe(d[0][2]);
    candle.d.low  = safe(d[0][3]);
    if (candle.d.open && candle.d.high && candle.d.low) tfReady.d = true;
  }
  if (Array.isArray(w) && w[0]) {
    candle.w.t = safe(w[0][0]);
    candle.w.open = safe(w[0][1]);
    candle.w.high = safe(w[0][2]);
    candle.w.low  = safe(w[0][3]);
    if (candle.w.open && candle.w.high && candle.w.low) tfReady.w = true;
  }
  if (Array.isArray(m) && m[0]) {
    candle.m.t = safe(m[0][0]);
    candle.m.open = safe(m[0][1]);
    candle.m.high = safe(m[0][2]);
    candle.m.low  = safe(m[0][3]);
    if (candle.m.open && candle.m.high && candle.m.low) tfReady.m = true;
  }

  if (Array.isArray(y) && y.length) {
    // Year = last ~52 weekly candles
    const first = y[0];
    candle.y.t = safe(first?.[0]);
    candle.y.open = safe(first?.[1]);

    let hi = -Infinity, lo = Infinity;
    for (const c of y) {
      const h = safe(c?.[2]);
      const l = safe(c?.[3]);
      if (h) hi = Math.max(hi, h);
      if (l) lo = Math.min(lo, l);
    }
    candle.y.high = Number.isFinite(hi) ? hi : 0;
    candle.y.low  = Number.isFinite(lo) ? lo : 0;
    if (candle.y.open && candle.y.high && candle.y.low) tfReady.y = true;
  }
}

/* ================= PRICE CHART (1D) ================= */
let chart = null;
let chartLabels = [];
let chartData = [];
let lastChartSign = null;
let chartUpdateLock = false;
let lastChartMinuteStart = 0;
let chartBootstrappedToday = false;

let hoverActive = false;
let hoverHideTimer = null;
let hoverIndex = null;
let pinnedIndex = null;
let isPanning = false;

const verticalLinePlugin = {
  id: "verticalLinePlugin",
  afterDraw(ch) {
    if (!hoverActive || hoverIndex == null) return;
    const meta = ch.getDatasetMeta(0);
    const el = meta?.data?.[hoverIndex];
    if (!el) return;
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(el.x, ch.chartArea.top);
    ctx.lineTo(el.x, ch.chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(250,204,21,0.9)";
    ctx.stroke();
    ctx.restore();
  }
};

function applyChartColorBySign(sign) {
  if (!chart) return;
  if (sign === lastChartSign) return;
  lastChartSign = sign;
  const ds = chart.data.datasets?.[0];
  if (!ds) return;

if (sign === "live") {
  ds.borderColor = "#38bdf8";
  ds.backgroundColor = "rgba(56,189,248,.16)";
} else if (sign === "up") {
    ds.borderColor = "#22c55e";
    ds.backgroundColor = "rgba(34,197,94,.20)";
  } else if (sign === "down") {
    ds.borderColor = "#ef4444";
    ds.backgroundColor = "rgba(239,68,68,.18)";
  } else {
    ds.borderColor = "#3b82f6";
    ds.backgroundColor = "rgba(59,130,246,.14)";
  }

  if (chartUpdateLock) return;
  chartUpdateLock = true;
  try { chart.update("none"); } catch (e) { console.warn("[chart.update]", e); }
  chartUpdateLock = false;
}

function updatePinnedOverlay() {
  const overlay = $("chartOverlay");
  const chartEl = $("chartPrice");
  if (!overlay || !chartEl || !chart) return;

  if (pinnedIndex == null) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  const ds = chart.data.datasets?.[0]?.data || [];
  const lbs = chart.data.labels || [];
  if (!ds.length || !lbs.length) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  let idx = Number.isFinite(+pinnedIndex) ? +pinnedIndex : null;
  if (idx == null) return;

  idx = clamp(Math.round(idx), 0, ds.length - 1);
  const price = safe(ds[idx]);
  const label = lbs[idx];
  if (!Number.isFinite(price) || !label) return;

  const ts = labelToTs(label);
  const span = spanMsFromLabels(lbs);
  const lbl = ts ? fmtAxisX(ts, span) : String(label);
  chartEl.textContent = `${lbl} • $${price.toFixed(4)}`;
  overlay.classList.add("show");
}

async function fetchKlines1mRange(startTime, endTime) {
  const out = [];
  let cursor = startTime;
  const end = endTime || Date.now();

  while (cursor < end && out.length < DAY_MINUTES) {
    const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1000&startTime=${cursor}&endTime=${end}`;
    const d = await fetchJSON(url);
    if (!Array.isArray(d) || !d.length) break;

    out.push(...d);
    const lastOpenTime = safe(d[d.length - 1][0]);
    cursor = lastOpenTime + ONE_MIN_MS;

    if (!lastOpenTime) break;
    if (d.length < 1000) break;
  }
  return out.slice(0, DAY_MINUTES);
}

function initChartToday() {
  const canvas = $("priceChart");
  if (!canvas || !window.Chart) return;

  const zoomBlock = ZOOM_OK ? {
    zoom: {
      pan: {
        enabled: true,
        mode: "x",
        threshold: 2,
        onPanStart: () => { isPanning = true; },
        onPanComplete: ({ chart }) => {
          isPanning = false;
          const xScale = chart.scales.x;
          const center = (chart.chartArea.left + chart.chartArea.right) / 2;
          pinnedIndex = xScale.getValueForPixel(center);
          updatePinnedOverlay();
        }
      },
      zoom: {
        wheel: { enabled: true },
        pinch: { enabled: true },
        mode: "x",
        onZoomComplete: ({ chart }) => {
          const xScale = chart.scales.x;
          const center = (chart.chartArea.left + chart.chartArea.right) / 2;
          pinnedIndex = xScale.getValueForPixel(center);
          updatePinnedOverlay();
        }
      }
    }
  } : {};

  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartData,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        cubicInterpolationMode: "monotone",
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...zoomBlock
      },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { left: 6, right: 10, top: 6, bottom: 2 } },
      scales: {
    x: { display: true, ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6, padding: 6,
          callback: (v) => {
            const lbs = chart?.data?.labels || [];
            const span = spanMsFromLabels(lbs);
            const lbl = (lbs?.[v] ?? v);
            const ts = labelToTs(lbl);
            return fmtAxisX(ts, span);
          }
        }, grid: { color: axisGridColor() }, border:{ display:false } },
        y: {
          ticks: {
            color: axisTickColor(),
            padding: 6,
            callback: (v) => `$${fmtSmart(v)}`
          },
          grid: { color: axisGridColor() },
          border:{ display:false }
        }
      }
    },
    plugins: [verticalLinePlugin, lastDotPlugin]
  });

  setupChartInteractions();
}

async function loadChartToday(isRefresh=false) {
  if (!isRefresh && !liveMode) return;
  if (!hasInternet()) return;
  if (!tfReady.d || !candle.d.t) return;

  const kl = await fetchKlines1mRange(candle.d.t, Date.now());
  if (!kl.length) return;

  chartLabels = kl.map(k => tsLabel(safe(k[0])));
  chartData   = kl.map(k => safe(k[4]));
  lastChartMinuteStart = safe(kl[kl.length - 1][0]) || 0;

  const lastClose = safe(kl[kl.length - 1][4]);
  if (!targetPrice && lastClose) targetPrice = lastClose;

  if (!chart) initChartToday();
  if (chart) {
    chart.data.labels = chartLabels;
    chart.data.datasets[0].data = chartData;
    chart.update("none");
  }

  chartBootstrappedToday = true;
}

function setupChartInteractions() {
  const canvas = $("priceChart");
  if (!canvas || !chart) return;

  const getIndexFromEvent = (evt) => {
    try{
      const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
      if (!points || !points.length) return null;
      return points[0].index;
    } catch { return null; }
  };

  const armHide = () => {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(() => {
      hoverActive = false;
      hoverIndex = null;
      pinnedIndex = null;
      updatePinnedOverlay();
      try { chart && chart.update("none"); } catch {}
    }, (Number.isFinite(+ch.$crosshairHoldMs) ? +ch.$crosshairHoldMs : 950));
  };

  const start = (evt) => {
    if (!chart || isPanning) return;
    const idx = getIndexFromEvent(evt);
    if (idx == null) return;

    hoverActive = true;
    hoverIndex = idx;
    pinnedIndex = idx;

    updatePinnedOverlay();
    try { chart.update("none"); } catch {}
    armHide();
  };

  const move = (evt) => {
    if (!hoverActive) return; // only after click/tap
    const idx = getIndexFromEvent(evt);
    if (idx == null) return;

    hoverIndex = idx;
    pinnedIndex = idx;

    updatePinnedOverlay();
    try { chart.update("none"); } catch {}
    armHide();
  };

  const end = () => {
    hoverActive = false;
    hoverIndex = null;
    pinnedIndex = null;
    updatePinnedOverlay();
    try { chart && chart.update("none"); } catch {}
  };

  // click/tap to show
  canvas.addEventListener("click", start, { passive:true });
  canvas.addEventListener("touchstart", start, { passive:true });

  // allow short drag while active
  canvas.addEventListener("mousemove", move, { passive:true });
  canvas.addEventListener("touchmove", move, { passive:true });

  canvas.addEventListener("mouseleave", end, { passive:true });
  canvas.addEventListener("touchend", end, { passive:true });
  canvas.addEventListener("touchcancel", end, { passive:true });
}

function updateChartFrom1mKline(k) {
  if (!liveMode) return;

  const isLive = (priceTf === "live");
  const is1d = (priceTf === "1d");
  if (!(isLive || is1d)) return;

  if (!chart) return;

  // For 1D we keep the stricter prerequisites (day-start candle + tfReady).
  if (is1d) {
    if (!chartBootstrappedToday || !tfReady.d || !candle.d.t) return;
  }

  const openTime = safe(k.t);
  const close = safe(k.c);
  if (!openTime || !close) return;

  const now = Date.now();
  const windowStart = isLive ? priceLiveRange(now).start : safe(candle?.d?.t);

  if (windowStart && openTime < windowStart) return;

  if (lastChartMinuteStart === openTime) {
    const idx = chart.data.datasets[0].data.length - 1;
    if (idx >= 0) {
      chart.data.datasets[0].data[idx] = close;
      chart.update("none");
    }
    return;
  }

  lastChartMinuteStart = openTime;
  chart.data.labels.push(tsLabel(openTime));
  chart.data.datasets[0].data.push(close);

  if (isLive) {
    // keep a rolling 15m window, but during the first 15m show the session build-up
    while (chart.data.labels.length) {
      const ts0 = labelToTs(chart.data.labels[0]);
      if (ts0 && ts0 < windowStart) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
        continue;
      }
      break;
    }
    const maxPts = PRICE_LIVE_MAX_POINTS + 10; // cushion for gaps
    while (chart.data.labels.length > maxPts) chart.data.labels.shift();
    while (chart.data.datasets[0].data.length > maxPts) chart.data.datasets[0].data.shift();
  } else {
    while (chart.data.labels.length > DAY_MINUTES) chart.data.labels.shift();
    while (chart.data.datasets[0].data.length > DAY_MINUTES) chart.data.datasets[0].data.shift();
  }

  chart.update("none");
}

/* ================= STAKE CHART (persist) ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let stakeMoves = [];
let stakeTypes = [];
let lastStakeRecordedRounded = null;
let stakeBaselineCaptured = false;
let stakeFollow = true;

function stakeStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_stake_series_v${STAKE_LOCAL_VER}_${a}` : null;
}
function clampArray(arr, max) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}
function saveStakeSeriesLocal() {
  const key = stakeStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: STAKE_LOCAL_VER, t: Date.now(),
      labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes
    }));
    cloudBumpLocal(1);
  } catch {}
  cloudMarkDirty({ stake:true });
}
function loadStakeSeriesLocal() {
  const key = stakeStoreKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== STAKE_LOCAL_VER) return false;

    stakeLabels = Array.isArray(obj.labels) ? obj.labels : [];
    stakeData   = Array.isArray(obj.data)   ? obj.data   : [];
    stakeMoves  = Array.isArray(obj.moves)  ? obj.moves  : [];
    stakeTypes  = Array.isArray(obj.types)  ? obj.types  : [];

    const n = stakeData.length;
    stakeLabels = stakeLabels.slice(0, n);
    stakeMoves  = stakeMoves.slice(0, n);
    stakeTypes  = stakeTypes.slice(0, n);

    while (stakeMoves.length < n) stakeMoves.push(0);
    while (stakeTypes.length < n) stakeTypes.push("Stake update");

    stakeBaselineCaptured = stakeData.length > 0;
    lastStakeRecordedRounded = stakeData.length ? Number(safe(stakeData[stakeData.length - 1]).toFixed(6)) : null;
    return true;
  } catch { return false; }
}

function initStakeChart() {
  const canvas = $("stakeChart");
  if (!canvas || !window.Chart) return;

  stakeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: stakeLabels,
      datasets: [{
        data: stakeData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.18)",
        fill: true,
        tension: 0.48,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 0,
        pointHitRadius: 18,
        borderWidth: 2,
        borderCapStyle: "round",
        borderJoinStyle: "round"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2, onPanComplete: ({ chart }) => { try{ stakeAutoYFromChart(chart); chart.update("none"); }catch{} } }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x", onZoomComplete: ({ chart }) => { try{ stakeAutoYFromChart(chart); chart.update("none"); }catch{} } } } } : {})
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          display:true,
          ticks: {
            color: axisTickColor(),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            padding: 6,
            callback: (v) => {
              const span = spanMsFromLabels(stakeLabels);
              const lbl = (stakeLabels?.[v] ?? v);
              const ts = labelToTs(lbl);
              return fmtAxisX(ts, span);
            }
          },
          grid: { color: axisGridColor() },
          border: { display:false }
        },
        y: {
          ticks: {
            color: axisTickColor(),
            callback: (v) => fmtSmart(v)
          },
          grid: { color: axisGridColor() },
          border: { display:false }
        }
      }},
    plugins: [lastDotPlugin]
  });
  attachCrosshair2(stakeChart, $("stakeReadout"), (i, lbs, ds) => {
    const t = labelToTs(lbs?.[i]);
    const v = safe(ds?.[i]);
    return `${t ? new Date(t).toLocaleString() : "—"} • ${v.toFixed(4)} INJ`;
  });
}
function drawStakeChart() {
  if (!stakeChart) initStakeChart();
  if (stakeChart) {
    stakeChart.data.labels = stakeLabels;
    stakeChart.data.datasets[0].data = stakeData;

    // dynamic x-axis labels
    try{
      stakeChart.options.scales.x.ticks = stakeChart.options.scales.x.ticks || {};
      stakeChart.options.scales.x.ticks.callback = (v, i) => {
        const span = spanMsFromLabels(stakeLabels);
        const lbl = (stakeLabels?.[v] ?? v);
        const ts = labelToTs(lbl);
        return fmtAxisX(ts, span);
      };
    } catch {}

    stakeChart.update("none");
  }
}


function fmtDTShort(ts){
  try{
    return new Date(ts).toLocaleString(undefined, { month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }catch(_){
    return ts ? new Date(ts).toLocaleString() : "—";
  }
}
function syncDualRangeFill(startEl, endEl, fillEl){
  if (!startEl || !endEl || !fillEl) return;
  const min = safe(startEl.min);
  const max = safe(startEl.max);
  const s = safe(startEl.value);
  const e = safe(endEl.value);
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  const span = Math.max(1, (max - min));
  const left = ((lo - min) / span) * 100;
  const right = ((hi - min) / span) * 100;
  fillEl.style.left = left.toFixed(4) + "%";
  fillEl.style.width = Math.max(0, right - left).toFixed(4) + "%";
}
/* === Auto Y scaling (make growth visible even with big jumps) === */
function autoScaleY(chart, dataArr, sIdx, eIdx, opts = {}){
  try{
    if (!chart || !chart.options || !chart.options.scales || !chart.options.scales.y) return;

    const n = Array.isArray(dataArr) ? dataArr.length : 0;
    if (!n){
      chart.options.scales.y.min = undefined;
      chart.options.scales.y.max = undefined;
      return;
    }

    const s0 = Number.isFinite(sIdx) ? sIdx : 0;
    const e0 = Number.isFinite(eIdx) ? eIdx : (n - 1);
    const lo = clamp(Math.min(s0, e0), 0, n - 1);
    const hi = clamp(Math.max(s0, e0), 0, n - 1);

    let min = Infinity, max = -Infinity;
    for (let i = lo; i <= hi; i++){
      const v = safe(dataArr[i]);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)){
      chart.options.scales.y.min = undefined;
      chart.options.scales.y.max = undefined;
      return;
    }

    const padRatio = Number.isFinite(opts.padRatio) ? opts.padRatio : 0.12;
    const minPad   = Number.isFinite(opts.minPad)   ? opts.minPad   : 0.01;

    const range = max - min;
    let pad = Math.max(range * padRatio, minPad);
    if (range <= 0) pad = Math.max(Math.abs(max) * 0.02, minPad);

    const allowZero = !!opts.allowZero;
    const newMin = allowZero ? Math.max(0, min - pad) : (min - pad);
    const newMax = max + pad;

    chart.options.scales.y.min = Number.isFinite(newMin) ? newMin : undefined;
    chart.options.scales.y.max = Number.isFinite(newMax) ? newMax : undefined;
  } catch {}
}

function stakeAutoYFromChart(chart){
  try{
    const c = chart || stakeChart;
    if (!c) return;
    const n = stakeData.length;
    if (!n) return;
    const sx = c.scales?.x;
    let sIdx = Number.isFinite(sx?.min) ? Math.floor(sx.min) : 0;
    let eIdx = Number.isFinite(sx?.max) ? Math.ceil(sx.max) : (n - 1);
    sIdx = clamp(sIdx, 0, n - 1);
    eIdx = clamp(eIdx, 0, n - 1);
    autoScaleY(c, stakeData, sIdx, eIdx, { padRatio: 0.10, minPad: Math.max(0.05, safe(stakeData[eIdx]) * 0.001), allowZero: false });
  } catch {}
}

function feesAutoYFromChart(chart){
  try{
    const c = chart || feesChart;
    if (!c) return;
    const n = feesValues.length;
    if (!n) return;
    const sx = c.scales?.x;
    let sIdx = Number.isFinite(sx?.min) ? Math.floor(sx.min) : 0;
    let eIdx = Number.isFinite(sx?.max) ? Math.ceil(sx.max) : (n - 1);
    sIdx = clamp(sIdx, 0, n - 1);
    eIdx = clamp(eIdx, 0, n - 1);
    autoScaleY(c, feesValues, sIdx, eIdx, { padRatio: 0.12, minPad: 0.000001, allowZero: true });
  } catch {}
}

function syncStakeTimelineUI(forceToEnd=false){
  const startEl = $("stakeTimelineStart");
  const endEl   = $("stakeTimelineEnd");
  const fillEl  = $("stakeTimelineFill");
  const meta    = $("stakeTimelineMeta");
  const last    = $("stakeLast");
  if (!startEl || !endEl || !meta) return;

  const n = stakeData.length;
  if (last) last.textContent = n ? `${safe(stakeData[n-1]).toFixed(4)} INJ` : "—";

  if (!n){
    startEl.min = 0; startEl.max = 0; startEl.value = 0;
    endEl.min = 0; endEl.max = 0; endEl.value = 0;
    meta.textContent = "—";
    try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
    if (stakeChart){
      stakeChart.options.scales.x.min = undefined;
      stakeChart.options.scales.x.max = undefined;
      stakeChart.options.scales.y.min = undefined;
      stakeChart.options.scales.y.max = undefined;
      stakeChart.update("none");
    }
    return;
  }

  const win = Math.min(60, n);

  startEl.min = 0; startEl.max = String(n - 1);
  endEl.min   = 0; endEl.max   = String(n - 1);

  if (forceToEnd){
    const e = n - 1;
    const s = Math.max(0, e - win + 1);
    endEl.value = String(e);
    startEl.value = String(s);
  } else {
    let s = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
    let e = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);
    if (s > e){ const t = s; s = e; e = t; }
    startEl.value = String(s);
    endEl.value   = String(e);
  }

  const sIdx = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
  const eIdx = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);

  if (stakeChart){
    stakeChart.options.scales.x.min = sIdx;
    stakeChart.options.scales.x.max = eIdx;
    autoScaleY(stakeChart, stakeData, sIdx, eIdx, { padRatio: 0.10, minPad: Math.max(0.05, safe(stakeData[eIdx]) * 0.001), allowZero: false });
    stakeChart.update("none");
  }

  const fromTs = labelToTs(stakeLabels[sIdx]);
  const toTs   = labelToTs(stakeLabels[eIdx]);
  const from = fromTs ? fmtDTShort(fromTs) : (stakeLabels[sIdx] || "");
  const to   = toTs ? fmtDTShort(toTs) : (stakeLabels[eIdx] || "");
  meta.textContent = n <= 1 ? `${to}` : `${from} → ${to}`;

  try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
}

$("stakeTimelineStart")?.addEventListener("input", () => {
  stakeFollow = false;
  syncStakeTimelineUI(false);
}, { passive:true });

$("stakeTimelineEnd")?.addEventListener("input", () => {
  stakeFollow = false;
  syncStakeTimelineUI(false);
}, { passive:true });

$("stakeLiveBtn")?.addEventListener("click", () => {
  stakeFollow = true;
  if (stakeChart?.resetZoom) stakeChart.resetZoom();
  syncStakeTimelineUI(true);
}, { passive:true });


function maybeAddStakePoint(currentStake) {
  const s = safe(currentStake);
  if (!Number.isFinite(s)) return;
  const rounded = Number(s.toFixed(6));

  if (!stakeBaselineCaptured) {
    stakeLabels.push(tsLabel());
    stakeData.push(rounded);
    stakeMoves.push(1);
    stakeTypes.push("Baseline (current)");
    lastStakeRecordedRounded = rounded;
    stakeBaselineCaptured = true;
    saveStakeSeriesLocal();
    drawStakeChart();
    try{ syncStakeTimelineUI(!!stakeFollow); }catch {}

    return;
  }

  if (lastStakeRecordedRounded == null) { lastStakeRecordedRounded = rounded; return; }
  if (rounded === lastStakeRecordedRounded) return;

  const delta = rounded - lastStakeRecordedRounded;
  lastStakeRecordedRounded = rounded;

  stakeLabels.push(tsLabel());
  stakeData.push(rounded);
  stakeMoves.push(delta > 0 ? 1 : -1);
  stakeTypes.push(delta > 0 ? "Delegate / Compound" : "Undelegate");

  saveStakeSeriesLocal();
  drawStakeChart();
    try{ syncStakeTimelineUI(!!stakeFollow); }catch {}


  pushEvent({
    kind: "tx",
    title: delta > 0 ? "Stake increased" : "Stake decreased",
    detail: `${delta > 0 ? "+" : ""}${delta.toFixed(6)} INJ`,
    status: "pending"
  });
}

/* ================= REWARD WITHDRAWALS (persist) ================= */
let wdLabelsAll = [];
let wdValuesAll = [];
let wdTimesAll  = [];

let wdLabels = [];
let wdValues = [];
let wdTimes  = [];

let wdLastRewardsSeen = null;
let wdMinFilter = 0;

function wdStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_reward_withdrawals_v${REWARD_WD_LOCAL_VER}_${a}` : null;
}
function saveWdAllLocal() {
  const key = wdStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: REWARD_WD_LOCAL_VER, t: Date.now(),
      labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll
    }));
    cloudBumpLocal(1);
  } catch {}
  cloudMarkDirty({ wd:true });
}
function loadWdAllLocal() {
  const key = wdStoreKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== REWARD_WD_LOCAL_VER) return false;

    wdLabelsAll = Array.isArray(obj.labels) ? obj.labels : [];
    wdValuesAll = Array.isArray(obj.values) ? obj.values : [];
    wdTimesAll  = Array.isArray(obj.times)  ? obj.times  : [];

    rebuildWdView();
    return true;
  } catch { return false; }
}

function rebuildWdView() {
  wdLabels = [];
  wdValues = [];
  wdTimes  = [];

  for (let i = 0; i < wdValuesAll.length; i++) {
    const v = safe(wdValuesAll[i]);
    if (v >= wdMinFilter) {
      wdLabels.push(wdLabelsAll[i]);
      wdValues.push(v);
      wdTimes.push(wdTimesAll[i] || 0);
    }
  }

  drawRewardWdChart();
  syncRewardTimelineUI(true);
  try { if (typeof updateTotalRewardAccUI === "function") updateTotalRewardAccUI(); } catch (e) { console.warn("[updateTotalRewardAccUI]", e); }
}

let rewardChart = null;

function initRewardWdChart() {
  const canvas = $("rewardChart");
  if (!canvas || !window.Chart) return;

  rewardChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: wdLabels,
      datasets: [{
        data: wdValues,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        tension: 0.42,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 0,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: axisGridColor() } },
        y: { position:"right", ticks: { color: axisTickColor(), callback: (v) => fmtSmart(v) }, grid: { color: axisGridColor() } }
      }
    },
    plugins: [lastDotPlugin]
  });

  attachCrosshair2(rewardChart, $("rewardReadout"), (i, lbs, ds) => {
    const t = labelToTs(lbs?.[i]) || (wdTimes?.[i] || 0);
    const v = safe(ds?.[i]);
    return `${t ? new Date(t).toLocaleString() : "—"} • +${v.toFixed(6)} INJ`;
  });
}
function drawRewardWdChart() {
  if (!rewardChart) initRewardWdChart();
  if (rewardChart) {
    rewardChart.data.labels = wdLabels;
    rewardChart.data.datasets[0].data = wdValues;

    // dynamic x-axis labels
    try{
      rewardChart.options.scales.x.ticks = rewardChart.options.scales.x.ticks || {};
      rewardChart.options.scales.x.ticks.callback = (v, i) => {
        const span = spanMsFromLabels(wdLabels);
        const lbl = (wdLabels?.[v] ?? v);
        const ts = labelToTs(lbl);
        return fmtAxisX(ts, span);
      };
    } catch {}

    rewardChart.update("none");
  }
}

function syncRewardTimelineUI(forceToEnd=false){
  const startEl = $("rewardTimelineStart");
  const endEl   = $("rewardTimelineEnd");
  const fillEl  = $("rewardTimelineFill");
  const meta    = $("rewardTimelineMeta");
  if (!startEl || !endEl || !meta) return;

  const n = wdValues.length;
  if (!n){
    startEl.min = 0; startEl.max = 0; startEl.value = 0;
    endEl.min = 0; endEl.max = 0; endEl.value = 0;
    meta.textContent = "—";
    try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
    if (rewardChart){
      rewardChart.options.scales.x.min = undefined;
      rewardChart.options.scales.x.max = undefined;
      rewardChart.update("none");
    }
    return;
  }

  const win = Math.min(60, n);

  startEl.min = 0; startEl.max = String(n - 1);
  endEl.min   = 0; endEl.max   = String(n - 1);

  if (forceToEnd){
    const e = n - 1;
    const s = Math.max(0, e - win + 1);
    endEl.value = String(e);
    startEl.value = String(s);
  } else {
    let s = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
    let e = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);
    if (s > e){ const t = s; s = e; e = t; }
    startEl.value = String(s);
    endEl.value   = String(e);
  }

  const sIdx = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
  const eIdx = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);

  if (rewardChart){
    rewardChart.options.scales.x.min = sIdx;
    rewardChart.options.scales.x.max = eIdx;
    rewardChart.update("none");
  }

  const fromTs = wdTimes[sIdx] || labelToTs(wdLabels[sIdx]);
  const toTs   = wdTimes[eIdx] || labelToTs(wdLabels[eIdx]);
  const from = fromTs ? fmtDTShort(fromTs) : (wdLabels[sIdx] || "");
  const to   = toTs ? fmtDTShort(toTs) : (wdLabels[eIdx] || "");
  meta.textContent = n <= 1 ? `${to}` : `${from} → ${to}`;

  try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
}

$("rewardTimelineStart")?.addEventListener("input", () => syncRewardTimelineUI(false), { passive: true });
$("rewardTimelineEnd")?.addEventListener("input", () => syncRewardTimelineUI(false), { passive: true });

$("rewardLiveBtn")?.addEventListener("click", () => {
  if (rewardChart?.resetZoom) rewardChart.resetZoom();
  syncRewardTimelineUI(true);
}, { passive: true });

$("rewardFilter")?.addEventListener("change", (e) => {
  wdMinFilter = safe(e.target.value);
  rebuildWdView();
  if (rewardChart?.resetZoom) rewardChart.resetZoom();
  syncRewardTimelineUI(true);
}, { passive: true });


function maybeRecordRewardWithdrawal(newRewards) {
  const r = safe(newRewards);
  if (wdLastRewardsSeen == null) { wdLastRewardsSeen = r; return; }

  const diff = wdLastRewardsSeen - r;
  if (diff > REWARD_WITHDRAW_THRESHOLD) {
    const diffRounded = Number(diff.toFixed(6));

    // Cross-device: deterministic timestamp + id within the same minute
    const rawTs = Date.now();
    const ts = wdDeterministicTs(rawTs, diffRounded);

    wdTimesAll.push(ts);
    wdLabelsAll.push(tsLabel(ts));
    wdValuesAll.push(diffRounded);
    saveWdAllLocal();
    rebuildWdView();

    // Event id deterministic to avoid duplicates across devices
    pushEvent({
      id: wdDeterministicId(ts, diffRounded),
      ts,
      kind: "tx",
      title: "Rewards withdrawn",
      detail: `+${diffRounded.toFixed(6)} INJ`,
      status: "pending"
    });

    // Flash green on Total Reward Accumulate
    try{
      flashGreen($("totalRewardsAcc"));
      flashGreen($("totalRewardsAccUsd"));
    } catch {}

    // Fees card: pull latest ALL-TX fees
    safeAsync(() => feesBackfill(true), "feesBackfill");
  }

  wdLastRewardsSeen = r;
}


/* ================= TOTAL REWARD ACCUMULATE ================= */
function totalRewardsAccumulated(){
  let s = 0;
  for (let i = 0; i < wdValuesAll.length; i++){
    const n = Number(wdValuesAll[i]);
    if (Number.isFinite(n)) s += n;
  }
  return s;
}
function updateTotalRewardAccUI(){
  const out = $("totalRewardsAcc");
  const usd = $("totalRewardsAccUsd");
  if (!out && !usd) return;

  const total = totalRewardsAccumulated();

  if (out) out.textContent = `+${total.toFixed(6)}`;

  const px = (Number.isFinite(displayed?.price) && displayed.price > 0) ? displayed.price :
             (Number.isFinite(targetPrice) && targetPrice > 0) ? targetPrice : 0;

  if (usd) usd.textContent = `≈ $${(total * px).toFixed(2)}`;
}

/* ================= TOTAL ASSET MANAGEMENT (TAM) CHART (global) ================= */
const TAM_SERIES_VER = 1;
const TAM_SERIES_KEY = `inj_tam_series_v${TAM_SERIES_VER}`;

// --- TAM anti-spike offset (keeps chart smooth across deposits/withdrawals) ---
const TAM_OFFSET_VER = 1;
const TAM_OFFSET_KEY = `inj_tam_offset_v${TAM_OFFSET_VER}`;
let tamOffset = 0;          // INJ offset applied ONLY to the TAM chart series
let tamLastRawSeen = NaN;   // last raw TAM seen (INJ) to detect sudden jumps

function tamLoadOffsetLocal(){
  try{
    const raw = localStorage.getItem(TAM_OFFSET_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    const v = safe(obj?.offset);
    if (Number.isFinite(v)) { tamOffset = v; return true; }
  } catch {}
  return false;
}
function tamSaveOffsetLocal(){
  try{
    localStorage.setItem(TAM_OFFSET_KEY, JSON.stringify({ v: TAM_OFFSET_VER, ts: Date.now(), offset: tamOffset }));
  } catch {}
}
// Adaptive spike threshold (INJ). Treat big jumps as "moves" (deposit/withdraw/claim/transfer)
// and neutralize them via tamOffset so the chart keeps a smooth trend.
function tamSpikeThreshold(lastRaw){
  const base = 0.35;                 // minimum 0.35 INJ
  const pct  = 0.003;                // or 0.30% of level
  const lvl = Math.abs(safe(lastRaw));
  return Math.max(base, lvl * pct);
}


// Chart series (global, not per-address)
let tamChart = null;
let tamLabels = [];
let tamValues = [];
let tamMoves = []; // delta vs previous point (INJ)
let tamFollow = true;

const TAM_POINT_EVERY_MS = 5 * 60 * 1000; // one chart point every 5 minutes
let tamAccSum = 0;
let tamAccCount = 0;
// Window stats to ignore temporary dips (e.g. reward withdraw -> restake timing)
// We commit one point every 5 min using a robust value.
let tamAccMax = -Infinity;
let tamAccMin = Infinity;
let tamAccLast = NaN;


function saveTamSeriesLocal(){
  try{
    localStorage.setItem(TAM_SERIES_KEY, JSON.stringify({
      v: TAM_SERIES_VER,
      t: Date.now(),
      labels: tamLabels,
      values: tamValues,
      moves: tamMoves
    }));
  } catch {}
}
function loadTamSeriesLocal(){
  try{
    const raw = localStorage.getItem(TAM_SERIES_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== TAM_SERIES_VER) return false;

    tamLabels = Array.isArray(obj.labels) ? obj.labels : [];
    tamValues = Array.isArray(obj.values) ? obj.values : [];
    tamMoves  = Array.isArray(obj.moves)  ? obj.moves  : [];

    const n = Math.min(tamLabels.length, tamValues.length);
    tamLabels = tamLabels.slice(0, n);
    tamValues = tamValues.slice(0, n);
    tamMoves  = tamMoves.slice(0, n);
    while (tamMoves.length < n) tamMoves.push(0);

    // cap history to keep localStorage healthy (2s polling can be heavy)
    const CAP = 12000;
    if (tamValues.length > CAP){
      const drop = tamValues.length - CAP;
      tamLabels = tamLabels.slice(drop);
      tamValues = tamValues.slice(drop);
      tamMoves  = tamMoves.slice(drop);
    }
        // seed raw baseline for spike detection (avoid first-run false spike)
    try{
      const n2 = tamValues.length;
      if (n2){
        const lastNorm = safe(tamValues[n2-1]);
        if (Number.isFinite(lastNorm)) tamLastRawSeen = lastNorm + tamOffset;
      }
    }catch{}
    return true;
  } catch {}
  return false;
}

function initTamChart(){
  const canvas = $("tamChart");
  if (!canvas || !window.Chart) return;

  tamChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: tamLabels,
      datasets: [{
        data: tamValues,
        borderColor: "#22d3ee",
        backgroundColor: "rgba(34,211,238,.12)",
        fill: true,
        tension: 0.42,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 0,
        pointHitRadius: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          display:true,
          ticks: {
            color: axisTickColor(),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (v) => {
              const span = spanMsFromLabels(tamLabels);
              const lbl = (tamLabels?.[v] ?? v);
              const ts = labelToTs(lbl);
              return fmtAxisX(ts, span);
            }
          },
          grid: { color: axisGridColor() },
          border: { display:false }
        },
        y: {
          ticks: {
            color: axisTickColor(),
            callback: (v) => `${fmtSmart(v)}`
          },
          grid: { color: axisGridColor() },
          border: { display:false }
        }
      }
      },
    plugins: [lastDotPlugin]
  });

  attachCrosshair2(tamChart, $("tamReadout"), (i, lbs, ds) => {
    const t = labelToTs(lbs?.[i]);
    const v = safe(ds?.[i]);
    const mv = safe(tamMoves?.[i]);
    const sMv = (Number.isFinite(mv) && mv !== 0) ? ` • Δ ${(mv>=0?"+":"")}${mv.toFixed(6)} INJ` : "";
    return `${t ? new Date(t).toLocaleString() : "—"} • ${v.toFixed(6)} INJ${sMv}`;
  });
}

function drawTamChart(){
  if (!tamChart) initTamChart();
  if (tamChart) {
    tamChart.data.labels = tamLabels;
    tamChart.data.datasets[0].data = tamValues;

    // dynamic x-axis labels (keep consistent with other cards)
    try{
      tamChart.options.scales.x.ticks = tamChart.options.scales.x.ticks || {};
      tamChart.options.scales.x.ticks.callback = (v, i) => {
        const span = spanMsFromLabels(tamLabels);
        const lbl = (tamLabels?.[v] ?? v);
        const ts = labelToTs(lbl);
        return fmtAxisX(ts, span);
      };
    } catch {}

    tamChart.update("none");
  }
}

function syncTamTimelineUI(forceToEnd=false){
  const startEl = $("tamTimelineStart");
  const endEl   = $("tamTimelineEnd");
  const fillEl  = $("tamTimelineFill");
  const meta    = $("tamTimelineMeta");
  const last    = $("tamLast");
  if (!startEl || !endEl || !meta) return;

  const n = tamValues.length;
  if (last) last.textContent = n ? `${safe(tamValues[n-1]).toFixed(6)} INJ` : "—";

  if (!n){
    startEl.min = 0; startEl.max = 0; startEl.value = 0;
    endEl.min = 0; endEl.max = 0; endEl.value = 0;
    meta.textContent = "—";
    try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
    if (tamChart){
      tamChart.options.scales.x.min = undefined;
      tamChart.options.scales.x.max = undefined;
      tamChart.update("none");
    }
    return;
  }

  const win = Math.min(288, n); // 24h window @ 5min points

  startEl.min = 0; startEl.max = String(n - 1);
  endEl.min   = 0; endEl.max   = String(n - 1);

  if (forceToEnd){
    const e = n - 1;
    const s = Math.max(0, e - win + 1);
    endEl.value = String(e);
    startEl.value = String(s);
  } else {
    let s = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
    let e = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);
    if (s > e){ const t = s; s = e; e = t; }
    startEl.value = String(s);
    endEl.value   = String(e);
  }

  const sIdx = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
  const eIdx = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);

  if (tamChart){
    tamChart.options.scales.x.min = sIdx;
    tamChart.options.scales.x.max = eIdx;
    tamChart.update("none");
  }

  const fromTs = labelToTs(tamLabels[sIdx]);
  const toTs   = labelToTs(tamLabels[eIdx]);
  const from = fromTs ? fmtDTShort(fromTs) : (tamLabels[sIdx] || "");
  const to   = toTs ? fmtDTShort(toTs) : (tamLabels[eIdx] || "");
  meta.textContent = n <= 1 ? `${to}` : `${from} → ${to}`;

  try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
}

$("tamTimelineStart")?.addEventListener("input", () => {
  tamFollow = false;
  syncTamTimelineUI(false);
}, { passive:true });

$("tamTimelineEnd")?.addEventListener("input", () => {
  tamFollow = false;
  syncTamTimelineUI(false);
}, { passive:true });

$("tamLiveBtn")?.addEventListener("click", () => {
  tamFollow = true;
  if (tamChart?.resetZoom) tamChart.resetZoom();
  syncTamTimelineUI(true);
}, { passive:true });

function maybeAddTamPoint(currInj){
  const vRaw = safe(currInj);
  if (!Number.isFinite(vRaw) || vRaw < 0) return false;

  // Detect sudden jumps (deposit/withdraw/claim/transfer) and neutralize them on the chart.
  // We keep the *displayed* TAM as-is; only the chart series is adjusted.
  if (Number.isFinite(tamLastRawSeen)){
    const dRaw = vRaw - tamLastRawSeen;
    const thr = tamSpikeThreshold(tamLastRawSeen);
    if (Math.abs(dRaw) > thr){
      tamOffset += dRaw;
      tamSaveOffsetLocal();
    }
  }
  tamLastRawSeen = vRaw;

  const v = vRaw - tamOffset;
  if (!Number.isFinite(v) || v < 0) return false;

  // High-frequency polling (2s) can be jittery; we aggregate and commit
  // one robust point every 5 minutes (smooth line like APR).
  tamAccSum += v;
  tamAccCount++;

  // track window stats (helps ignore temporary dips that recover quickly)
  if (v > tamAccMax) tamAccMax = v;
  if (v < tamAccMin) tamAccMin = v;
  tamAccLast = v;

  const now = Date.now();
  const n = tamValues.length;
  const lastTs = n ? labelToTs(tamLabels[n - 1]) : 0;

  const due = (!lastTs) || ((now - lastTs) >= TAM_POINT_EVERY_MS);
  if (!due) return false;

  const avg = tamAccCount ? (tamAccSum / tamAccCount) : v;

  // Robust point selection:
  // If the window ends back near the window max, we keep the max to avoid
  // "down then up" spikes caused by async state changes (withdraw -> restake).
  const wMax = Number.isFinite(tamAccMax) ? tamAccMax : avg;
  const wMin = Number.isFinite(tamAccMin) ? tamAccMin : avg;
  const wLast = Number.isFinite(tamAccLast) ? tamAccLast : avg;

  // tolerance: minimum 0.0005 INJ or 5 bps of level
  const eps = Math.max(0.0005, Math.abs(wMax) * 0.00005);

  let pointRaw = avg;

  // Case A: recovered by end of window -> use max
  if (wLast >= (wMax - eps)) pointRaw = wMax;
  // Case B: big temporary dip inside window -> prefer max (keeps trend smooth)
  else if ((wMax - wMin) > Math.max(0.02, Math.abs(wMax) * 0.001)) pointRaw = wMax;

  // reset window
  tamAccSum = 0;
  tamAccCount = 0;
  tamAccMax = -Infinity;
  tamAccMin = Infinity;
  tamAccLast = NaN;

  const pointV = Number(pointRaw.toFixed(6));
  const lastV = n ? safe(tamValues[n - 1]) : NaN;
  const mv = Number.isFinite(lastV) ? (pointV - lastV) : 0;

  tamLabels.push(String(now));
  tamValues.push(pointV);
  tamMoves.push(mv);

  // cap history to keep it fast
  const CAP = 12000;
  if (tamValues.length > CAP){
    const drop = tamValues.length - CAP;
    tamLabels = tamLabels.slice(drop);
    tamValues = tamValues.slice(drop);
    tamMoves  = tamMoves.slice(drop);
  }

  saveTamSeriesLocal();
  drawTamChart();
  // If user is following live, keep the window at the end
  try{ syncTamTimelineUI(tamFollow); } catch {}
  return true;
}

/* ================= FEES (all tx fees) ================= */
const FEES_LOCAL_VER = 2;
const FEES_LEGACY_VER = 1;

let feesIdsAll = [];
let feesLabelsAll = [];
let feesValuesAll = [];
let feesTimesAll = [];

let feesLabels = [];
let feesValues = [];
let feesTimes = [];

let feesChart = null;
let feesTotalCache = NaN;
let feesLastSyncAt = 0;

function feesStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_fees_all_v${FEES_LOCAL_VER}_${a}` : null;
}

// migration: older builds stored only withdraw-reward fees
function feesStoreKeyLegacy(addr){
  const a = (addr || "").trim();
  return a ? `inj_fees_wd_v${FEES_LEGACY_VER}_${a}` : null;
}

function saveFeesLocal(){
  const k = feesStoreKey(address);
  if (!k) return;
  try{
    localStorage.setItem(k, JSON.stringify({
      v: FEES_LOCAL_VER,
      ids: feesIdsAll,
      labels: feesLabelsAll,
      values: feesValuesAll,
      times: feesTimesAll
    }));
  } catch {}
}

function loadFeesLocal(){
  // Try current key
  let k = feesStoreKey(address);
  if (!k) return false;

  let raw = null;
  try{
    raw = localStorage.getItem(k);
  } catch {}

  // Fallback to legacy key (v1) if current key not found
  if (!raw){
    try{
      const legacy = feesStoreKeyLegacy(address);
      if (legacy) raw = localStorage.getItem(legacy);
    } catch {}
  }

  if (!raw) return false;

  try{
    const obj = JSON.parse(raw);
    if (!obj) return false;

    // Accept both v1 and v2 payloads (arrays)
    const ids = Array.isArray(obj.ids) ? obj.ids : [];
    const labels = Array.isArray(obj.labels) ? obj.labels : [];
    const values = Array.isArray(obj.values) ? obj.values : [];
    const times = Array.isArray(obj.times) ? obj.times : [];

    feesIdsAll = ids.map(x=>String(x||""));
    feesLabelsAll = labels.map(x=>String(x||""));
    feesValuesAll = values.map(x=>safe(x));
    feesTimesAll = times.map(x=>safe(x)||0);

    feesSortNormalize();
    return true;
  } catch {
    return false;
  }
}

function feesRecalcTotalCache(){
  let s = 0;
  for (let i = 0; i < feesValuesAll.length; i++){
    const n = Number(feesValuesAll[i]);
    if (Number.isFinite(n)) s += n;
  }
  feesTotalCache = s;
}

function feesSortNormalize(){
  const pts = [];
  for (let i = 0; i < feesValuesAll.length; i++){
    const id = String(feesIdsAll[i] ?? "");
    const t  = safe(feesTimesAll[i]) || labelToTs(feesLabelsAll[i]) || 0;
    const v  = safe(feesValuesAll[i]);
    if (!id || !t || !Number.isFinite(v) || v <= 0) continue;
    pts.push({ id, t, v, label: feesLabelsAll[i] || tsLabel(t) });
  }
  pts.sort((a,b)=>a.t-b.t);

  feesIdsAll    = pts.map(p => p.id);
  feesTimesAll  = pts.map(p => p.t);
  feesValuesAll = pts.map(p => p.v);
  feesLabelsAll = pts.map(p => p.label);

  feesRecalcTotalCache();
}

function rebuildFeesView(){
  feesLabels = feesLabelsAll.slice();
  feesValues = feesValuesAll.map(v => safe(v));
  feesTimes  = feesTimesAll.slice();

  drawFeesChart();
  syncFeesTimelineUI(true);
  updateFeesUI();
}

function updateFeesUI(){
  const totEl  = $("feesTotal");
  const usdEl  = $("feesTotalUsd");
  const lastEl = $("feesLast");

  if (!totEl && !usdEl && !lastEl) return;

  if (!Number.isFinite(feesTotalCache)) feesRecalcTotalCache();
  const total = feesTotalCache;

  if (totEl){
    const unitEl = totEl.nextElementSibling;
    const hasUnit = unitEl && unitEl.classList && unitEl.classList.contains("unit") && /inj/i.test(unitEl.textContent || "");
    totEl.textContent = hasUnit ? `${total.toFixed(6)}` : `${total.toFixed(6)} INJ`;
  }

  const px = (Number.isFinite(displayed?.price) && displayed.price > 0) ? displayed.price :
             (Number.isFinite(targetPrice) && targetPrice > 0) ? targetPrice : 0;

  if (usdEl) usdEl.textContent = `≈ $${(total * px).toFixed(2)}`;

  if (lastEl){
    const n = feesValues.length;
    lastEl.textContent = n ? `${safe(feesValues[n-1]).toFixed(6)} INJ` : "—";
  }
}

function initFeesChart() {
  const canvas = $("feesChart");
  if (!canvas || !window.Chart) return;

  feesChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: feesLabels,
      datasets: [{
        data: feesValues,
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245,158,11,.14)",
        fill: true,
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 0,
        pointHitRadius: 18,
        borderWidth: 2,
        borderCapStyle: "round",
        borderJoinStyle: "round"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2, onPanComplete: ({ chart }) => { try{ feesAutoYFromChart(chart); chart.update("none"); }catch{} } }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x", onZoomComplete: ({ chart }) => { try{ feesAutoYFromChart(chart); chart.update("none"); }catch{} } } } } : {})
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          display:true,
          ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6,
            callback: (v) => {
              const span = spanMsFromLabels(feesLabels);
              const lbl = (feesLabels?.[v] ?? v);
              const ts = labelToTs(lbl) || (feesTimes?.[v] || 0);
              return fmtAxisX(ts, span);
            }
          },
          grid: { color: axisGridColor() },
          border: { display:false }
        },
        y: {
          position:"right",
          ticks: { color: axisTickColor(), callback: (v) => fmtSmart(v) },
          grid: { color: axisGridColor() },
          border: { display:false }
        }
      }},
    plugins: [lastDotPlugin]
  });

  attachCrosshair2(feesChart, $("feesReadout"), (i, lbs, ds) => {
    const t = labelToTs(lbs?.[i]) || (feesTimes?.[i] || 0);
    const v = safe(ds?.[i]);
    return `${t ? new Date(t).toLocaleString() : "—"} • ${v.toFixed(6)} INJ`;
  });
}

function drawFeesChart() {
  if (!feesChart) initFeesChart();
  if (feesChart) {
    feesChart.data.labels = feesLabels;
    feesChart.data.datasets[0].data = feesValues;

    // dynamic x-axis labels
    try{
      feesChart.options.scales.x.ticks = feesChart.options.scales.x.ticks || {};
      feesChart.options.scales.x.ticks.callback = (v, i) => {
        const span = spanMsFromLabels(feesLabels);
        const lbl = (feesLabels?.[v] ?? v);
        const ts = labelToTs(lbl);
        return fmtAxisX(ts, span);
      };
    } catch {}

    feesChart.update("none");
  }
}

function syncFeesTimelineUI(forceToEnd=false){
  const startEl = $("feesTimelineStart");
  const endEl   = $("feesTimelineEnd");
  const fillEl  = $("feesTimelineFill");
  const meta    = $("feesTimelineMeta");
  const last    = $("feesLast");
  if (!startEl || !endEl || !meta) return;

  const n = feesValues.length;
  if (last) last.textContent = n ? `${safe(feesValues[n-1]).toFixed(6)} INJ` : "—";

  if (!n){
    startEl.min = 0; startEl.max = 0; startEl.value = 0;
    endEl.min   = 0; endEl.max   = 0; endEl.value   = 0;
    meta.textContent = "—";
    try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
    if (feesChart){
      feesChart.options.scales.x.min = undefined;
      feesChart.options.scales.x.max = undefined;
      feesChart.options.scales.y.min = undefined;
      feesChart.options.scales.y.max = undefined;
      feesChart.update("none");
    }
    return;
  }

  const win = Math.min(60, n);

  startEl.min = 0; startEl.max = String(n - 1);
  endEl.min   = 0; endEl.max   = String(n - 1);

  if (forceToEnd){
    const e = n - 1;
    const s = Math.max(0, e - win + 1);
    endEl.value   = String(e);
    startEl.value = String(s);
  } else {
    let s = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
    let e = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);
    if (s > e){ const t = s; s = e; e = t; }
    startEl.value = String(s);
    endEl.value   = String(e);
  }

  const sIdx = clamp(parseInt(startEl.value || "0", 10), 0, n - 1);
  const eIdx = clamp(parseInt(endEl.value   || "0", 10), 0, n - 1);

  if (feesChart){
    feesChart.options.scales.x.min = sIdx;
    feesChart.options.scales.x.max = eIdx;
    autoScaleY(feesChart, feesValues, sIdx, eIdx, { padRatio: 0.12, minPad: 0.000001, allowZero: true });
    feesChart.update("none");
  }

  const fromTs = feesTimes[sIdx] || labelToTs(feesLabels[sIdx]);
  const toTs   = feesTimes[eIdx] || labelToTs(feesLabels[eIdx]);
  const from = fromTs ? fmtDTShort(fromTs) : (feesLabels[sIdx] || "");
  const to   = toTs   ? fmtDTShort(toTs)   : (feesLabels[eIdx] || "");
  meta.textContent = n <= 1 ? `${to}` : `${from} → ${to}`;

  try{ syncDualRangeFill(startEl, endEl, fillEl); }catch{}
}

$("feesTimelineStart")?.addEventListener("input", () => syncFeesTimelineUI(false), { passive: true });
$("feesTimelineEnd")?.addEventListener("input",   () => syncFeesTimelineUI(false), { passive: true });

$("feesLiveBtn")?.addEventListener("click", () => {
  if (feesChart?.resetZoom) feesChart.resetZoom();
  safeAsync(() => feesBackfill(true), "feesBackfill");
  syncFeesTimelineUI(true);
}, { passive:true });

function txHasWithdrawDelegatorReward(tx){
  const msgs = tx?.body?.messages;
  if (!Array.isArray(msgs)) return false;
  for (const m of msgs){
    const t = String(m?.["@type"] || m?.type_url || m?.type || "");
    if (t.includes("WithdrawDelegatorReward")) return true;
  }
  return false;
}

function txFeeInj(tx){
  const coins = tx?.auth_info?.fee?.amount;
  let sum = 0;
  if (Array.isArray(coins)){
    for (const c of coins){
      const denom = String(c?.denom || "");
      const amt = safe(c?.amount);
      if (!amt) continue;
      if (denom === "inj") sum += amt / 1e18;
      else if (denom === "uinj") sum += amt / 1e6;
    }
  }
  return sum;
}

async function feesBackfill(force=false){
  if (!address || !hasInternet()) return;

  // Throttle: fees are expensive to backfill
  const now = Date.now();
  if (!force && (now - (feesLastSyncAt || 0)) < 30_000) return;
  feesLastSyncAt = now;

  // Build a set of already-known tx hashes
  const known = new Set((feesIdsAll || []).map(x => String(x || "")));

  let added = 0;
  let scanned = 0;
  let source = "none";

  // ---------- 1) Primary: Explorer/Indexer REST (includes gas_fee per tx) ----------
  try{
    const LIMIT = 100;
    let skip = 0;
    let pages = 0;

    while (pages < 40){
      const res = await fetchExplorer(`/api/explorer/v1/accountTxs/${address}?limit=${LIMIT}&skip=${skip}&status=success`);
      if (!res) throw new Error("explorer fetch failed");

      const list = Array.isArray(res.data) ? res.data : (Array.isArray(res?.data?.data) ? res.data.data : []);
      if (!Array.isArray(list) || list.length === 0) break;

      source = "explorer";
      scanned += list.length;

      for (const tx of list){
        const hash = String(tx?.hash || tx?.tx_hash || tx?.txHash || "");
        if (!hash || known.has(hash)) continue;

        const fee = feesFeeFromExplorerTx(tx);
        if (!(fee > 0)) continue;

        const ts = feesExplorerTxTimeMs(tx);
        feesIdsAll.push(hash);
        feesTimesAll.push(ts || 0);
        feesValuesAll.push(Number(fee.toFixed(6)));
        feesLabelsAll.push(ts ? tsLabel(ts) : "");

        known.add(hash);
        added++;
      }

      skip += list.length;
      pages++;

      // If we received fewer than limit, we are done
      if (list.length < LIMIT) break;

      // Optimization: if this page contained mostly known hashes (older history),
      // we can stop early to avoid heavy backfills.
      if (pages >= 3 && added === 0) break;
    }
  } catch(e){
    // keep going to LCD fallback
    // console.warn("[fees] explorer fallback:", e);
  }

  // ---------- 2) Fallback: LCD tx search (requires tx indexing on the node) ----------
  // This is less reliable on some public LCDs; keep it as a secondary source.
  if (source !== "explorer"){
    try{
      const LIMIT = 100;
      let offset = 0;
      let pages = 0;

      const ev = `coin_spent.spender='${address}'`; // address paid fees (most reliable event key)
      const evQ = encodeURIComponent(ev);

      while (pages < 12){
        const r = await fetchLCD(`/cosmos/tx/v1beta1/txs?events=${evQ}&pagination.limit=${LIMIT}&pagination.offset=${offset}&order_by=ORDER_BY_DESC`);
        if (!r) break;

        const txs = Array.isArray(r.txs) ? r.txs : [];
        const rs  = Array.isArray(r.tx_responses) ? r.tx_responses : [];
        if (txs.length === 0 && rs.length === 0) break;

        source = "lcd";
        const n = Math.max(txs.length, rs.length);
        scanned += n;

        for (let i = 0; i < n; i++){
          const tr = rs[i] || {};
          const hash = String(tr.txhash || "");
          if (!hash || known.has(hash)) continue;

          // fee may be on txs[i]; if not present, fetch by hash
          let tx = txs[i] || null;
          if (!tx){
            const one = await fetchLCD(`/cosmos/tx/v1beta1/txs/${hash}`);
            tx = one?.tx || null;
          }
          const fee = txFeeInj(tx);
          if (!(fee > 0)) continue;

          const ts = labelToTs(tr.timestamp) || (tr?.timestamp ? Date.parse(tr.timestamp) : 0) || 0;

          feesIdsAll.push(hash);
          feesTimesAll.push(ts || 0);
          feesValuesAll.push(Number(fee.toFixed(6)));
          feesLabelsAll.push(ts ? tsLabel(ts) : "");

          known.add(hash);
          added++;
        }

        offset += n;
        pages++;
        if (n < LIMIT) break;
        if (pages >= 3 && added === 0) break;
      }
    } catch(e){
      // console.warn("[fees] lcd fallback failed:", e);
    }
  }

  // ---------- finalize ----------
  if (added > 0){
    feesSortNormalize();
    saveFeesLocal();
    rebuildFeesView();
    try { flashGreen($("feesTotal")); } catch {}
  } else {
    // keep UI fresh (USD conversion / last label)
    updateFeesUI();
  }

    // Debug line removed: keep Fees UI clean (no "EXPLORE scanned...")
}

// Explorer tx -> fee in INJ
function feesFeeFromExplorerTx(tx){
  const gf = tx?.gas_fee || tx?.gasFee || tx?.gasFeeAmount || null;
  const amts = Array.isArray(gf?.amount) ? gf.amount : (Array.isArray(gf?.amounts) ? gf.amounts : []);
  if (!Array.isArray(amts) || amts.length === 0) return 0;

  let sum = 0;
  for (const a of amts){
    const denom = String(a?.denom || "").toLowerCase();
    const amtStr = String(a?.amount || "0");
    if (!amtStr || amtStr === "0") continue;

    if (denom === "inj"){
      sum += injBigIntToNumber(amtStr, 18, 6);
    } else if (denom === "uinj"){
      sum += injBigIntToNumber(amtStr, 6, 6);
    }
  }
  return sum;
}

// Explorer tx -> timestamp (ms)
function feesExplorerTxTimeMs(tx){
  // Prefer ISO timestamp
  const iso = tx?.block_timestamp || tx?.blockTimestamp || tx?.block_time || tx?.blockTime;
  if (iso){
    const t = Date.parse(String(iso));
    if (Number.isFinite(t) && t > 0) return t;
  }
  // Sometimes indexer returns unix timestamp in ms / ns
  const u = tx?.block_unix_timestamp || tx?.blockUnixTimestamp || tx?.block_unix_ms;
  if (u){
    const n = Number(u);
    if (Number.isFinite(n)){
      // if it's in ns, convert
      if (n > 1e14) return Math.floor(n / 1e6);
      // if it's in us
      if (n > 1e13) return Math.floor(n / 1e3);
      // ms
      if (n > 1e10) return Math.floor(n);
      // seconds
      if (n > 1e9) return Math.floor(n * 1000);
    }
  }
  return 0;
}

// Convert a big integer string with `decimals` to a Number with up to `keep` decimals.
// Example: inj uses 18 decimals.
function injBigIntToNumber(amountStr, decimals, keep=6){
  try{
    const bi = BigInt(amountStr);
    const base = 10n ** BigInt(decimals);
    const whole = bi / base;
    const frac = bi % base;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, keep);
    return Number(`${whole.toString()}.${fracStr}`);
  } catch {
    const n = Number(amountStr);
    if (!Number.isFinite(n)) return 0;
    return n / Math.pow(10, decimals);
  }
}


/* ================= NET WORTH (persist + chart) ================= */
let nwTf = "live";
let nwScale = "linear";
let nwTAll = [];
let nwUsdAll = [];
let nwInjAll = [];

let netWorthChart = null;
let lastNWDrawAt = 0;
let lastNWPointAt = 0;

function nwStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
}

function nwDesiredStep(ageMs, pass=1){
  const p = pass || 1;
  const base = (ageMs <= 30*60*1000) ? NW_POINT_MIN_MS
    : (ageMs <= 2*60*60*1000) ? 10*1000
    : (ageMs <= 24*60*60*1000) ? 60*1000
    : (ageMs <= 7*24*60*60*1000) ? 10*60*1000
    : (ageMs <= 30*24*60*60*1000) ? 60*60*1000
    : (ageMs <= 180*24*60*60*1000) ? 6*60*60*1000
    : 24*60*60*1000;
  return Math.floor(base * (1 + (p-1)*0.75));
}
function nwCompactInPlace(pass=1){
  if (nwTAll.length < 2) return;

  const pts = [];
  for (let i=0;i<nwTAll.length;i++){
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    const j = safe(nwInjAll[i]);
    if (!t || !Number.isFinite(u) || u <= 0) continue;
    pts.push({t,u,j});
  }
  if (pts.length < 2) return;
  pts.sort((a,b)=>a.t-b.t);

  const now = Date.now();
  const T = [], U = [], J = [];

  for (const p of pts){
    const age = now - p.t;
    const step = nwDesiredStep(age, pass);
    if (!T.length){
      T.push(p.t); U.push(p.u); J.push(p.j);
      continue;
    }
    const lastT = T[T.length-1];
    if ((p.t - lastT) >= step){
      T.push(p.t); U.push(p.u); J.push(p.j);
    } else {
      // keep last point in the bucket
      T[T.length-1] = p.t;
      U[U.length-1] = p.u;
      J[J.length-1] = p.j;
    }
  }

  nwTAll = T; nwUsdAll = U; nwInjAll = J;
}

function clampNWArrays(){
  const n = Math.min(nwTAll.length, nwUsdAll.length, nwInjAll.length);
  nwTAll = nwTAll.slice(-n);
  nwUsdAll = nwUsdAll.slice(-n);
  nwInjAll = nwInjAll.slice(-n);

  // Keep "ALL" history but compact progressively so it remains fast on mobile
  if (nwTAll.length > NW_MAX_POINTS){
    for (let pass=1; pass<=4 && nwTAll.length > NW_MAX_POINTS; pass++){
      nwCompactInPlace(pass);
    }
  }

  // Final safety clamp (should be extremely rare after compaction)
  if (nwTAll.length > NW_MAX_POINTS){
    const over = nwTAll.length - NW_MAX_POINTS;
    nwTAll = nwTAll.slice(over);
    nwUsdAll = nwUsdAll.slice(over);
    nwInjAll = nwInjAll.slice(over);
  }
}
function saveNWLocal(){
  const key = nwStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER, t: Date.now(),
      tAll: nwTAll,
      usdAll: nwUsdAll,
      injAll: nwInjAll,
      tf: nwTf,
      scale: nwScale
    }));
    cloudBumpLocal(1);
  } catch {}
  cloudMarkDirty({ nw:true });
}
function loadNWLocal(){
  const key = nwStoreKey(address);
  if (!key) return false;
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== NW_LOCAL_VER) return false;

    nwTAll = Array.isArray(obj.tAll) ? obj.tAll.map(Number) : [];
    nwUsdAll = Array.isArray(obj.usdAll) ? obj.usdAll.map(Number) : [];
    nwInjAll = Array.isArray(obj.injAll) ? obj.injAll.map(Number) : [];
    nwTf = typeof obj.tf === "string" ? obj.tf : "live";
    nwScale = (obj.scale === "log") ? "log" : "linear";

    clampNWArrays();
    return true;
  } catch { return false; }
}

function nwWindowMs(tf){
  if (tf === "live") return NW_LIVE_WINDOW_MS;
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  if (tf === "all") return 10 * 365 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/* === NW market-synced view cache (matches INJ chart shape) === */
const NW_MKT_VIEW_CACHE_MS = {
  live: 5_000,
  "1d": 60_000,
  "1w": 120_000,
  "1m": 300_000,
  "1y": 900_000,
  all: 1_800_000
};
let nwMktViewCache = {}; // tf -> { at, labels, data }
let nwMktViewLoading = {}; // tf -> bool

function nwMarketParams(tf){
  const now = Date.now();
  let interval = "1m";
  let start = 0;
  let maxTotal = 1440;

  if (tf === "live"){
    interval = "1m";
    const r = priceLiveRange(now);
    start = r.start;
    maxTotal = Math.max(20, Math.min(2400, Math.ceil((now - start) / ONE_MIN_MS) + 8));
  } else if (tf === "1d"){
    interval = "1m";
    start = now - 24*60*60*1000;
    maxTotal = 1440;
  } else if (tf === "1w"){
    interval = "15m";
    start = now - 7*24*60*60*1000;
    maxTotal = 672;
  } else if (tf === "1m"){
    interval = "1h";
    start = now - 30*24*60*60*1000;
    maxTotal = 720;
  } else if (tf === "1y"){
    interval = "1d";
    start = now - 365*24*60*60*1000;
    maxTotal = 365;
  } else {
    interval = "1w";
    start = 0;
    maxTotal = 1000;
  }

  return { now, interval, start, maxTotal };
}

function nwTotalInjNow(){
  const t = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  if (t > 0) return t;
  // fallback to last known stored inj (offline / before account loads)
  const last = nwInjAll.length ? safe(nwInjAll[nwInjAll.length - 1]) : 0;
  return last > 0 ? last : 0;
}

function nwRequestMarketView(tf, force=false){
  const key = String(tf||"1d");
  if (nwMktViewLoading[key]) return;
  if (!hasInternet()) return;

  const cached = nwMktViewCache[key];
  const ttl = NW_MKT_VIEW_CACHE_MS[key] || 120_000;
  if (!force && cached && (Date.now() - safe(cached.at)) < ttl && cached.labels?.length){
    return;
  }

  nwMktViewLoading[key] = true;
  safeAsync(async () => {
    try{
      const { now, interval, start, maxTotal } = nwMarketParams(key);
      const kl = await fetchKlinesRange("INJUSDT", interval, start, now, Math.min(2400, maxTotal));
      if (!Array.isArray(kl) || kl.length < 2) return;

      const qty = nwTotalInjNow();
      if (!Number.isFinite(qty) || qty <= 0) return;

      const labels = kl.map(k => tsLabel(safe(k[0])));
      const data = kl.map(k => safe(k[4]) * qty);

      nwMktViewCache[key] = { at: Date.now(), labels, data, qty };
      // keep UI in sync
      drawNW(true);
    } catch(e){
      console.warn("nwRequestMarketView", e);
    } finally {
      nwMktViewLoading[key] = false;
    }
  }, "nwRequestMarketView");
}

function nwHasSpan(tf){
  if (!nwTAll.length) return false;
  const first = nwTAll[0];
  const span = Date.now() - first;
  return span >= nwWindowMs(tf);
}
function nwBuildView(tf){
  // Prefer market-synced view (matches INJ chart)
  nwRequestMarketView(tf, false);
  const mv = nwMktViewCache[String(tf||"1d")];
  if (mv && Array.isArray(mv.labels) && Array.isArray(mv.data) && mv.labels.length >= 2){
    return { labels: mv.labels, data: mv.data };
  }

  const now = Date.now();
  const w = nwWindowMs(tf);
  let minT = (tf === "all") ? 0 : (now - w);
  if (tf === "1d") {
    // day-to-date (Rome): resets every new day
    minT = startOfDayRome(now);
  }

  const labels = [];
  const data = [];

  // No visible gaps: the curve is reconstructed via market backfill when the device is back online.
  for (let i = 0; i < nwTAll.length; i++){
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    if (t >= minT && Number.isFinite(u) && u > 0){
      labels.push(tsLabel(t));
      data.push(u);
    }
  }

  return { labels, data };
}

/* === Net Worth: rebuild missing points from market (INJUSDT) ===
   Idea: when the app was offline / sleeping, we approximate the missing curve
   using INJ market movement and the last known INJ amount.
*/
async function nwBackfillFromMarketRange(startTs, endTs){
  if (!address) return false;
  if (!hasInternet()) return false;
  if (!nwTAll.length) return false;

  const baseIdx = nwTAll.length - 1;
  const baseInj = safe(nwInjAll?.[baseIdx]);
  if (!Number.isFinite(baseInj) || baseInj <= 0) return false;

  const now = Date.now();
  const end = Math.min(safe(endTs) || now, now);
  const start = Math.max(safe(startTs) || 0, end - NW_MKT_BACKFILL_MAX_SPAN_MS);

  if ((end - start) < NW_MKT_BACKFILL_MIN_GAP_MS) return false;

  let kl = [];
  try{
    // 1m bars give a smooth-enough reconstruction without being heavy
    kl = await fetchKlinesRange("INJUSDT", "1m", start, end, 1600);
  } catch {}
  if (!Array.isArray(kl) || kl.length < 2) return false;

  let appended = 0;
  let lastT = safe(nwTAll[nwTAll.length - 1]);

  for (const k of kl){
    const t = safe(k?.[0]);
    if (!t || t <= lastT) continue;
    if (t > end) break;

    const px = safe(k?.[4]); // close
    if (!Number.isFinite(px) || px <= 0) continue;

    nwTAll.push(t);
    nwUsdAll.push(baseInj * px);
    nwInjAll.push(baseInj);
    lastT = t;
    appended++;
  }

  if (appended){
    clampNWArrays();
    saveNWLocal();
    drawNW(true);
  }

  return appended > 0;
}

function nwStartMarketBackfill(endTs = Date.now(), force=false){
  if (!address) return false;
  if (!hasInternet()) return false;
  if (!nwTAll.length) return false;

  const lastT = safe(nwTAll[nwTAll.length - 1]);
  const now = Date.now();

  if (!lastT) return false;
  if (!force && (safe(endTs) - lastT) < NW_MKT_BACKFILL_MIN_GAP_MS) return false;

  if (!force){
    if ((now - nwLastBackfillReqAt) < NW_MKT_BACKFILL_COOLDOWN_MS) return false;
    if ((now - nwLastBackfillFailAt) < NW_MKT_BACKFILL_FAIL_COOLDOWN_MS) return false;
  }

  nwLastBackfillReqAt = now;
  nwBackfilling = true;

  safeAsync(async () => {
    try{
      const ok = await nwBackfillFromMarketRange(lastT, endTs);
      if (!ok) nwLastBackfillFailAt = Date.now();
    } catch (e){
      nwLastBackfillFailAt = Date.now();
    } finally {
      nwBackfilling = false;
    }
  }, "nwBackfillFromMarketRange");

  return true;
}

const nwLastDotPlugin = {
  id: "nwLastDotPlugin",
  afterDatasetsDraw(ch) {
    const meta = ch.getDatasetMeta(0);
    const pts = meta?.data || [];
    if (!pts.length) return;

    const el = pts[pts.length - 1];
    if (!el) return;

    const t = Date.now();
    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t / 320));

    const ctx = ch.ctx;
    ctx.save();
    ctx.shadowColor = `rgba(250,204,21,${0.35 * pulse})`;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.arc(el.x, el.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.22 * pulse})`;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(el.x, el.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.95 * pulse})`;
    ctx.fill();

    ctx.restore();
  }
};

function initNWChart(){
  const canvas = $("netWorthChart");
  if (!canvas || !window.Chart) return;

  const view = nwBuildView(nwTf);

  netWorthChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: view.labels,
      datasets: [{
        data: view.data,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.12)",
        borderWidth: 2,
        borderCapStyle: "round",
        borderJoinStyle: "round",
        fill: true,
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        pointRadius: 0,
        pointHitRadius: 18,
        spanGaps: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          display: true,
          ticks: {
            color: axisTickColor(),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (val, idx) => {
              const lbs = netWorthChart?.data?.labels || [];
              const span = spanMsFromLabels(lbs);
              const lbl = (lbs?.[val] ?? val);
              const ts = labelToTs(lbl);
              return fmtAxisX(ts, span);
            }
          },
          grid: { display: false },
          border: { display: false }
    },
    y: {
      type: (nwScale === "log") ? "logarithmic" : "linear",
          type: (nwScale === "log") ? "logarithmic" : "linear",
          position: "right",
          afterFit: (scale) => { scale.width = Math.min(scale.width, 56); },
          ticks: {
            color: axisTickColor(),
            maxTicksLimit: 5,
            callback: (v) => `$${fmtSmart(v)}`
          },
          grid: { color: axisGridColor() },
          border: { display: false }
        }
      }
    },
    plugins: [lastDotPlugin]
  });

  // Keep readout pinned longer on interaction (no snap-back)
  try{ netWorthChart.$crosshairHoldMs = 6500; }catch{}

  attachCrosshair2(netWorthChart, $("nwReadout"), (i, lbs, ds) => {
    const t = labelToTs(lbs?.[i]);
    const v = safe(ds?.[i]);
    return `${t ? fmtHHMM(t) : "—"} • $${v.toFixed(2)}`;
  });
}

function updateNWTFButtons(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;
  wrap.querySelectorAll(".tf-btn").forEach((b) => {
    b.disabled = false;
    b.classList.remove("locked");
    b.style.opacity = "1";
    b.style.pointerEvents = "auto";
    b.classList.toggle("active", (b.dataset.tf === nwTf));
  });
}

function drawNW(force=false){
  const now = Date.now();
  if (!force && (now - lastNWDrawAt) < NW_DRAW_MIN_MS) return;
  lastNWDrawAt = now;

  if (!netWorthChart) initNWChart();
  if (!netWorthChart) return;

  const view = nwBuildView(nwTf);

  netWorthChart.data.labels = view.labels;
  netWorthChart.data.datasets[0].data = view.data;
  netWorthChart.options.scales.y.type = (nwScale === "log") ? "logarithmic" : "linear";
  try { netWorthChart.update("none"); } catch(e){ console.warn("[netWorthChart.update]", e); }

  const pnlEl = $("netWorthPnl");
  if (view.data.length >= 2){
    const first = safe(view.data[0]);
    const last  = safe(view.data[view.data.length - 1]);
    const pnl = last - first;
    const pnlPct = first ? (pnl / first) * 100 : 0;

    if (pnlEl){
      pnlEl.classList.remove("good","bad","flat");
      pnlEl.classList.add(pnl > 0 ? "good" : pnl < 0 ? "bad" : "flat");
      const sign = pnl > 0 ? "+" : "";
      pnlEl.textContent = `PnL: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`;
    }
  } else {
    if (pnlEl){
      pnlEl.classList.remove("good","bad");
      pnlEl.classList.add("flat");
      pnlEl.textContent = "PnL: —";
    }
  }

  updateNWTFButtons();
  // keep readout alive, but don't override while user is inspecting a point
  const ro = $("nwReadout");
  if (netWorthChart && ro) {
    const pinnedUntil = Number.isFinite(+netWorthChart.$pinUntil) ? +netWorthChart.$pinUntil : 0;
    if (pinnedUntil && Date.now() < pinnedUntil) {
      // keep pinned value
    } else {
      const ds = netWorthChart.data.datasets?.[0]?.data || [];
      const lbs = netWorthChart.data.labels || [];
      if (ds.length) {
        const i = ds.length - 1;
        ro.textContent = `${labelToTs(lbs[i]) ? fmtHHMM(labelToTs(lbs[i])) : "—"} • $${safe(ds[i]).toFixed(2)}`;
      }
    }
  }
}

$("nwTfSwitch")?.addEventListener("click", (e) => {
  const btn = e.target?.closest(".tf-btn");
  if (!btn) return;
  const tf = btn.dataset.tf || "live";
  if (!["live","1d","1w","1m","1y","all"].includes(tf)) return;
  if (btn.disabled) return;

  nwTf = tf;
  // reset zoom/pan so ALL fills the card
  try{ netWorthChart?.resetZoom?.(); }catch{}
  saveNWLocal();
  nwRequestMarketView(nwTf, true);
  drawNW(true);
}, { passive:true });

$("nwScaleToggle")?.addEventListener("click", (e) => {
  e.preventDefault();
  nwScale = (nwScale === "log") ? "linear" : "log";
  const b = $("nwScaleToggle");
  if (b) b.textContent = (nwScale === "log") ? "LOG" : "LIN";
  saveNWLocal();
  drawNW(true);
}, { passive:false });

$("nwLiveToggle")?.addEventListener("click", (e) => {
  e.preventDefault();
  const b = $("nwLiveToggle");
  const on = (nwTf === "live") ? false : true;
  nwTf = on ? "live" : "1d";
  if (b) b.classList.toggle("active", on);
  saveNWLocal();
  drawNW(true);
}, { passive:false });

function updateNetWorthMiniRows(){
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  setText("netWorthInj", `${totalInj.toFixed(4)} INJ`);
}

function recordNetWorthPoint(){
  if (!address) return;

  const now = Date.now();
  if ((now - lastNWPointAt) < NW_POINT_MIN_MS) return;

  const px = safe(targetPrice);
  if (!Number.isFinite(px) || px <= 0) return;

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * px;
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;

  const lastT = nwTAll.length ? safe(nwTAll[nwTAll.length - 1]) : 0;

  // If there was a long gap (offline/sleep), rebuild the missing curve from market before adding a new point.
  if (lastT && (now - lastT) > NW_MKT_BACKFILL_MIN_GAP_MS){
    if (nwBackfilling) return;
    if ((now - nwLastBackfillFailAt) > NW_MKT_BACKFILL_FAIL_COOLDOWN_MS){
      if (nwStartMarketBackfill(now, false)) return;
    }
  }
  const lastUsd = nwUsdAll.length ? safe(nwUsdAll[nwUsdAll.length - 1]) : 0;

  const dt = now - lastT;
  const dUsd = Math.abs(totalUsd - lastUsd);

  if (lastT && dt < NW_POINT_MIN_MS && dUsd < 0.50) return;

  lastNWPointAt = now;
  nwTAll.push(now);
  nwUsdAll.push(totalUsd);
  nwInjAll.push(totalInj);
  clampNWArrays();
  saveNWLocal();
  drawNW(false);
}

/* ================= CLOUD SYNC ================= */
const CLOUD_VER = 2;
const CLOUD_KEY = `inj_cloudmeta_v${CLOUD_VER}`;
let cloudPts = 0;
let cloudLastSync = 0;
let cloudDirty = false;
let cloudPushTimer = null;

// track "what syncing" for Advanced settings
let cloudDirtyWhat = { stake:false, wd:false, nw:false, events:false };

function cloudLoadMeta(){
  try{
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    cloudPts = safe(obj?.pts);
    cloudLastSync = safe(obj?.lastSync);
  } catch {}
}
function cloudSaveMeta(){
  try{ localStorage.setItem(CLOUD_KEY, JSON.stringify({ v:CLOUD_VER, pts: cloudPts, lastSync: cloudLastSync })); } catch {}
}
function cloudSetState(state){
  const st = $("cloudStatus");
  if (st){
    if (state === "saving") st.textContent = hasInternet() ? "Cloud: Saving" : "Cloud: Offline cache";
    else if (state === "error") st.textContent = "Cloud: Error";
    else st.textContent = hasInternet() ? "Cloud: Synced" : "Cloud: Offline cache";
  }

  // menu
  if (cloudDotMenu) {
    cloudDotMenu.classList.remove("ok","saving","err");
    if (state === "saving") cloudDotMenu.classList.add("saving");
    else if (state === "error") cloudDotMenu.classList.add("err");
    else cloudDotMenu.classList.add("ok");
  }
  if (cloudTextMenu) {
    cloudTextMenu.textContent = (state === "saving") ? "Saving"
      : (state === "error") ? "Error"
      : hasInternet() ? "Synced" : "Offline cache";
  }
  if (cloudLastMenu){
    cloudLastMenu.textContent = cloudLastSync ? new Date(cloudLastSync).toLocaleString() : "—";
  }

  // Advanced settings monitor
  const advDot = $("cloudAdvDot");
  const advSt = $("cloudAdvState");
  const advLast = $("cloudAdvLast");
  const advPts = $("cloudAdvPts");
  const advWhat = $("cloudAdvWhat");

  if (advDot) {
    advDot.classList.remove("ok","saving","err");
    if (state === "saving") advDot.classList.add("saving");
    else if (state === "error") advDot.classList.add("err");
    else advDot.classList.add("ok");
  }
  if (advSt) {
    advSt.textContent =
      (state === "saving") ? (hasInternet() ? "Saving to Cloud…" : "Offline cache") :
      (state === "error") ? "Cloud error" :
      (hasInternet() ? "Cloud synced" : "Offline cache");
  }
  if (advLast) advLast.textContent = cloudLastSync ? new Date(cloudLastSync).toLocaleString() : "—";
  if (advPts) advPts.textContent = String(Math.max(0, Math.floor(safe(cloudPts))));
  if (advWhat){
    const list = [];
    if (cloudDirtyWhat.stake) list.push("Stake");
    if (cloudDirtyWhat.wd) list.push("Rewards");
    if (cloudDirtyWhat.nw) list.push("NetWorth");
    if (cloudDirtyWhat.events) list.push("Events");
    advWhat.textContent = list.length ? list.join(", ") : (state === "saving" ? "Preparing…" : "—");
  }
}
function cloudRenderMeta(){
  const hist = $("cloudHistory");
  if (hist) hist.textContent = `· ${Math.max(0, Math.floor(cloudPts))} pts`;
  if (cloudLastMenu){
    cloudLastMenu.textContent = cloudLastSync ? new Date(cloudLastSync).toLocaleString() : "—";
  }
  cloudSetState("synced");
}
function cloudBumpLocal(points = 1){
  cloudPts = safe(cloudPts) + safe(points);
  cloudLastSync = Date.now();
  cloudSaveMeta();
  cloudRenderMeta();
}
function cloudMarkDirty(what = {}){
  if (!address) return;
  cloudDirty = true;
  if (what?.stake) cloudDirtyWhat.stake = true;
  if (what?.wd) cloudDirtyWhat.wd = true;
  if (what?.nw) cloudDirtyWhat.nw = true;
  if (what?.events) cloudDirtyWhat.events = true;

  if (!hasInternet()) return;
  scheduleCloudPush();
}
function scheduleCloudPush(){
  if (Date.now() - cloudLastFailAt < CLOUD_FAIL_COOLDOWN_MS) return;
  if (cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => cloudPush(), CLOUD_PUSH_DEBOUNCE_MS);
}
function buildCloudPayload(){
  return {
    v: 2,
    t: Date.now(),
    stake: { labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes },
    wd: { labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll },
    nw: { times: nwTAll, usd: nwUsdAll, inj: nwInjAll },
    events: eventsAll
  };
}
function mergeUniqueByTs(baseTimes, baseVals, addTimes, addVals){
  const map = new Map();
  for (let i=0;i<baseTimes.length;i++){
    const t = safe(baseTimes[i]);
    if (!t) continue;
    map.set(t, safe(baseVals[i]));
  }
  for (let i=0;i<addTimes.length;i++){
    const t = safe(addTimes[i]);
    if (!t) continue;
    if (!map.has(t)) map.set(t, safe(addVals[i]));
  }
  const times = [...map.keys()].sort((a,b)=>a-b);
  const vals = times.map(t => map.get(t));
  return { times, vals };
}
function mergeStakeByLabel(payloadStake){
  if (!payloadStake) return;
  const pl = Array.isArray(payloadStake.labels) ? payloadStake.labels : [];
  const pd = Array.isArray(payloadStake.data) ? payloadStake.data : [];
  const pm = Array.isArray(payloadStake.moves) ? payloadStake.moves : [];
  const pt = Array.isArray(payloadStake.types) ? payloadStake.types : [];

  const map = new Map();
  for (let i=0;i<stakeLabels.length;i++){
    const k = String(stakeLabels[i]);
    map.set(k, { d: safe(stakeData[i]), m: safe(stakeMoves[i]), t: String(stakeTypes[i] || "Stake update") });
  }
  for (let i=0;i<pl.length;i++){
    const k = String(pl[i]);
    if (!map.has(k)) {
      map.set(k, { d: safe(pd[i]), m: safe(pm[i]), t: String(pt[i] || "Stake update") });
    }
  }

  const keys = [...map.keys()].sort((a,b)=>labelToTs(a)-labelToTs(b));
  stakeLabels = clampArray(keys, 2400);
  stakeData   = clampArray(keys.map(k => map.get(k).d), 2400);
  stakeMoves  = clampArray(keys.map(k => map.get(k).m), 2400);
  stakeTypes  = clampArray(keys.map(k => map.get(k).t), 2400);

  stakeBaselineCaptured = stakeData.length > 0;
  lastStakeRecordedRounded = stakeData.length ? Number(safe(stakeData[stakeData.length - 1]).toFixed(6)) : null;
}

function mergeWd(payloadWd){
  if (!payloadWd) return;
  const pl = Array.isArray(payloadWd.labels) ? payloadWd.labels : [];
  const pv = Array.isArray(payloadWd.values) ? payloadWd.values : [];
  const pt = Array.isArray(payloadWd.times) ? payloadWd.times : [];

  const map = new Map();

  // local
  for (let i=0;i<wdTimesAll.length;i++){
    const tIn = safe(wdTimesAll[i]) || labelToTs(wdLabelsAll[i]);
    const v = safe(wdValuesAll[i]);
    if (!tIn || !Number.isFinite(v) || v <= 0) continue;
    const t = wdDeterministicTs(tIn, v);
    map.set(t, { v, l: String(wdLabelsAll[i] || tsLabel(t)) });
  }

  // remote
  const n = Math.max(pl.length, pv.length, pt.length);
  for (let i=0;i<n;i++){
    const tIn = safe(pt[i]) || labelToTs(pl[i]);
    const v = safe(pv[i]);
    if (!tIn || !Number.isFinite(v) || v <= 0) continue;
    const t = wdDeterministicTs(tIn, v);
    if (!map.has(t)) map.set(t, { v, l: String(pl[i] || tsLabel(t)) });
  }

  const keys = [...map.keys()].sort((a,b)=>a-b);

  wdTimesAll  = keys;
  wdLabelsAll = keys.map(t => map.get(t).l || tsLabel(t));
  wdValuesAll = keys.map(t => safe(map.get(t).v));

  clampWdAll();
}
function mergeNW(payloadNw){
  if (!payloadNw) return;
  const t = Array.isArray(payloadNw.times) ? payloadNw.times : [];
  const u = Array.isArray(payloadNw.usd) ? payloadNw.usd : [];
  const j = Array.isArray(payloadNw.inj) ? payloadNw.inj : [];

  const m1 = mergeUniqueByTs(nwTAll, nwUsdAll, t, u);
  const m2 = mergeUniqueByTs(nwTAll, nwInjAll, t, j);

  nwTAll = m1.times;
  nwUsdAll = m1.vals;
  nwInjAll = m2.vals;

  clampNWArrays();
}

function mergeEvents(payloadEvents){
  if (!Array.isArray(payloadEvents)) return;

  const rankStatus = (s) => (s === "done" ? 3 : s === "pending" ? 2 : s === "error" ? 1 : 0);

  const semKey = (ev) => {
    if (!ev) return "";
    const id = String(ev.id || "");
    if (id.startsWith("daily_") || id.startsWith("wd_")) return id;

    const ts = safe(ev.ts);
    const minute = ts ? Math.floor(ts/60000)*60000 : 0;

    const k = String(ev.kind || "").trim().toLowerCase();
    const t = String(ev.title || "").trim().toLowerCase();
    const d = String(ev.detail || "").trim().toLowerCase().slice(0, 80);

    return `${k}|${t}|${d}|${minute}`;
  };

  const mergeTwo = (a, b) => {
    if (!a) return b;
    if (!b) return a;

    const out = { ...a };

    // keep stable id if any deterministic, else keep existing
    if (!out.id && b.id) out.id = b.id;

    // timestamp: keep the earlier within the same minute (more "event-like")
    const ta = safe(a.ts), tb = safe(b.ts);
    if (ta && tb) out.ts = Math.min(ta, tb);
    else out.ts = ta || tb || Date.now();

    // prefer richer fields
    if ((!out.detail || out.detail.length < 4) && b.detail) out.detail = b.detail;
    else if (b.detail && (b.detail.length > (out.detail || "").length)) out.detail = b.detail;

    if (!out.dir && b.dir) out.dir = b.dir;

    // status: keep best
    const ra = rankStatus(out.status);
    const rb = rankStatus(b.status);
    if (rb > ra) out.status = b.status;

    // title/kind: keep existing unless missing
    if (!out.title && b.title) out.title = b.title;
    if (!out.kind && b.kind) out.kind = b.kind;

    return out;
  };

  const map = new Map();

  const all = []
    .concat(Array.isArray(eventsAll) ? eventsAll : [])
    .concat(Array.isArray(payloadEvents) ? payloadEvents : []);

  for (const ev of all){
    const key = semKey(ev);
    if (!key) continue;
    const cur = map.get(key);
    map.set(key, mergeTwo(cur, ev));
  }

  const merged = Array.from(map.values())
    .filter(Boolean)
    .sort((a,b)=>safe(b.ts)-safe(a.ts));

  eventsAll = merged.slice(0, 1200);
}
async function cloudPull(){
  if (!address) return;
  if (!hasInternet()) { cloudSetState("synced"); return; }

  const url = `${CLOUD_API}?address=${encodeURIComponent(address)}`;
  const res = await fetchJSON(url);
  if (!res?.ok) { cloudLastFailAt = Date.now();
    cloudSetState("error"); return; }
  if (!res.data) { cloudSetState("synced"); return; }

  try{
    const data = res.data;

    // ✅ merge solo del tuo address, payload è per-address già dal server
    mergeStakeByLabel(data.stake);
    mergeWd(data.wd);
    mergeNW(data.nw);
    mergeEvents(data.events);

    // persist merged cloud data locally without marking dirty
    try{ saveWdAllLocalSilent(); } catch {}
    try{ saveNWLocalSilent(); } catch {}
    try{ saveEventsSilent(); } catch {}

    // salva local per questo address
    saveStakeSeriesLocal();
    saveWdAllLocal();
    saveNWLocal();
    saveEvents();

    rebuildWdView();
    drawNW(true);
    drawStakeChart();
    drawRewardWdChart();
    renderEvents();

    cloudLastSync = Date.now();
    cloudSaveMeta();
    cloudSetState("synced");
  } catch {
    cloudLastFailAt = Date.now();
    cloudSetState("error");
  }
}

async function cloudPush(){
  if (!address) return;
  if (!hasInternet()) return;
  if (!cloudDirty) return;

  cloudSetState("saving");

  const url = `${CLOUD_API}?address=${encodeURIComponent(address)}`;
  // merge-before-post: pull latest first to avoid overwrites (multi-device safe)
try{
  const pulled = await fetchJSON(url);
  if (pulled?.ok && pulled.data){
    const data = pulled.data;
    try{ mergeStakeByLabel(data.stake); } catch {}
    try{ mergeWd(data.wd); } catch {}
    try{ mergeNW(data.nw); } catch {}
    try{ mergeEvents(data.events); } catch {}
  }
} catch {}

const payload = buildCloudPayload();

const res = await fetchJSON(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res?.ok) {
    cloudLastFailAt = Date.now();
    cloudSetState("error");
    return;
  }

  cloudDirty = false;
  cloudDirtyWhat = { stake:false, wd:false, nw:false, events:false };

  cloudLastSync = Date.now();
  cloudSaveMeta();
  cloudRenderMeta();
  cloudSetState("synced");
}

/* ================= CHART THEME REFRESH ================= */
function refreshChartsTheme(){
  try{
    if (stakeChart) {
      stakeChart.options.scales.y.grid.color = axisGridColor();
      stakeChart.options.scales.y.ticks.color = axisTickColor();
      stakeChart.options.scales.x.grid.color = axisGridColor();
      stakeChart.options.scales.x.ticks.color = axisTickColor();
      stakeChart.update("none");
    }
    if (rewardChart) {
      rewardChart.options.scales.x.grid.color = axisGridColor();
      rewardChart.options.scales.y.grid.color = axisGridColor();
      rewardChart.options.scales.x.ticks.color = axisTickColor();
      rewardChart.options.scales.y.ticks.color = axisTickColor();
      rewardChart.update("none");
    }
    if (chart) {
      chart.options.scales.y.grid.color = axisGridColor();
      chart.options.scales.y.ticks.color = axisTickColor();
      chart.update("none");
    }
    if (netWorthChart) {
      netWorthChart.options.scales.y.grid.color = axisGridColor();
      netWorthChart.options.scales.y.ticks.color = axisTickColor();
      netWorthChart.options.scales.x.ticks.color = axisTickColor();
      try { netWorthChart.update("none"); } catch(e){ console.warn("[netWorthChart.update]", e); }
    }
  } catch {}
}

/* ================= Crosshair (mouse+touch) for charts ================= */
const crosshairPlugin = {
  id: "crosshairPlugin",
  afterDraw(ch) {
    const idx = ch?.$crosshairIndex;
    if (idx == null) return;
    const meta = ch.getDatasetMeta(0);
    const el = meta?.data?.[idx];
    if (!el) return;

    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(el.x, ch.chartArea.top);
    ctx.lineTo(el.x, ch.chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(250,204,21,0.95)";
    ctx.stroke();
    ctx.restore();
  }
};

function attachCrosshair(ch, overlayEl, formatter){
  if (!ch || !overlayEl) return;
  try { Chart.register(crosshairPlugin); } catch {}

  const canvas = ch.canvas;

  const getIdx = (evt) => {
    try{
      const pts = ch.getElementsAtEventForMode(evt, "index", { intersect:false }, false);
      if (!pts || !pts.length) return null;
      return pts[0].index;
    } catch { return null; }
  };

  const update = (idx) => {
    const ds = ch.data.datasets?.[0]?.data || [];
    const lbs = ch.data.labels || [];
    if (!ds.length) return;
    const i = clamp(idx ?? (ds.length - 1), 0, ds.length - 1);
    ch.$crosshairIndex = i;
    overlayEl.textContent = formatter(i, lbs, ds);
    ch.update("none");
  };

  const move = (evt) => {
    const i = getIdx(evt);
    if (i == null) return;
    update(i);
  };

  const leave = () => {
    const ds = ch.data.datasets?.[0]?.data || [];
    if (!ds.length) return;
    update(ds.length - 1);
  };

  // init on last point
  leave();

  canvas.addEventListener("mousemove", move, { passive:true });
  canvas.addEventListener("mouseleave", leave, { passive:true });
  canvas.addEventListener("touchstart", move, { passive:true });
  canvas.addEventListener("touchmove", move, { passive:true });
  canvas.addEventListener("touchend", leave, { passive:true });
  canvas.addEventListener("touchcancel", leave, { passive:true });
}

/* ================= SETTINGS (Advanced settings) ================= */
const advBtn = $("advAccBtn");
const advBody = $("advAccBody");
advBtn?.addEventListener("click", () => {
  const open = advBtn.getAttribute("aria-expanded") === "true";
  advBtn.setAttribute("aria-expanded", open ? "false" : "true");
  advBody?.setAttribute("aria-hidden", open ? "true" : "false");
}, { passive:true });

async function fetchPublicIP(){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2200);
  try{
    const r = await fetch("https://api.ipify.org?format=json", { cache:"no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error("bad");
    const j = await r.json();
    return String(j?.ip || "—");
  } catch { return "—"; }
  finally { clearTimeout(t); }
}


/* ================= BACKUP & RESTORE (per-wallet chart data) ================= */
function backupLastKey(addr){
  const a = String(addr||"").trim().toLowerCase();
  return a ? ("inj_backup_last__" + a) : null;
}

function backupGlobalKeys(){
  // Global site prefs (not address-specific) that should travel with the backup
  const out = [];
  try{
    // known constants (defined above)
    if (typeof THEME_KEY === "string") out.push(THEME_KEY);
    if (typeof MODE_KEY  === "string") out.push(MODE_KEY);
    if (typeof VIEW_KEY  === "string") out.push(VIEW_KEY);
    if (typeof PRIVACY_KEY === "string") out.push(PRIVACY_KEY);
    if (typeof TICKER_SPEED_KEY === "string") out.push(TICKER_SPEED_KEY);
    if (typeof CARD_FX_ON_KEY === "string") out.push(CARD_FX_ON_KEY);
    if (typeof CARD_BORDER_FX_SPEED_KEY === "string") out.push(CARD_BORDER_FX_SPEED_KEY);
    if (typeof CARD_BORDER_FX_LEN_KEY === "string") out.push(CARD_BORDER_FX_LEN_KEY);
    if (typeof CARD_ORDER_KEY === "string") out.push(CARD_ORDER_KEY);
    if (typeof PRICE_TF_KEY === "string") out.push(PRICE_TF_KEY);
    if (typeof PRICE_SCALE_KEY === "string") out.push(PRICE_SCALE_KEY);
    if (typeof LAST_ADDR_KEY === "string") out.push(LAST_ADDR_KEY);
  }catch{}

  // Best-effort: include any additional "inj_*" prefs that are global (not per-address).
  // We include only keys that start with "inj_" and do NOT contain "__" (our per-address keys use "__<addr>" or prefixes with address appended).
  try{
    for (let i=0; i<localStorage.length; i++){
      const k = localStorage.key(i);
      if (!k || typeof k !== "string") continue;
      if (!k.startsWith("inj_")) continue;
      // Skip per-address blobs (they almost always contain "__" or end with an address)
      if (k.includes("__")) continue;
      if (!out.includes(k)) out.push(k);
    }
  }catch{}

  return out.filter(Boolean);
}

function backupKeysForAddr(addr){
  const a = String(addr||"").trim();
  if (!a) return [];
  // Per-wallet stored series
  const list = [
    nwStoreKey(a),
    stakeStoreKey(a),
    wdStoreKey(a),
    feesStoreKey(a),
    aprStoreKey(a),
    evStoreKey(a),
    // lightweight snapshot card
    (typeof SNAP_KEY_PREFIX === "string" ? (SNAP_KEY_PREFIX + a) : null),
    // cloud cfg (optional, still local)
    ("inj_cloud_cfg__" + a.toLowerCase())
  ];
  // add global keys
  const g = backupGlobalKeys();
  return list.concat(g).filter(Boolean);
}
function backupComputeStats(addr){
  const a = String(addr||"").trim();
  const out = { nw:0, stake:0, wd:0, fees:0, apr:0, events:0, keysPresent:0, keysTotal:0, last:null };

  const keys = backupKeysForAddr(a);
  out.keysTotal = keys.length;
  for (const k of keys){
    try{ if (localStorage.getItem(k) != null) out.keysPresent++; }catch{}
  }

  try{
    const raw = localStorage.getItem(nwStoreKey(a));
    if (raw){
      const o = JSON.parse(raw);
      out.nw = Array.isArray(o?.times) ? o.times.length : 0;
    }
  }catch{}
  try{
    const raw = localStorage.getItem(stakeStoreKey(a));
    if (raw){
      const o = JSON.parse(raw);
      out.stake = Array.isArray(o?.labels) ? o.labels.length : (Array.isArray(o?.data) ? o.data.length : 0);
    }
  }catch{}
  try{
    const raw = localStorage.getItem(wdStoreKey(a));
    if (raw){
      const o = JSON.parse(raw);
      out.wd = Array.isArray(o?.labels) ? o.labels.length : (Array.isArray(o?.values) ? o.values.length : 0);
    }
  }catch{}
  try{
    const raw = localStorage.getItem(feesStoreKey(a));
    if (raw){
      const o = JSON.parse(raw);
      out.fees = Array.isArray(o?.labels) ? o.labels.length : (Array.isArray(o?.values) ? o.values.length : 0);
    }
  }catch{}
  try{
    const raw = localStorage.getItem(aprStoreKey(a));
    if (raw){
      const o = JSON.parse(raw);
      out.apr = Array.isArray(o?.labels) ? o.labels.length : (Array.isArray(o?.data) ? o.data.length : 0);
    }
  }catch{}
  try{
    const raw = localStorage.getItem(evStoreKey(a));
    if (raw){
      const o = JSON.parse(raw);
      out.events = Array.isArray(o?.events) ? o.events.length : 0;
    }
  }catch{}

  try{
    const lk = backupLastKey(a);
    const raw = lk ? localStorage.getItem(lk) : null;
    if (raw){
      const o = JSON.parse(raw);
      out.last = o && o.ts ? o.ts : null;
    }
  }catch{}

  return out;
}
function backupInfoText(addr){
  const a = String(addr||"").trim();
  if (!a) return "Inserisci un address per abilitare backup.";
  const s = backupComputeStats(a);
  const last = s.last ? (" • Last backup: " + fmtDDMMYY(s.last) + " " + fmtHHMM(s.last)) : "";
  return `NW ${s.nw} • Stake ${s.stake} • WD ${s.wd} • Fees ${s.fees} • APR ${s.apr} • Events ${s.events} • Keys ${s.keysPresent}/${s.keysTotal}${last}`;
}
function backupRenderInfo(){
  const info = $("backupInfo");
  if (info) info.textContent = backupInfoText(address);

  const exp = $("backupExportBtn");
  const imp = $("backupImportBtn");
  const file = $("backupImportFile");
  const hasAddr = !!address && isValidInjAddr(address);
  if (exp) exp.disabled = !hasAddr;
  // Import is allowed even if address is empty (we can restore and set it from file)
  if (imp) imp.disabled = !(file && file.files && file.files.length);
}
function downloadTextFile(filename, text, mime="application/json"){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
async function backupExportNow(){
  const a = String(address||"").trim();
  if (!isValidInjAddr(a)){
    pushEvent({ kind:"info", title:"Backup", detail:"Inserisci un indirizzo valido prima di esportare.", status:"fail" });
    return;
  }

  const keys = backupKeysForAddr(a);
  const data = {};
  let saved = 0;
  for (const k of keys){
    try{
      const v = localStorage.getItem(k);
      if (v != null){ data[k] = v; saved++; }
    }catch{}
  }

  const payload = {
    meta: { app:"Injective Portfolio", version:"v2.0.2", exportedAt: new Date().toISOString() },
    address: a,
    data
  };

  const date = new Date().toISOString().slice(0,10);
  const fn = `inj_backup_${a.slice(0,8)}_${date}.json`;
  downloadTextFile(fn, JSON.stringify(payload, null, 2));

  try{
    const lk = backupLastKey(a);
    if (lk) localStorage.setItem(lk, JSON.stringify({ ts: Date.now(), keys: saved, file: fn }));
  }catch{}

  backupRenderInfo();
  pushEvent({ kind:"info", title:"Backup creato", detail:`Scaricato ${fn} (${saved} blocchi)`, status:"ok" });
}
async function backupImportNow(){
  const fileEl = $("backupImportFile");
  const file = fileEl?.files?.[0];
  if (!file){
    pushEvent({ kind:"info", title:"Restore", detail:"Seleziona un file .json di backup.", status:"fail" });
    return;
  }

  let txt = "";
  try{ txt = await file.text(); }
  catch(e){
    pushEvent({ kind:"info", title:"Restore", detail:"Impossibile leggere il file.", status:"fail" });
    return;
  }

  let obj = null;
  try{ obj = JSON.parse(txt); }
  catch(e){
    pushEvent({ kind:"info", title:"Restore", detail:"File non valido (JSON).", status:"fail" });
    return;
  }

  const bAddr = String(obj?.address || "").trim();
  const cur = String(address || "").trim();
  const target = cur || bAddr;

  if (!isValidInjAddr(target)){
    pushEvent({ kind:"info", title:"Restore", detail:"Backup non valido: address mancante. Inserisci prima un indirizzo o usa un backup corretto.", status:"fail" });
    return;
  }

  if (cur && bAddr && cur.toLowerCase() !== bAddr.toLowerCase()){
    pushEvent({
      kind:"info",
      title:"Restore bloccato",
      detail:`Backup per ${maskAddr(bAddr)} ma stai usando ${maskAddr(cur)}. Cambia indirizzo e riprova.`,
      status:"fail"
    });
    return;
  }

  const data = (obj && typeof obj.data === "object" && obj.data) ? obj.data : null;
  if (!data){
    pushEvent({ kind:"info", title:"Restore", detail:"Backup non valido: manca il campo data.", status:"fail" });
    return;
  }

  const allowed = new Set(backupKeysForAddr(target));
  let applied = 0, skipped = 0;

  for (const [k, v] of Object.entries(data)){
    if (!allowed.has(k)){ skipped++; continue; }
    try{ localStorage.setItem(k, String(v)); applied++; }
    catch(e){ skipped++; }
  }

  try{
    const lk = backupLastKey(target);
    if (lk) localStorage.setItem(lk, JSON.stringify({ ts: Date.now(), keys: applied, source: file.name }));
  }catch{}

  pushEvent({ kind:"info", title:"Restore completato", detail:`Importati ${applied} blocchi (saltati ${skipped}).`, status:"ok" });

  // Re-hydrate UI
  const addrInput = $("addressInput");
  if (!cur && addrInput) addrInput.value = target;

  // commitAddress reloads cached locals + redraws all charts safely
  await commitAddress(target);

  backupRenderInfo();
}
(function wireBackupSettings(){
  let wired = false;
  function wire(){
    const exp = $("backupExportBtn");
    const imp = $("backupImportBtn");
    const file = $("backupImportFile");
    if (!exp || !imp || !file) return;

    if (!wired){
      exp.addEventListener("click", () => safeAsync(() => backupExportNow(), "backupExportNow"), { passive:true });
      imp.addEventListener("click", () => safeAsync(() => backupImportNow(), "backupImportNow"), { passive:true });
      file.addEventListener("change", backupRenderInfo, { passive:true });
      wired = true;
    }
    backupRenderInfo();
  }
  document.addEventListener("DOMContentLoaded", wire);
  document.addEventListener("click", (e)=>{
    const el = e.target?.closest?.('[data-page="settings"]');
    if (el) setTimeout(wire, 0);
  }, { passive:true });
})();

async function renderSettingsSnapshot(){
  setText("settingsTheme", (document.body.dataset.theme || "dark").toUpperCase());
  setText("settingsMode", (liveMode ? "LIVE" : "REFRESH"));
  setText("settingsWallet", address || "—");

  // Card layout (reorder)
  renderCardOrderUI();

  setText("deviceTz", Intl.DateTimeFormat().resolvedOptions().timeZone || "—");
  setText("deviceLang", navigator.language || "—");
  setText("devicePlatform", navigator.platform || "—");
  setText("deviceScreen", `${window.screen?.width || "?"}×${window.screen?.height || "?"} • DPR ${window.devicePixelRatio || 1}`);

  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const conn = c ? `${c.effectiveType || "?"}${c.downlink ? ` • ${c.downlink}Mb/s` : ""}${c.rtt ? ` • ${c.rtt}ms` : ""}` : "—";
  setText("deviceConn", conn);

  const ipEl = $("deviceIp");
  if (ipEl && (ipEl.textContent === "—" || !ipEl.textContent)) {
    const ip = await fetchPublicIP();
    setText("deviceIp", ip);
  }
  try{ backupRenderInfo(); }catch(_){ }
}

/* ================= ADDRESS COMMIT (FIX: no mixing between addresses) ================= */
function resetPerAddressStateUI(){
  // reset series arrays always before loading next address
  stakeLabels = []; stakeData = []; stakeMoves = []; stakeTypes = [];
  stakeBaselineCaptured = false;
  lastStakeRecordedRounded = null;
  stakeFollow = true;
  try{ setText("stakeLast","—"); setText("stakeTimelineMeta","—"); const s1=$("stakeTimelineStart"), s2=$("stakeTimelineEnd");
    if(s1&&s2){ s1.min=0; s1.max=0; s1.value=0; s2.min=0; s2.max=0; s2.value=0; }
    const f=$("stakeTimelineFill"); if(f){ f.style.left="0%"; f.style.width="0%"; } }catch{}

  wdLabelsAll = []; wdValuesAll = []; wdTimesAll = [];
  wdLabels = []; wdValues = []; wdTimes = [];
  wdLastRewardsSeen = null;

  nwTAll = []; nwUsdAll = []; nwInjAll = [];
  lastNWPointAt = 0;

  eventsAll = [];

  // reset charts without destroy to avoid flashing bugs
  try{
    if (stakeChart){
      stakeChart.data.labels = [];
      stakeChart.data.datasets[0].data = [];
      stakeChart.update("none");
    }
    if (rewardChart){
      rewardChart.data.labels = [];
      rewardChart.data.datasets[0].data = [];
      rewardChart.update("none");
    }
    if (netWorthChart){
      netWorthChart.data.labels = [];
      netWorthChart.data.datasets[0].data = [];
      try { netWorthChart.update("none"); } catch(e){ console.warn("[netWorthChart.update]", e); }
    }
    if (feesChart){
      feesChart.data.labels = [];
      feesChart.data.datasets[0].data = [];
      feesChart.update("none");
    }
    if (aprChart){
      aprChart.data.labels = [];
      aprChart.data.datasets[0].data = [];
      aprChart.update("none");
    }
    // readouts
    setText("stakeReadout", "—");
    setText("rewardReadout", "—");
    setText("feesReadout", "—");
    setText("aprReadout", "—");
    setText("nwReadout", "—");
  } catch {}
}

async function commitAddress(newAddr) {
  const a = (newAddr || "").trim();
  if (!a) return;

  // Basic validation client-side to avoid confusion
  if (!/^inj[a-z0-9]{20,80}$/i.test(a)) {
    pushEvent({ kind:"info", title:"Invalid address", detail:"Address must start with inj...", status:"fail" });
    return;
  }

  address = a;
// Per-tab address (prevents multi-tab mixing)
try{ sessionStorage.setItem(TAB_ADDR_KEY, address); }catch{}
setUrlAddr(address);
// Global default for new tabs only
try{ localStorage.setItem(LAST_ADDR_KEY, address); }catch{}

  setAddressDisplay(address);
  settleStart = Date.now();

  // ✅ FIX: reset all per-address in-memory state (prevents mixing)
  resetPerAddressStateUI();

  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;
  displayed.available = 0; displayed.stake = 0; displayed.rewards = 0; displayed.netWorthUsd = 0; displayed.apr = 0;

  // load local per this address (or keep empty)
  const hadStake = loadStakeSeriesLocal();
  stakeFollow = true;
  if (!hadStake) drawStakeChart(); else drawStakeChart();
  try{ syncStakeTimelineUI(true); }catch {}

  wdMinFilter = safe($("rewardFilter")?.value || 0);

  // ✅ Restore last known values instantly (offline-friendly) for this address
  try{
    if (address) {
      const snap = loadAccountSnapshot(address);
      if (snap) applyAccountSnapshot(snap);
    }
  } catch {}
  const hadWd = loadWdAllLocal();
  if (!hadWd) rebuildWdView(); else rebuildWdView();

  const hadFees = loadFeesLocal();
  if (!hadFees) rebuildFeesView(); else rebuildFeesView();
  safeAsync(() => feesBackfill(true), "feesBackfill");

  const hadNw = loadNWLocal();
  const scaleBtn = $("nwScaleToggle");
  if (scaleBtn) scaleBtn.textContent = (nwScale === "log") ? "LOG" : "LIN";
  const liveBtn = $("nwLiveToggle");
  if (liveBtn) liveBtn.classList.toggle("active", nwTf === "live");
  if (!hadNw) drawNW(true); else drawNW(true);

  loadEvents();
  renderEvents();
  renderTargetsNow();
  loadAprLocal();
  drawAprChart();
// cloud pull for this address
  cloudSetState("saving");
  safeAsync(() => cloudPull(), "cloudPull");

  modeLoading = true;
  refreshConnUI();
  renderSettingsSnapshot();

  if (liveMode) await loadAccount();
  else {
    refreshLoaded = false;
    refreshConnUI();
    await safeAsync(() => refreshLoadAllOnce(), "refreshLoadAllOnce");
    
  }
}

/* ================= ONLINE / OFFLINE ================= */
window.addEventListener("online", () => {
  refreshConnUI();
  cloudSetState("synced");
  if (address) safeAsync(() => cloudPull(), "cloudPull");
  if (liveMode) {
    startTradeWS();
    startKlineWS();
    if (address) safeAsync(() => loadAccount(false), "loadAccount");
  } else {
    safeAsync(() => refreshLoadAllOnce(), "refreshLoadAllOnce");
  }
}, { passive: true });

window.addEventListener("offline", () => {
  wsTradeOnline = false;
  wsKlineOnline = false;
  accountOnline = false;
  refreshLoaded = false;
  refreshLoading = false;
  modeLoading = false;
  refreshConnUI();
  cloudSetState("synced");
}, { passive: true });


/* ================= INTEGRATIONS_V20260206 =================
   Privacy toggle (A: blur) • Targets modal • Events PRO filters
   Price Chart Timeframes • APR Chart series • Validator card
   Dynamic axes + crosshair only on interaction + blinking last dot
   ========================================================= */

/* === Privacy === */
const PRIVACY_KEY = "inj_privacy_on";
let privacyOn = (localStorage.getItem(PRIVACY_KEY) || "0") === "1";

function applyPrivacy(on){
  privacyOn = !!on;
  document.body.classList.toggle("privacy-on", privacyOn);
  try { localStorage.setItem(PRIVACY_KEY, privacyOn ? "1" : "0"); } catch {}
  const ico = $("privacyIcon");
  if (ico) ico.textContent = privacyOn ? "🙈" : "👁️";
}
$("privacyToggle")?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyPrivacy(!privacyOn);
}, { passive:false });

/* === Targets (stake/rewards) === */
let targetModalType = "stake"; // stake | reward
const TARGETS_VER = 1;

function ensureTargetGearButtons(){
  const ensureBtn = (wrapSel, id, aria) => {
    const wrap = document.querySelector(wrapSel);
    if (!wrap) return null;
    let btn = wrap.querySelector(`#${id}`);
    if (!btn){
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = id;
      btn.className = "target-gear";
      btn.setAttribute("aria-label", aria);
      btn.textContent = "⚙️";
      const left = wrap.querySelector('.left');
      if (left) wrap.insertBefore(btn, left);
      else wrap.prepend(btn);
    }
    return btn;
  };
  return {
    stakeBtn: ensureBtn('.stake-values, .bar-values.stake-values', 'stakeTargetBtn', 'Set stake target'),
    rewardBtn: ensureBtn('.reward-values, .bar-values.reward-values', 'rewardTargetBtn', 'Set rewards target')
  };
}

function targetKey(addr, type){
  const a = (addr || "").trim();
  return a ? `inj_target_v${TARGETS_VER}_${type}_${a}` : null;
}
function getTarget(addr, type, fallback){
  const k = targetKey(addr, type);
  if (!k) return fallback;
  try{
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch { return fallback; }
}
function setTarget(addr, type, v){
  const k = targetKey(addr, type);
  if (!k) return;
  try{ localStorage.setItem(k, String(v)); } catch {}
}

let stakeTargetMaxDyn = STAKE_TARGET_MAX;
let rewardTargetMaxDyn = 1;

function targetNudgeStep(type, cur){
  const v = Math.max(0, safe(cur));
  if (type === "reward"){
    if (v < 1) return 0.01;
    if (v < 10) return 0.1;
    if (v < 100) return 1;
    if (v < 1000) return 5;
    return Math.max(10, Math.round(v * 0.01));
  }
  if (v < 10) return 0.1;
  if (v < 100) return 1;
  if (v < 1000) return 5;
  if (v < 10000) return 10;
  return Math.max(25, Math.round(v * 0.01));
}

function nudgeTarget(type, dir){
  if (!address) return;
  const fallback = (type === "reward") ? 1 : STAKE_TARGET_MAX;
  const cur = getTarget(address, type, fallback);
  const step = targetNudgeStep(type, cur);
  const min = (type === "reward") ? 0.001 : 0.01;
  const next = Math.max(min, +(cur + (dir > 0 ? step : -step)).toFixed(6));
  setTarget(address, type, next);
  renderTargetsNow();
}

function bindTargetWheel(el, type){
  if (!el || el.dataset.targetWheelBound === "1") return;
  el.dataset.targetWheelBound = "1";
  el.title = (el.title ? (el.title + " • ") : "") + "Click = imposta target • Wheel = +/-";
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = (e.deltaY < 0) ? +1 : -1;
    nudgeTarget(type, dir);
  }, { passive:false });
}

function renderTargetsNow(){
  stakeTargetMaxDyn = getTarget(address, "stake", STAKE_TARGET_MAX);
  rewardTargetMaxDyn = getTarget(address, "reward", 1);

  setText("stakeMax", fmtTrim(stakeTargetMaxDyn, 6));
  setText("rewardMax", fmtTrim(rewardTargetMaxDyn, 6));
}

function openTargetModal(type){
  targetModalType = type === "reward" ? "reward" : "stake";

  const modal = $("targetModal");
  const bd = $("targetBackdrop");
  const close = $("targetClose");
  const apply = $("targetApply");
  const input = $("targetInput");
  const title = $("targetTitle");
  if (!modal || !input || !title) return;

  const cur = (targetModalType === "stake")
    ? getTarget(address, "stake", STAKE_TARGET_MAX)
    : getTarget(address, "reward", 1);

  title.textContent = targetModalType === "stake" ? "Set STAKE target" : "Set REWARDS target";

  // Inputs constraints
  if (targetModalType === "reward") {
    input.min = "0.001";
    input.step = "0.001";
    input.placeholder = "0.001";
  } else {
    input.min = "0";
    input.step = "0.01";
    input.placeholder = "0";
  }
  input.inputMode = "decimal";
  input.value = fmtTrim(cur, 6);

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");

  const closeFn = () => {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  };

  const applyFn = () => {
    const v = safe(input.value);
    const min = (targetModalType === "reward") ? 0.001 : 0;
    if (v >= min && v > 0) {
      setTarget(address, targetModalType, v);
      renderTargetsNow();
    }
    closeFn();
  };

  bd?.addEventListener("click", closeFn, { passive:true, once:true });
  close?.addEventListener("click", closeFn, { passive:false, once:true });
  apply?.addEventListener("click", applyFn, { passive:false, once:true });

  input.focus();
}

const __targetBtns = ensureTargetGearButtons();
bindTargetWheel(__targetBtns?.stakeBtn || $("stakeTargetBtn"), "stake");
bindTargetWheel(__targetBtns?.rewardBtn || $("rewardTargetBtn"), "reward");
bindTargetWheel($("stakeMax"), "stake");
bindTargetWheel($("rewardMax"), "reward");

$("stakeTargetBtn")?.addEventListener("click", (e) => { e?.preventDefault?.(); openTargetModal("stake"); }, { passive:false });
$("rewardTargetBtn")?.addEventListener("click", (e) => { e?.preventDefault?.(); openTargetModal("reward"); }, { passive:false });

/* === Dynamic axes helpers === */
function spanMsFromLabels(labels){
  if (!labels || labels.length < 2) return 0;
  const a = labelToTs(labels[0]);
  const b = labelToTs(labels[labels.length - 1]);
  const span = Math.abs((b || 0) - (a || 0));
  return Number.isFinite(span) ? span : 0;
}
function fmtAxisX(ts, spanMs){
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");

  const oneDay = 24 * 60 * 60 * 1000;
  const oneYear = 365 * oneDay;

  if (spanMs <= 2 * oneDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (spanMs <= 60 * oneDay) return `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
  if (spanMs <= 2 * oneYear) return `${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}`;
  return String(d.getFullYear());
}

/* === Crosshair: show yellow line only during interaction, then hide === */
const crosshairPlugin2 = {
  id: "crosshairPlugin2",
  afterDraw(ch) {
    const idx = ch?.$crosshairIndex;
    const active = ch?.$crosshairActive === true;
    if (!active || idx == null) return;

    const meta = ch.getDatasetMeta(0);
    const el = meta?.data?.[idx];
    if (!el) return;

    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(el.x, ch.chartArea.top);
    ctx.lineTo(el.x, ch.chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(250,204,21,0.95)";
    ctx.stroke();
    ctx.restore();
  }
};

function attachCrosshair2(ch, overlayEl, formatter){
  if (!ch || !overlayEl) return;
  try { Chart.register(crosshairPlugin2); } catch {}
  const canvas = ch.canvas;

  const getIdx = (evt) => {
    try{
      const pts = ch.getElementsAtEventForMode(evt, "index", { intersect:false }, false);
      if (!pts || !pts.length) return null;
      return pts[0].index;
    } catch { return null; }
  };

  const show = () => { overlayEl.classList.add("show"); };
  const hide = () => { overlayEl.classList.remove("show"); };

  const setIdx = (i, active) => {
    const ds = ch.data.datasets?.[0]?.data || [];
    const lbs = ch.data.labels || [];
    if (!ds.length) return;

    const idx = clamp(i ?? (ds.length - 1), 0, ds.length - 1);

    ch.$crosshairIndex = idx;
    ch.$crosshairActive = !!active;

    if (active) show(); else hide();

    try{
      overlayEl.textContent = formatter(idx, lbs, ds);
    } catch {
      overlayEl.textContent = "—";
    }

    // pin readout so it doesn't snap back to "now" immediately
    try{
      const holdMs = (Number.isFinite(+ch.$crosshairHoldMs) ? +ch.$crosshairHoldMs : 950);
      ch.$pinUntil = Date.now() + holdMs;
    } catch {}

    try { ch.update("none"); } catch {}

    if (active){
      if (ch.$crosshairTimer) clearTimeout(ch.$crosshairTimer);
      const holdMs = (Number.isFinite(+ch.$crosshairHoldMs) ? +ch.$crosshairHoldMs : 950);
      ch.$crosshairTimer = setTimeout(() => {
        ch.$crosshairActive = false;
        ch.$crosshairIndex = null;
        hide();
        try { ch.update("none"); } catch {}
      }, holdMs);
    }
  };

  const start = (evt) => {
    const i = getIdx(evt);
    if (i == null) return;
    setIdx(i, true);
  };

  const move = (evt) => {
    if (!ch.$crosshairActive) return;
    const i = getIdx(evt);
    if (i == null) return;
    setIdx(i, true);
  };

  const end = () => {
    ch.$crosshairActive = false;
    ch.$crosshairIndex = null;
    hide();
    try { ch.update("none"); } catch {}
  };

  // start hidden
  end();

  // click/tap to show
  canvas.addEventListener("click", start, { passive:true });
  canvas.addEventListener("touchstart", start, { passive:true });

  // allow short drag while active (mobile/desktop)
  canvas.addEventListener("mousemove", move, { passive:true });
  canvas.addEventListener("touchmove", move, { passive:true });

  canvas.addEventListener("mouseleave", end, { passive:true });
  canvas.addEventListener("touchend", end, { passive:true });
  canvas.addEventListener("touchcancel", end, { passive:true });
}

/* === Blinking last dot plugin (trend-based) === */
const lastDotPlugin = {
  id: "lastDotPlugin",
  afterDatasetsDraw(ch){
    const meta = ch.getDatasetMeta(0);
    const pts = meta?.data || [];
    const ds = ch.data.datasets?.[0]?.data || [];
    if (!pts.length || ds.length < 1) return;

    const el = pts[pts.length - 1];
    if (!el) return;

    const last = safe(ds[ds.length - 1]);
    const prev = safe(ds.length > 1 ? ds[ds.length - 2] : last);
let col = "rgba(250,204,21,0.95)";
if (priceTf !== "live") {
  if (last > prev) col = "rgba(34,197,94,0.95)";
  else if (last < prev) col = "rgba(239,68,68,0.95)";
}

    const t = Date.now();
    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t / 320));

    const ctx = ch.ctx;
    ctx.save();
    ctx.shadowColor = col.replace("0.95", String(0.35 * pulse));
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.arc(el.x, el.y, 6.5, 0, Math.PI*2);
    ctx.fillStyle = col.replace("0.95", String(0.22 * pulse));
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(el.x, el.y, 3.2, 0, Math.PI*2);
    ctx.fillStyle = col.replace("0.95", String(0.95 * pulse));
    ctx.fill();
    ctx.restore();
  }
};
try { Chart.register(lastDotPlugin); } catch {}

/* === Events PRO filters === */
function eventsGetFilters(){
  const q = String($("eventsSearch")?.value || "").trim().toLowerCase();
  const kind = String($("eventsKind")?.value || "all").toLowerCase();
  const status = String($("eventsStatus")?.value || "all").toLowerCase();
  return { q, kind, status };
}
["eventsSearch","eventsKind","eventsStatus"].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener(id === "eventsSearch" ? "input" : "change", () => renderEvents(), { passive:true });
});

/* === Price Chart timeframes === */
const PRICE_TF_KEY = "inj_price_tf_v1";
let priceTf = (localStorage.getItem(PRICE_TF_KEY) || "1d").toLowerCase();
if (!["live","1d","1w","1m","1y","all"].includes(priceTf)) priceTf = "1d";

/* === Price Chart scale (LIN/LOG) === */
const PRICE_SCALE_KEY = "inj_price_scale_v1";
let priceScale = (localStorage.getItem(PRICE_SCALE_KEY) || "lin").toLowerCase();
if (!["lin","log"].includes(priceScale)) priceScale = "lin";

/* === Price Chart LIVE rolling window (15 minutes) === */
const PRICE_LIVE_WINDOW_MS = 15 * 60 * 1000;
const PRICE_LIVE_MAX_POINTS = 15; // 1m bars for 15m window
let priceSessionStartAt = Date.now();

function priceLiveRange(now = Date.now()){
  const t0 = safe(priceSessionStartAt) || now;
  const start = (now - t0 < PRICE_LIVE_WINDOW_MS) ? t0 : (now - PRICE_LIVE_WINDOW_MS);
  return { start, end: now };
}


function updatePriceScaleBtn(){
  const b = $("priceScaleToggle");
  if (!b) return;
  b.textContent = (priceScale === "log") ? "LOG" : "LIN";
  b.classList.toggle("active", priceScale === "log");
}
function ensurePriceScaleSafe(){
  if (!chart) return true;
  if (priceScale !== "log") return true;
  // log scale requires positive values
  const ds = chart.data?.datasets?.[0]?.data || [];
  for (const v of ds){
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0){
      // fallback
      priceScale = "lin";
      try{ localStorage.setItem(PRICE_SCALE_KEY, priceScale); } catch {}
      updatePriceScaleBtn();
      return false;
    }
  }
  return true;
}

function applyPriceScale(){
  if (!chart) return;
  if (!ensurePriceScaleSafe()) return;
  chart.options.scales.y = chart.options.scales.y || {};
  chart.options.scales.y.type = (priceScale === "log") ? "logarithmic" : "linear";
  try { chart.update("none"); } catch {}
}
function setPriceScale(next){
  priceScale = (next === "log") ? "log" : "lin";
  try { localStorage.setItem(PRICE_SCALE_KEY, priceScale); } catch {}
  updatePriceScaleBtn();
  applyPriceScale();
}
$("priceScaleToggle")?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  setPriceScale(priceScale === "log" ? "lin" : "log");
}, { passive:false });


function updatePriceTitle(){
  const el = $("priceChartTitle");
  if (!el) return;
  const map = {
    live: "LIVE (15m) Price Chart",
    "1d": "1D Price Chart",
    "1w": "1W Price Chart",
    "1m": "1M Price Chart",
    "1y": "1Y Price Chart",
    all: "ALL Price Chart"
  };
  el.textContent = map[priceTf] || "Price Chart";
}
function updatePriceTFButtons(){
  const wrap = $("priceTfSwitch");
  if (!wrap) return;
  wrap.querySelectorAll(".tf-btn").forEach((b) => {
    b.classList.toggle("active", (b.dataset.tf === priceTf));
  });
}
function setPriceTf(tf){
  priceTf = tf;
  try { localStorage.setItem(PRICE_TF_KEY, priceTf); } catch {}
  updatePriceTFButtons();
  updatePriceTitle();
  loadPriceChart(true);

  // apply scale on tf change (after chart data loads)
  setTimeout(() => applyPriceScale(), 0);
}

$("priceTfSwitch")?.addEventListener("click", (e) => {
  const btn = e.target?.closest(".tf-btn");
  if (!btn) return;
  const tf = String(btn.dataset.tf || "1d").toLowerCase();
  if (!["live","1d","1w","1m","1y","all"].includes(tf)) return;
  setPriceTf(tf);
}, { passive:true });

async function fetchKlinesRange(symbol, interval, startTime, endTime, maxTotal=2400){
  const out = [];
  let cursor = startTime || 0;
  const end = endTime || Date.now();
  let guard = 0;
  while (out.length < maxTotal && guard++ < 10){
    const limit = 1000;
    const url = cursor
      ? `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&startTime=${cursor}&endTime=${end}`
      : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const d = await fetchJSON(url);
    if (!Array.isArray(d) || !d.length) break;
    out.push(...d);
    if (!cursor) break;
    const lastOpen = safe(d[d.length - 1][0]);
    if (!lastOpen) break;
    // step in ms (approx for 1M)
    const step =
      interval === "1m" ? ONE_MIN_MS :
      interval === "15m" ? 15*ONE_MIN_MS :
      interval === "1h" ? 60*ONE_MIN_MS :
      interval === "1d" ? 24*60*ONE_MIN_MS :
      interval === "1w" ? 7*24*60*ONE_MIN_MS :
      interval === "1M" ? 30*24*60*ONE_MIN_MS :
      ONE_MIN_MS;
    cursor = lastOpen + step;
    if (d.length < limit) break;
    if (cursor >= end) break;
  }
  return out.slice(0, maxTotal);
}

async function loadPriceChart(force=false){
  if (!hasInternet()) return;
  if (!chart) initChartToday();
  if (!chart) return;

  const now = Date.now();
  let interval = "1m";
  let start = 0;
  let maxTotal = 1440;

  if (priceTf === "live"){
    interval = "1m";
    const r = priceLiveRange(now);
    start = r.start;
    // 15m window (1m bars) + small cushion
    maxTotal = Math.max(20, Math.min(2400, Math.ceil((now - start) / ONE_MIN_MS) + 8));
  } else if (priceTf === "1d"){
    interval = "1m";
    start = now - 24*60*60*1000;
    maxTotal = 1440;
  } else if (priceTf === "1w"){
    interval = "15m";
    start = now - 7*24*60*60*1000;
    maxTotal = 672;
  } else if (priceTf === "1m"){
    interval = "1h";
    start = now - 30*24*60*60*1000;
    maxTotal = 720;
  } else if (priceTf === "1y"){
    interval = "1d";
    start = now - 365*24*60*60*1000;
    maxTotal = 365;
  } else {
    interval = "1w";
    start = 0;
    maxTotal = 1000;
  }

  const kl = await fetchKlinesRange("INJUSDT", interval, start, now, Math.min(2400, maxTotal));
  if (!kl.length) return;

  const labels = kl.map(k => tsLabel(safe(k[0])));
  const data = kl.map(k => safe(k[4]));

  chart.data.labels = labels;
  chart.data.datasets[0].data = data;

  // allow LIVE / 1D to keep updating via 1m kline stream
  if (interval === "1m"){
    chartBootstrappedToday = true;
    lastChartMinuteStart = safe(kl[kl.length - 1]?.[0]) || lastChartMinuteStart;
  }

  // ensure axes are dynamic
  chart.options.scales.x.display = true;
  chart.options.scales.x.ticks = chart.options.scales.x.ticks || {};
  chart.options.scales.x.ticks.callback = (v, i) => {
    const lbs = chart.data.labels || [];
    const span = spanMsFromLabels(lbs);
    const lbl = (lbs?.[v] ?? v);
    const ts = labelToTs(lbl);
    return fmtAxisX(ts, span);
  };
  chart.options.scales.y.ticks = chart.options.scales.y.ticks || {};
  chart.options.scales.y.ticks.callback = (v) => `$${fmtSmart(v)}`;

  const first = safe(data[0]);
  const last = safe(data[data.length - 1]);
  const sign = (priceTf === "live") ? "live" : ((last > first) ? "up" : (last < first) ? "down" : "flat");
  applyChartColorBySign(sign);

  try{ applyPriceScale(); } catch {}

  chart.update("none");
  pinnedIndex = null;
  updatePinnedOverlay();
}

/* === APR chart series === */
const APR_LOCAL_VER = 1;
let aprLabels = [];
let aprData = [];
let aprChart = null;
let lastAprPointAt = 0;
let lastAprSeen = null;

function aprStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_apr_series_v${APR_LOCAL_VER}_${a}` : null;
}
function loadAprLocal(){
  const k = aprStoreKey(address);
  if (!k) return false;
  try{
    const raw = localStorage.getItem(k);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== APR_LOCAL_VER) return false;
    aprLabels = Array.isArray(obj.labels) ? obj.labels : [];
    aprData = Array.isArray(obj.data) ? obj.data : [];
    const n = Math.min(aprLabels.length, aprData.length);
    aprLabels = aprLabels.slice(-n);
    aprData = aprData.slice(-n);
    return true;
  } catch { return false; }
}
function saveAprLocal(){
  const k = aprStoreKey(address);
  if (!k) return;
  try{
    localStorage.setItem(k, JSON.stringify({ v: APR_LOCAL_VER, t: Date.now(), labels: aprLabels, data: aprData }));
  } catch {}
}
function initAprChart(){
  const canvas = $("aprChart");
  if (!canvas || !window.Chart) return;

  aprChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: aprLabels,
      datasets: [{
        data: aprData,
        borderColor: "#facc15",
        backgroundColor: "rgba(250,204,21,.12)",
        fill: true,
        tension: 0.25,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 0,
        pointHitRadius: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display:false },
        tooltip: { enabled:false },
        ...(ZOOM_OK ? { zoom: { pan: { enabled:true, mode:"x", threshold:2 }, zoom: { wheel:{ enabled:true }, pinch:{ enabled:true }, mode:"x" } } } : {})
      },
      interaction: { mode:"index", intersect:false },
      scales: {
        x: {
          display:true,
          ticks: {
            color: axisTickColor(),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (v, i) => {
              const span = spanMsFromLabels(aprLabels);
              const lbl = (aprLabels?.[v] ?? v);
              const ts = labelToTs(lbl);
              return fmtAxisX(ts, span);
            }
          },
          grid: { color: axisGridColor() },
          border: { display:false }
        },
        y: {
          ticks: {
            color: axisTickColor(),
            callback: (v) => `${fmtSmart(v)}%`
          },
          grid: { color: axisGridColor() },
          border: { display:false }
        }
      }
    },
    plugins: [lastDotPlugin]
  });

  attachCrosshair2(aprChart, $("aprReadout"), (i, lbs, ds) => {
    const t = labelToTs(lbs?.[i]);
    const v = safe(ds?.[i]);
    return `${t ? new Date(t).toLocaleString() : "—"} • ${v.toFixed(2)}%`;
  });
}
function drawAprChart(){
  if (!aprChart) initAprChart();
  if (!aprChart) return;
  aprChart.data.labels = aprLabels;
  aprChart.data.datasets[0].data = aprData;
  aprChart.update("none");
}
function recordAprPoint(){
  if (!address) return;
  const now = Date.now();
  if ((now - lastAprPointAt) < 2500) return;
  lastAprPointAt = now;

  const v = safe(apr);
  if (!Number.isFinite(v)) return;
  const last = aprData.length ? safe(aprData[aprData.length - 1]) : null;
  if (last != null && Math.abs(v - last) < 0.01) return;

  aprLabels.push(tsLabel(now));
  aprData.push(v);

  while (aprLabels.length > 2400){ aprLabels.shift(); aprData.shift(); }

  saveAprLocal();
  drawAprChart();
}

/* === Validator card === */
const validatorCache = new Map();
async function fetchValidator(valoper){
  if (!valoper) return null;
  if (validatorCache.has(valoper)) return validatorCache.get(valoper);
  const j = await fetchLCD(`/cosmos/staking/v1beta1/validators/${valoper}`);
  const v = j?.validator || null;
  validatorCache.set(valoper, v);
  return v;
}
/* === Primary validator cache (per address) === */
let primaryValidator = { valoper:"", moniker:"", commissionRate: NaN };

async function updateValidatorFromDelegations(delegation_responses){
  const elName = $("validatorName");
  const elMeta = $("validatorMeta");
  if (!elName || !elMeta) return primaryValidator;

  const del = Array.isArray(delegation_responses) ? delegation_responses : [];
  if (!del.length){
    elName.textContent = "—";
    elMeta.textContent = "No delegations";
    primaryValidator = { valoper:"", moniker:"", commissionRate: NaN };
    return primaryValidator;
  }

  let best = del[0];
  let bestAmt = safe(best?.balance?.amount);
  for (const d of del){
    const a = safe(d?.balance?.amount);
    if (a > bestAmt){ best = d; bestAmt = a; }
  }

  const val = String(best?.delegation?.validator_address || "");
  if (!val){
    elName.textContent = "—";
    elMeta.textContent = "Validator not found";
    primaryValidator = { valoper:"", moniker:"", commissionRate: NaN };
    return primaryValidator;
  }

  // optimistic set while we fetch
  primaryValidator = { valoper: val, moniker: shortAddr(val), commissionRate: NaN };

  const v = await fetchValidator(val);
  const moniker = v?.description?.moniker || shortAddr(val);
  const commissionRate = safe(v?.commission?.commission_rates?.rate);
  const ratePct = commissionRate * 100;

  primaryValidator = { valoper: val, moniker, commissionRate };

  elName.textContent = moniker;
  elMeta.textContent = `${shortAddr(val)} • Commission ${Number.isFinite(ratePct) ? ratePct.toFixed(2) : "—"}%`;
  return primaryValidator;
}


/* === Total Asset Management (TAM) — 3 fixed addresses === */
const TAM_ADDRS = [
  "inj1cqvjau8tl4ge874crfaj6gkw55pnn6n2vmwdhv",
  "inj1ewp22h79mx9ln494nnx08laan4u2x7xyf37ceu",
  "inj19ue2rs8a8vr5q7fc7a52ee9kx8axt46wndhzv9",
];

const TAM_LOCAL_VER = 1;
const TAM_LOCAL_KEY = `inj_tam_total_v${TAM_LOCAL_VER}`;

let tamTargetInj = 0;
let tamDisplayedInj = 0;
let tamDisplayedUsd = 0;
let tamLoading = false;
let tamLastOkAt = 0;

function tamLoadLocal(){
  try{
    const raw = localStorage.getItem(TAM_LOCAL_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    const v = safe(obj?.inj);
    if (Number.isFinite(v) && v >= 0){
      tamTargetInj = v;
      if (!Number.isFinite(tamDisplayedInj) || tamDisplayedInj <= 0) tamDisplayedInj = v;
      return true;
    }
  } catch {}
  return false;
}
function tamSaveLocal(){
  try{
    localStorage.setItem(TAM_LOCAL_KEY, JSON.stringify({ v: TAM_LOCAL_VER, ts: Date.now(), inj: tamTargetInj }));
  } catch {}
}

async function tamFetchTotalsForAddr(addr){
  const a = String(addr || "").trim();
  if (!a) return null;

  const bankP = fetchLCD(`/cosmos/bank/v1beta1/balances/${a}`);
  const delP  = fetchLCD(`/cosmos/staking/v1beta1/delegations/${a}`);
  const rewP  = fetchLCD(`/cosmos/distribution/v1beta1/delegators/${a}/rewards`);
  const [b, s, r] = await Promise.all([bankP, delP, rewP]);

  if (!b || !s) return null;

  const bal = (b?.balances || []).find(x => x?.denom === "inj");
  const available = safe(bal?.amount) / 1e18;

  const del = (s?.delegation_responses || []);
  const stake = del.reduce((acc, d) => acc + safe(d?.balance?.amount), 0) / 1e18;

  let rewards = 0;
  if (r){
    rewards = (r?.rewards || []).reduce((acc, x) =>
      acc + (x?.reward || []).reduce((s2, y) => s2 + safe(y?.amount), 0)
    , 0) / 1e18;
  }

  const total = available + stake + rewards;
  return { available, stake, rewards, total };
}

async function loadTAM(isRefresh=false){
  // works in both LIVE and REFRESH; throttle by timer (REST_SYNC_MS) / manual calls.
  if (!hasInternet()) return;
  if (tamLoading) return;
  tamLoading = true;

  try{
    const settled = await Promise.allSettled(TAM_ADDRS.map(a => tamFetchTotalsForAddr(a)));

    let total = 0;
    let ok = 0;
    for (const r of settled){
      const v = (r?.status === "fulfilled") ? r.value : null;
      const t = safe(v?.total);
      if (Number.isFinite(t) && t >= 0){
        total += t;
        ok++;
      }
    }

    // Avoid under-count "drops" if one address temporarily fails:
    // - first successful baseline can be partial (better than 0)
    // - after baseline, require ALL 3 addresses to update the total
    const hasBaseline = tamLastOkAt > 0;
    const okAll = (ok === TAM_ADDRS.length);
    if (okAll || (!hasBaseline && ok > 0)){
      tamTargetInj = total;
      tamLastOkAt = Date.now();
      tamSaveLocal();
      // Record / aggregate chart series (5-min points)
      try{ maybeAddTamPoint(tamTargetInj); }catch{}
    }

  } catch (e){
    console.warn("[loadTAM]", e);
  } finally {
    tamLoading = false;
  }
}

/* === Cloud: color text where present (wrap) === */
function setCloudTextClass(el, state){
  if (!el) return;
  el.classList.remove("cloud-ok","cloud-saving","cloud-err");
  if (state === "saving") el.classList.add("cloud-saving");
  else if (state === "error") el.classList.add("cloud-err");
  else el.classList.add("cloud-ok");
}
const __cloudSetState_orig = cloudSetState;
cloudSetState = function(state){
  __cloudSetState_orig(state);
  setCloudTextClass($("cloudStatus"), state);
  setCloudTextClass($("cloudMenuStatus"), state);
  setCloudTextClass($("cloudAdvState"), state);
};

/* === RenderEvents PRO (wrap) === */
const __renderEvents_orig = renderEvents;
renderEvents = function(){
  const body = $("eventsTbody");
  const empty = $("eventsEmpty");
  const count = $("eventsCount");
  if (!body) return __renderEvents_orig();

  const { q, kind, status } = eventsGetFilters();
  const list = Array.isArray(eventsAll) ? eventsAll : [];

  const filtered = list.filter((ev) => {
    const k = String(ev?.kind || "info").toLowerCase();
    const st = String(ev?.status || "done").toLowerCase();
    if (kind !== "all" && k !== kind) return false;
    if (status !== "all" && st !== status) return false;

    if (q){
      const blob = `${ev?.title || ""} ${ev?.detail || ""} ${ev?.id || ""} ${k} ${st}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  if (count) count.textContent = String(filtered.length);

  body.innerHTML = "";
  if (empty) empty.style.display = filtered.length ? "none" : "block";
  if (!filtered.length) return;

  for (const ev of filtered){
    const tr = document.createElement("tr");

    const dt = new Date(ev.ts || Date.now());
    const when = `${dt.toLocaleDateString()} ${fmtHHMMSS(ev.ts || Date.now())}`;

    const k = String(ev.kind || "info").toUpperCase();
    const st = String(ev.status || "done").toLowerCase();

    const dir = (ev.dir === "up" || ev.dir === "down") ? ev.dir : "neu";
    const badgeClass = dir === "up" ? "up" : dir === "down" ? "down" : "neu";

    const title = ev.title || k;
    const detail = ev.detail || "";
    const id = ev.id ? String(ev.id).slice(0, 64) : "";

    tr.innerHTML = `
      <td>
        <div class="ev-title"><span class="ev-badge ${badgeClass}">${k}</span> ${title}</div>
        ${id ? `<div class="ev-id">${id}</div>` : ""}
      </td>
      <td style="white-space:nowrap">${when}</td>
      <td><div class="ev-detail">${detail}</div></td>
      <td style="white-space:nowrap">
        <span class="pill ${st === "ok" ? "ok" : st === "pending" ? "pending" : st === "err" ? "err" : "done"}">${st.toUpperCase()}</span>
      </td>
    `;
    body.appendChild(tr);
  }
};


/* ================= BOOT ================= */
(async function boot() {
  applyTheme(theme);
  applyView(viewMode);
  applyPrivacy(privacyOn);
  // TAM: load cached total instantly (offline-friendly) + fetch latest in background
  try{ tamLoadLocal(); }catch{}
  try{ tamLoadOffsetLocal(); }catch{}
  // TAM chart: load cached series + render instantly
  try{ loadTamSeriesLocal(); }catch{}
  try{ drawTamChart(); }catch{}
  try{ syncTamTimelineUI(true); }catch{}
  safeAsync(() => loadTAM(true), "loadTAM(boot)");
  // Ensure main price arrow exists + has animation styles (helps when CSS is cached on some devices)
  ensureArrowAnimCSS();
  ensurePriceDirArrow();
  updatePriceScaleBtn();
  ZOOM_OK = tryRegisterZoom();

  // Chart defaults: more "breathing room" above last points + smoother axes on all charts
  try{
    if (window.Chart && Chart.defaults){
      Chart.defaults.layout = Chart.defaults.layout || {};
      Chart.defaults.layout.padding = Chart.defaults.layout.padding || {};
      Chart.defaults.layout.padding.top = 12;

      Chart.defaults.scales = Chart.defaults.scales || {};
      if (Chart.defaults.scales.linear) Chart.defaults.scales.linear.grace = "16%";
      if (Chart.defaults.scales.logarithmic) Chart.defaults.scales.logarithmic.grace = "16%";
    }
  } catch {}


  cloudLoadMeta();
  cloudRenderMeta();
  cloudSetState("synced");
  refreshConnUI();

  bindExpandButtons();
  initTickerSpeedSettings();
  initCardFxSettings();
  initCardBorderFxSettings();
  initMarketTicker();
// Apply user card order (if saved)
  applyCardOrder(loadCardOrder());
  setAddressDisplay(address);

  wdMinFilter = safe($("rewardFilter")?.value || 0);

  if (address) {
    // ✅ reset then load current address only
    resetPerAddressStateUI();

    loadStakeSeriesLocal(); drawStakeChart();
    try{ syncStakeTimelineUI(true); }catch {}
    loadWdAllLocal(); rebuildWdView();
    loadNWLocal();
    const scaleBtn = $("nwScaleToggle");
    if (scaleBtn) scaleBtn.textContent = (nwScale === "log") ? "LOG" : "LIN";
    const liveBtn = $("nwLiveToggle");
    if (liveBtn) liveBtn.classList.toggle("active", nwTf === "live");
    drawNW(true);

    loadEvents();
  renderEvents();
  renderTargetsNow();
  loadAprLocal();
  drawAprChart();
safeAsync(() => cloudPull(), "cloudPull");
  }

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;
  

  modeLoading = true;
  refreshConnUI();
  renderSettingsSnapshot();

  try{ await loadCandleSnapshot(liveMode ? false : true); }catch(e){ console.warn("boot loadCandleSnapshot", e); }

  try{ await loadChartToday(liveMode ? false : true); }catch(e){ console.warn("boot loadChartToday", e); }

  updatePriceTFButtons();
  updatePriceTitle();
  try{ await loadPriceChart(true); }catch(e){ console.warn("boot loadPriceChart", e); }
  // ✅ Auto-load tab-scoped address (URL/session) + auto-start data load
  const savedAddr = resolveInitialAddr();
  const hasSavedAddr = !!savedAddr && isValidInjAddr(savedAddr);


  if (hasSavedAddr) {
    // Ensure globals are aligned immediately (even if commitAddress short-circuits)
    address = savedAddr;
    pendingAddress = savedAddr;
    setAddressDisplay(address);

    // Load cached locals immediately (offline-friendly)
    try{
      resetPerAddressStateUI();
      loadStakeSeriesLocal(); drawStakeChart();
      try{ syncStakeTimelineUI(true); }catch {}
      loadWdAllLocal(); rebuildWdView();
      loadNWLocal();
      const scaleBtn = $("nwScaleToggle");
      if (scaleBtn) scaleBtn.textContent = (nwScale === "log") ? "LOG" : "LIN";
      const liveBtn = $("nwLiveToggle");
      if (liveBtn) liveBtn.classList.toggle("active", nwTf === "live");
      drawNW(true);
      loadEvents(); renderEvents();
      renderTargetsNow();
      loadAprLocal(); drawAprChart();
    } catch {}

    // Now trigger remote loading automatically (both modes)
    await commitAddress(savedAddr);
  } else {
    // Price/Charts ready: don't stay stuck in Loading if no address yet
    modeLoading = false; // price ready
    refreshConnUI();
  }

  if (liveMode) {
    startTradeWS();
    startKlineWS();
    if (address) { try{ await loadAccount(); }catch(e){ console.warn("boot loadAccount", e); } }

    startAllTimers();
  } else {
    stopAllTimers();
    stopAllSockets();
    accountOnline = false;
    refreshLoaded = false;
    refreshConnUI();
    await safeAsync(() => refreshLoadAllOnce(), "refreshLoadAllOnce");
    
  }
})();

/* ================= LOOP ================= */
function updateRewardEstimatesUI(){
  const stake = safe(stakeInj);
  const aprPct = safe(apr);
  const price = safe(displayed?.price || targetPrice || 0);

  const ok = (stake > 0) && (aprPct > 0);
  const annual = ok ? (stake * (aprPct / 100)) : 0;
  const set = (injId, usdId, val) => {
    const elI = $(injId);
    const elU = $(usdId);
    if (!elI && !elU) return;
    if (!ok || !Number.isFinite(val) || val < 0) {
      if (elI) elI.textContent = "—";
      if (elU) elU.textContent = "—";
      return;
    }
    if (elI) elI.textContent = fmtTrim(val, 6);
    if (elU) elU.textContent = price ? `≈ $${(val * price).toFixed(2)}` : "—";
  };

  set("est6hInj", "est6hUsd", annual * (6 / 8760));
  set("est1dInj", "est1dUsd", annual * (1 / 365));
  set("est1wInj", "est1wUsd", annual * (7 / 365));
  set("est1mInj", "est1mUsd", annual * (30 / 365));
  set("est1yInj", "est1yUsd", annual);
}

function animate() {
  const op = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, op, 4);
  // Update market ticker numbers (smooth digits)

  // Direction arrow next to main INJ price (visible + lingers; hidden when stable)
  try{
    const el = ensurePriceDirArrow();
    if (el){
      const HOLD_MS = 1300; // keep arrow visible a bit after each price change
      const nowTs = Date.now();

      const prevTarget = Number.isFinite(+el.dataset.prevTarget) ? +el.dataset.prevTarget : safe(targetPrice);
      const nowTarget  = safe(targetPrice);
      const d = nowTarget - prevTarget;

      // store for next tick (target changes come from WS/poll)
      el.dataset.prevTarget = String(nowTarget);

      // base glyph matches perf arrows; direction is rotation + color
      el.textContent = "►";

      const lastAt  = Number.isFinite(+el.dataset.lastAt) ? +el.dataset.lastAt : 0;
      const lastDir = el.dataset.lastDir || "";

      let dir = "";
      let changed = false;

      if (d > 0) { dir = "up"; changed = true; }
      else if (d < 0) { dir = "down"; changed = true; }
      else {
        // no change this frame: keep last direction for a bit, then hide
        if (lastDir && (nowTs - lastAt) < HOLD_MS) dir = lastDir;
        else dir = "";
      }

      // apply
      el.classList.remove("up","down","pulse","hidden");

      if (!dir){
        el.classList.add("hidden"); // stable: no arrow
      } else {
        el.classList.add(dir);
        el.dataset.lastDir = dir;
        if (changed){
          el.dataset.lastAt = String(nowTs);
          // retrigger pulse animation on each change
          void el.offsetWidth;
          el.classList.add("pulse");
        }
      }
    }
  } catch {}


  // Total withdrawn rewards (USD updates with price)
  try { if (typeof updateTotalRewardAccUI === "function") updateTotalRewardAccUI(); } catch (e) { console.warn("[updateTotalRewardAccUI]", e); }

  // Fees (USD updates with price)
  try { if (typeof updateFeesUI === "function") updateFeesUI(); } catch (e) { console.warn("[updateFeesUI]", e); }

  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;
  const pY = tfReady.y ? pctChange(targetPrice, candle.y.open) : 0;

  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);
  updatePerf("arrowYear", "pctYear", pY);

  const sign = pD > 0 ? "up" : (pD < 0 ? "down" : "flat");
  applyChartColorBySign(sign);

  const dUp   = "linear-gradient(90deg, rgba(34,197,94,.55), rgba(16,185,129,.32))";
  const dDown = "linear-gradient(270deg, rgba(239,68,68,.55), rgba(248,113,113,.30))";
  const wUp   = "linear-gradient(90deg, rgba(59,130,246,.55), rgba(99,102,241,.30))";
  const wDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(59,130,246,.26))";
  const mUp   = "linear-gradient(90deg, rgba(249,115,22,.50), rgba(236,72,153,.28))";
  const mDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(236,72,153,.25))";
  const yUp   = "linear-gradient(90deg, rgba(168,85,247,.52), rgba(59,130,246,.28))";
  const yDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(168,85,247,.22))";

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, dUp, dDown);
  renderBar($("weekBar"),  $("weekLine"),  targetPrice, candle.w.open, candle.w.low, candle.w.high, wUp, wDown);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, mUp, mDown);
  renderBar($("yearBar"),  $("yearLine"),  targetPrice, candle.y.open, candle.y.low, candle.y.high, yUp, yDown);

  if (tfReady.d) {
    setText("priceMin", safe(candle.d.low).toFixed(3));
    setText("priceOpen", safe(candle.d.open).toFixed(3));
    setText("priceMax", safe(candle.d.high).toFixed(3));
  } else { setText("priceMin", "--"); setText("priceOpen", "--"); setText("priceMax", "--"); }

  if (tfReady.w) {
    setText("weekMin", safe(candle.w.low).toFixed(3));
    setText("weekOpen", safe(candle.w.open).toFixed(3));
    setText("weekMax", safe(candle.w.high).toFixed(3));
  } else { setText("weekMin", "--"); setText("weekOpen", "--"); setText("weekMax", "--"); }

  if (tfReady.m) {
    setText("monthMin", safe(candle.m.low).toFixed(3));
    setText("monthOpen", safe(candle.m.open).toFixed(3));
    setText("monthMax", safe(candle.m.high).toFixed(3));
  } else { setText("monthMin", "--"); setText("monthOpen", "--"); setText("monthMax", "--"); }

  if (tfReady.y) {
    setText("yearMin", safe(candle.y.low).toFixed(3));
    setText("yearOpen", safe(candle.y.open).toFixed(3));
    setText("yearMax", safe(candle.y.high).toFixed(3));
  } else { setText("yearMin", "--"); setText("yearOpen", "--"); setText("yearMax", "--"); }


  // Market ticker (global + INJ)
  try{ updateMarketInjTargets(); updateMarketTickerUI(); }catch{}

  // ATH / ATL blink on bars + main price when price is touching candle extremes
  try{
    const p = safe(targetPrice);
    const eps = Math.max(0.0001, p * 0.00005);
    const main = $("price");
    let anyTouch = false;

    const checks = [
      ["d", "priceMin", "priceMax"],
      ["w", "weekMin", "weekMax"],
      ["m", "monthMin", "monthMax"],
      ["y", "yearMin", "yearMax"]
    ];

    for (const [k, idMin, idMax] of checks){
      const lo = safe(candle?.[k]?.low);
      const hi = safe(candle?.[k]?.high);

      const elMin = $(idMin);
      const elMax = $(idMax);

      const touchLow  = tfReady?.[k] && Number.isFinite(lo) && (p <= lo + eps);
      const touchHigh = tfReady?.[k] && Number.isFinite(hi) && (p >= hi - eps);

      if (elMin) elMin.classList.toggle("blink-yellow", !!touchLow);
      if (elMax) elMax.classList.toggle("blink-yellow", !!touchHigh);

      if (touchLow || touchHigh) anyTouch = true;
    }

    if (main) main.classList.toggle("blink-yellow", anyTouch);
  } catch {}

  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);
  setText("availableUsd", `≈ $${(displayed.available * displayed.price).toFixed(2)}`);

  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);
  setText("stakeUsd", `≈ $${(displayed.stake * displayed.price).toFixed(2)}`);

  const stakePct = clamp((displayed.stake / Math.max(0.0001, stakeTargetMaxDyn)) * 100, 0, 100);
  const stakeBar = $("stakeBar");
  const stakeLine = $("stakeLine");
  if (stakeBar) stakeBar.style.width = stakePct + "%";
  if (stakeLine) stakeLine.style.left = stakePct + "%";
  setText("stakePercent", stakePct.toFixed(1) + "%");
  setText("stakeMin", "0");
  setText("stakeMax", String(stakeTargetMaxDyn));

  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);
  setText("rewardsUsd", `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`);

  const autoMaxR = Math.max(0.1, Math.ceil(displayed.rewards * 10) / 10);
  const maxR = Math.max(autoMaxR, safe(rewardTargetMaxDyn) || 1);
  const rp = clamp((displayed.rewards / Math.max(0.0001, maxR)) * 100, 0, 100);

  const rewardBar = $("rewardBar");
  const rewardLine = $("rewardLine");
  if (rewardBar) rewardBar.style.width = rp + "%";
  if (rewardLine) rewardLine.style.left = rp + "%";
  setText("rewardPercent", rp.toFixed(1) + "%");
  setText("rewardMin", "0");
  setText("rewardMax", fmtSmart(maxR));

  const oapr = displayed.apr;
  displayed.apr = tick(displayed.apr, apr);
  colorNumber($("apr"), displayed.apr, oapr, 2);
  try{ updateRewardEstimatesUI(); }catch{}

  setText("updated", "Last update: " + nowLabel());

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(displayed.price);

  const onw = displayed.netWorthUsd;
  displayed.netWorthUsd = tick(displayed.netWorthUsd, totalUsd);
  colorMoney($("netWorthUsd"), displayed.netWorthUsd, onw, 2);

  drawNW(false);
  updateNetWorthMiniRows();

  // Total Asset Management (global: 3 addresses)
  try{
    const tInj = safe(tamTargetInj);
    const oInj = safe(tamDisplayedInj);
    tamDisplayedInj = tick(oInj, tInj);
    colorNumber($("tamInj"), tamDisplayedInj, oInj, 4);

    const tUsd = tInj * safe(displayed.price);
    const oUsd = safe(tamDisplayedUsd);
    tamDisplayedUsd = tick(oUsd, tUsd);
    colorMoney($("tamUsd"), tamDisplayedUsd, oUsd, 2);
  } catch {}

  if (address && liveMode) recordNetWorthPoint();
    try { ensureDailyPerfEvent(); } catch {}
  if (cloudDirty && hasInternet()) scheduleCloudPush();

  refreshConnUI();

  requestAnimationFrame(animate);
}
animate();


/* ===== Cloud Sync Settings (UI) ===== */
(function(){
  function setPill(state, text){
    const pill = document.getElementById("cloudSettingsStatus");
    const last = document.getElementById("cloudSettingsLast");
    if(pill){
      pill.classList.remove("online","loading","offline");
      pill.classList.add(state);
      pill.textContent = text || (state==="loading"?"Loading":state==="offline"?"Offline":"Online");
    }
    if(last){
      if(state==="loading") last.textContent = "Syncing…";
      else if(state==="offline") last.textContent = "—";
      else last.textContent = "Last: " + (typeof nowLabel==="function"?nowLabel():"");
    }
  }

  function cfgKey(a){ return "inj_cloud_cfg__" + String(a||"").trim().toLowerCase(); }
  function loadCfg(a){
    try{
      const raw = localStorage.getItem(cfgKey(a));
      if(!raw) return { enabled:true, leader:false };
      const c = JSON.parse(raw);
      return { enabled: typeof c.enabled==="boolean"?c.enabled:true, leader: typeof c.leader==="boolean"?c.leader:false };
    }catch(_){ return { enabled:true, leader:false }; }
  }
  function saveCfg(a,c){
    try{ localStorage.setItem(cfgKey(a), JSON.stringify({ ...c, ts: Date.now() })); }catch(_){}
  }

  async function forceSync(){
    if(typeof forceCloudSyncNow==="function") return forceCloudSyncNow();
    // fallback: trigger cloudPull + cloudPush if available
    try{ await cloudPull(); }catch(_){}
    try{ cloudDirty = true; await cloudPush(); }catch(_){}
  }

  function wire(){
    const a = (typeof address==="string" && address) ? address : (document.getElementById("addressInput")?.value || "");
    const cfg = loadCfg(a);

    const t = document.getElementById("cloudSyncToggle");
    const l = document.getElementById("cloudLeaderToggle");
    const f = document.getElementById("cloudForceSync");

    if(t){
      t.textContent = cfg.enabled ? "ON" : "OFF";
      t.classList.toggle("primary", cfg.enabled);
      t.onclick = ()=>{ const a2=(typeof address==="string" && address)?address:(document.getElementById("addressInput")?.value||"");
        const c2 = loadCfg(a2); c2.enabled=!c2.enabled; saveCfg(a2,c2); wire(); setPill(c2.enabled?"online":"offline", c2.enabled?"Online":"Disabled"); };
    }
    if(l){
      l.textContent = cfg.leader ? "ON" : "OFF";
      l.classList.toggle("primary", cfg.leader);
      l.onclick = ()=>{ const a2=(typeof address==="string" && address)?address:(document.getElementById("addressInput")?.value||"");
        const c2 = loadCfg(a2); c2.leader=!c2.leader; saveCfg(a2,c2); wire(); };
    }
    if(f){ f.onclick = forceSync; }

    setPill(cfg.enabled?"online":"offline", cfg.enabled?"Online":"Disabled");
  }

  document.addEventListener("DOMContentLoaded", wire);
  document.addEventListener("click", (e)=>{
    const el = e.target?.closest?.('[data-page="settings"]');
    if(el) setTimeout(wire, 0);
  });
})();


/* UI patch: card icons and LIN/LOG controls removed in HTML/CSS */
