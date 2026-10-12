"use strict";

const APP_VERSION = "v12"; // keep in step with VERSION in sw.js

const STORE_KEY = "daily-tracker:v1";
const DEFAULT_SLOTS = [
  ["7AM", "Breakfast"],
  ["10AM", "Snack"],
  ["12 noon", "Lunch"],
  ["2PM", "Snack"],
  ["7PM", "Dinner"],
  ["9PM", ""],
];
const SLOT_FIELDS = ["nutrition", "activity", "feel"];


// ---------- storage ----------
// Older entries had two "How I feel" notes per time slot (after eating and after
// activity). They're now one; merge both into it so nothing typed is lost.
function normalizeDay(d) {
  for (const s of d.slots || []) {
    if ("nutFeel" in s || "actFeel" in s) {
      s.feel = [s.feel, s.nutFeel, s.actFeel].filter(Boolean).join("\n");
      delete s.nutFeel; delete s.actFeel;
    }
  }
  return d;
}
function loadAll() {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    Object.values(all).forEach(normalizeDay);
    return all;
  } catch { return {}; }
}
let db = loadAll();
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); flashSaved(); }
  catch { flashSaved("Couldn't save — storage unavailable"); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

function blankDay() {
  return {
    morning: null, evening: null, water: 0,
    slots: DEFAULT_SLOTS.map(([time, meal]) => ({ time, meal, nutrition: "", activity: "", feel: "" })),
    worked: "", didnt: "", focus: "",
  };
}
function isEmpty(d) {
  return d.morning == null && d.evening == null && !d.water && !d.worked && !d.didnt && !d.focus &&
    d.slots.every((s) => SLOT_FIELDS.every((f) => !s[f]));
}

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const dateOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const todayIso = () => isoOf(new Date());
const shiftIso = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const fmtLong = (iso) => dateOf(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
const fmtShort = (iso) => dateOf(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

// ---------- state ----------
let current = todayIso();
let day = db[current] ? structuredClone(db[current]) : blankDay();

function save() {
  if (isEmpty(day)) delete db[current]; else db[current] = structuredClone(day);
  persist();
}

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let savedTimer;
function flashSaved(msg = "Saved on this device ✓") {
  const el = $("#saved"); el.textContent = msg;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = "Saved on this device"; }, 1500);
}

// In-page replacement for confirm()/alert(). Resolves true when OK is pressed.
// With no okLabel it's a plain notice with a single OK button.
function ask(message, okLabel) {
  const dlg = $("#askDlg");
  $("#askMsg").textContent = message;
  $("#askOk").textContent = okLabel || "OK";
  $("#askCancel").hidden = !okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

// ---------- day view ----------
function buildScales() {
  $$(".scale").forEach((sc) => {
    sc.innerHTML = "";
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = i; b.setAttribute("role", "radio"); b.dataset.v = i;
      b.addEventListener("click", () => {
        const f = sc.dataset.field;
        day[f] = day[f] === i ? null : i; // tap again to clear
        renderScales(); save();
      });
      sc.appendChild(b);
    }
  });
}
function renderScales() {
  $$(".scale").forEach((sc) => {
    const v = day[sc.dataset.field];
    $$("button", sc).forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.v) === v)));
  });
}

function renderWater() {
  const n = day.water || 0;
  $("#glasses").innerHTML = (n ? "💧".repeat(Math.min(n, 12)) : "") +
    `<span class="count">${n} glass${n === 1 ? "" : "es"}</span>`;
}

const SLOT_CELLS = [
  ["nutrition", "nut", "Nutrition"],
  ["activity", "act", "Rest / movement / activities"],
  ["feel", "feel", "How I feel"],
];
const REVIEW_LABELS = {
  worked: "Things that worked well?",
  didnt: "Things that didn't work well?",
  focus: "My main focus for tomorrow is:",
};

// A tappable box that shows a note's text and opens the editor.
function noteButton(cls, label, value) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `note ${cls}`;
  b.innerHTML = `<span class="lbl">${esc(label)}</span><span class="val"></span>`;
  setNoteText(b, value);
  return b;
}
function setNoteText(b, value) {
  const v = $(".val", b);
  v.textContent = value || "Tap to add";
  v.classList.toggle("empty", !value);
}

// Full-screen-ish editor for one note. Saves as you type.
let editorTarget = null;
function openEditor(context, label, value, onChange) {
  editorTarget = onChange;
  $("#editContext").textContent = context;
  $("#editLabel").textContent = label;
  const ta = $("#editText");
  ta.value = value || "";
  $("#editDlg").showModal();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ---------- dictation ----------
// Chrome's built-in speech recognition (audio goes to Google, so it needs a
// connection). One tap = one stretch of speech, added to the end of the note;
// it stops by itself after a pause. Continuous mode repeats words on Android.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

function setMicState(state) {
  const b = $("#micBtn");
  b.dataset.state = state;
  b.setAttribute("aria-pressed", String(state === "listening"));
  $("#micLabel").textContent = state === "listening" ? "Listening… tap to stop" : state === "starting" ? "Starting…" : "Speak";
}

function joinSpoken(base, spoken) {
  spoken = spoken.trim();
  if (!spoken) return base;
  const startSentence = !base.trim() || /[.!?]\s*$|\n\s*$/.test(base);
  if (startSentence) spoken = spoken[0].toUpperCase() + spoken.slice(1);
  const sep = !base || /\s$/.test(base) ? "" : " ";
  return base + sep + spoken;
}

function stopDictation() {
  if (rec) { rec.onresult = rec.onerror = null; try { rec.abort(); } catch {} rec = null; }
  setMicState("idle");
}

function startDictation() {
  const ta = $("#editText");
  const base = ta.value;
  rec = new SpeechRec();
  rec.lang = navigator.language || "en-GB";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onstart = () => setMicState("listening");
  rec.onresult = (e) => {
    let spoken = "";
    for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
    ta.value = joinSpoken(base, spoken);
    ta.scrollTop = ta.scrollHeight;
    editorTarget?.(ta.value);
  };
  rec.onerror = (e) => {
    const msg = {
      "not-allowed": "Microphone access is blocked. Allow the microphone for this app in your phone's settings (or Chrome's site settings), then try again.",
      "service-not-allowed": "Microphone access is blocked. Allow the microphone for this app in your phone's settings (or Chrome's site settings), then try again.",
      "network": "Speech-to-text needs an internet connection. Try again when you're online, or use your keyboard's microphone instead.",
      "audio-capture": "No microphone was found.",
    }[e.error];
    stopDictation();
    if (msg) ask(msg);
  };
  rec.onend = () => { rec = null; setMicState("idle"); };
  setMicState("starting");
  try { rec.start(); } catch { stopDictation(); }
}

function renderSlots() {
  const wrap = $("#slots");
  wrap.innerHTML = "";
  day.slots.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "card slot";
    card.innerHTML = `
      <div class="slot-head"><span class="time">${esc(s.time)}</span><span class="meal">${esc(s.meal)}</span></div>
      <div class="cells"></div>`;
    const cells = $(".cells", card);
    SLOT_CELLS.forEach(([key, cls, label]) => {
      const b = noteButton(cls, label, s[key]);
      b.addEventListener("click", () => {
        const context = [s.time, s.meal].filter(Boolean).join(" · ");
        openEditor(context, label, s[key], (text) => { s[key] = text; setNoteText(b, text); save(); });
      });
      cells.appendChild(b);
    });
    wrap.appendChild(card);
  });
}

function renderReview() {
  const wrap = $("#review");
  wrap.innerHTML = "";
  for (const [key, label] of Object.entries(REVIEW_LABELS)) {
    const b = noteButton("field", label, day[key]);
    b.addEventListener("click", () => openEditor("Review", label, day[key], (text) => { day[key] = text; setNoteText(b, text); save(); }));
    wrap.appendChild(b);
  }
}

function renderDay() {
  const t = todayIso();
  $("#dateLabel").textContent = current === t ? `Today · ${fmtLong(current)}` : fmtLong(current);
  $("#dateInput").value = current;
  $("#todayBtn").hidden = current === t;
  renderScales();
  renderWater();
  renderSlots();
  renderReview();
}

function goTo(iso) {
  current = iso;
  day = db[current] ? structuredClone(db[current]) : blankDay();
  renderDay();
  window.scrollTo({ top: 0 });
}

// ---------- history ----------
function renderChart() {
  const W = 340, H = 170, L = 24, R = 8, T = 10, B = 26;
  const days = []; for (let i = 13; i >= 0; i--) days.push(shiftIso(todayIso(), -i));
  const x = (i) => L + (i * (W - L - R)) / 13;
  const y = (v) => T + ((10 - v) * (H - T - B)) / 9;
  let g = "";
  for (const v of [1, 4, 7, 10]) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>` +
      `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${v}</text>`;
  }
  days.forEach((d, i) => {
    if (i % 2 === 0 || i === 13) {
      g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${dateOf(d).getDate()}</text>`;
    }
  });
  for (const [key, color] of [["morning", "var(--am)"], ["evening", "var(--pm)"]]) {
    let prev = null;
    days.forEach((d, i) => {
      const v = db[d]?.[key];
      if (v == null) { prev = null; return; }
      if (prev) g += `<line x1="${x(prev[0])}" y1="${y(prev[1])}" x2="${x(i)}" y2="${y(v)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
      g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${color}"><title>${fmtShort(d)}: ${v}</title></circle>`;
      prev = [i, v];
    });
  }
  const any = days.some((d) => db[d]?.morning != null || db[d]?.evening != null);
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Energy ratings over the last 14 days">${g}</svg>` +
    (any ? "" : `<p class="muted small">Rate your energy on the Day tab and it will show up here.</p>`);
}

function renderHistory() {
  renderChart();
  const list = $("#dayList");
  const dates = Object.keys(db).sort().reverse();
  list.innerHTML = dates.length ? "" : `<li class="muted">No days logged yet.</li>`;
  for (const d of dates) {
    const e = db[d];
    const li = document.createElement("li");
    li.innerHTML = `<button type="button"><span>${esc(fmtShort(d))}</span>
      <span class="scores">☀ ${e.morning ?? "–"} · ☾ ${e.evening ?? "–"} · 💧${e.water || 0}</span></button>`;
    $("button", li).addEventListener("click", () => { goTo(d); showView("day"); });
    list.appendChild(li);
  }
}

function download(name, data, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportJson() {
  download(`daily-tracker-${todayIso()}.json`, JSON.stringify({ app: "daily-tracker", version: 1, days: db }, null, 2), "application/json");
}
function exportCsv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["date", "morning", "evening", "water", "time", "meal", "nutrition", "activity", "how_i_feel", "worked_well", "didnt_work", "focus_tomorrow"]];
  for (const d of Object.keys(db).sort()) {
    const e = db[d];
    const slots = e.slots.length ? e.slots : [{}];
    slots.forEach((s, i) => rows.push([d, e.morning, e.evening, e.water, s.time, s.meal, s.nutrition, s.activity, s.feel,
      i ? "" : e.worked, i ? "" : e.didnt, i ? "" : e.focus]));
  }
  download(`daily-tracker-${todayIso()}.csv`, rows.map((r) => r.map(q).join(",")).join("\r\n"), "text/csv");
}
async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const days = data && data.days;
    if (!days || typeof days !== "object") throw new Error("not a tracker backup");
    const n = Object.keys(days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).length;
    if (!(await ask(`Import ${n} day(s)? Days that already exist on this phone will be replaced by the backup's version.`, "Import"))) return;
    for (const [k, v] of Object.entries(days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && Array.isArray(v.slots)) db[k] = normalizeDay({ ...blankDay(), ...v });
    }
    persist(); goTo(current); renderHistory();
    ask("Backup imported.");
  } catch (err) {
    ask(`Couldn't import that file: ${err.message}`);
  }
}

// ---------- PDF export ----------
let pdfLibLoading;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error(`couldn't load ${src}`));
    document.head.appendChild(el);
  });
}
function loadPdfLib() {
  pdfLibLoading ||= loadScript("vendor/pdf-lib.min.js").then(() => loadScript("pdf-export.js"))
    .catch((err) => { pdfLibLoading = null; throw err; });
  return pdfLibLoading;
}
const pdfFmt = {
  weekday: (iso) => dateOf(iso).toLocaleDateString(undefined, { weekday: "long" }),
  date: (iso) => dateOf(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
  short: (iso) => dateOf(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  row: (iso) => dateOf(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
};

async function exportPdf(days, name, btn, opts = {}) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Making PDF…";
  try {
    await loadPdfLib();
    const bytes = await window.buildTrackerPdf(days, pdfFmt, opts);
    const file = new File([bytes], name, { type: "application/pdf" });
    download(name, file);
  } catch (err) {
    ask(`Couldn't make the PDF: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

// Every logged day, plus a summary page when there's more than one.
function exportPdfAll() {
  const days = Object.keys(db).sort().map((iso) => ({ iso, entry: db[iso] }));
  if (!days.length) { ask("Nothing is logged yet. Fill in a day on the Day tab first."); return; }
  const from = days[0].iso, to = days[days.length - 1].iso;
  const name = from === to ? `daily-tracker-${from}.pdf` : `daily-tracker-${from}-to-${to}.pdf`;
  exportPdf(days, name, $("#pdfAll"), { summary: days.length > 1 });
}

// ---------- views ----------
function showView(name) {
  $$(".view").forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "history") renderHistory();
  window.scrollTo({ top: 0 });
}

// ---------- wiring ----------
buildScales();
$("#prevDay").addEventListener("click", () => goTo(shiftIso(current, -1)));
$("#nextDay").addEventListener("click", () => goTo(shiftIso(current, 1)));
$("#todayBtn").addEventListener("click", () => goTo(todayIso()));
$("#dateInput").addEventListener("change", (e) => { if (e.target.value) goTo(e.target.value); });
$$("[data-water]").forEach((b) => b.addEventListener("click", () => {
  day.water = Math.max(0, (day.water || 0) + Number(b.dataset.water)); renderWater(); save();
}));
$("#editText").addEventListener("input", (e) => editorTarget?.(e.target.value));
$("#editDlg").addEventListener("close", () => { stopDictation(); editorTarget = null; });
$("#micBtn").hidden = !SpeechRec;
$("#micBtn").addEventListener("click", () => (rec ? rec.stop() : startDictation()));
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
$("#exportJson").addEventListener("click", exportJson);
$("#exportCsv").addEventListener("click", exportCsv);
$("#pdfAll").addEventListener("click", exportPdfAll);
// A day with nothing filled in still exports, as a blank sheet to print and fill by hand.
$("#pdfDay").addEventListener("click", () => exportPdf([{ iso: current, entry: day }], `daily-tracker-${current}.pdf`, $("#pdfDay")));
$("#importFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ""; });

// Pick up edits made in another tab/window, and roll over to the new day if the app was left open.
window.addEventListener("storage", (e) => { if (e.key === STORE_KEY) { db = loadAll(); goTo(current); } });
let lastToday = todayIso();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const t = todayIso();
  if (t !== lastToday) { if (current === lastToday) goTo(t); lastToday = t; renderDay(); }
});

renderDay();
$("#appVersion").textContent = APP_VERSION;

// ---------- install / offline ----------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredPrompt = e; $("#installBtn").hidden = false;
});
$("#installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $("#installBtn").hidden = true;
});
window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  // When an updated version takes over this page, reload once so it shows straight away.
  // Skipped on the very first install (no previous controller) and while editing a note.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded || $("#editDlg").open) return;
    reloaded = true;
    location.reload();
  });
}
