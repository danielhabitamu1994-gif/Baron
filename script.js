// ==================================================================
//  BARON BINGO — script.js
//  Full production Telegram Mini App logic with Firebase Realtime DB
// ==================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, onValue, update, push, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ===== FIREBASE INIT =====
const firebaseConfig = {
  apiKey: "AIzaSyAZxHUnuaRNc6GfJQHNBnggJ_jfZFt_0mA",
  authDomain: "baron-24c9e.firebaseapp.com",
  projectId: "baron-24c9e",
  storageBucket: "baron-24c9e.firebasestorage.app",
  messagingSenderId: "559650974936",
  appId: "1:559650974936:web:dd133acca1be5fec8cfbad",
  databaseURL: "https://baron-24c9e-default-rtdb.firebaseio.com"
};
const fbApp  = initializeApp(firebaseConfig);
const db     = getDatabase(fbApp);

// ===== TELEGRAM WEBAPP =====
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const tgUser = tg?.initDataUnsafe?.user || {
  id: "demo_" + Math.floor(Math.random() * 9999),
  first_name: "Demo",
  last_name: "User",
  username: "demo_user"
};
const UID = String(tgUser.id);

// ===== CONSTANTS =====
const JOIN_SEC  = 30;
const GAME_SEC  = 60;
const CALL_MS   = 3500;   // ms between number calls
const COMMISSION = 0.10;  // 10%
const MIN_REAL   = 1;     // minimum real players to start
const MAX_PLAYERS = 20;   // maximum in a room
const NO_PLAYER_STAKES = new Set([]);

const BOT_NAMES = [
  "bek***","ale**","muli**","aben***","fits**","hayl**",
  "mery**","kedi**","tseg**","dagi**","abdu**","eyer**",
  "kal***","nati**","geta***","zelu**","daw***","rob**","feti**"
];

const STAKE_CONFIG = [
  { amount: 10,  theme: "sc-gold",   icon: "🎯", min: 7,  max: 18 },
  { amount: 20,  theme: "sc-green",  icon: "🎲", min: 5,  max: 15 },
  { amount: 50,  theme: "sc-cyan",   icon: "💎", min: 3,  max: 10 },
  { amount: 100, theme: "sc-purple", icon: "👑", min: 4,  max: 12 }
];

// ===== STATE =====
let userBalance = 0;
let selectedStake  = 10;
let selectedCardNo = 1;
let currentRoomId  = null;
let roomListener   = null;
let callerInterval = null;
let isHost         = false;
let gameCardNums   = [];
let daubedSet      = new Set();
let myUsername     = tgUser.username || tgUser.first_name || "player";

// ===== SYNCHRONIZED CYCLE =====
// All users share the same cycle based on a fixed epoch anchor
// Cycle period = JOIN_SEC + GAME_SEC seconds, ticking from a known UTC anchor
const CYCLE_PERIOD = JOIN_SEC + GAME_SEC; // 90s total

function getSyncedCycleState(amount) {
  // Use a per-stake offset so different stakes are out of phase
  const stakeOffset = [10, 20, 50, 100].indexOf(amount) * 22;
  const nowSec = Math.floor(Date.now() / 1000) + stakeOffset;
  const pos = nowSec % CYCLE_PERIOD;
  const phase = pos < JOIN_SEC ? "join" : "started";
  const elapsed = pos < JOIN_SEC ? pos : pos - JOIN_SEC;
  return { phase, pos, elapsed };
}

const cycleState = {};
STAKE_CONFIG.forEach(s => {
  if (NO_PLAYER_STAKES.has(s.amount)) {
    cycleState[s.amount] = { phase: "none", pos: 0, elapsed: 0 };
  } else {
    cycleState[s.amount] = getSyncedCycleState(s.amount);
  }
});

// ===== DOM SHORTCUTS =====
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ===== SCREENS =====
function showScreen(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

// ===== TOAST =====
let toastTimer;
function toast(msg, dur = 2800) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), dur);
}

// ===== COPY =====
function copyPhone() {
  const num = $("depositPhone").textContent;
  navigator.clipboard?.writeText(num)
    .then(() => toast("✅ ቁጥሩ ተገልብጧል!"))
    .catch(() => { /* fallback */ });
}
window.copyPhone = copyPhone;

// ===== MENU =====
function openMenu() {
  $("sideMenu").classList.add("open");
  $("menuOverlay").classList.add("open");
}
function closeMenu() {
  $("sideMenu").classList.remove("open");
  $("menuOverlay").classList.remove("open");
}
window.openMenu  = openMenu;
window.closeMenu = closeMenu;
window.openDeposit = () => { showScreen("screen-deposit"); loadDepositHistory(); };
window.openWithdraw = () => {
  showScreen("screen-withdraw");
  $("withdrawBalanceDisplay").textContent = userBalance.toFixed(2) + " ETB";
  loadWithdrawHistory();
};
window.openWalletModal = () => {
  $("wmBalance").textContent = userBalance.toFixed(2);
  $("walletModalOverlay").classList.add("active");
  $("walletModal").classList.add("active");
};
window.closeWalletModal = () => {
  $("walletModalOverlay").classList.remove("active");
  $("walletModal").classList.remove("active");
};

// ===== UPDATE UI BALANCE =====
function updateBalanceUI() {
  $("topBalance").textContent = userBalance;
  $("menuBalance").textContent = userBalance;
}

// ===== USER INIT =====
async function initUser() {
  const uRef = ref(db, `users/${UID}`);
  const snap = await get(uRef);

  $("menuAvatar").textContent = (tgUser.first_name?.[0] || "?").toUpperCase();
  $("menuName").textContent   = `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim() || "Player";
  $("menuPhone").textContent  = "Telegram ID: " + UID;

  if (!snap.exists()) {
    // New user
    await set(uRef, {
      uid: UID,
      name: `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim(),
      username: tgUser.username || "",
      balance: 0,
      createdAt: serverTimestamp()
    });
    userBalance = 0;
  } else {
    userBalance = snap.val().balance || 0;
    // Phone from firebase if stored
    const ph = snap.val().phone;
    if (ph) $("menuPhone").textContent = ph;
  }

  // Live balance listener
  onValue(ref(db, `users/${UID}/balance`), snap => {
    userBalance = snap.val() || 0;
    updateBalanceUI();
  });

  updateBalanceUI();
}

// ===== STAKE HOME SCREEN =====
function buildStakeGrid() {
  const grid = $("stakeGrid");
  grid.innerHTML = "";

  STAKE_CONFIG.forEach(cfg => {
    const card = document.createElement("div");
    card.className = `stake-card ${cfg.theme}`;
    card.id = `sc-${cfg.amount}`;

    const isNP = NO_PLAYER_STAKES.has(cfg.amount);

    card.innerHTML = `
      <div class="sc-ring">${cfg.icon}</div>
      <div class="sc-amount">${cfg.amount}</div>
      <div class="sc-curr">Birr</div>
      <div class="sc-divider"></div>
      <div class="sc-meta">
        <div class="sc-players">
          <span class="sc-live-dot" ${isNP ? 'style="background:#555;box-shadow:none;animation:none"' : ''}></span>
          <span><span id="sp-${cfg.amount}">${isNP ? 0 : cfg.min}</span> ተጫዋቾች</span>
        </div>
        <div class="sc-prize">🏆 <span class="sc-prize-val" id="sw-${cfg.amount}">${isNP ? 0 : cfg.min * cfg.amount}</span> ETB</div>
        ${isNP
          ? `<div class="sc-no-players-label">ተጫዋች የለም</div>`
          : `<div class="sc-phase phase-join" id="sph-${cfg.amount}">
               <span class="sc-phase-dot"></span>
               <span id="sphl-${cfg.amount}">መቀላቀል ይቻላል</span>
             </div>
             <div class="sc-timer">
               <div class="sc-timer-bar"><div class="sc-timer-fill tf-join" id="stf-${cfg.amount}" style="width:100%"></div></div>
               <div class="sc-timer-val" id="stv-${cfg.amount}">30s</div>
             </div>`
        }
      </div>
    `;

    card.addEventListener("click", () => {
      if (isNP) {
        toast("⚠ ይህ stake ላይ ገና ተጫዋቾች የሉም");
        return;
      }
      showCardSelection(cfg.amount);
    });

    grid.appendChild(card);
  });
}

// ===== ASYNC CYCLE ENGINE =====
function startCycleEngine() {
  STAKE_CONFIG.forEach(cfg => {
    if (NO_PLAYER_STAKES.has(cfg.amount)) return;

    setInterval(() => {
      // Always re-derive from real clock so all users stay in sync
      const synced = getSyncedCycleState(cfg.amount);
      const st = cycleState[cfg.amount];
      const wasStarted = st.phase === "started";
      st.pos     = synced.pos;
      st.phase   = synced.phase;
      st.elapsed = synced.elapsed;

      // Detect phase transition: started → join (game ended, new cycle)
      if (wasStarted && st.phase === "join") {
        resetPlayerCount(cfg.amount, cfg.min);
      }

      updateStakeCycleUI(cfg.amount);
    }, 1000);
  });
}

function updateStakeCycleUI(amount) {
  const st  = cycleState[amount];
  const ph  = $(`sph-${amount}`);
  const lbl = $(`sphl-${amount}`);
  const tf  = $(`stf-${amount}`);
  const tv  = $(`stv-${amount}`);
  if (!ph) return;

  if (st.phase === "join") {
    const rem = JOIN_SEC - st.elapsed;
    ph.className  = "sc-phase phase-join";
    lbl.textContent = "መቀላቀል ይቻላል";
    tf.className  = "sc-timer-fill tf-join";
    tf.style.width = ((rem / JOIN_SEC) * 100) + "%";
    tv.textContent = rem + "s";
    if (Math.random() < 0.25) fluctuatePlayers(amount);
  } else {
    const rem = GAME_SEC - st.elapsed;
    ph.className  = "sc-phase phase-started";
    lbl.textContent = "ጨዋታ ጀምሯል";
    tf.className  = "sc-timer-fill tf-started";
    tf.style.width = ((rem / GAME_SEC) * 100) + "%";
    tv.textContent = rem + "s";
    // Player count frozen during game
  }

  // Sync start button if user is on card selection for this stake
  if ($("screen-card").classList.contains("active") && selectedStake === amount) {
    updateStartBtn(amount);
  }
}

function fluctuatePlayers(amount) {
  const cfg = STAKE_CONFIG.find(c => c.amount === amount);
  if (!cfg) return;
  const el = $(`sp-${amount}`);
  const we = $(`sw-${amount}`);
  if (!el) return;
  const cur = parseInt(el.textContent) || cfg.min;
  const chg = Math.random() > 0.45 ? Math.floor(Math.random() * 3) + 1 : -Math.floor(Math.random() * 2);
  const nxt = Math.min(Math.max(cur + chg, cfg.min), cfg.max);
  el.textContent = nxt;
  we.textContent = nxt * amount;
}

function dropPlayers(amount) {
  const cfg = STAKE_CONFIG.find(c => c.amount === amount);
  if (!cfg) return;
  const el = $(`sp-${amount}`);
  const we = $(`sw-${amount}`);
  if (!el) return;
  const cur = parseInt(el.textContent) || cfg.min;
  const nxt = Math.max(cur - Math.floor(Math.random() * 2) - 1, cfg.min);
  el.textContent = nxt;
  we.textContent = nxt * amount;
}

function resetPlayerCount(amount, min) {
  const el = $(`sp-${amount}`);
  const we = $(`sw-${amount}`);
  if (!el) return;
  el.textContent = min;
  we.textContent = min * amount;
}

// ===== CARD SELECTION =====
let pickedCardNo = 1;
let takenCards   = new Set();

async function showCardSelection(amount) {
  selectedStake = amount;
  $("cardBadge").textContent = amount + " ETB";
  pickedCardNo = 1;
  showScreen("screen-card");
  await loadTakenCards(amount);
  renderCardPicker();
  renderPreview(1);
  updateStartBtn(amount);
}
window.goHome = () => showScreen("screen-home");

function updateStartBtn(amount) {
  const btn = $("startGameBtn");
  if (!btn) return;
  const st = cycleState[amount];
  if (!st) return;
  if (st.phase === "started") {
    btn.disabled = true;
    btn.textContent = "⏳ ጨዋታ እየተካሄደ ነው... ይጠብቁ";
    btn.style.opacity = "0.55";
    btn.style.cursor  = "not-allowed";
    btn.onclick = null;
  } else {
    btn.disabled = false;
    btn.textContent = "🎮 ጨዋታውን ጀምር";
    btn.style.opacity = "1";
    btn.style.cursor  = "pointer";
    btn.onclick = joinGame;
  }
}

async function loadTakenCards(amount) {
  takenCards = new Set();
  // Check active rooms for this stake — cards in use
  const snap = await get(ref(db, `rooms`));
  if (!snap.exists()) return;
  snap.forEach(roomSnap => {
    const r = roomSnap.val();
    if (r.stake !== amount || r.status === "finished") return;
    if (r.players) {
      Object.values(r.players).forEach(p => {
        if (p.cardNo) takenCards.add(p.cardNo);
      });
    }
  });
}

function renderCardPicker() {
  const grid = $("cardPickerGrid");
  grid.innerHTML = "";
  for (let i = 1; i <= 100; i++) {
    const el = document.createElement("div");
    el.className = "cp-num" + (takenCards.has(i) ? " taken" : "") + (i === pickedCardNo ? " selected" : "");
    el.textContent = i;
    el.dataset.num = i;
    el.addEventListener("click", () => {
      if (takenCards.has(i)) return;
      pickedCardNo = i;
      $$(".cp-num").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected");
      $("cpLabel").textContent = "Card #" + i;
      selectedCardNo = i;
      renderPreview(i);
    });
    grid.appendChild(el);
  }
}

function renderPreview(seed) {
  const nums = generateCard(seed);
  const grid = $("bingoPreview");
  grid.innerHTML = "";
  nums.forEach((n, i) => {
    const cell = document.createElement("div");
    cell.className = "bp-cell" + (i === 12 ? " bp-free" : "");
    cell.textContent = i === 12 ? "⭐" : n;
    grid.appendChild(cell);
  });
}

// ===== BINGO CARD GENERATOR =====
function generateCard(seed) {
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  let s = seed * 9301 + 49297;
  function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
  let card = [];
  for (let col = 0; col < 5; col++) {
    let [mn, mx] = ranges[col];
    let pool = [];
    for (let n = mn; n <= mx; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) {
      let j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    card.push(pool.slice(0, 5).sort((a, b) => a - b));
  }
  let result = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) result.push(card[col][row]);
  }
  result[12] = 0; // FREE
  return result;
}

function numToLetter(n) {
  if (n <= 15) return "B";
  if (n <= 30) return "I";
  if (n <= 45) return "N";
  if (n <= 60) return "G";
  return "O";
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== JOIN GAME =====
async function joinGame() {
  if (userBalance < selectedStake) {
    toast("⚠ ቀሪ ሂሳብዎ አነስተኛ ነው! Deposit ያድርጉ");
    return;
  }

  selectedCardNo = pickedCardNo;
  showScreen("screen-lobby");
  $("lobbyPlayers").innerHTML = "";

  // Deduct stake
  await update(ref(db, `users/${UID}`), { balance: userBalance - selectedStake });

  // Find or create room
  const roomId = await findOrCreateRoom(selectedStake);
  currentRoomId = roomId;

  // Add player to room
  await update(ref(db, `rooms/${roomId}/players/${UID}`), {
    uid: UID,
    name: myUsername,
    username: "@" + (tgUser.username || myUsername),
    cardNo: selectedCardNo,
    isBot: false,
    joinedAt: serverTimestamp()
  });

  // Listen to room
  listenRoom(roomId);
}
window.joinGame = joinGame;

async function findOrCreateRoom(stake) {
  // Helper: scan for open waiting room
  async function scanForRoom() {
    const snap = await get(ref(db, "rooms"));
    if (!snap.exists()) return null;
    let found = null;
    snap.forEach(r => {
      const v = r.val();
      if (v.stake === stake && v.status === "waiting" && !found) {
        const playerCount = v.players ? Object.keys(v.players).length : 0;
        if (playerCount < MAX_PLAYERS) found = r.key;
      }
    });
    return found;
  }

  // First scan
  let found = await scanForRoom();
  if (found) return found;

  // Create new room
  const newRoom = ref(db, "rooms");
  const pushed  = push(newRoom);
  const roomId  = pushed.key;

  await set(ref(db, `rooms/${roomId}`), {
    id: roomId,
    stake,
    status: "waiting",
    createdAt: serverTimestamp(),
    hostUid: UID,
    players: {},
    calledNumbers: []
  });

  // Short wait then re-scan — if another room appeared in parallel, join that instead
  await new Promise(r => setTimeout(r, 800));
  const concurrent = await scanForRoom();
  if (concurrent && concurrent !== roomId) {
    // Another room opened — remove ours and join theirs
    await remove(ref(db, `rooms/${roomId}`));
    isHost = false;
    return concurrent;
  }

  isHost = true;
  return roomId;
}

function listenRoom(roomId) {
  if (roomListener) roomListener();
  roomListener = onValue(ref(db, `rooms/${roomId}`), snap => {
    if (!snap.exists()) return;
    const room = snap.val();
    handleRoomUpdate(room, roomId);
  });
}

function handleRoomUpdate(room, roomId) {
  const players = room.players ? Object.values(room.players) : [];
  const realPlayers = players.filter(p => !p.isBot);

  if (room.status === "waiting") {
    updateLobbyUI(players, room.stake);
    // Host decides when to start
    if (isHost && realPlayers.length >= MIN_REAL) {
      scheduleGameStart(roomId, room);
    }
  } else if (room.status === "playing") {
    // All screens (lobby OR card-select) transition to game screen
    if (!$("screen-game").classList.contains("active")) {
      startGameUI(room);
    }
    // Sync called numbers for every player
    syncCalledNumbers(room.calledNumbers || []);

    // Check if someone shouted bingo
    if (room.winner) {
      handleWinner(room.winner, room);
    }
  } else if (room.status === "finished") {
    if (room.winner && !$("screen-result").classList.contains("active")) {
      handleWinner(room.winner, room);
    }
  }
}

let startScheduled = false;
function scheduleGameStart(roomId, room) {
  if (startScheduled) return;
  startScheduled = true;

  const stake    = room.stake;
  const players  = room.players ? Object.values(room.players) : [];
  const realCount = players.filter(p => !p.isBot).length;

  // Add bots for all stake levels
  let allPlayers = [...players];
  if (allPlayers.length < 6) {
    const botsNeeded = Math.floor(Math.random() * (19 - 3 + 1)) + 3;
    const shuffledNames = shuffleArr([...BOT_NAMES]);
    const botUpdates = {};
    for (let i = 0; i < botsNeeded && allPlayers.length < MAX_PLAYERS; i++) {
      const botId  = "bot_" + i + "_" + Date.now();
      const cardNo = pickBotCardNo(allPlayers);
      botUpdates[botId] = {
        uid: botId,
        name: shuffledNames[i % shuffledNames.length],
        username: shuffledNames[i % shuffledNames.length],
        cardNo,
        isBot: true,
        joinedAt: Date.now()
      };
      allPlayers.push(botUpdates[botId]);
    }
    update(ref(db, `rooms/${roomId}/players`), botUpdates);
  }

  // Generate call order (75 numbers shuffled)
  const callOrder = shuffleArr(Array.from({length:75}, (_,i) => i+1));

  setTimeout(async () => {
    await update(ref(db, `rooms/${roomId}`), {
      status: "playing",
      startedAt: serverTimestamp(),
      callOrder,
      calledNumbers: [],
      callIndex: 0
    });

    startScheduled = false;
    isHost = true;
    startCallerLoop(roomId);
  }, 3000);
}

function pickBotCardNo(existingPlayers) {
  const taken = new Set(existingPlayers.map(p => p.cardNo).filter(Boolean));
  let n;
  do { n = Math.floor(Math.random() * 100) + 1; } while (taken.has(n));
  return n;
}

// ===== LOBBY UI =====
function updateLobbyUI(players, stake) {
  const real = players.filter(p => !p.isBot);
  const bots  = players.filter(p => p.isBot);
  $("lobbyJoined").textContent = players.length;
  $("lobbyNeeded").textContent = 6;

  const wrap = $("lobbyPlayers");
  wrap.innerHTML = "";
  real.forEach(p => {
    const chip = document.createElement("div");
    chip.className = "lp-chip lp-real";
    chip.textContent = (p.uid === UID ? "⭐ " : "") + p.username;
    wrap.appendChild(chip);
  });
  bots.slice(0, 5).forEach(p => {
    const chip = document.createElement("div");
    chip.className = "lp-chip lp-bot";
    chip.textContent = p.name;
    wrap.appendChild(chip);
  });
  if (bots.length > 5) {
    const chip = document.createElement("div");
    chip.className = "lp-chip lp-bot";
    chip.textContent = "+" + (bots.length - 5) + " bots";
    wrap.appendChild(chip);
  }
}

function cancelLobby() {
  if (roomListener) { roomListener(); roomListener = null; }
  if (currentRoomId) {
    remove(ref(db, `rooms/${currentRoomId}/players/${UID}`));
    // Refund
    update(ref(db, `users/${UID}`), { balance: userBalance + selectedStake });
  }
  startScheduled = false;
  currentRoomId  = null;
  isHost = false;
  showScreen("screen-home");
  toast("🔄 ጨዋታ ተሰርዟል። ገንዘብዎ ተመልሷል");
}
window.cancelLobby = cancelLobby;

// ===== GAME UI =====
function startGameUI(room) {
  showScreen("screen-game");
  const players = room.players ? Object.values(room.players) : [];
  const prize   = calcPrize(players.length, room.stake);

  $("gtbRound").textContent   = "Stake: " + room.stake + " ETB";
  $("gtbPlayers").textContent = "👥 " + players.length;
  $("gtbPrize").textContent   = "🏆 " + prize + " ETB";

  // Build player card
  gameCardNums = generateCard(selectedCardNo);
  daubedSet = new Set([12]); // FREE center
  renderGameCard(gameCardNums);
  buildCalledGrid();

  // Players strip
  renderPlayersStrip(players);

  // Host starts caller loop
  if (isHost) startCallerLoop(currentRoomId);
}

function renderGameCard(nums) {
  const grid = $("gameCard");
  grid.innerHTML = "";
  nums.forEach((n, i) => {
    const cell = document.createElement("div");
    cell.className = "gc-cell" + (i === 12 ? " gc-free" : "");
    cell.dataset.idx = i;
    cell.textContent = i === 12 ? "FREE" : n;
    if (i !== 12) cell.addEventListener("click", () => manualDaub(i));
    grid.appendChild(cell);
  });
}

function buildCalledGrid() {
  const grid = $("calledGrid");
  grid.innerHTML = "";
  for (let n = 1; n <= 75; n++) {
    const el = document.createElement("div");
    el.id = "cg-" + n;
    el.className = "cg-num cg-" + numToLetter(n).toLowerCase();
    el.textContent = n;
    grid.appendChild(el);
  }
}

function renderPlayersStrip(players) {
  const strip = $("playersStrip");
  strip.innerHTML = "";
  players.forEach(p => {
    const chip = document.createElement("div");
    chip.className = "ps-chip" + (p.uid === UID ? " ps-self" : p.isBot ? " ps-bot" : "");
    chip.textContent = (p.uid === UID ? "⭐ " : "") + p.username;
    chip.id = "pchip-" + p.uid;
    strip.appendChild(chip);
  });
}

function calcPrize(playerCount, stake) {
  return Math.floor(playerCount * stake * (1 - COMMISSION));
}

// ===== CALLER LOOP (HOST) =====
function startCallerLoop(roomId) {
  if (callerInterval) clearInterval(callerInterval);
  callerInterval = setInterval(async () => {
    const snap = await get(ref(db, `rooms/${roomId}`));
    if (!snap.exists()) { clearInterval(callerInterval); return; }
    const room = snap.val();
    if (room.status !== "playing" || room.winner) {
      clearInterval(callerInterval); return;
    }

    const callOrder = room.callOrder || [];
    const idx = room.callIndex || 0;

    if (idx >= callOrder.length || idx >= 20) {
      clearInterval(callerInterval);
      // If we hit 20 calls and no winner yet, find best scoring player
      if (idx >= 20 && !room.winner) {
        forceWinnerAt20(room, roomId);
      }
      return;
    }

    const num = callOrder[idx];
    const calledNumbers = [...(room.calledNumbers || []), num];

    await update(ref(db, `rooms/${roomId}`), {
      calledNumbers,
      callIndex: idx + 1,
      lastCalled: num
    });

    // Bot auto-check bingo after each call
    if (room.players) {
      checkBotBingo(room, calledNumbers, roomId);
    }
  }, CALL_MS);
}

// ===== SYNC CALLED NUMBERS =====
function syncCalledNumbers(calledNums) {
  if (!calledNums || !calledNums.length) return;
  const latest = calledNums[calledNums.length - 1];

  // Update call counter
  const countEl = $("gtbCallCount");
  if (countEl) countEl.textContent = `Call ${calledNums.length}/20`;

  // Big display
  $("currentCallLetter").textContent = numToLetter(latest);
  const numEl = $("currentCallNumber");
  numEl.textContent = latest;
  numEl.style.animation = "none";
  void numEl.offsetWidth;
  numEl.style.animation = "";

  // History strip (last 4)
  const strip = $("callHistory");
  strip.innerHTML = "";
  const last4 = calledNums.slice(-5, -1).reverse();
  last4.forEach(n => {
    const ball = document.createElement("div");
    ball.className = "ch-ball chb-" + numToLetter(n).toLowerCase();
    ball.textContent = n;
    strip.appendChild(ball);
  });

  // Called grid
  calledNums.forEach(n => {
    const el = $("cg-" + n);
    if (el) el.classList.add("cg-called");
  });

  // Auto-daub player card
  gameCardNums.forEach((n, i) => {
    if (n !== 0 && calledNums.includes(n)) {
      daubedSet.add(i);
      const cell = document.querySelector(`#gameCard [data-idx="${i}"]`);
      if (cell && !cell.classList.contains("gc-daubed")) {
        cell.classList.add("gc-called", "gc-daubed");
      }
    }
  });

  // Check bingo eligibility
  if (checkBingo(daubedSet)) {
    $("bingoShoutBtn").classList.add("ready");
  }
}

// ===== MANUAL DAUB =====
function manualDaub(idx) {
  const num = gameCardNums[idx];
  const cell = document.querySelector(`#gameCard [data-idx="${idx}"]`);
  if (!cell) return;

  const snap_ref = ref(db, `rooms/${currentRoomId}/calledNumbers`);
  get(snap_ref).then(snap => {
    const called = snap.val() || [];
    if (called.includes(num)) {
      daubedSet.add(idx);
      cell.classList.add("gc-daubed");
      if (checkBingo(daubedSet)) $("bingoShoutBtn").classList.add("ready");
    } else {
      toast("⚠ ይህ ቁጥር ገና አልተጠራም!");
    }
  });
}

// ===== BINGO CHECK =====
function checkBingo(daubed) {
  // Rows
  for (let r = 0; r < 5; r++) {
    let ok = true;
    for (let c = 0; c < 5; c++) { if (!daubed.has(r*5+c)) { ok=false; break; } }
    if (ok) return true;
  }
  // Cols
  for (let c = 0; c < 5; c++) {
    let ok = true;
    for (let r = 0; r < 5; r++) { if (!daubed.has(r*5+c)) { ok=false; break; } }
    if (ok) return true;
  }
  // Diagonals
  let d1=true, d2=true;
  for (let i=0;i<5;i++) {
    if (!daubed.has(i*5+i)) d1=false;
    if (!daubed.has(i*5+(4-i))) d2=false;
  }
  return d1||d2;
}

function getWinCells(daubed) {
  const wins = new Set();
  for (let r=0;r<5;r++) {
    let ok=true; let cells=[];
    for (let c=0;c<5;c++){cells.push(r*5+c); if(!daubed.has(r*5+c)){ok=false;break;}}
    if(ok) cells.forEach(x=>wins.add(x));
  }
  for (let c=0;c<5;c++) {
    let ok=true; let cells=[];
    for (let r=0;r<5;r++){cells.push(r*5+c); if(!daubed.has(r*5+c)){ok=false;break;}}
    if(ok) cells.forEach(x=>wins.add(x));
  }
  let d1c=[],d2c=[],d1=true,d2=true;
  for(let i=0;i<5;i++){
    d1c.push(i*5+i); d2c.push(i*5+(4-i));
    if(!daubed.has(i*5+i)) d1=false;
    if(!daubed.has(i*5+(4-i))) d2=false;
  }
  if(d1) d1c.forEach(x=>wins.add(x));
  if(d2) d2c.forEach(x=>wins.add(x));
  return wins;
}

// ===== SHOUT BINGO =====
async function shoutBingo() {
  if (!checkBingo(daubedSet)) {
    toast("⚠ ገና ቢንጎ አልሆነም! ሁሉም ቁጥሮች አልተዳቡም");
    return;
  }
  const snap = await get(ref(db, `rooms/${currentRoomId}`));
  if (!snap.exists()) return;
  const room = snap.val();
  if (room.winner) { toast("😞 ቀድሞ አሸናፊ ተወስኗል!"); return; }

  const players = room.players ? Object.values(room.players) : [];
  const prize   = calcPrize(players.length, room.stake);

  // Set winner
  await update(ref(db, `rooms/${currentRoomId}`), {
    winner: { uid: UID, username: "@" + (tgUser.username || myUsername), isBot: false, prize },
    status: "finished"
  });

  // Credit prize
  await update(ref(db, `users/${UID}`), { balance: userBalance + prize });

  // Log transaction
  const txRef = push(ref(db, `users/${UID}/transactions`));
  await set(txRef, {
    type: "win", amount: prize, roomId: currentRoomId,
    stake: room.stake, ts: serverTimestamp()
  });

  if (callerInterval) { clearInterval(callerInterval); callerInterval = null; }
  highlightWinCells();
  showResultScreen(true, prize, "@" + (tgUser.username || myUsername));
  launchConfetti();
}
window.shoutBingo = shoutBingo;

function highlightWinCells() {
  const wins = getWinCells(daubedSet);
  wins.forEach(idx => {
    const cell = document.querySelector(`#gameCard [data-idx="${idx}"]`);
    if (cell) cell.classList.add("gc-win");
  });
}

// ===== BOT BINGO CHECK =====
function checkBotBingo(room, calledNumbers, roomId) {
  if (room.winner) return;
  const players = Object.values(room.players);
  const bots = players.filter(p => p.isBot);

  if (calledNumbers.length < 20) return;

  // At exactly 20 calls, find the bot with most matches and declare winner
  let bestBot = null;
  let bestScore = -1;
  bots.forEach(bot => {
    const botCard   = generateCard(bot.cardNo, room.stake);
    const botDaubed = buildBotDaubed(botCard, calledNumbers);
    const score = botDaubed.size;
    if (score > bestScore) { bestScore = score; bestBot = bot; }
  });

  if (bestBot) {
    const prize = calcPrize(players.length, room.stake);
    update(ref(db, `rooms/${roomId}`), {
      winner: { uid: bestBot.uid, username: bestBot.username, isBot: true, prize },
      status: "finished"
    });
  }
}

// Force winner when 20 calls reached — picks real player or best bot
async function forceWinnerAt20(room, roomId) {
  const players    = Object.values(room.players || {});
  const called     = room.calledNumbers || [];
  const prize      = calcPrize(players.length, room.stake);

  let bestPlayer = null;
  let bestScore  = -1;
  players.forEach(p => {
    const card   = generateCard(p.cardNo, room.stake);
    const daubed = buildBotDaubed(card, called);
    if (daubed.size > bestScore) { bestScore = daubed.size; bestPlayer = p; }
  });

  if (bestPlayer && !room.winner) {
    await update(ref(db, `rooms/${roomId}`), {
      winner: {
        uid: bestPlayer.uid,
        username: bestPlayer.username || bestPlayer.name,
        isBot: !!bestPlayer.isBot,
        prize
      },
      status: "finished"
    });
  }
}

function buildBotDaubed(cardNums, calledNumbers) {
  const d = new Set([12]);
  cardNums.forEach((n, i) => {
    if (n !== 0 && calledNumbers.includes(n)) d.add(i);
  });
  return d;
}

// ===== WINNER HANDLING =====
function handleWinner(winner, room) {
  if (callerInterval) { clearInterval(callerInterval); callerInterval = null; }

  if (winner.uid === UID) return; // Already handled in shoutBingo

  const isLoss = winner.uid !== UID;
  if (isLoss) {
    showResultScreen(false, room.stake, winner.username || "Unknown");
  }
}

function showResultScreen(won, amount, winnerName) {
  const el_emoji  = $("resultEmoji");
  const el_title  = $("resultTitle");
  const el_amount = $("resultAmount");
  const el_winner = $("resultWinner");
  const el_sub    = $("resultSub");

  if (won) {
    el_emoji.textContent  = "🏆";
    el_title.textContent  = "አሸነፉ!";
    el_title.className    = "result-title";
    el_amount.textContent = "+" + amount + " ETB";
    el_amount.className   = "result-amount";
    el_winner.textContent = "Winner: " + winnerName;
    el_sub.textContent    = "ሽልማቱ ወደ ሂሳብዎ ተጨምሯል";
  } else {
    el_emoji.textContent  = "😞";
    el_title.textContent  = "አልተሳካም";
    el_title.className    = "result-title loss";
    el_amount.textContent = "-" + amount + " ETB";
    el_amount.className   = "result-amount loss";
    el_winner.textContent = "Winner: " + winnerName;
    el_sub.textContent    = "ሌላ ተጫዋች አሸንፏል። እንደገና ይሞክሩ!";
  }

  showScreen("screen-result");
  cleanupGame();
}

function cleanupGame() {
  if (roomListener) { roomListener(); roomListener = null; }
  if (callerInterval) { clearInterval(callerInterval); callerInterval = null; }
  currentRoomId = null;
  isHost = false;
  startScheduled = false;
  daubedSet = new Set();
  gameCardNums = [];
}

// ===== LEAVE GAME =====
function leaveGame() {
  if (currentRoomId) {
    remove(ref(db, `rooms/${currentRoomId}/players/${UID}`));
  }
  cleanupGame();
  showScreen("screen-home");
  toast("🚪 ጨዋታውን ለቅቀዋል");
}
window.leaveGame = leaveGame;

// ===== DEPOSIT =====
async function submitDeposit() {
  const amt = parseFloat($("depAmount").value);
  const sms = $("depSms").value.trim();

  if (!amt || amt < 50) { toast("⚠ ቢያንስ 50 ETB ያስገቡ!"); return; }
  if (!sms) { toast("⚠ SMS ማረጋገጫ ያስፈልጋል!"); return; }

  // Save pending request to Firebase
  const txRef = push(ref(db, `users/${UID}/transactions`));
  await set(txRef, {
    type: "deposit",
    status: "pending",
    amount: amt,
    sms,
    uid: UID,
    username: tgUser.username || myUsername,
    ts: serverTimestamp()
  });

  // Also save to admin requests
  const adminRef = push(ref(db, `depositRequests`));
  await set(adminRef, {
    uid: UID,
    username: tgUser.username || myUsername,
    name: `${tgUser.first_name||""} ${tgUser.last_name||""}`.trim(),
    amount: amt,
    sms,
    status: "pending",
    ts: serverTimestamp()
  });

  $("depAmount").value = "";
  $("depSms").value = "";
  toast("✅ ጥያቄዎ ተልኳል! ከ admin ማረጋገጫ ይጠብቁ");
  loadDepositHistory();
}
window.submitDeposit = submitDeposit;

// Single persistent listener — started once at app init, never re-created
let _depHistStarted = false;
function loadDepositHistory() {
  if (_depHistStarted) return; // already listening
  _depHistStarted = true;
  onValue(ref(db, `users/${UID}/transactions`), snap => {
    const container = $("depositHistory");
    if (!container) return;
    container.innerHTML = "";
    if (!snap.exists()) return;
    const txs = [];
    snap.forEach(s => txs.push({ ...s.val(), key: s.key }));
    txs.filter(t => t.type === "deposit")
       .sort((a, b) => (b.ts || 0) - (a.ts || 0))
       .slice(0, 8)
       .forEach(t => {
         const el = document.createElement("div");
         el.className = `hist-item hist-dep ${t.status === "pending" ? "hist-pending" : ""}`;
         el.innerHTML = `
           <div class="hist-label">📥 Deposit</div>
           <div class="hist-right">
             <div class="hist-amount pos">+${t.amount} ETB</div>
             ${t.status === "pending"
               ? `<div class="hist-status">⏳ Pending...</div>`
               : `<div class="hist-status" style="color:var(--green)">✅ Approved</div>`}
           </div>
         `;
         container.appendChild(el);
       });
  });
}

// ===== WITHDRAW =====
async function submitWithdraw() {
  const phone = $("wdPhone").value.trim();
  const amt   = parseFloat($("wdAmount").value);
  if (!phone || phone.length < 10) { toast("⚠ ትክክለኛ TeleBirr ቁጥር ያስገቡ!"); return; }
  if (!amt || amt < 50)            { toast("⚠ ቢያንስ 50 ETB ያስገቡ!");           return; }
  if (amt > userBalance)           { toast("⚠ በቂ ሂሳብ የለዎትም!");              return; }

  const fee    = +(amt * 0.05).toFixed(2);
  const payout = +(amt - fee).toFixed(2);
  const newBal = +(userBalance - amt).toFixed(2);

  await update(ref(db, `users/${UID}`), { balance: newBal });
  userBalance = newBal;
  $("topBalance").textContent    = userBalance.toFixed(2);
  $("menuBalance").textContent   = userBalance.toFixed(2);
  $("withdrawBalanceDisplay").textContent = userBalance.toFixed(2) + " ETB";

  const txRef = push(ref(db, `users/${UID}/transactions`));
  await set(txRef, { type:"withdraw", status:"pending", amount:amt, fee, payout, phone, uid:UID, username: tgUser.username||myUsername, ts: serverTimestamp() });

  const adminRef = push(ref(db, `withdrawRequests`));
  await set(adminRef, { uid:UID, username: tgUser.username||myUsername, name:`${tgUser.first_name||""} ${tgUser.last_name||""}`.trim(), amount:amt, fee, payout, phone, status:"pending", ts: serverTimestamp() });

  $("wdPhone").value = ""; $("wdAmount").value = "";
  toast(`✅ ጥያቄዎ ተልኳል! ${payout} ETB ወደ ${phone} ይደርሳል`);
}
window.submitWithdraw = submitWithdraw;

function loadWithdrawHistory() {
  const container = $("withdrawHistory");
  if (!container) return;
  onValue(ref(db, `users/${UID}/transactions`), snap => {
    container.innerHTML = "";
    if (!snap.exists()) return;
    const txs = [];
    snap.forEach(s => txs.push({ ...s.val(), key: s.key }));
    txs.filter(t => t.type === "withdraw").reverse().slice(0, 8).forEach(t => {
      const el = document.createElement("div");
      el.className = `hist-item hist-bet ${t.status === "pending" ? "hist-pending" : ""}`;
      el.innerHTML = `
        <div class="hist-label">📤 Withdraw → ${t.phone||""}</div>
        <div class="hist-right">
          <div class="hist-amount neg">-${t.amount} ETB</div>
          ${t.status === "pending" ? `<div class="hist-status">⏳ Pending...</div>` : `<div class="hist-status" style="color:var(--green)">✅ ተላልፏል</div>`}
        </div>
      `;
      container.appendChild(el);
    });
  });
}
window.loadWithdrawHistory = loadWithdrawHistory;

// ===== FULL HISTORY =====
async function showHistory() {
  showScreen("screen-history");
  const snap = await get(ref(db, `users/${UID}/transactions`));
  const container = $("fullHistory");
  container.innerHTML = "";
  if (!snap.exists()) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-dim);padding:40px;font-family:var(--font-am)">ምንም ግብይት የለም</div>`;
    return;
  }
  const txs = [];
  snap.forEach(s => txs.push({ ...s.val(), key: s.key }));
  txs.reverse().forEach(t => {
    const el = document.createElement("div");
    const cls = t.type === "win" ? "hist-win" : t.type === "deposit" ? "hist-dep" : "hist-bet";
    const icon = t.type === "win" ? "🏆" : t.type === "deposit" ? "📥" : "🎯";
    const pos = t.type === "win" || t.type === "deposit";
    el.className = `hist-item ${cls}`;
    el.innerHTML = `
      <div class="hist-label">${icon} ${t.type === "win" ? "ድል" : t.type === "deposit" ? "Deposit" : "Stake"} — ${t.stake||t.amount} ETB</div>
      <div class="hist-right">
        <div class="hist-amount ${pos?"pos":"neg"}">${pos?"+":"-"}${t.amount} ETB</div>
        ${t.status === "pending" ? `<div class="hist-status">⏳ Pending</div>` : ""}
      </div>
    `;
    container.appendChild(el);
  });
}
window.showHistory = showHistory;

// ===== CONFETTI =====
function launchConfetti() {
  const wrap = $("confettiWrap");
  wrap.innerHTML = "";
  const colors = ["#ffd700","#ff9500","#ff4444","#00e676","#00e5ff","#e040fb","#0061ff"];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("div");
    p.className = "conf-piece";
    p.style.cssText = `
      left: ${Math.random()*100}%;
      background: ${colors[Math.floor(Math.random()*colors.length)]};
      width: ${Math.random()*8+5}px;
      height: ${Math.random()*8+5}px;
      border-radius: ${Math.random()>.5 ? "50%" : "2px"};
      animation-duration: ${Math.random()*2+1.5}s;
      animation-delay: ${Math.random()*0.8}s;
    `;
    wrap.appendChild(p);
  }
  setTimeout(() => wrap.innerHTML = "", 4000);
}

// ===== INIT APP =====
const ADMIN_ID = "8460829504";
const IS_ADMIN = UID === ADMIN_ID;

async function init() {
  buildStakeGrid();
  startCycleEngine();
  await initUser();
  if (IS_ADMIN) {
    showScreen("screen-admin");
    loadAdminPanel();
  } else {
    showScreen("screen-home");
    loadDepositHistory();
  }
}

init();


// ===== ADMIN PANEL =====
// Uses event delegation — works correctly inside ES modules

function isPending(status) {
  return !status || status === "pending";
}

function loadAdminPanel() {
  loadAdminStats();
  loadAdminDeposits();
  loadAdminWithdraws();
  loadAdminUsers();
}

function adminTab(tab) {
  ["deposit","withdraw","users"].forEach(t => {
    const panel = document.getElementById("adminPanel" + t.charAt(0).toUpperCase() + t.slice(1));
    const btn   = document.getElementById("tab"   + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.style.display = (t === tab) ? "block" : "none";
    if (btn)   btn.classList.toggle("active", t === tab);
  });
}
window.adminTab = adminTab;

// ---- STATS ----
function loadAdminStats() {
  onValue(ref(db, "depositRequests"), snap => {
    let c = 0;
    if (snap.exists()) snap.forEach(s => { if (isPending(s.val().status)) c++; });
    document.getElementById("adminPendingDep").textContent = c;
  });
  onValue(ref(db, "withdrawRequests"), snap => {
    let c = 0;
    if (snap.exists()) snap.forEach(s => { if (isPending(s.val().status)) c++; });
    document.getElementById("adminPendingWd").textContent = c;
  });
  onValue(ref(db, "users"), snap => {
    document.getElementById("adminTotalUsers").textContent =
      snap.exists() ? Object.keys(snap.val()).length : 0;
  });
}

// ---- DEPOSITS ----
function renderDepositCard(item) {
  const pend = isPending(item.status);
  const statusLabel = pend ? "⏳ Pending"
    : item.status === "approved" ? "✅ Approved" : "❌ Cancelled";
  const statusClass = pend ? "st-pending"
    : item.status === "approved" ? "st-approved" : "st-cancelled";
  const cardClass = pend ? "acard-pending"
    : item.status === "approved" ? "acard-approved" : "acard-cancelled";

  const card = document.createElement("div");
  card.className = "admin-card " + cardClass;
  card.dataset.key    = item.key;
  card.dataset.uid    = item.uid;
  card.dataset.amount = item.amount;

  card.innerHTML = `
    <div class="ac-row">
      <div class="ac-user">
        <div class="ac-name">@${item.username || "unknown"}</div>
        <div class="ac-uid">ID: ${item.uid}</div>
      </div>
      <div class="ac-amount pos">+${item.amount} ETB</div>
    </div>
    <div class="ac-row ac-meta">
      <span>📱 SMS: <b>${item.sms || "—"}</b></span>
      <span class="ac-status ${statusClass}">${statusLabel}</span>
    </div>
    ${pend ? `
    <div class="ac-actions">
      <button class="ac-btn ac-approve" data-action="dep-approve">✅ Approve</button>
      <button class="ac-btn ac-cancel"  data-action="dep-cancel">❌ Cancel</button>
    </div>` : ""}
  `;

  if (pend) {
    card.querySelector('[data-action="dep-approve"]')
      .addEventListener("click", () => adminApproveDeposit(item.key, item.uid, item.amount));
    card.querySelector('[data-action="dep-cancel"]')
      .addEventListener("click", () => adminCancelDeposit(item.key));
  }
  return card;
}

function loadAdminDeposits() {
  onValue(ref(db, "depositRequests"), snap => {
    const list = document.getElementById("adminDepositList");
    if (!list) return;
    list.innerHTML = "";

    if (!snap.exists()) {
      list.innerHTML = '<div class="admin-empty">ምንም deposit request የለም</div>';
      return;
    }

    const items = [];
    snap.forEach(s => items.push({ key: s.key, ...s.val() }));

    // Sort: pending first, then by timestamp desc
    items.sort((a, b) => {
      const ap = isPending(a.status) ? 0 : 1;
      const bp = isPending(b.status) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.ts || 0) - (a.ts || 0);
    });

    items.forEach(item => list.appendChild(renderDepositCard(item)));
  });
}

async function adminApproveDeposit(key, uid, amount) {
  if (!confirm(`${amount} ETB approve ታደርጋለህ?`)) return;
  try {
    // 1. Mark deposit request approved
    await update(ref(db, `depositRequests/${key}`), { status: "approved" });

    // 2. Mark user's matching transaction approved
    const txSnap = await get(ref(db, `users/${uid}/transactions`));
    if (txSnap.exists()) {
      const updates = {};
      txSnap.forEach(s => {
        const t = s.val();
        if (t.type === "deposit" && isPending(t.status) && t.amount === amount) {
          updates[`users/${uid}/transactions/${s.key}/status`] = "approved";
        }
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }

    // 3. Credit user balance
    const balSnap = await get(ref(db, `users/${uid}/balance`));
    const cur = balSnap.exists() ? (balSnap.val() || 0) : 0;
    await update(ref(db, `users/${uid}`), { balance: +(cur + amount).toFixed(2) });

    toast("✅ " + amount + " ETB approved! ሂሳቡ ወደ ተጠቃሚው ተጨምሯል");
  } catch(e) {
    toast("❌ Error: " + e.message);
  }
}

async function adminCancelDeposit(key) {
  if (!confirm("ይህን deposit request ሰርዝ?")) return;
  try {
    await update(ref(db, `depositRequests/${key}`), { status: "cancelled" });
    toast("❌ Deposit cancelled.");
  } catch(e) {
    toast("❌ Error: " + e.message);
  }
}

// ---- WITHDRAWALS ----
function renderWithdrawCard(item) {
  const pend = isPending(item.status);
  const statusLabel = pend ? "⏳ Pending"
    : item.status === "approved" ? "✅ Sent" : "❌ Cancelled";
  const statusClass = pend ? "st-pending"
    : item.status === "approved" ? "st-approved" : "st-cancelled";
  const cardClass = pend ? "acard-pending"
    : item.status === "approved" ? "acard-approved" : "acard-cancelled";

  const card = document.createElement("div");
  card.className = "admin-card " + cardClass;

  card.innerHTML = `
    <div class="ac-row">
      <div class="ac-user">
        <div class="ac-name">@${item.username || "unknown"}</div>
        <div class="ac-uid">ID: ${item.uid}</div>
      </div>
      <div class="ac-amount neg">-${item.amount} ETB</div>
    </div>
    <div class="ac-row ac-meta">
      <span>📱 ${item.phone || "—"}</span>
      <span>💸 Payout: ${item.payout || item.amount} ETB</span>
      <span class="ac-status ${statusClass}">${statusLabel}</span>
    </div>
    ${pend ? `
    <div class="ac-actions">
      <button class="ac-btn ac-approve" data-action="wd-approve">✅ Mark Sent</button>
      <button class="ac-btn ac-cancel"  data-action="wd-cancel">❌ Refund</button>
    </div>` : ""}
  `;

  if (pend) {
    card.querySelector('[data-action="wd-approve"]')
      .addEventListener("click", () => adminApproveWithdraw(item.key, item.uid, item.amount));
    card.querySelector('[data-action="wd-cancel"]')
      .addEventListener("click", () => adminCancelWithdraw(item.key, item.uid, item.amount));
  }
  return card;
}

function loadAdminWithdraws() {
  onValue(ref(db, "withdrawRequests"), snap => {
    const list = document.getElementById("adminWithdrawList");
    if (!list) return;
    list.innerHTML = "";

    if (!snap.exists()) {
      list.innerHTML = '<div class="admin-empty">ምንም withdrawal request የለም</div>';
      return;
    }

    const items = [];
    snap.forEach(s => items.push({ key: s.key, ...s.val() }));

    items.sort((a, b) => {
      const ap = isPending(a.status) ? 0 : 1;
      const bp = isPending(b.status) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.ts || 0) - (a.ts || 0);
    });

    items.forEach(item => list.appendChild(renderWithdrawCard(item)));
  });
}

async function adminApproveWithdraw(key, uid, amount) {
  if (!confirm(`${amount} ETB sent ታረጋግጣለህ?`)) return;
  try {
    await update(ref(db, `withdrawRequests/${key}`), { status: "approved" });

    const txSnap = await get(ref(db, `users/${uid}/transactions`));
    if (txSnap.exists()) {
      const updates = {};
      txSnap.forEach(s => {
        const t = s.val();
        if (t.type === "withdraw" && isPending(t.status) && t.amount === amount) {
          updates[`users/${uid}/transactions/${s.key}/status`] = "approved";
        }
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }

    toast("✅ Withdrawal marked as sent!");
  } catch(e) {
    toast("❌ Error: " + e.message);
  }
}

async function adminCancelWithdraw(key, uid, amount) {
  if (!confirm(`Cancel & refund ${amount} ETB?`)) return;
  try {
    await update(ref(db, `withdrawRequests/${key}`), { status: "cancelled" });

    const txSnap = await get(ref(db, `users/${uid}/transactions`));
    if (txSnap.exists()) {
      const updates = {};
      txSnap.forEach(s => {
        const t = s.val();
        if (t.type === "withdraw" && isPending(t.status) && t.amount === amount) {
          updates[`users/${uid}/transactions/${s.key}/status`] = "cancelled";
        }
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }

    // Refund balance
    const balSnap = await get(ref(db, `users/${uid}/balance`));
    const cur = balSnap.exists() ? (balSnap.val() || 0) : 0;
    await update(ref(db, `users/${uid}`), { balance: +(cur + amount).toFixed(2) });

    toast("↩ Refunded " + amount + " ETB to user");
  } catch(e) {
    toast("❌ Error: " + e.message);
  }
}

// ---- USERS ----
function loadAdminUsers() {
  onValue(ref(db, "users"), snap => {
    const list = document.getElementById("adminUserList");
    if (!list) return;
    list.innerHTML = "";

    if (!snap.exists()) {
      list.innerHTML = '<div class="admin-empty">ምንም user የለም</div>';
      return;
    }

    const users = [];
    snap.forEach(s => users.push({ uid: s.key, ...s.val() }));
    users.sort((a, b) => (b.balance || 0) - (a.balance || 0));

    users.forEach(u => {
      const card = document.createElement("div");
      card.className = "admin-card acard-user";
      card.innerHTML = `
        <div class="ac-row">
          <div class="ac-user">
            <div class="ac-name">${u.name || u.username || "Unknown"}</div>
            <div class="ac-uid">@${u.username || "—"} · ID: ${u.uid}</div>
          </div>
          <div class="ac-amount pos">${(u.balance || 0).toFixed(2)} ETB</div>
        </div>
        <div class="ac-row ac-meta">
          <button class="ac-btn ac-approve" style="flex:1" data-action="adjust">💰 Balance አስተካክል</button>
        </div>
      `;
      card.querySelector('[data-action="adjust"]')
        .addEventListener("click", () => adminAdjustBalance(u.uid, u.name || u.username || u.uid, u.balance || 0));
      list.appendChild(card);
    });
  });
}

async function adminAdjustBalance(uid, name, cur) {
  const val = prompt(`${name}\nአዲስ balance (አሁን: ${cur} ETB):`);
  if (val === null) return;
  const nb = parseFloat(val);
  if (isNaN(nb) || nb < 0) { toast("⚠ ትክክለኛ ቁጥር ያስገቡ"); return; }
  try {
    await update(ref(db, `users/${uid}`), { balance: nb });
    toast(`✅ Balance → ${nb} ETB`);
  } catch(e) {
    toast("❌ Error: " + e.message);
  }
}
