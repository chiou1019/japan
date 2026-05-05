// ============================================================
// N5 單字學習系統 v6
// ============================================================

// ── 全域狀態 ──
let sessionWords = [];
let remainQueue = [];
let unknownList = [];
let current = null;
let showReading = false;
let showMeaning = false;
let selectedCount = 15;
let isGuestMode = false;
let currentUser = null;

let sesKnown = 0;
let sesUnknown = 0;
let sesStreak = 0;
let sesMaxStreak = 0;
let gStats = JSON.parse(
  localStorage.getItem("n5_gstats") || '{"known":0,"unknown":0,"total":0}',
);

// ── 主題 ──
let currentTheme = localStorage.getItem("n5_theme") || "dark";
function applyTheme(t) {
  currentTheme = t;
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("n5_theme", t);
  const btn = document.getElementById("btnTheme");
  if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
  // 白板顏色跟著主題變
  wbColor = t === "dark" ? "#e4e4ef" : "#1a1a2e";
}
function toggleTheme() {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
}

// ── 語音 ──
let ttsEnabled = true;
let ttsVoice = null;
let ttsRate = 0.85;

function initTTS() {
  if (!window.speechSynthesis) return;

  function unlockAudio() {
    const utt = new SpeechSynthesisUtterance("");
    utt.volume = 0;
    speechSynthesis.speak(utt);
  }
  document.addEventListener("touchstart", unlockAudio, { once: true });
  document.addEventListener("click", unlockAudio, { once: true });

  loadVoices();
}

function loadVoices() {
  if (!window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) applyVoices(voices);
  speechSynthesis.onvoiceschanged = () => {
    const v = speechSynthesis.getVoices();
    if (v.length > 0) applyVoices(v);
  };
  let tries = 0;
  const poll = setInterval(() => {
    tries++;
    const v = speechSynthesis.getVoices();
    if (v.length > 0) {
      applyVoices(v);
      clearInterval(poll);
      return;
    }
    if (tries > 15) clearInterval(poll);
  }, 200);
}

function applyVoices(voices) {
  ttsVoice =
    voices.find((v) => v.lang === "ja-JP" && v.name.includes("Google")) ||
    voices.find((v) => v.lang === "ja-JP" && v.localService) ||
    voices.find((v) => v.lang === "ja-JP") ||
    voices.find((v) => v.lang.startsWith("ja")) ||
    null;
  const sel = document.getElementById("voiceSelect");
  if (!sel) return;
  const ja = voices.filter((v) => v.lang.startsWith("ja"));
  sel.innerHTML = ja.length
    ? ja
        .map(
          (v, i) =>
            `<option value="${i}" ${ttsVoice && v.name === ttsVoice.name ? "selected" : ""}>${v.name}</option>`,
        )
        .join("")
    : '<option value="-1">（系統日文語音）</option>';
}

function speak(text) {
  if (!ttsEnabled || !window.speechSynthesis || !text) return;
  if (speechSynthesis.paused) speechSynthesis.resume();
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "ja-JP";
  utt.rate = ttsRate;
  utt.volume = 1.0;
  if (ttsVoice) utt.voice = ttsVoice;
  setTimeout(() => {
    try {
      speechSynthesis.speak(utt);
    } catch (e) {}
  }, 50);
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById("btnTTS");
  btn.classList.toggle("tts-off", !ttsEnabled);
  btn.textContent = ttsEnabled ? "🔊" : "🔇";
}

function onVoiceChange(sel) {
  const idx = parseInt(sel.value);
  if (idx < 0) {
    ttsVoice = null;
    return;
  }
  const ja = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("ja"));
  ttsVoice = ja[idx] || null;
}

function onRateChange(val) {
  ttsRate = parseFloat(val);
  document.getElementById("rateLabel").textContent =
    parseFloat(val).toFixed(1) + "x";
}

function speakWord() {
  if (current) {
    speak(current.word);
    flashBtn("btnSpeakWord");
  }
}
function speakReading() {
  if (current) {
    speak(current.hiragana);
    flashBtn("btnSpeakReading");
  }
}

function flashBtn(id) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.add("speaking");
  setTimeout(() => btn.classList.remove("speaking"), 600);
}

// ── 登入 ──
function switchTab(tab) {
  document.getElementById("loginForm").style.display =
    tab === "login" ? "" : "none";
  document.getElementById("registerForm").style.display =
    tab === "register" ? "" : "none";
  document
    .getElementById("tabLogin")
    .classList.toggle("active", tab === "login");
  document
    .getElementById("tabRegister")
    .classList.toggle("active", tab === "register");
}

async function doLogin() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.ok) {
      errEl.textContent = data.error;
      return;
    }
    onLoginSuccess(data.username);
  } catch (e) {
    errEl.textContent = "連線失敗";
  }
}

async function doRegister() {
  const username = document.getElementById("regUser").value.trim();
  const password = document.getElementById("regPass").value.trim();
  const errEl = document.getElementById("registerError");
  errEl.textContent = "";
  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.ok) {
      errEl.textContent = data.error;
      return;
    }
    onLoginSuccess(data.username);
  } catch (e) {
    errEl.textContent = "連線失敗";
  }
}

function continueAsGuest() {
  isGuestMode = true;
  currentUser = null;
  document.getElementById("userInfo").style.display = "none";
  showScreen("screenSetup");
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  currentUser = null;
  isGuestMode = false;
  document.getElementById("userInfo").style.display = "none";
  document.getElementById("userProgress").style.display = "none";
  document.getElementById("wordPanels").style.display = "none";
  showScreen("screenLogin");
}

function onLoginSuccess(username) {
  currentUser = username;
  isGuestMode = false;
  document.getElementById("userName").textContent = "👤 " + username;
  document.getElementById("userInfo").style.display = "flex";
  showScreen("screenSetup");
  loadUserProgress();
}

async function loadUserProgress() {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    document.getElementById("progKnown").textContent = data.known;
    document.getElementById("progUnknown").textContent = data.unknown;
    document.getElementById("progNew").textContent = data.new;
    document.getElementById("progTotal").textContent = data.total;
    document.getElementById("userProgress").style.display = "block";

    const pctK = ((data.known / data.total) * 100).toFixed(1);
    const pctU = ((data.unknown / data.total) * 100).toFixed(1);
    document.getElementById("overallKnown").style.width = pctK + "%";
    document.getElementById("overallUnknown").style.width = pctU + "%";

    // 載入單字卡片區
    document.getElementById("wordPanels").style.display = "block";
    document.getElementById("knownBadgeCount").textContent = data.known;
    document.getElementById("unknownBadgeCount").textContent = data.unknown;

    loadWordPanels();
  } catch (e) {}
}

async function loadWordPanels() {
  try {
    const [knownRes, unknownRes] = await Promise.all([
      fetch("/api/known-words"),
      fetch("/api/unknown-words"),
    ]);
    const knownWords = await knownRes.json();
    const unknownWords = await unknownRes.json();

    renderWordGrid("knownWordGrid", knownWords, "known");
    renderWordGrid("unknownWordGrid", unknownWords, "unknown");

    document.getElementById("btnPracticeUnknown").style.display =
      unknownWords.length > 0 ? "block" : "none";
  } catch (e) {}
}

function renderWordGrid(gridId, words, type) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  if (words.length === 0) {
    grid.innerHTML = `<div style="font-size:.8rem;color:var(--muted2);padding:.3rem 0">尚無單字</div>`;
    return;
  }
  grid.innerHTML = words
    .map(
      (w) => `
    <div class="word-chip" title="${w.meaning}">
      <span>${w.word}</span>
      <span class="chip-reading">${w.hiragana}</span>
    </div>
  `,
    )
    .join("");
}

function togglePanel(panelId, btn) {
  const panel = document.getElementById(panelId);
  const open = panel.style.display === "none";
  panel.style.display = open ? "block" : "none";
  btn.textContent = open ? "收起 ▴" : "展開 ▾";
}

async function checkSession() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();
    if (data.loggedIn) {
      onLoginSuccess(data.username);
    } else {
      showScreen("screenLogin");
    }
  } catch (e) {
    showScreen("screenLogin");
  }
}

// ── 學習 ──
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickCount(el) {
  document
    .querySelectorAll(".cnt-wide")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  selectedCount = parseInt(el.dataset.n);
}

async function startLearning() {
  showScreen("screenStudy");
  document.getElementById("ttsBar").style.display = "flex";
  resetSession();
  try {
    const res = await fetch(`/daily/${selectedCount}`);
    const data = await res.json();
    sessionWords = shuffle(data);
    remainQueue = [...sessionWords];
    unknownList = [];
    initWhiteboardOnce();
    nextCard();
  } catch (e) {
    alert("載入失敗，請確認伺服器是否運行中");
  }
}

async function startUnknownPractice() {
  showScreen("screenStudy");
  document.getElementById("ttsBar").style.display = "flex";
  resetSession();
  try {
    const res = await fetch("/api/unknown-words");
    const data = await res.json();
    if (data.length === 0) {
      alert("目前沒有還不會的單字！");
      backToSetup();
      return;
    }
    sessionWords = shuffle(data);
    remainQueue = [...sessionWords];
    unknownList = [];
    initWhiteboardOnce();
    nextCard();
  } catch (e) {
    alert("載入失敗");
  }
}

function resetSession() {
  sesKnown = sesUnknown = sesStreak = sesMaxStreak = 0;
  updateStatsBar();
  updateStreakDisplay();
}

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
  clearWhiteboard();
}

function renderCard(w) {
  document.getElementById("frontWord").textContent = w.word;
  document.getElementById("frontNum").textContent =
    `${remainQueue.length} 張剩餘`;
  document.getElementById("wbPlaceholder").style.display = "flex";
  updateRevealUI();
  setActionBtns(false);
}

function updateRevealUI() {
  const readingEl = document.getElementById("revealReading");
  const meaningEl = document.getElementById("revealMeaning");
  const btnR = document.getElementById("btnRevealReading");
  const btnM = document.getElementById("btnRevealMeaning");
  const sep = document.getElementById("revealSep");

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

  sep.textContent = showReading && showMeaning ? "／" : "";
  setActionBtns(showReading && showMeaning);
}

function revealReading() {
  showReading = true;
  speakReading();
  updateRevealUI();
}
function revealMeaning() {
  showMeaning = true;
  updateRevealUI();
}

async function saveProgress(word, status) {
  if (isGuestMode || !currentUser) return;
  try {
    await fetch("/api/save-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, status }),
    });
  } catch (e) {}
}

function markKnown() {
  sesKnown++;
  sesStreak++;
  sesMaxStreak = Math.max(sesMaxStreak, sesStreak);
  gStats.known++;
  gStats.total++;
  saveGStats();
  saveProgress(current.word, "known");
  animCard("anim-pop", "anim-glow-green");
  updateStatsBar();
  updateStreakDisplay();
  setTimeout(() => nextCard(), 280);
}

function markUnknown() {
  sesUnknown++;
  sesStreak = 0;
  gStats.unknown++;
  gStats.total++;
  saveGStats();
  saveProgress(current.word, "unknown");
  unknownList.push(current);
  animCard("anim-shake", "anim-glow-red");
  updateStatsBar();
  updateStreakDisplay();
  setTimeout(() => nextCard(), 320);
}

function retryUnknown() {
  if (unknownList.length === 0) return;
  sessionWords = shuffle([...unknownList]);
  remainQueue = [...sessionWords];
  unknownList = [];
  showScreen("screenStudy");
  document.getElementById("ttsBar").style.display = "flex";
  resetSession();
  nextCard();
}

function backToSetup() {
  document.getElementById("ttsBar").style.display = "none";
  showScreen("screenSetup");
  if (currentUser) loadUserProgress();
}

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

// ── UI helpers ──
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
  ["screenLogin", "screenSetup", "screenStudy", "screenComplete"].forEach(
    (s) => {
      document.getElementById(s).style.display = s === id ? "block" : "none";
    },
  );
}

function animCard(...classes) {
  const scene = document.querySelector(".card-scene");
  if (!scene) return;
  scene.classList.remove(...classes);
  void scene.offsetWidth;
  scene.classList.add(...classes);
  setTimeout(() => scene.classList.remove(...classes), 600);
}

function saveGStats() {
  localStorage.setItem("n5_gstats", JSON.stringify(gStats));
}

// Enter 鍵送出
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const ls = document.getElementById("screenLogin");
  if (ls && ls.style.display !== "none") {
    document.getElementById("tabLogin").classList.contains("active")
      ? doLogin()
      : doRegister();
  }
});

// ── 白板 ──
let isDrawing = false;
let wbCtx = null;
let lastX = 0,
  lastY = 0;
let wbColor = "#e4e4ef";
let wbSize = 4;
let wbMode = "draw";
let wbInited = false;

function initWhiteboardOnce() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const canvas = document.getElementById("wbCanvas");
      if (!canvas) return;
      wbCtx = canvas.getContext("2d");
      syncCanvasSize();
      if (!wbInited) {
        wbInited = true;
        canvas.addEventListener("mousedown", wbStart);
        canvas.addEventListener("mousemove", wbDraw);
        canvas.addEventListener("mouseup", wbEnd);
        canvas.addEventListener("mouseleave", wbEnd);
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
        window.addEventListener("resize", syncCanvasSize);
      }
    }),
  );
}

function syncCanvasSize() {
  const canvas = document.getElementById("wbCanvas");
  if (!canvas || !wbCtx) return;
  const wrap = canvas.parentElement;
  const w = wrap.offsetWidth || 300;
  const h = wrap.offsetHeight || 340;
  let imgData = null;
  try {
    imgData = wbCtx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (e) {}
  canvas.width = w;
  canvas.height = h;
  if (imgData) {
    try {
      wbCtx.putImageData(imgData, 0, 0);
    } catch (e) {}
  }
}

function getPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function wbStart(e) {
  isDrawing = true;
  const ph = document.getElementById("wbPlaceholder");
  if (ph) ph.style.display = "none";
  const canvas = document.getElementById("wbCanvas");
  const pos = getPos(e, canvas);
  lastX = pos.x;
  lastY = pos.y;
}

function wbDraw(e) {
  if (!isDrawing || !wbCtx) return;
  const canvas = document.getElementById("wbCanvas");
  const pos = getPos(e, canvas);
  wbCtx.lineWidth = wbMode === "erase" ? wbSize * 5 : wbSize;
  wbCtx.lineCap = "round";
  wbCtx.lineJoin = "round";
  wbCtx.globalCompositeOperation =
    wbMode === "erase" ? "destination-out" : "source-over";
  wbCtx.strokeStyle = wbColor;
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
  const ph = document.getElementById("wbPlaceholder");
  if (ph) ph.style.display = "flex";
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
applyTheme(currentTheme);
updateStatsBar();
initTTS();
checkSession();
