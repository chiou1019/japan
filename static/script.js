// ============================================================
// N5 單字學習系統 v3 — 修正版
//
// 核心邏輯：
//   - 每次練習只練「今天選的 N 個單字」，練完就結束
//   - 記住了 → 當天不再出現（從 session 移除）
//   - 還不會 → 暫存到 unknownList，本次 session 不再出現
//             下次開始練習時才會重新加入
//   - session 結束條件：所有單字都按過「記住了」
// ============================================================

// ── 狀態 ──
let sessionWords = []; // 本次要練習的單字（固定 N 個）
let remainQueue = []; // 還沒練到的（記住了就移除）
let unknownList = []; // 點了「還不會」的（本次不再出現）
let current = null;
let isFlipped = false;
let selectedCount = 15;

// Session 統計
let sesKnown = 0;
let sesUnknown = 0;
let sesStreak = 0;
let sesMaxStreak = 0;

// 全域累積
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
  if (ttsVoice) utt.voice = ttsVoice;
  speechSynthesis.speak(utt);
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById("btnTTS");
  btn.classList.toggle("tts-off", !ttsEnabled);
  btn.title = ttsEnabled ? "語音：開" : "語音：關";
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
      remainQueue = [...data]; // 全部放入隊列
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
  // ✅ 結束條件：remainQueue 空了 = 全部記住
  if (remainQueue.length === 0) {
    showComplete();
    return;
  }

  // 從 remainQueue 取出第一張
  current = remainQueue.shift();
  renderCard(current);
  updateProgress();
  updateQueueInfo();

  if (ttsEnabled) speak(current.word);
}

// ── 渲染卡片 ──
function renderCard(w) {
  isFlipped = false;
  document.getElementById("card").classList.remove("flipped");
  document.getElementById("frontWord").textContent = w.word;
  document.getElementById("backReading").textContent = w.hiragana;
  document.getElementById("backMeaning").textContent = w.meaning;
  document.getElementById("backEcho").textContent = w.word;
  document.getElementById("frontNum").textContent =
    `${remainQueue.length} 張剩餘`;
  setActionBtns(false);
  document.getElementById("btnPeek").classList.remove("hidden");
}

// ── 翻面 ──
function flipCard() {
  if (!current) return;
  isFlipped = !isFlipped;
  document.getElementById("card").classList.toggle("flipped", isFlipped);
  if (isFlipped) {
    setActionBtns(true);
    document.getElementById("btnPeek").classList.add("hidden");
    if (ttsEnabled) speak(current.hiragana);
  }
}

// ── 記住了 → 移除，不再出現 ──
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

  // ✅ 不放回 remainQueue，直接結束這張
  setTimeout(() => nextCard(), 280);
}

// ── 還不會 → 暫存，本次不再出現 ──
function markUnknown() {
  sesUnknown++;
  sesStreak = 0;
  gStats.unknown++;
  gStats.total++;
  saveGStats();

  // ✅ 存到 unknownList，不放回 remainQueue
  unknownList.push(current);

  animCard("anim-shake", "anim-glow-red");
  updateStatsBar();
  updateStreakDisplay();

  setTimeout(() => nextCard(), 320);
}

// ── 只練還不會的（下一輪） ──
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

// ── 結束畫面 ──
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

  // 有還不會的才顯示重練按鈕
  document.getElementById("btnRetry").style.display =
    unknownList.length > 0 ? "" : "none";
  document.getElementById("unknownCount").textContent =
    unknownList.length > 0 ? `（${unknownList.length} 個）` : "";
}

// ── 進度條 ──
function updateProgress() {
  const total = sessionWords.length;
  const done = sesKnown;
  const pct = total > 0 ? Math.min((done / total) * 100, 100) : 0;
  document.getElementById("progFill").style.width = pct + "%";
  document.getElementById("progLabel").textContent = `${done} / ${total}`;
}

function updateQueueInfo() {
  document.getElementById("queueInfo").textContent =
    `剩餘 ${remainQueue.length} 張`;
  document.getElementById("tagUnknown").textContent =
    `⚠ 待複習 ${unknownList.length}`;
  document.getElementById("tagDone").textContent = `✓ 完成 ${sesKnown}`;
}

// ── Stats ──
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

// ── 初始化 ──
updateStatsBar();
initTTS();
