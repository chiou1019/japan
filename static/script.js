// ============================================================
// N5 單字學習系統 — 後端 API + PWA
// ============================================================

// ── 全域狀態 ──
let sessionWords  = [];
let remainQueue   = [];
let unknownList   = [];
let current       = null;
let showReading   = false;
let showMeaning   = false;
let selectedCount = 15;
let currentUser   = null;
let practiceMode  = 'daily';

// 本輪每題的答題結果 {word: 'known'|'unknown'}
let sessionProgress = {};

let sesKnown    = 0;
let sesUnknown  = 0;
let sesStreak   = 0;
let sesMaxStreak = 0;
let gStats = JSON.parse(localStorage.getItem('n5_gstats') || '{"known":0,"unknown":0,"total":0}');

// ── 主題 ──
let currentTheme = localStorage.getItem('n5_theme') || 'dark';
let wbColor      = currentTheme === 'dark' ? '#e4e4ef' : '#1a1a2e';

function applyTheme(t) {
  currentTheme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('n5_theme', t);
  const btn = document.getElementById('btnTheme');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
  wbColor = t === 'dark' ? '#e4e4ef' : '#1a1a2e';
}
function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

// ── 語音 ──
let ttsEnabled  = true;
let ttsVoice    = null;
let ttsRate     = 0.85;
let ttsUnlocked = false;

function initTTS() {
  if (!window.speechSynthesis) return;
  const unlock = () => {
    if (ttsUnlocked) return;
    ttsUnlocked = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0; u.rate = 1;
    speechSynthesis.speak(u);
    loadVoices();
  };
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('click',      unlock, { once: true });
  loadVoices();
}

function loadVoices() {
  if (!window.speechSynthesis) return;
  const tryApply = () => {
    const all = speechSynthesis.getVoices();
    if (all.length > 0) { applyVoices(all); return true; }
    return false;
  };
  if (tryApply()) return;
  speechSynthesis.onvoiceschanged = () => tryApply();
  let n = 0;
  const t = setInterval(() => { if (tryApply() || ++n > 25) clearInterval(t); }, 200);
}

function applyVoices(voices) {
  ttsVoice =
    voices.find(v => v.lang === 'ja-JP' && v.name.toLowerCase().includes('google')) ||
    voices.find(v => v.lang === 'ja-JP') ||
    voices.find(v => v.lang.startsWith('ja')) || null;
  const sel = document.getElementById('voiceSelect');
  if (!sel) return;
  const ja = voices.filter(v => v.lang.startsWith('ja'));
  sel.innerHTML = ja.length
    ? ja.map((v, i) => `<option value="${i}" ${ttsVoice && v.name===ttsVoice.name?'selected':''}>${v.name}</option>`).join('')
    : '<option value="-1">⚠ 未安裝日文語音</option>';
}

function speak(text) {
  if (!ttsEnabled || !window.speechSynthesis || !text) return;
  try { speechSynthesis.cancel(); } catch(e) {}
  if (speechSynthesis.paused) { try { speechSynthesis.resume(); } catch(e) {} }
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ja-JP'; utt.rate = ttsRate; utt.volume = 1.0; utt.pitch = 1.0;
  if (ttsVoice) utt.voice = ttsVoice;
  utt.onerror = e => { if (e.error !== 'interrupted') console.warn('TTS:', e.error); };
  setTimeout(() => { try { speechSynthesis.speak(utt); } catch(e) {} }, 100);
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById('btnTTS');
  btn.classList.toggle('tts-off', !ttsEnabled);
  btn.textContent = ttsEnabled ? '🔊' : '🔇';
}
function onVoiceChange(sel) {
  const idx = parseInt(sel.value);
  if (idx < 0) { ttsVoice = null; return; }
  const ja = speechSynthesis.getVoices().filter(v => v.lang.startsWith('ja'));
  ttsVoice = ja[idx] || null;
}
function onRateChange(val) {
  ttsRate = parseFloat(val);
  document.getElementById('rateLabel').textContent = parseFloat(val).toFixed(1) + 'x';
}
function speakWord()    { if (current) { speak(current.word);     flashBtn('btnSpeakWord'); } }
function speakReading() { if (current) { speak(current.hiragana); flashBtn('btnSpeakReading'); } }
function flashBtn(id) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.add('speaking');
  setTimeout(() => btn.classList.remove('speaking'), 600);
}

// ════════════════════════════════════════
// 帳號
// ════════════════════════════════════════

function switchTab(tab) {
  document.getElementById('loginForm').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('tabLogin').classList.toggle('active',    tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value.trim();
  const errEl    = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const res  = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = data.error; return; }
    onLoginSuccess(data.username);
  } catch(e) { errEl.textContent = '連線失敗，請確認網路'; }
}

async function doRegister() {
  const username = document.getElementById('regUser').value.trim();
  const password = document.getElementById('regPass').value.trim();
  const errEl    = document.getElementById('registerError');
  errEl.textContent = '';
  try {
    const res  = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = data.error; return; }
    onLoginSuccess(data.username);
  } catch(e) { errEl.textContent = '連線失敗，請確認網路'; }
}

function continueAsGuest() {
  currentUser = null;
  document.getElementById('userInfo').style.display = 'none';
  showScreen('screenSetup');
  loadSetupScreen();
}

async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch(e) {}
  currentUser = null;
  document.getElementById('userInfo').style.display     = 'none';
  document.getElementById('userProgress').style.display = 'none';
  document.getElementById('wordPanels').style.display   = 'none';
  showScreen('screenLogin');
}

function onLoginSuccess(username) {
  currentUser = username;
  document.getElementById('userName').textContent   = '👤 ' + username;
  document.getElementById('userInfo').style.display = 'flex';
  showScreen('screenSetup');
  loadSetupScreen();
}

async function checkSession() {
  try {
    const res  = await fetch('/api/me');
    const data = await res.json();
    if (data.loggedIn) { onLoginSuccess(data.username); }
    else               { showScreen('screenLogin'); }
  } catch(e) { showScreen('screenLogin'); }
}

// ── 載入主選單 ──
async function loadSetupScreen() {
  if (!currentUser) return;
  try {
    const [statsRes, knownRes, unknownRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/known-words'),
      fetch('/api/unknown-words')
    ]);
    const stats        = await statsRes.json();
    const knownWords   = await knownRes.json();
    const unknownWords = await unknownRes.json();

    document.getElementById('progKnown').textContent   = stats.known;
    document.getElementById('progUnknown').textContent = stats.unknown;
    document.getElementById('progNew').textContent     = stats.new;
    document.getElementById('progTotal').textContent   = stats.total;
    document.getElementById('userProgress').style.display = 'block';

    const pctK = stats.total > 0 ? (stats.known   / stats.total * 100).toFixed(1) : 0;
    const pctU = stats.total > 0 ? (stats.unknown / stats.total * 100).toFixed(1) : 0;
    document.getElementById('overallKnown').style.width   = pctK + '%';
    document.getElementById('overallUnknown').style.width = pctU + '%';

    document.getElementById('knownBadgeCount').textContent   = stats.known;
    document.getElementById('unknownBadgeCount').textContent = stats.unknown;
    document.getElementById('wordPanels').style.display = 'block';
    renderWordGrid('knownWordGrid',   knownWords);
    renderWordGrid('unknownWordGrid', unknownWords);
    document.getElementById('btnPracticeUnknown').style.display =
      unknownWords.length > 0 ? 'block' : 'none';

  } catch(e) { console.warn('loadSetupScreen error:', e); }
}

function renderWordGrid(gridId, words) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  if (!words.length) {
    grid.innerHTML = '<div style="font-size:.8rem;color:var(--muted2);padding:.3rem 0">尚無單字</div>';
    return;
  }
  grid.innerHTML = words.map(w => `
    <div class="word-chip" title="${w.meaning}">
      <span>${w.word}</span>
      <span class="chip-reading">${w.hiragana}</span>
    </div>
  `).join('');
}

function togglePanel(panelId, btn) {
  const panel = document.getElementById(panelId);
  const open  = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  btn.textContent     = open ? '收起 ▴' : '展開 ▾';
}

// ════════════════════════════════════════
// 儲存進度到後端（單次 + batch）
// ════════════════════════════════════════

async function flushProgress() {
  // 把 sessionProgress 送後端，清空後回傳
  if (!currentUser || !Object.keys(sessionProgress).length) return;
  const records = Object.entries(sessionProgress).map(([word, status]) => ({ word, status }));
  try {
    const res = await fetch('/api/save-progress/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records,
        mode:    practiceMode,
        known:   sesKnown,
        unknown: sesUnknown
      })
    });
    if (!res.ok) console.warn('batch save failed:', await res.text());
    else sessionProgress = {};  // 送成功才清空
  } catch(e) { console.warn('batch save error:', e); }
}

// ════════════════════════════════════════
// 學習邏輯
// ════════════════════════════════════════

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickCount(el) {
  document.querySelectorAll('.cnt-wide').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  selectedCount = parseInt(el.dataset.n);
}

async function startLearning() {
  practiceMode = 'daily';
  showScreen('screenStudy');
  document.getElementById('ttsBar').style.display = 'flex';
  resetSession();
  try {
    const res  = await fetch(`/daily/${selectedCount}`);
    const data = await res.json();
    sessionWords = shuffle(data);
    remainQueue  = [...sessionWords];
    unknownList  = [];
    initWhiteboardOnce();
    nextCard();
  } catch(e) { alert('載入失敗，請確認網路連線'); }
}

async function startUnknownPractice() {
  practiceMode = 'unknown';
  showScreen('screenStudy');
  document.getElementById('ttsBar').style.display = 'flex';
  resetSession();
  try {
    const res  = await fetch('/api/unknown-words');
    const data = await res.json();
    if (!data.length) { alert('目前沒有還不會的單字！'); backToSetup(); return; }
    sessionWords = shuffle(data);
    remainQueue  = [...sessionWords];
    unknownList  = [];
    initWhiteboardOnce();
    nextCard();
  } catch(e) { alert('載入失敗'); }
}

function resetSession() {
  sesKnown = sesUnknown = sesStreak = sesMaxStreak = 0;
  sessionProgress = {};
  updateStatsBar();
  updateStreakDisplay();
}

function nextCard() {
  if (remainQueue.length === 0) {
    showComplete();
    return;
  }
  current     = remainQueue.shift();
  showReading = false;
  showMeaning = false;
  renderCard(current);
  updateProgress();
  updateQueueInfo();
  clearWhiteboard();
}

function renderCard(w) {
  document.getElementById('frontWord').textContent = w.word;
  document.getElementById('frontNum').textContent  = `${remainQueue.length} 張剩餘`;
  const ph = document.getElementById('wbPlaceholder');
  if (ph) ph.style.display = 'flex';
  updateRevealUI();
  setActionBtns(false);
}

function updateRevealUI() {
  const readingEl = document.getElementById('revealReading');
  const meaningEl = document.getElementById('revealMeaning');
  const btnR      = document.getElementById('btnRevealReading');
  const btnM      = document.getElementById('btnRevealMeaning');
  const sep       = document.getElementById('revealSep');

  if (showReading) {
    readingEl.textContent = current?.hiragana || '';
    readingEl.classList.add('visible');
    btnR.classList.add('revealed');
    btnR.textContent = '🔊 ' + (current?.hiragana || '');
  } else {
    readingEl.textContent = '';
    readingEl.classList.remove('visible');
    btnR.classList.remove('revealed');
    btnR.textContent = '👁 顯示假名';
  }
  if (showMeaning) {
    meaningEl.textContent = current?.meaning || '';
    meaningEl.classList.add('visible');
    btnM.classList.add('revealed');
    btnM.textContent = '✓ ' + (current?.meaning || '');
  } else {
    meaningEl.textContent = '';
    meaningEl.classList.remove('visible');
    btnM.classList.remove('revealed');
    btnM.textContent = '👁 顯示中文';
  }
  sep.textContent = (showReading && showMeaning) ? '／' : '';
  setActionBtns(showReading && showMeaning);
}

function revealReading() { showReading = true; speakReading(); updateRevealUI(); }
function revealMeaning() { showMeaning = true; updateRevealUI(); }

function markKnown() {
  sesKnown++; sesStreak++; sesMaxStreak = Math.max(sesMaxStreak, sesStreak);
  gStats.known++; gStats.total++;
  saveGStats();
  sessionProgress[current.word] = 'known';
  animCard('anim-pop', 'anim-glow-green');
  updateStatsBar(); updateStreakDisplay();
  setTimeout(() => nextCard(), 280);
}

function markUnknown() {
  sesUnknown++; sesStreak = 0;
  gStats.unknown++; gStats.total++;
  saveGStats();
  sessionProgress[current.word] = 'unknown';
  unknownList.push(current);
  animCard('anim-shake', 'anim-glow-red');
  updateStatsBar(); updateStreakDisplay();
  setTimeout(() => nextCard(), 320);
}

// ── 結束畫面：先存進度，再顯示 ──
async function showComplete() {
  saveGStats();
  await flushProgress();  // 確保存完才繼續

  showScreen('screenComplete');
  const total = sesKnown + sesUnknown;
  const rate  = total > 0 ? Math.round(sesKnown / total * 100) : 0;
  document.getElementById('resKnown').textContent    = sesKnown;
  document.getElementById('resUnknown').textContent  = sesUnknown;
  document.getElementById('resStreak').textContent   = sesMaxStreak;
  document.getElementById('resRate').textContent     = rate + '%';
  document.getElementById('completeSub').textContent = `共練習 ${total} 次，正確率 ${rate}%`;
  document.getElementById('btnRetry').style.display  = unknownList.length > 0 ? '' : 'none';
  document.getElementById('unknownCount').textContent =
    unknownList.length > 0 ? `（${unknownList.length} 個）` : '';
}

// ── 重練不會的：存完這輪再開新一輪 ──
async function retryUnknown() {
  if (!unknownList.length) return;

  // 1. 先把這輪進度存到後端
  await flushProgress();

  // 2. 開新一輪
  const retryWords = shuffle([...unknownList]);
  sessionWords = retryWords;
  remainQueue  = [...retryWords];
  unknownList  = [];
  practiceMode = 'retry';

  // 3. 重設 session 計數（不清 sessionProgress，flushProgress 已清）
  sesKnown = sesUnknown = sesStreak = sesMaxStreak = 0;
  updateStatsBar(); updateStreakDisplay();

  showScreen('screenStudy');
  document.getElementById('ttsBar').style.display = 'flex';
  nextCard();
}

async function backToSetup() {
  // 離開練習時也確保進度有存
  await flushProgress();
  document.getElementById('ttsBar').style.display = 'none';
  showScreen('screenSetup');
  if (currentUser) loadSetupScreen();
}

// ── UI helpers ──
function updateProgress() {
  const total = sessionWords.length;
  const pct   = total > 0 ? Math.min((sesKnown / total) * 100, 100) : 0;
  document.getElementById('progFill').style.width  = pct + '%';
  document.getElementById('progLabel').textContent = `${sesKnown} / ${total}`;
}
function updateQueueInfo() {
  document.getElementById('queueInfo').textContent  = `剩餘 ${remainQueue.length} 張`;
  document.getElementById('tagUnknown').textContent = `⚠ 待複習 ${unknownList.length}`;
  document.getElementById('tagDone').textContent    = `✓ 完成 ${sesKnown}`;
}
function updateStatsBar() {
  const total = sesKnown + sesUnknown;
  const rate  = total > 0 ? Math.round(sesKnown / total * 100) + '%' : '—';
  document.getElementById('statKnown').textContent   = sesKnown;
  document.getElementById('statUnknown').textContent = sesUnknown;
  document.getElementById('statTotal').textContent   = gStats.total;
  document.getElementById('statRate').textContent    = rate;
}
function updateStreakDisplay() {
  const el = document.getElementById('streakDisplay');
  if (sesStreak >= 3) {
    el.style.display = 'flex';
    document.getElementById('streakCount').textContent = sesStreak;
  } else {
    el.style.display = 'none';
  }
}
function setActionBtns(enabled) {
  document.getElementById('btnKnown').disabled   = !enabled;
  document.getElementById('btnUnknown').disabled = !enabled;
}
function showScreen(id) {
  ['screenLogin','screenSetup','screenStudy','screenComplete'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
}
function animCard(...classes) {
  const scene = document.querySelector('.card-scene');
  if (!scene) return;
  scene.classList.remove(...classes); void scene.offsetWidth;
  scene.classList.add(...classes);
  setTimeout(() => scene.classList.remove(...classes), 600);
}
function saveGStats() { localStorage.setItem('n5_gstats', JSON.stringify(gStats)); }

// Enter 鍵送出
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const ls = document.getElementById('screenLogin');
  if (ls && ls.style.display !== 'none') {
    document.getElementById('tabLogin').classList.contains('active') ? doLogin() : doRegister();
  }
});

// ════════════════════════════════════════
// 安裝 App
// ════════════════════════════════════════
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('btnInstall');
  if (btn) btn.style.display = 'flex';
});

async function installApp() {
  if (!deferredPrompt) {
    alert('iOS：Safari → 分享 → 加入主畫面\nAndroid：瀏覽器右上角選單 → 安裝應用程式');
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (outcome === 'accepted') {
    const btn = document.getElementById('btnInstall');
    if (btn) btn.style.display = 'none';
  }
}

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('btnInstall');
  if (btn) btn.style.display = 'none';
});

// ════════════════════════════════════════
// 白板
// ════════════════════════════════════════
let isDrawing = false, wbCtx = null, lastX = 0, lastY = 0;
let wbSize = 4, wbMode = 'draw', wbInited = false;

function initWhiteboardOnce() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const canvas = document.getElementById('wbCanvas');
    if (!canvas) return;
    wbCtx = canvas.getContext('2d');
    syncCanvasSize();
    if (!wbInited) {
      wbInited = true;
      canvas.addEventListener('mousedown',  wbStart);
      canvas.addEventListener('mousemove',  wbDraw);
      canvas.addEventListener('mouseup',    wbEnd);
      canvas.addEventListener('mouseleave', wbEnd);
      canvas.addEventListener('touchstart', e => { e.preventDefault(); wbStart(e.touches[0]); }, { passive: false });
      canvas.addEventListener('touchmove',  e => { e.preventDefault(); wbDraw(e.touches[0]);  }, { passive: false });
      canvas.addEventListener('touchend',   wbEnd);
      window.addEventListener('resize', syncCanvasSize);
    }
  }));
}

function syncCanvasSize() {
  const canvas = document.getElementById('wbCanvas');
  if (!canvas || !wbCtx) return;
  const wrap = canvas.parentElement;
  const w = wrap.offsetWidth || 300, h = wrap.offsetHeight || 340;
  let img = null;
  try { img = wbCtx.getImageData(0, 0, canvas.width, canvas.height); } catch(e) {}
  canvas.width = w; canvas.height = h;
  if (img) { try { wbCtx.putImageData(img, 0, 0); } catch(e) {} }
}

function getPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width  / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height)
  };
}
function wbStart(e) {
  isDrawing = true;
  const ph = document.getElementById('wbPlaceholder');
  if (ph) ph.style.display = 'none';
  const pos = getPos(e, document.getElementById('wbCanvas'));
  lastX = pos.x; lastY = pos.y;
}
function wbDraw(e) {
  if (!isDrawing || !wbCtx) return;
  const canvas = document.getElementById('wbCanvas');
  const pos = getPos(e, canvas);
  wbCtx.lineWidth   = wbMode === 'erase' ? wbSize * 5 : wbSize;
  wbCtx.lineCap     = 'round'; wbCtx.lineJoin = 'round';
  wbCtx.globalCompositeOperation = wbMode === 'erase' ? 'destination-out' : 'source-over';
  wbCtx.strokeStyle = wbColor;
  wbCtx.beginPath(); wbCtx.moveTo(lastX, lastY); wbCtx.lineTo(pos.x, pos.y); wbCtx.stroke();
  wbCtx.globalCompositeOperation = 'source-over';
  lastX = pos.x; lastY = pos.y;
}
function wbEnd() { isDrawing = false; }
function clearWhiteboard() {
  if (!wbCtx) return;
  const c = document.getElementById('wbCanvas');
  wbCtx.clearRect(0, 0, c.width, c.height);
  const ph = document.getElementById('wbPlaceholder');
  if (ph) ph.style.display = 'flex';
}
function setWbColor(color) {
  wbColor = color; wbMode = 'draw';
  document.querySelectorAll('.wb-color').forEach(b => b.classList.remove('active'));
  document.querySelector(`.wb-color[data-color="${color}"]`)?.classList.add('active');
  document.getElementById('btnErase').classList.remove('active');
}
function setWbSize(size) {
  wbSize = parseInt(size);
  document.getElementById('wbSizeLabel').textContent = size + 'px';
}
function toggleErase() {
  wbMode = wbMode === 'erase' ? 'draw' : 'erase';
  document.getElementById('btnErase').classList.toggle('active', wbMode === 'erase');
}

// ════════════════════════════════════════
// 初始化
// ════════════════════════════════════════
function init() {
  applyTheme(currentTheme);
  updateStatsBar();
  initTTS();
  checkSession();
  if (window.matchMedia('(display-mode: standalone)').matches) {
    const btn = document.getElementById('btnInstall');
    if (btn) btn.style.display = 'none';
  }
}

init();
