// ============================================================
// N5 單字學習系統 v4
// - 平假名 / 中文 分開按鈕顯示
// - 不自動發音，使用者點按鈕才發音
// - 白板功能
// ============================================================

let sessionWords = [];
let remainQueue = [];
let unknownList = [];
let current = null;
let isFlipped = false;
let showReading = false; // 是否顯示假名
let showMeaning = false; // 是否顯示中文
let selectedCount = 15;

let sesKnown = 0;
let sesUnknown = 0;
let sesStreak = 0;
let sesMaxStreak = 0;

let gStats = JSON.parse(
  localStorage.getItem("n5_gstats") || '{"known":0,"unknown":0,"total":0}',
);

// ── 語音 ──
let ttsEnabled = true;
let ttsVoice = null;
let ttsRate = 0.85;

function initTTS() {
  if (!window.speechSynthesis) return;
  const load = () => {
    const voices = speechSynthesis.getVoices();
    ttsVoice =
      voices.find((v) => v.lang === "ja-JP" && v.localService) ||
      voices.find((v) => v.lang === "ja-JP") ||
      voices.find((v) => v.lang.startsWith("ja")) ||
      null;
    const sel = document.getElementById("voiceSelect");
    if (!sel) return;
    const ja = voices.filter((v) => v.lang.startsWith("ja"));
    sel.innerHTML = ja.length
      ? ja.map((v, i) => `<option value="${i}">${v.name}</option>`).join("")
      : "<option>（無日文語音）</option>";
  };
  load();
  speechSynthesis.onvoiceschanged = load;
}

function speak(text) {
  if (!ttsEnabled || !window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "ja-JP";
  utt.rate = ttsRate;
  utt.volume = 1.0; // 最大音量
  if (ttsVoice) utt.voice = ttsVoice;
  speechSynthesis.speak(utt);
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById("btnTTS");
  btn.classList.toggle("tts-off", !ttsEnabled);
  btn.textContent = ttsEnabled ? "🔊" : "🔇";
}

function onVoiceChange(sel) {
  const ja = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("ja"));
  ttsVoice = ja[parseInt(sel.value)] || null;
}

function onRateChange(val) {
  ttsRate = parseFloat(val);
  document.getElementById("rateLabel").textContent =
    parseFloat(val).toFixed(1) + "x";
}

// 朗讀單字（使用者手動觸發）
function speakWord() {
  if (!current) return;
  speak(current.word);
  flashBtn("btnSpeakWord");
}

// 朗讀假名（使用者手動觸發）
function speakReading() {
  if (!current) return;
  speak(current.hiragana);
  flashBtn("btnSpeakReading");
}

function flashBtn(id) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.add("speaking");
  setTimeout(() => btn.classList.remove("speaking"), 600);
}

// ── 選擇數量 ──
function pickCount(el) {
  document
    .querySelectorAll(".cnt")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  selectedCount = parseInt(el.dataset.n);
}

// ── 開始學習 ──
function startLearning() {
  showScreen("screenStudy");
  document.getElementById("ttsBar").style.display = "flex";
  resetSession();

  fetch(`/daily/${selectedCount}`)
    .then((r) => r.json())
    .then((data) => {
      sessionWords = data;
      remainQueue = [...data];
      unknownList = [];
      nextCard();
    })
    .catch(() => alert("載入失敗，請確認 Flask 伺服器是否運行中"));
}

function resetSession() {
  sesKnown = sesUnknown = sesStreak = sesMaxStreak = 0;
  updateStatsBar();
  updateStreakDisplay();
}

// ── 下一張 ──
function nextCard() {
  if (remainQueue.length === 0) {
    showComplete();
    return;
  }
  current = remainQueue.shift();
  showReading = false;
  showMeaning = false;
  renderCard(current);
  updateProgress();
  updateQueueInfo();
  clearWhiteboard(); // 換題自動清白板
}

// ── 渲染卡片 ──
function renderCard(w) {
  document.getElementById("frontWord").textContent = w.word;
  document.getElementById("frontNum").textContent =
    `${remainQueue.length} 張剩餘`;

  // 重置顯示狀態
  updateRevealUI();
  setActionBtns(false);
}

// 更新「顯示假名」「顯示中文」的 UI 狀態
function updateRevealUI() {
  // 假名區域
  const readingEl = document.getElementById("revealReading");
  const meaningEl = document.getElementById("revealMeaning");
  const btnR = document.getElementById("btnRevealReading");
  const btnM = document.getElementById("btnRevealMeaning");

  if (showReading) {
    readingEl.textContent = current ? current.hiragana : "";
    readingEl.classList.add("visible");
    btnR.classList.add("revealed");
    btnR.textContent = "🔊 " + (current ? current.hiragana : "");
  } else {
    readingEl.textContent = "";
    readingEl.classList.remove("visible");
    btnR.classList.remove("revealed");
    btnR.textContent = "👁 顯示假名";
  }

  if (showMeaning) {
    meaningEl.textContent = current ? current.meaning : "";
    meaningEl.classList.add("visible");
    btnM.classList.add("revealed");
    btnM.textContent = "✓ " + (current ? current.meaning : "");
  } else {
    meaningEl.textContent = "";
    meaningEl.classList.remove("visible");
    btnM.classList.remove("revealed");
    btnM.textContent = "👁 顯示中文";
  }

  // 兩個都顯示了才能按判斷按鈕
  const bothRevealed = showReading && showMeaning;
  setActionBtns(bothRevealed);
}

// 點「顯示假名」
function revealReading() {
  showReading = true;
  speakReading(); // 點了就自動唸假名
  updateRevealUI();
}

// 點「顯示中文」
function revealMeaning() {
  showMeaning = true;
  updateRevealUI();
}

// ── 記住了 ──
function markKnown() {
  sesKnown++;
  sesStreak++;
  sesMaxStreak = Math.max(sesMaxStreak, sesStreak);
  gStats.known++;
  gStats.total++;
  saveGStats();
  animCard("anim-pop", "anim-glow-green");
  updateStatsBar();
  updateStreakDisplay();
  setTimeout(() => nextCard(), 280);
}

// ── 還不會 ──
function markUnknown() {
  sesUnknown++;
  sesStreak = 0;
  gStats.unknown++;
  gStats.total++;
  saveGStats();
  unknownList.push(current);
  animCard("anim-shake", "anim-glow-red");
  updateStatsBar();
  updateStreakDisplay();
  setTimeout(() => nextCard(), 320);
}

// ── 只練還不會 ──
function retryUnknown() {
  if (unknownList.length === 0) return;
  sessionWords = [...unknownList];
  remainQueue = [...unknownList];
  unknownList = [];
  showScreen("screenStudy");
  document.getElementById("ttsBar").style.display = "flex";
  resetSession();
  nextCard();
}

function backToSetup() {
  document.getElementById("ttsBar").style.display = "none";
  showScreen("screenSetup");
}

// ── 結束 ──
function showComplete() {
  saveGStats();
  showScreen("screenComplete");
  const total = sesKnown + sesUnknown;
  const rate = total > 0 ? Math.round((sesKnown / total) * 100) : 0;
  document.getElementById("resKnown").textContent = sesKnown;
  document.getElementById("resUnknown").textContent = sesUnknown;
  document.getElementById("resStreak").textContent = sesMaxStreak;
  document.getElementById("resRate").textContent = rate + "%";
  document.getElementById("completeSub").textContent =
    `共練習 ${total} 次，正確率 ${rate}%`;
  document.getElementById("btnRetry").style.display =
    unknownList.length > 0 ? "" : "none";
  document.getElementById("unknownCount").textContent =
    unknownList.length > 0 ? `（${unknownList.length} 個）` : "";
}

// ── Progress ──
function updateProgress() {
  const total = sessionWords.length;
  const pct = total > 0 ? Math.min((sesKnown / total) * 100, 100) : 0;
  document.getElementById("progFill").style.width = pct + "%";
  document.getElementById("progLabel").textContent = `${sesKnown} / ${total}`;
}

function updateQueueInfo() {
  document.getElementById("queueInfo").textContent =
    `剩餘 ${remainQueue.length} 張`;
  document.getElementById("tagUnknown").textContent =
    `⚠ 待複習 ${unknownList.length}`;
  document.getElementById("tagDone").textContent = `✓ 完成 ${sesKnown}`;
}

function updateStatsBar() {
  const total = sesKnown + sesUnknown;
  const rate = total > 0 ? Math.round((sesKnown / total) * 100) + "%" : "—";
  document.getElementById("statKnown").textContent = sesKnown;
  document.getElementById("statUnknown").textContent = sesUnknown;
  document.getElementById("statTotal").textContent = gStats.total;
  document.getElementById("statRate").textContent = rate;
}

function updateStreakDisplay() {
  const el = document.getElementById("streakDisplay");
  if (sesStreak >= 3) {
    el.style.display = "flex";
    document.getElementById("streakCount").textContent = sesStreak;
  } else {
    el.style.display = "none";
  }
}

function setActionBtns(enabled) {
  document.getElementById("btnKnown").disabled = !enabled;
  document.getElementById("btnUnknown").disabled = !enabled;
}

function showScreen(id) {
  ["screenSetup", "screenStudy", "screenComplete"].forEach((s) => {
    document.getElementById(s).style.display = s === id ? "block" : "none";
  });
}

function animCard(...classes) {
  const scene = document.querySelector(".card-scene");
  scene.classList.remove(...classes);
  void scene.offsetWidth;
  scene.classList.add(...classes);
  setTimeout(() => scene.classList.remove(...classes), 600);
}

function saveGStats() {
  localStorage.setItem("n5_gstats", JSON.stringify(gStats));
}

// ══════════════════════════════════════════
// 白板功能
// ══════════════════════════════════════════
let isDrawing = false;
let wbCtx = null;
let lastX = 0,
  lastY = 0;
let wbColor = "#e4e4ef";
let wbSize = 4;
let wbMode = "draw"; // 'draw' | 'erase'

function initWhiteboard() {
  const canvas = document.getElementById("wbCanvas");
  if (!canvas) return;

  // 強制設定 canvas 像素尺寸
  function syncSize() {
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const w = rect.width || wrap.offsetWidth || 300;
    const h = rect.height || wrap.offsetHeight || 340;
    if (canvas.width !== Math.floor(w) || canvas.height !== Math.floor(h)) {
      // 備份內容
      let imgData = null;
      if (wbCtx && canvas.width > 0 && canvas.height > 0) {
        try {
          imgData = wbCtx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (e) {}
      }
      canvas.width = Math.floor(w);
      canvas.height = Math.floor(h);
      if (imgData && wbCtx) {
        try {
          wbCtx.putImageData(imgData, 0, 0);
        } catch (e) {}
      }
    }
  }

  wbCtx = canvas.getContext("2d");
  syncSize();

  // Mouse
  canvas.addEventListener("mousedown", wbStart);
  canvas.addEventListener("mousemove", wbDraw);
  canvas.addEventListener("mouseup", wbEnd);
  canvas.addEventListener("mouseleave", wbEnd);

  // Touch
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      wbStart(e.touches[0]);
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      wbDraw(e.touches[0]);
    },
    { passive: false },
  );
  canvas.addEventListener("touchend", wbEnd);

  window.addEventListener("resize", syncSize);
}

function resizeCanvas() {} // 保留空函數避免舊呼叫報錯

function getPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function wbStart(e) {
  isDrawing = true;
  const canvas = document.getElementById("wbCanvas");
  const pos = getPos(e, canvas);
  lastX = pos.x;
  lastY = pos.y;
  wbCtx.beginPath();
  wbCtx.arc(
    lastX,
    lastY,
    (wbMode === "erase" ? wbSize * 3 : wbSize) / 2,
    0,
    Math.PI * 2,
  );
  wbCtx.fillStyle = wbMode === "erase" ? "rgba(0,0,0,0)" : wbColor;
  if (wbMode === "erase") {
    wbCtx.globalCompositeOperation = "destination-out";
    wbCtx.fill();
    wbCtx.globalCompositeOperation = "source-over";
  } else {
    wbCtx.fill();
  }
}

function wbDraw(e) {
  if (!isDrawing) return;
  const canvas = document.getElementById("wbCanvas");
  const pos = getPos(e, canvas);

  wbCtx.lineWidth = wbMode === "erase" ? wbSize * 5 : wbSize;
  wbCtx.lineCap = "round";
  wbCtx.lineJoin = "round";
  wbCtx.strokeStyle = wbColor;

  if (wbMode === "erase") {
    wbCtx.globalCompositeOperation = "destination-out";
  } else {
    wbCtx.globalCompositeOperation = "source-over";
    wbCtx.strokeStyle = wbColor;
  }

  wbCtx.beginPath();
  wbCtx.moveTo(lastX, lastY);
  wbCtx.lineTo(pos.x, pos.y);
  wbCtx.stroke();

  wbCtx.globalCompositeOperation = "source-over";
  lastX = pos.x;
  lastY = pos.y;
}

function wbEnd() {
  isDrawing = false;
}

function clearWhiteboard() {
  if (!wbCtx) return;
  const canvas = document.getElementById("wbCanvas");
  wbCtx.clearRect(0, 0, canvas.width, canvas.height);
}

function setWbColor(color) {
  wbColor = color;
  wbMode = "draw";
  document
    .querySelectorAll(".wb-color")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`.wb-color[data-color="${color}"]`)
    ?.classList.add("active");
  document.getElementById("btnErase").classList.remove("active");
}

function setWbSize(size) {
  wbSize = parseInt(size);
  document.getElementById("wbSizeLabel").textContent = size + "px";
}

function toggleErase() {
  wbMode = wbMode === "erase" ? "draw" : "erase";
  document
    .getElementById("btnErase")
    .classList.toggle("active", wbMode === "erase");
}

// ── 初始化 ──
updateStatsBar();
initTTS();

// 白板在進入學習頁面後才初始化（確保 DOM 已有尺寸）
const _origStart = startLearning;
startLearning = function () {
  _origStart();
  // 等畫面顯示後再初始化白板
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      initWhiteboard();
    });
  });
};
