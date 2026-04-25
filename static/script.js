// ============================================================
// N5 單字學習系統 — 間隔重複 (Spaced Repetition)
//
// 規則：
//   記住了 → level++，延後 2^level 張牌後再出現
//   還不會 → level=0，立刻插回隊列頭部
//   level 達到 5 → 從隊列移除（本次學習完成）
// ============================================================

// ── 狀態 ──
let allWords = []; // 伺服器拿回的原始資料
let queue = []; // 當前隊列 [{...word, level, dueIn}]
let current = null;
let isFlipped = false;
let selectedCount = 15;

// Session 統計
let sesKnown = 0;
let sesUnknown = 0;
let sesStreak = 0;
let sesMaxStreak = 0;

// 全域累積（localStorage）
let gStats = JSON.parse(
  localStorage.getItem("n5_gstats") || '{"known":0,"unknown":0,"total":0}',
);

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

// ── 顯示下一張 ──
function nextCard() {
  // 找第一張 dueIn <= 0 的牌
  let idx = queue.findIndex((w) => w.dueIn <= 0);

  if (idx === -1) {
    // 全都在延後中 → 縮短等待（不該發生，但保險起見）
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
}

// ── 渲染卡片 ──
function renderCard(w) {
  isFlipped = false;
  const card = document.getElementById("card");
  card.classList.remove("flipped");

  document.getElementById("frontWord").textContent = w.word;
  document.getElementById("backReading").textContent = w.hiragana;
  document.getElementById("backMeaning").textContent = w.meaning;
  document.getElementById("backEcho").textContent = w.word;
  document.getElementById("frontNum").textContent =
    `${queue.length + 1} 張剩餘`;

  // 熟練度星星（最多5顆）
  const stars = "★".repeat(w.level) + "☆".repeat(5 - w.level);
  document.getElementById("levelStars").textContent = stars;

  // 鎖住按鈕，等翻面
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
    // 延後 2^level 張後再出現
    const delay = Math.pow(2, current.level); // 2,4,8,16,32
    current.dueIn = delay;
    const insertAt = Math.min(delay, queue.length);
    queue.splice(insertAt, 0, current);
    // 其他牌倒數
    queue.forEach((w, i) => {
      if (i !== insertAt) w.dueIn = Math.max(0, w.dueIn - 1);
    });
  }
  // level=5 → 不放回，本次畢業

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

  // 立刻插回頭部
  queue.unshift(current);
  queue.slice(1).forEach((w) => (w.dueIn = Math.max(0, w.dueIn - 1)));

  animCard("anim-shake", "anim-glow-red");
  updateStatsBar();
  updateStreakDisplay();
  saveGStats();

  setTimeout(nextCard, 320);
}

// ── 只練還不會的 ──
function retryUnknown() {
  // 找出本次 level=0（從未答對過）的字
  const unknowns = allWords.filter((w) => {
    // 若牌還在 queue 且 level=0
    const inQ = queue.find((q) => q.word === w.word);
    return inQ ? inQ.level === 0 : false;
  });

  // 若找不到（全過了），就重練全部
  const retry = unknowns.length > 0 ? unknowns : allWords;
  queue = retry.map((w) => ({ ...w, level: 0, dueIn: 0 }));

  showScreen("screenStudy");
  resetSession();
  nextCard();
}

// ── 回設定 ──
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

  // 若沒有還不會的，隱藏重練按鈕
  const hasUnknown = queue.some((w) => w.level === 0);
  document.getElementById("btnRetry").style.display = hasUnknown ? "" : "none";
}

// ── 進度條 ──
function updateProgress() {
  const done = sesKnown;
  const total = selectedCount;
  const pct = Math.min((done / total) * 100, 100);

  document.getElementById("progFill").style.width = pct + "%";
  document.getElementById("progLabel").textContent = `${done} / ${total}`;
  document.getElementById("queueInfo").textContent =
    `剩餘 ${queue.length + 1} 張`;
}

// ── 隊列標籤 ──
function updateQueueTags() {
  const reviews = queue.filter((w) => w.level > 0).length;
  const news = queue.filter((w) => w.level === 0).length;
  document.getElementById("tagReview").textContent = `🔄 複習 ${reviews}`;
  document.getElementById("tagNew").textContent = `✦ 新字 ${news}`;
}

// ── 統計欄 ──
function updateStatsBar() {
  const total = sesKnown + sesUnknown;
  const rate = total > 0 ? Math.round((sesKnown / total) * 100) + "%" : "—";
  document.getElementById("statKnown").textContent = sesKnown;
  document.getElementById("statUnknown").textContent = sesUnknown;
  document.getElementById("statTotal").textContent = gStats.total;
  document.getElementById("statRate").textContent = rate;
}

// ── 連勝顯示 ──
function updateStreakDisplay() {
  const el = document.getElementById("streakDisplay");
  if (sesStreak >= 3) {
    el.style.display = "flex";
    document.getElementById("streakCount").textContent = sesStreak;
  } else {
    el.style.display = "none";
  }
}

// ── 按鈕啟用/禁用 ──
function setActionBtns(enabled) {
  document.getElementById("btnKnown").disabled = !enabled;
  document.getElementById("btnUnknown").disabled = !enabled;
}

// ── 畫面切換 ──
function showScreen(id) {
  ["screenSetup", "screenStudy", "screenComplete"].forEach((s) => {
    document.getElementById(s).style.display = s === id ? "block" : "none";
  });
}

// ── 卡片動畫 ──
function animCard(...classes) {
  const scene = document.querySelector(".card-scene");
  scene.classList.remove(...classes);
  void scene.offsetWidth; // reflow
  scene.classList.add(...classes);
  setTimeout(() => scene.classList.remove(...classes), 600);
}

// ── localStorage ──
function saveGStats() {
  localStorage.setItem("n5_gstats", JSON.stringify(gStats));
}

// ── 初始化 ──
updateStatsBar();
