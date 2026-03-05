// ==================================================================
//  BARON BINGO â€” script.js
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
const NO_PLAYER_STAKES = new Set([20, 100]);

const BOT_NAMES = [
  "bek***","ale**","muli**","aben***","fits**","hayl**",
  "mery**","kedi**","tseg**","dagi**","abdu**","eyer**",
  "kal***","nati**","geta***","zelu**","daw***","rob**","feti**"
];

const STAKE_CONFIG = [
  { amount: 10,  theme: "sc-gold",   icon: "ðŸŽ¯", min: 7,  max: 18 },
  { amount: 20,  theme: "sc-green",  icon: "ðŸŽ²", min: 0,  max: 0  },
  { amount: 50,  theme: "sc-cyan",   icon: "ðŸ’Ž", min: 3,  max: 10 },
  { amount: 100, theme: "sc-purple", icon: "ðŸ‘‘", min: 0,  max: 0  }
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
    .then(() => toast("âœ… á‰áŒ¥áˆ© á‰°áŒˆáˆá‰¥áŒ§áˆ!"))
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
window.openDeposit = () => showScreen("screen-deposit");

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
          <span><span id="sp-${cfg.amount}">${isNP ? 0 : cfg.min}</span> á‰°áŒ«á‹‹á‰¾á‰½</span>
        </div>
        <div class="sc-prize">ðŸ† <span class="sc-prize-val" id="sw-${cfg.amount}">${isNP ? 0 : cfg.min * cfg.amount}</span> ETB</div>
        ${isNP
          ? `<div class="sc-no-players-label">á‰°áŒ«á‹‹á‰½ á‹¨áˆˆáˆ</div>`
          : `<div class="sc-phase phase-join" id="sph-${cfg.amount}">
               <span class="sc-phase-dot"></span>
               <span id="sphl-${cfg.amount}">áˆ˜á‰€áˆ‹á‰€áˆ á‹­á‰»áˆ‹áˆ</span>
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
        toast("âš  á‹­áˆ… stake áˆ‹á‹­ áŒˆáŠ“ á‰°áŒ«á‹‹á‰¾á‰½ á‹¨áˆ‰áˆ");
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
    lbl.textContent = "áˆ˜á‰€áˆ‹á‰€áˆ á‹­á‰»áˆ‹áˆ";
    tf.className  = "sc-timer-fill tf-join";
    tf.style.width = ((rem / JOIN_SEC) * 100) + "%";
    tv.textContent = rem + "s";
    if (Math.random() < 0.25) fluctuatePlayers(amount);
  } else {
    const rem = GAME_SEC - st.elapsed;
    ph.className  = "sc-phase phase-started";
    lbl.textContent = "áŒ¨á‹‹á‰³ áŒ€áˆáˆ¯áˆ";
    tf.className  = "sc-timer-fill tf-started";
    tf.style.width = ((rem / GAME_SEC) * 100) + "%";
    tv.textContent = rem + "s";
    if (Math.random() < 0.12 && rem < 35) dropPlayers(amount);
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
}
window.goHome = () => showScreen("screen-home");

async function loadTakenCards(amount) {
  takenCards = new Set();
  // Check active rooms for this stake â€” cards in use
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
    cell.textContent = i === 12 ? "â­" : n;
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
    toast("âš  á‰€áˆª áˆ‚áˆ³á‰¥á‹Ž áŠ áŠáˆµá‰°áŠ› áŠá‹! Deposit á‹«á‹µáˆ­áŒ‰");
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
    chip.textContent = (p.uid === UID ? "â­ " : "") + p.username;
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
  toast("ðŸ”„ áŒ¨á‹‹á‰³ á‰°áˆ°áˆ­á‹Ÿáˆá¢ áŒˆáŠ•á‹˜á‰¥á‹Ž á‰°áˆ˜áˆáˆ·áˆ");
}
window.cancelLobby = cancelLobby;

// ===== GAME UI =====
function startGameUI(room) {
  showScreen("screen-game");
  const players = room.players ? Object.values(room.players) : [];
  const prize   = calcPrize(players.length, room.stake);

  $("gtbRound").textContent   = "Stake: " + room.stake + " ETB";
  $("gtbPlayers").textContent = "ðŸ‘¥ " + players.length;
  $("gtbPrize").textContent   = "ðŸ† " + prize + " ETB";

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
    chip.textContent = (p.uid === UID ? "â­ " : "") + p.username;
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
      toast("âš  á‹­áˆ… á‰áŒ¥áˆ­ áŒˆáŠ“ áŠ áˆá‰°áŒ áˆ«áˆ!");
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
    toast("âš  áŒˆáŠ“ á‰¢áŠ•áŒŽ áŠ áˆáˆ†áŠáˆ! áˆáˆ‰áˆ á‰áŒ¥áˆ®á‰½ áŠ áˆá‰°á‹³á‰¡áˆ");
    return;
  }
  const snap = await get(ref(db, `rooms/${currentRoomId}`));
  if (!snap.exists()) return;
  const room = snap.val();
  if (room.winner) { toast("ðŸ˜ž á‰€á‹µáˆž áŠ áˆ¸áŠ“áŠ á‰°á‹ˆáˆµáŠ—áˆ!"); return; }

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
    const botCard = generateCard(bot.cardNo);
    const botDaubed = buildBotDaubed(botCard, calledNumbers);
    if (checkBingo(botDaubed) && Math.random() < 0.04) {
      const playerList = Object.values(room.players);
      const prize = calcPrize(playerList.length, room.stake);
      // Bot wins â€” house keeps prize
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
    el_emoji.textContent  = "ðŸ†";
    el_title.textContent  = "áŠ áˆ¸áŠá‰!";
    el_title.className    = "result-title";
    el_amount.textContent = "+" + amount + " ETB";
    el_amount.className   = "result-amount";
    el_winner.textContent = "Winner: " + winnerName;
    el_sub.textContent    = "áˆ½áˆáˆ›á‰± á‹ˆá‹° áˆ‚áˆ³á‰¥á‹Ž á‰°áŒ¨áˆáˆ¯áˆ";
  } else {
    el_emoji.textContent  = "ðŸ˜ž";
    el_title.textContent  = "áŠ áˆá‰°áˆ³áŠ«áˆ";
    el_title.className    = "result-title loss";
    el_amount.textContent = "-" + amount + " ETB";
    el_amount.className   = "result-amount loss";
    el_winner.textContent = "Winner: " + winnerName;
    el_sub.textContent    = "áˆŒáˆ‹ á‰°áŒ«á‹‹á‰½ áŠ áˆ¸áŠ•ááˆá¢ áŠ¥áŠ•á‹°áŒˆáŠ“ á‹­áˆžáŠ­áˆ©!";
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
  toast("ðŸšª áŒ¨á‹‹á‰³á‹áŠ• áˆˆá‰…á‰€á‹‹áˆ");
}
window.leaveGame = leaveGame;

// ===== DEPOSIT =====
async function submitDeposit() {
  const amt = parseFloat($("depAmount").value);
  const sms = $("depSms").value.trim();

  if (!amt || amt < 50) { toast("âš  á‰¢á‹«áŠ•áˆµ 50 ETB á‹«áˆµáŒˆá‰¡!"); return; }
  if (!sms) { toast("âš  SMS áˆ›áˆ¨áŒ‹áŒˆáŒ« á‹«áˆµáˆáˆáŒ‹áˆ!"); return; }

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
  toast("âœ… áŒ¥á‹«á‰„á‹Ž á‰°áˆáŠ³áˆ! áŠ¨ admin áˆ›áˆ¨áŒ‹áŒˆáŒ« á‹­áŒ á‰¥á‰");
  loadDepositHistory();
}
window.submitDeposit = submitDeposit;

async function loadDepositHistory() {
  const snap = await get(ref(db, `users/${UID}/transactions`));
  const container = $("depositHistory");
  container.innerHTML = "";
  if (!snap.exists()) return;

  const txs = [];
  snap.forEach(s => txs.push({ ...s.val(), key: s.key }));
  txs.filter(t => t.type === "deposit").reverse().slice(0, 8).forEach(t => {
    const el = document.createElement("div");
    el.className = `hist-item hist-dep ${t.status === "pending" ? "hist-pending" : ""}`;
    el.innerHTML = `
      <div class="hist-label">ðŸ“¥ Deposit</div>
      <div class="hist-right">
        <div class="hist-amount pos">+${t.amount} ETB</div>
        ${t.status === "pending" ? `<div class="hist-status">â³ Pending...</div>` : `<div class="hist-status" style="color:var(--green)">âœ… Approved</div>`}
      </div>
    `;
    container.appendChild(el);
  });
}

// ===== FULL HISTORY =====
async function showHistory() {
  showScreen("screen-history");
  const snap = await get(ref(db, `users/${UID}/transactions`));
  const container = $("fullHistory");
  container.innerHTML = "";
  if (!snap.exists()) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-dim);padding:40px;font-family:var(--font-am)">áˆáŠ•áˆ áŒá‰¥á‹­á‰µ á‹¨áˆˆáˆ</div>`;
    return;
  }
  const txs = [];
  snap.forEach(s => txs.push({ ...s.val(), key: s.key }));
  txs.reverse().forEach(t => {
    const el = document.createElement("div");
    const cls = t.type === "win" ? "hist-win" : t.type === "deposit" ? "hist-dep" : "hist-bet";
    const icon = t.type === "win" ? "ðŸ†" : t.type === "deposit" ? "ðŸ“¥" : "ðŸŽ¯";
    const pos = t.type === "win" || t.type === "deposit";
    el.className = `hist-item ${cls}`;
    el.innerHTML = `
      <div class="hist-label">${icon} ${t.type === "win" ? "á‹µáˆ" : t.type === "deposit" ? "Deposit" : "Stake"} â€” ${t.stake||t.amount} ETB</div>
      <div class="hist-right">
        <div class="hist-amount ${pos?"pos":"neg"}">${pos?"+":"-"}${t.amount} ETB</div>
        ${t.status === "pending" ? `<div class="hist-status">â³ Pending</div>` : ""}
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
async function init() {
  buildStakeGrid();
  startCycleEngine();
  await initUser();
  loadDepositHistory();
}

init();
