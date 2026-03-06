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
const ADMIN_ID = "8460829504";
const IS_ADMIN = UID === ADMIN_ID;

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

// Async cycle states per stake
const cycleState = {};
STAKE_CONFIG.forEach(s => {
  if (NO_PLAYER_STAKES.has(s.amount)) {
    cycleState[s.amount] = { phase: "none", pos: 0, elapsed: 0 };
  } else {
    const rnd = Math.floor(Math.random() * (JOIN_SEC + GAME_SEC));
    cycleState[s.amount] = {
      phase: rnd < JOIN_SEC ? "join" : "started",
      pos: rnd,
      elapsed: rnd < JOIN_SEC ? rnd : rnd - JOIN_SEC
    };
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
  $("wmBalance").textContent = userBalance.toFixed(2) + " ETB";
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
      const st = cycleState[cfg.amount];
      st.pos = (st.pos + 1) % (JOIN_SEC + GAME_SEC);

      if (st.pos < JOIN_SEC) {
        if (st.phase === "started") {
          st.phase = "join";
          resetPlayerCount(cfg.amount, cfg.min);
          // Game just ended → save old cards as "prev" for 30% carry-over, then clear cache
          lastGameCards[`prev_${cfg.amount}`] = lastGameCards[cfg.amount] || [];
          lastGameCards[cfg.amount] = []; // force regeneration on next card screen open
        }
        st.elapsed = st.pos;
      } else {
        if (st.phase === "join") st.phase = "started";
        st.elapsed = st.pos - JOIN_SEC;
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
    // Player count stays frozen during game — no dropPlayers call
  }

  // If user is on card selection screen for this stake, sync the button
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

// Stores last game's taken card numbers per stake, for 30% carry-over
const lastGameCards = {}; // { [amount]: number[] }

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

// Updates the start button based on whether the game is in join or started phase
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

  const cfg = STAKE_CONFIG.find(c => c.amount === amount);
  const st  = cycleState[amount];

  // --- Phase "started": game is LIVE → all simulated cards released, only real room cards locked ---
  if (st && st.phase === "started") {
    const snap = await get(ref(db, `rooms`));
    if (snap.exists()) {
      snap.forEach(roomSnap => {
        const r = roomSnap.val();
        if (r.stake !== amount || r.status !== "started") return;
        if (r.players) {
          Object.values(r.players).forEach(p => {
            if (p.cardNo) takenCards.add(p.cardNo);
          });
        }
      });
    }
    return; // No simulated cards — grid mostly open for next player
  }

  // --- Phase "join": lobby open → show stable simulated taken cards ---

  // Step 1: Real cards from waiting rooms only
  const snap = await get(ref(db, `rooms`));
  const realTaken = new Set();
  if (snap.exists()) {
    snap.forEach(roomSnap => {
      const r = roomSnap.val();
      if (r.stake !== amount || r.status !== "waiting") return;
      if (r.players) {
        Object.values(r.players).forEach(p => {
          if (p.cardNo) realTaken.add(p.cardNo);
        });
      }
    });
  }
  realTaken.forEach(c => takenCards.add(c));

  if (!cfg) return;

  // Step 2: Use STABLE cached simulated cards — only regenerate when game cycle resets
  // lastGameCards[amount] is set once per join cycle by the cycle engine, not on back-button
  if (!lastGameCards[amount] || lastGameCards[amount].length === 0) {
    _regenerateSimulatedCards(amount, cfg, realTaken);
  }
  (lastGameCards[amount] || []).forEach(c => {
    if (!takenCards.has(c)) takenCards.add(c);
  });
}

// Called ONCE when a new join cycle starts (game just ended → new lobby open)
function _regenerateSimulatedCards(amount, cfg, realTaken) {
  const shownEl    = $(`sp-${amount}`);
  const playerCount = shownEl ? (parseInt(shownEl.textContent) || cfg.min) : cfg.min;
  const slotsNeeded = Math.max(0, playerCount - (realTaken ? realTaken.size : 0));
  if (slotsNeeded <= 0) { lastGameCards[amount] = []; return; }

  const prev       = lastGameCards[`prev_${amount}`] || [];
  const carryCount = Math.round(slotsNeeded * 0.30);
  const freshCount = slotsNeeded - carryCount;
  const simulated  = new Set();

  // 30% carry-over from previous game's cards
  const prevAvail = prev.filter(c => !realTaken || !realTaken.has(c));
  seededShuffle(prevAvail, amount * 31 + (Date.now() % 9999));
  prevAvail.slice(0, carryCount).forEach(c => simulated.add(c));

  // 70% fresh random cards
  const pool = [];
  for (let i = 1; i <= 100; i++) {
    if ((!realTaken || !realTaken.has(i)) && !simulated.has(i)) pool.push(i);
  }
  seededShuffle(pool, amount * 13 + (Date.now() % 7777));
  pool.slice(0, freshCount).forEach(c => simulated.add(c));

  lastGameCards[amount] = Array.from(simulated);
}

// Simple in-place shuffle with a seed offset
function seededShuffle(arr, offset) {
  let s = (offset * 1103515245 + 12345) & 0x7fffffff;
  function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
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
  const nums = generateCard(seed, selectedStake);
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
function generateCard(seed, stake) {
  const stakeOffset = stake ? stake * 137 : 0;
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  let s = (seed * 9301 + 49297 + stakeOffset);
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
  // Look for open room with same stake
  const snap = await get(ref(db, "rooms"));
  if (snap.exists()) {
    let found = null;
    snap.forEach(r => {
      const v = r.val();
      if (v.stake === stake && v.status === "waiting" && !found) {
        const playerCount = v.players ? Object.keys(v.players).length : 0;
        if (playerCount < MAX_PLAYERS) found = r.key;
      }
    });
    if (found) return found;
  }

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
    if (document.getElementById("screen-lobby").classList.contains("active")) {
      startGameUI(room);
    }
    // Sync called numbers
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

  // Add bots if < 6 total AND stake is 10
  let allPlayers = [...players];
  if (stake === 10 && allPlayers.length < 6) {
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
  gameCardNums = generateCard(selectedCardNo, selectedStake);
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

    if (idx >= callOrder.length) {
      clearInterval(callerInterval);
      return;
    }

    const num = callOrder[idx];
    const calledNumbers = [...(room.calledNumbers || []), num];

    await update(ref(db, `rooms/${roomId}`), {
      calledNumbers,
      callIndex: idx + 1,
      lastCalled: num
    });

    // Bot auto-check bingo
    if (room.players) {
      checkBotBingo(room, calledNumbers, roomId);
    }
  }, CALL_MS);
}

// ===== SYNC CALLED NUMBERS =====
function syncCalledNumbers(calledNums) {
  if (!calledNums || !calledNums.length) return;
  const latest = calledNums[calledNums.length - 1];

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

  // Each bot has ~3% chance per call to "win" naturally (after 20 calls)
  if (calledNumbers.length < 20) return;
  bots.forEach(bot => {
    const botCard = generateCard(bot.cardNo, selectedStake);
    const botDaubed = buildBotDaubed(botCard, calledNumbers);
    if (checkBingo(botDaubed) && Math.random() < 0.04) {
      const playerList = Object.values(room.players);
      const prize = calcPrize(playerList.length, room.stake);
      // Bot wins — house keeps prize
      update(ref(db, `rooms/${roomId}`), {
        winner: { uid: bot.uid, username: bot.username, isBot: true, prize },
        status: "finished"
      });
    }
  });
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
  // onValue listener already active — updates automatically
}
window.submitDeposit = submitDeposit;

// ===== WITHDRAW =====
async function submitWithdraw() {
  const phone = $("wdPhone").value.trim();
  const amt   = parseFloat($("wdAmount").value);

  if (!phone || phone.length < 10) { toast("⚠ ትክክለኛ TeleBirr ቁጥር ያስገቡ!"); return; }
  if (!amt || amt < 50)            { toast("⚠ ቢያንስ 50 ETB ያስገቡ!");           return; }
  if (amt > userBalance)           { toast("⚠ በቂ ሂሳብ የለዎትም!");              return; }

  const fee     = +(amt * 0.05).toFixed(2);
  const payout  = +(amt - fee).toFixed(2);

  // Deduct balance immediately (optimistic)
  const newBal = +(userBalance - amt).toFixed(2);
  await update(ref(db, `users/${UID}`), { balance: newBal });
  userBalance = newBal;
  $("topBalance").textContent = userBalance.toFixed(2);
  $("menuBalance").textContent = userBalance.toFixed(2);
  $("withdrawBalanceDisplay").textContent = userBalance.toFixed(2) + " ETB";

  // Save to user transactions
  const txRef = push(ref(db, `users/${UID}/transactions`));
  await set(txRef, {
    type:     "withdraw",
    status:   "pending",
    amount:   amt,
    fee,
    payout,
    phone,
    uid:      UID,
    username: tgUser.username || myUsername,
    ts:       serverTimestamp()
  });

  // Save to admin withdraw requests
  const adminRef = push(ref(db, `withdrawRequests`));
  await set(adminRef, {
    uid:      UID,
    username: tgUser.username || myUsername,
    name:     `${tgUser.first_name||""} ${tgUser.last_name||""}`.trim(),
    amount:   amt,
    fee,
    payout,
    phone,
    status:   "pending",
    ts:       serverTimestamp()
  });

  $("wdPhone").value  = "";
  $("wdAmount").value = "";
  toast(`✅ ጥያቄዎ ተልኳል! ${payout} ETB ወደ ${phone} ይደርሳል`);
  // onValue listener already active — updates automatically
}
window.submitWithdraw = submitWithdraw;

// Withdraw history — single persistent listener, started once
function initWithdrawHistoryListener() {
  onValue(ref(db, `users/${UID}/transactions`), snap => {
    const container = $("withdrawHistory");
    if (!container) return;
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
          ${t.status === "pending"
            ? `<div class="hist-status">⏳ Pending...</div>`
            : `<div class="hist-status" style="color:var(--green)">✅ ተላልፏል</div>`}
        </div>
      `;
      container.appendChild(el);
    });
  });
}
function loadWithdrawHistory() {} // kept for legacy calls — listener already running
window.loadWithdrawHistory = loadWithdrawHistory;


// Deposit history — single persistent listener, started once
function initDepositHistoryListener() {
  onValue(ref(db, `users/${UID}/transactions`), snap => {
    const container = $("depositHistory");
    if (!container) return;
    container.innerHTML = "";
    if (!snap.exists()) return;
    const txs = [];
    snap.forEach(s => txs.push({ ...s.val(), key: s.key }));
    txs.filter(t => t.type === "deposit").reverse().slice(0, 8).forEach(t => {
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
function loadDepositHistory() {} // kept for legacy calls — listener already running

// Full history — single persistent listener, started once
function initFullHistoryListener() {
  onValue(ref(db, `users/${UID}/transactions`), snap => {
    const container = $("fullHistory");
    if (!container) return;
    container.innerHTML = "";
    if (!snap.exists()) {
      container.innerHTML = `<div style="text-align:center;color:var(--text-dim);padding:40px;font-family:var(--font-am)">ምንም ግብይት የለም</div>`;
      return;
    }
    const txs = [];
    snap.forEach(s => txs.push({ ...s.val(), key: s.key }));
    txs.reverse().forEach(t => {
      const el   = document.createElement("div");
      const cls  = t.type === "win" ? "hist-win" : t.type === "deposit" ? "hist-dep" : "hist-bet";
      const icon = t.type === "win" ? "🏆" : t.type === "deposit" ? "📥" : t.type === "withdraw" ? "📤" : "🎯";
      const pos  = t.type === "win" || t.type === "deposit";
      el.className = `hist-item ${cls}`;
      el.innerHTML = `
        <div class="hist-label">${icon} ${t.type === "win" ? "ድል" : t.type === "deposit" ? "Deposit" : t.type === "withdraw" ? "Withdraw" : "Stake"} — ${t.stake||t.amount} ETB</div>
        <div class="hist-right">
          <div class="hist-amount ${pos?"pos":"neg"}">${pos?"+":"-"}${t.amount} ETB</div>
          ${t.status === "pending" ? `<div class="hist-status">⏳ Pending</div>` : ""}
        </div>
      `;
      container.appendChild(el);
    });
  });
}
function showHistory() { showScreen("screen-history"); }
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
async function init() {
  buildStakeGrid();
  startCycleEngine();
  await initUser();

  if (IS_ADMIN) {
    showScreen("screen-admin");
    loadAdminPanel();
  } else {
    initDepositHistoryListener();
    initWithdrawHistoryListener();
    initFullHistoryListener();
  }
}

init();

// ===== ADMIN PANEL =====
function loadAdminPanel() {
  loadAdminDeposits();
  loadAdminWithdraws();
  loadAdminUsers();
  loadAdminStats();
}

function adminTab(tab) {
  ["deposit","withdraw","users"].forEach(t => {
    $(`adminPanel${t.charAt(0).toUpperCase()+t.slice(1)}`).style.display = t === tab ? "block" : "none";
    $(`tab${t.charAt(0).toUpperCase()+t.slice(1)}`).classList.toggle("active", t === tab);
  });
}
window.adminTab = adminTab;

function loadAdminStats() {
  // Pending deposits count
  onValue(ref(db, "depositRequests"), snap => {
    let count = 0;
    snap.forEach(s => { if (s.val().status === "pending") count++; });
    $("adminPendingDep").textContent = count;
  });
  // Pending withdrawals count
  onValue(ref(db, "withdrawRequests"), snap => {
    let count = 0;
    snap.forEach(s => { if (s.val().status === "pending") count++; });
    $("adminPendingWd").textContent = count;
  });
  // Total users
  onValue(ref(db, "users"), snap => {
    $("adminTotalUsers").textContent = snap.exists() ? Object.keys(snap.val()).length : 0;
  });
}

// ---- DEPOSITS ----
function loadAdminDeposits() {
  onValue(ref(db, "depositRequests"), snap => {
    const list = $("adminDepositList");
    list.innerHTML = "";
    if (!snap.exists()) {
      list.innerHTML = `<div class="admin-empty">ምንም deposit request የለም</div>`;
      return;
    }
    const items = [];
    snap.forEach(s => items.push({ key: s.key, ...s.val() }));
    items.sort((a,b) => (b.ts||0) - (a.ts||0));
    items.forEach(item => {
      const card = document.createElement("div");
      card.className = `admin-card ${item.status === "pending" ? "acard-pending" : item.status === "approved" ? "acard-approved" : "acard-cancelled"}`;
      const date = item.ts ? new Date(item.ts).toLocaleString("am-ET") : "—";
      card.innerHTML = `
        <div class="ac-row">
          <div class="ac-user">
            <div class="ac-name">@${item.username||"unknown"}</div>
            <div class="ac-uid">ID: ${item.uid}</div>
          </div>
          <div class="ac-amount pos">+${item.amount} ETB</div>
        </div>
        <div class="ac-row ac-meta">
          <span>📱 SMS: <b>${item.sms||"—"}</b></span>
          <span class="ac-date">${date}</span>
        </div>
        <div class="ac-row ac-meta">
          <span>👤 ${item.name||""}</span>
          <span class="ac-status ${item.status === "pending" ? "st-pending" : item.status === "approved" ? "st-approved" : "st-cancelled"}">
            ${item.status === "pending" ? "⏳ Pending" : item.status === "approved" ? "✅ Approved" : "❌ Cancelled"}
          </span>
        </div>
        ${item.status === "pending" ? `
        <div class="ac-actions">
          <button class="ac-btn ac-approve" onclick="adminApproveDeposit('${item.key}','${item.uid}',${item.amount})">✅ Approve</button>
          <button class="ac-btn ac-cancel" onclick="adminCancelDeposit('${item.key}')">❌ Cancel</button>
        </div>` : ""}
      `;
      list.appendChild(card);
    });
  });
}

async function adminApproveDeposit(key, uid, amount) {
  if (!confirm(`${amount} ETB deposit approve ታደርጋለህ?`)) return;
  // Update deposit request status
  await update(ref(db, `depositRequests/${key}`), { status: "approved" });
  // Find and update user transaction
  const txSnap = await get(ref(db, `users/${uid}/transactions`));
  if (txSnap.exists()) {
    txSnap.forEach(s => {
      const t = s.val();
      if (t.type === "deposit" && t.status === "pending" && t.amount === amount) {
        update(ref(db, `users/${uid}/transactions/${s.key}`), { status: "approved" });
      }
    });
  }
  // Add balance to user
  const balSnap = await get(ref(db, `users/${uid}/balance`));
  const curBal = balSnap.exists() ? (balSnap.val() || 0) : 0;
  await update(ref(db, `users/${uid}`), { balance: +(curBal + amount).toFixed(2) });
  toast(`✅ ${amount} ETB approved! Balance updated.`);
}
window.adminApproveDeposit = adminApproveDeposit;

async function adminCancelDeposit(key) {
  if (!confirm("Deposit request ሰርዝ?")) return;
  await update(ref(db, `depositRequests/${key}`), { status: "cancelled" });
  toast("❌ Deposit cancelled.");
}
window.adminCancelDeposit = adminCancelDeposit;

// ---- WITHDRAWALS ----
function loadAdminWithdraws() {
  onValue(ref(db, "withdrawRequests"), snap => {
    const list = $("adminWithdrawList");
    list.innerHTML = "";
    if (!snap.exists()) {
      list.innerHTML = `<div class="admin-empty">ምንም withdrawal request የለም</div>`;
      return;
    }
    const items = [];
    snap.forEach(s => items.push({ key: s.key, ...s.val() }));
    items.sort((a,b) => (b.ts||0) - (a.ts||0));
    items.forEach(item => {
      const card = document.createElement("div");
      card.className = `admin-card ${item.status === "pending" ? "acard-pending" : item.status === "approved" ? "acard-approved" : "acard-cancelled"}`;
      const date = item.ts ? new Date(item.ts).toLocaleString("am-ET") : "—";
      card.innerHTML = `
        <div class="ac-row">
          <div class="ac-user">
            <div class="ac-name">@${item.username||"unknown"}</div>
            <div class="ac-uid">ID: ${item.uid}</div>
          </div>
          <div class="ac-amount neg">-${item.amount} ETB</div>
        </div>
        <div class="ac-row ac-meta">
          <span>📱 TeleBirr: <b>${item.phone||"—"}</b></span>
          <span class="ac-date">${date}</span>
        </div>
        <div class="ac-row ac-meta">
          <span>💸 Payout: <b>${item.payout||item.amount} ETB</b> (fee: ${item.fee||0} ETB)</span>
          <span class="ac-status ${item.status === "pending" ? "st-pending" : item.status === "approved" ? "st-approved" : "st-cancelled"}">
            ${item.status === "pending" ? "⏳ Pending" : item.status === "approved" ? "✅ Sent" : "❌ Cancelled"}
          </span>
        </div>
        ${item.status === "pending" ? `
        <div class="ac-actions">
          <button class="ac-btn ac-approve" onclick="adminApproveWithdraw('${item.key}','${item.uid}',${item.amount})">✅ Sent</button>
          <button class="ac-btn ac-cancel" onclick="adminCancelWithdraw('${item.key}','${item.uid}',${item.amount})">❌ Cancel & Refund</button>
        </div>` : ""}
      `;
      list.appendChild(card);
    });
  });
}

async function adminApproveWithdraw(key, uid, amount) {
  if (!confirm(`${amount} ETB withdrawal ተላልፏል ብለህ confirm ታደርጋለህ?`)) return;
  await update(ref(db, `withdrawRequests/${key}`), { status: "approved" });
  const txSnap = await get(ref(db, `users/${uid}/transactions`));
  if (txSnap.exists()) {
    txSnap.forEach(s => {
      const t = s.val();
      if (t.type === "withdraw" && t.status === "pending" && t.amount === amount) {
        update(ref(db, `users/${uid}/transactions/${s.key}`), { status: "approved" });
      }
    });
  }
  toast(`✅ Withdrawal confirmed as sent!`);
}
window.adminApproveWithdraw = adminApproveWithdraw;

async function adminCancelWithdraw(key, uid, amount) {
  if (!confirm(`Withdraw ሰርዝ እና ${amount} ETB ተመላሽ ታደርጋለህ?`)) return;
  await update(ref(db, `withdrawRequests/${key}`), { status: "cancelled" });
  const txSnap = await get(ref(db, `users/${uid}/transactions`));
  if (txSnap.exists()) {
    txSnap.forEach(s => {
      const t = s.val();
      if (t.type === "withdraw" && t.status === "pending" && t.amount === amount) {
        update(ref(db, `users/${uid}/transactions/${s.key}`), { status: "cancelled" });
      }
    });
  }
  // Refund balance
  const balSnap = await get(ref(db, `users/${uid}/balance`));
  const curBal = balSnap.exists() ? (balSnap.val() || 0) : 0;
  await update(ref(db, `users/${uid}`), { balance: +(curBal + amount).toFixed(2) });
  toast(`↩ Refunded ${amount} ETB to user.`);
}
window.adminCancelWithdraw = adminCancelWithdraw;

// ---- USERS ----
function loadAdminUsers() {
  onValue(ref(db, "users"), snap => {
    const list = $("adminUserList");
    list.innerHTML = "";
    if (!snap.exists()) {
      list.innerHTML = `<div class="admin-empty">ምንም user የለም</div>`;
      return;
    }
    const users = [];
    snap.forEach(s => users.push({ uid: s.key, ...s.val() }));
    users.sort((a,b) => (b.balance||0) - (a.balance||0));
    users.forEach(u => {
      const card = document.createElement("div");
      card.className = "admin-card acard-user";
      card.innerHTML = `
        <div class="ac-row">
          <div class="ac-user">
            <div class="ac-name">${u.name||u.username||"Unknown"}</div>
            <div class="ac-uid">@${u.username||"—"} · ID: ${u.uid}</div>
          </div>
          <div class="ac-amount pos">${(u.balance||0).toFixed(2)} ETB</div>
        </div>
        <div class="ac-row ac-meta" style="gap:8px">
          <button class="ac-btn ac-approve" style="flex:1" onclick="adminAdjustBalance('${u.uid}','${u.username||u.name||u.uid}',${u.balance||0})">💰 Balance አስተካክል</button>
        </div>
      `;
      list.appendChild(card);
    });
  });
}

async function adminAdjustBalance(uid, name, currentBal) {
  const val = prompt(`${name} ሂሳብ አዲስ balance ያስገቡ (አሁን: ${currentBal} ETB)`);
  if (val === null) return;
  const newBal = parseFloat(val);
  if (isNaN(newBal) || newBal < 0) { toast("⚠ ትክክለኛ ቁጥር ያስገቡ"); return; }
  await update(ref(db, `users/${uid}`), { balance: newBal });
  toast(`✅ Balance updated to ${newBal} ETB`);
}
window.adminAdjustBalance = adminAdjustBalance;
