// ============================================================
// N5 單字學習系統 — 間隔重複 + 語音朗讀
// ============================================================

// ── 狀態 ──
let allWords = [];
let queue = [];
let current = null;
let isFlipped = false;
let selectedCount = 15;

let sesKnown = 0;
let sesUnknown = 0;
let sesStreak = 0;
let sesMaxStreak = 0;

let gStats = JSON.parse(
  localStorage.getItem("n5_gstats") || '{"known":0,"unknown":0,"total":0}',
);

// ── 語音設定 ──
let ttsEnabled = true; // 預設開啟
let ttsVoice = null; // 選定的日文語音
let ttsRate = 0.85; // 語速（0.5～2.0）

function initTTS() {
  if (!window.speechSynthesis) return;

  const loadVoices = () => {
    const voices = speechSynthesis.getVoices();
    // 優先找日文語音
    ttsVoice =
      voices.find((v) => v.lang === "ja-JP" && v.localService) ||
      voices.find((v) => v.lang === "ja-JP") ||
      voices.find((v) => v.lang.startsWith("ja")) ||
      null;

    // 填入語音選單
    const sel = document.getElementById("voiceSelect");
    if (!sel) return;
    const jaVoices = voices.filter((v) => v.lang.startsWith("ja"));
    sel.innerHTML = jaVoices
      .map((v, i) => `<option value="${i}">${v.name}</option>`)
      .join("");

    if (!jaVoices.length) {
      sel.innerHTML = "<option>（無日文語音）</option>";
    }
  };

  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(text) {
  if (!ttsEnabled || !window.speechSynthesis) return;
  speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "ja-JP";
  utt.rate = ttsRate;
  if (ttsVoice) utt.voice = ttsVoice;
  speechSynthesis.speak(utt);
}

// 切換語音開關
function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById("btnTTS");
  btn.classList.toggle("tts-off", !ttsEnabled);
  btn.title = ttsEnabled ? "語音：開" : "語音：關";
  btn.textContent = ttsEnabled ? "🔊" : "🔇";
}

// 手動朗讀當前單字
function speakCurrent() {
  if (!current) return;
  speak(current.word);
  // 按鈕動畫
  const btn = document.getElementById("btnSpeak");
  btn.classList.add("speaking");
  setTimeout(() => btn.classList.remove("speaking"), 700);
}

// 語音選單變更
function onVoiceChange(sel) {
  const voices = speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith("ja"));
  ttsVoice = voices[parseInt(sel.value)] || null;
}

// 語速變更
function onRateChange(val) {
  ttsRate = parseFloat(val);
  document.getElementById("rateLabel").textContent = val + "x";
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
  resetSession();

  fetch(`/daily/${selectedCount}`)
    .then((r) => r.json())
    .then((data) => {
      allWords = data;
      queue = data.map((w) => ({ ...w, level: 0, dueIn: 0 }));
      nextCard();
    })
    .catch(() => alert("載入失敗，請確認伺服器是否運行中"));
}

function resetSession() {
  sesKnown = sesUnknown = sesStreak = sesMaxStreak = 0;
  updateStatsBar();
}

// ── 下一張 ──
function nextCard() {
  let idx = queue.findIndex((w) => w.dueIn <= 0);
  if (idx === -1) {
    queue.forEach((w) => (w.dueIn = Math.max(0, w.dueIn - 1)));
    idx = queue.findIndex((w) => w.dueIn <= 0);
    if (idx === -1) {
      showComplete();
      return;
    }
  }

  current = queue.splice(idx, 1)[0];
  renderCard(current);
  updateProgress();
  updateQueueTags();

  // 自動朗讀正面單字
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
    `${queue.length + 1} 張剩餘`;

  const stars = "★".repeat(w.level) + "☆".repeat(5 - w.level);
  document.getElementById("levelStars").textContent = stars;

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
    // 翻面時朗讀假名
    if (ttsEnabled) speak(current.hiragana);
  }
}

// ── 記住了 ──
function markKnown() {
  sesKnown++;
  sesStreak++;
  sesMaxStreak = Math.max(sesMaxStreak, sesStreak);
  gStats.known++;
  gStats.total++;

  current.level = Math.min(current.level + 1, 5);

  if (current.level < 5) {
    const delay = Math.pow(2, current.level);
    current.dueIn = delay;
    const insertAt = Math.min(delay, queue.length);
    queue.splice(insertAt, 0, current);
    queue.forEach((w, i) => {
      if (i !== insertAt) w.dueIn = Math.max(0, w.dueIn - 1);
    });
  }

  animCard("anim-pop", "anim-glow-green");
  updateStatsBar();
  updateStreakDisplay();
  saveGStats();

  setTimeout(() => {
    if (queue.length === 0) {
      showComplete();
      return;
    }
    nextCard();
  }, 280);
}

// ── 還不會 ──
function markUnknown() {
  sesUnknown++;
  sesStreak = 0;
  gStats.unknown++;
  gStats.total++;

  current.level = 0;
  current.dueIn = 0;

  queue.unshift(current);
  queue.slice(1).forEach((w) => (w.dueIn = Math.max(0, w.dueIn - 1)));

  animCard("anim-shake", "anim-glow-red");
  updateStatsBar();
  updateStreakDisplay();
  saveGStats();

  setTimeout(nextCard, 320);
}

// ── 只練還不會 ──
function retryUnknown() {
  const unknowns = allWords.filter((w) => {
    const inQ = queue.find((q) => q.word === w.word);
    return inQ ? inQ.level === 0 : false;
  });
  const retry = unknowns.length > 0 ? unknowns : allWords;
  queue = retry.map((w) => ({ ...w, level: 0, dueIn: 0 }));
  showScreen("screenStudy");
  resetSession();
  nextCard();
}

function backToSetup() {
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

  const hasUnknown = queue.some((w) => w.level === 0);
  document.getElementById("btnRetry").style.display = hasUnknown ? "" : "none";
}

// ── Progress ──
function updateProgress() {
  const pct = Math.min((sesKnown / selectedCount) * 100, 100);
  document.getElementById("progFill").style.width = pct + "%";
  document.getElementById("progLabel").textContent =
    `${sesKnown} / ${selectedCount}`;
  document.getElementById("queueInfo").textContent =
    `剩餘 ${queue.length + 1} 張`;
}

function updateQueueTags() {
  const reviews = queue.filter((w) => w.level > 0).length;
  const news = queue.filter((w) => w.level === 0).length;
  document.getElementById("tagReview").textContent = `🔄 複習 ${reviews}`;
  document.getElementById("tagNew").textContent = `✦ 新字 ${news}`;
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

// ── 初始化 ──
updateStatsBar();
initTTS();
