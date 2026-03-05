// =============================================
//  BARON BINGO PRO â€” script.js  (v4 â€” fixed)
//  â€¢ Real Firebase config
//  â€¢ Deposit â†’ depositRequests collection (fixed)
//  â€¢ Synchronized multiplayer via Firestore gameRooms doc
//  â€¢ Bot logic centralized (only room host writes to Firebase)
//  â€¢ User profile: Telegram name + ID shown in sidebar
// =============================================

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, onSnapshot,
  query, where, orderBy,
  serverTimestamp, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// â”€â”€ â‘  Real Firebase Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const firebaseConfig = {
  apiKey           : "AIzaSyAZxHUnuaRNc6GfJQHNBnggJ_jfZFt_0mA",
  authDomain       : "baron-24c9e.firebaseapp.com",
  projectId        : "baron-24c9e",
  storageBucket    : "baron-24c9e.firebasestorage.app",
  messagingSenderId: "559650974936",
  appId            : "1:559650974936:web:dd133acca1be5fec8cfbad"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ADMIN_ID = "6452034854";

const BOT_NAMES = [
  "bek***","ale**","muli**","aben***","fits**","hayl**","mery**",
  "kedi**","tseg**","dagi**","abdu**","eyer**","kal***","nati**",
  "geta***","zelu**","daw***","rob**","feti**"
];

// â”€â”€ Global client state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let currentUser        = null;
let userProfile        = null;
let userBalance        = 0;
let selectedBet        = 10;
let selectedTicketNum  = 1;
let gameActive         = false;
let calledNumbers      = [];      // mirrors Firestore
let cardNumbers        = [];
let daubedCells        = new Set();
let currentGameBet     = 10;
let currentGamePlayers = 1;
let currentRoomId      = null;    // "room_10", "room_50" etc.
let waitingTimeout     = null;
let playerWon          = false;
let takenCards         = new Set();
let transactions       = [];
let lastFourCalled     = [];
let isRoomHost         = false;   // true â†’ this client drives the number caller
let callerInterval     = null;
let gameDocUnsub       = null;    // onSnapshot cleanup for game room
let takenCardsUnsub    = null;
let depositAdminUnsub  = null;

// Lobby UI cycle (purely cosmetic â€” independent of real game sync)
const JOIN_DURATION = 30;
const GAME_DURATION = 60;
const TOTAL_CYCLE   = JOIN_DURATION + GAME_DURATION;
let p10=18, p20=0, p50=3, p100=0;
const NO_PLAYERS_STAKES = new Set([20, 100]);
const stakeState = {
  10 : { phase:'joining', elapsed:0, cyclePos:0 },
  20 : { phase:'joining', elapsed:0, cyclePos:0 },
  50 : { phase:'joining', elapsed:0, cyclePos:0 },
  100: { phase:'joining', elapsed:0, cyclePos:0 }
};

// =============================================
//  â‘¡ AUTH â€” sign in anonymously, then load profile
// =============================================
window.Telegram?.WebApp?.ready?.();

signInAnonymously(auth).catch(e => console.error("Anonymous auth failed:", e));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadOrCreateProfile(user.uid);
  }
});

// =============================================
//  â‘¢ USER PROFILE  (Telegram initDataUnsafe â†’ Firestore)
// =============================================
async function loadOrCreateProfile(uid) {
  const ref  = doc(db, "users", uid);
  const snap = await getDoc(ref);

  // Read Telegram Mini App user data (only available inside Telegram)
  const tg = window.Telegram?.WebApp?.initDataUnsafe?.user ?? {};

  if (snap.exists()) {
    userProfile = snap.data();
    // Always update Telegram fields from fresh session
    userProfile.telegramId       = tg.id?.toString()   || userProfile.telegramId       || uid;
    userProfile.telegramName     = tg.first_name        || userProfile.telegramName      || "Guest";
    userProfile.telegramUsername = tg.username          || userProfile.telegramUsername  || "";
    userProfile.phone            = tg.phone_number      || userProfile.phone             || "";
    userBalance = userProfile.balance ?? 0;
    await updateDoc(ref, {
      telegramId      : userProfile.telegramId,
      telegramName    : userProfile.telegramName,
      telegramUsername: userProfile.telegramUsername,
      phone           : userProfile.phone
    });
  } else {
    userProfile = {
      uid,
      telegramId      : tg.id?.toString()  || uid,
      telegramName    : tg.first_name       || "Guest",
      telegramUsername: tg.username         || "",
      phone           : tg.phone_number     || "",
      balance         : 0,
      createdAt       : serverTimestamp()
    };
    await setDoc(ref, userProfile);
    userBalance = 0;
  }

  updateAllBalances();
  renderMenuUserInfo();
  loadTransactionHistory();
  if (userProfile.telegramId === ADMIN_ID) startAdminListener();
}

async function saveBalance() {
  if (!currentUser) return;
  await updateDoc(doc(db, "users", currentUser.uid), { balance: userBalance });
}

// =============================================
//  NAVIGATION
// =============================================
window.navigateTo = function(id) {
  if (gameActive && id !== 'game-screen') {
    showToast("âš  áŒ¨á‹‹á‰³ áŠ¥á‹¨á‰°áŒ«á‹ˆá‰± áŠá‹!"); return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'balance-screen') renderBalanceScreen();
  if (id === 'admin-screen')   renderAdminScreen();
  if (id === 'history-screen') renderHistoryScreen();
};

window.toggleMenu = function() {
  document.getElementById('sideMenu').classList.toggle('open');
  document.getElementById('menuOverlay').classList.toggle('open');
  renderMenuUserInfo();
  renderSidebarTransactions();
};

// â”€â”€ Sidebar: show Telegram @username + Telegram ID â”€â”€
function renderMenuUserInfo() {
  if (!userProfile) return;

  // Display @username if available, otherwise first name
  const displayName = userProfile.telegramUsername
    ? "@" + userProfile.telegramUsername
    : (userProfile.telegramName || "Guest");

  // Show Telegram numeric ID below the name
  const displayId = userProfile.telegramId
    ? "Telegram ID: " + userProfile.telegramId
    : (userProfile.phone ? "ðŸ“ž " + userProfile.phone : "");

  const nameEl = document.getElementById('menu-user-name');
  if (nameEl) nameEl.textContent = displayName;

  // menu-user-phone element reused to display Telegram ID
  const idEl = document.getElementById('menu-user-phone');
  if (idEl) idEl.textContent = displayId;

  const balEl = document.getElementById('menu-balance-val');
  if (balEl) balEl.textContent = userBalance + " ETB";

  const adminItem = document.getElementById('admin-menu-item');
  if (adminItem)
    adminItem.style.display = (userProfile.telegramId === ADMIN_ID) ? 'flex' : 'none';
}

function updateAllBalances() {
  const gb = document.getElementById('global-balance');
  if (gb) gb.innerText = userBalance;
  const mb = document.getElementById('menu-balance-val');
  if (mb) mb.innerText = userBalance + " ETB";
  const bd = document.getElementById('balance-display');
  if (bd) bd.innerText = userBalance;
}

function renderBalanceScreen() {
  const bd = document.getElementById('balance-display');
  if (bd) bd.innerText = userBalance;
}

// =============================================
//  TRANSACTION HISTORY
// =============================================
function addTransaction(type, amount, note) {
  const tx = { type, amount, note, time: new Date().toLocaleTimeString() };
  transactions.unshift(tx);
  if (transactions.length > 100) transactions.pop();
  renderSidebarTransactions();
  if (currentUser) {
    addDoc(collection(db, "users", currentUser.uid, "transactions"), {
      ...tx, createdAt: serverTimestamp()
    }).catch(() => {});
  }
}

async function loadTransactionHistory() {
  if (!currentUser) return;
  const q = query(
    collection(db, "users", currentUser.uid, "transactions"),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, snap => {
    transactions = snap.docs.map(d => d.data());
    renderSidebarTransactions();
    renderHistoryScreen();
  });
}

function renderSidebarTransactions() {
  const c = document.getElementById('sidebar-tx-list');
  if (!c) return;
  if (!transactions.length) {
    c.innerHTML = '<div class="menu-tx-empty">áˆáŠ•áˆ á‰³áˆªáŠ­ á‹¨áˆˆáˆ</div>'; return;
  }
  c.innerHTML = '';
  transactions.slice(0, 6).forEach(tx => {
    const sign  = (tx.type==='deposit'||tx.type==='win') ? '+' : '-';
    const cls   = { deposit:'tx-deposit', win:'tx-win', withdraw:'tx-withdraw', loss:'tx-loss' }[tx.type] || 'tx-loss';
    const label = { deposit:'ðŸ“¥ Deposit', win:'ðŸ† Win', withdraw:'ðŸ“¤ Withdraw', loss:'ðŸ˜ž Loss' }[tx.type] || tx.type;
    c.innerHTML += `<div class="menu-tx-item ${cls}">
      <span class="tx-label">${label}</span>
      <span class="tx-amt">${sign}${tx.amount} ETB</span></div>`;
  });
}

function renderHistoryScreen() {
  const c = document.getElementById('history-list');
  if (!c) return;
  if (!transactions.length) {
    c.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,.3);">áˆáŠ•áˆ á‰³áˆªáŠ­ á‹¨áˆˆáˆ</div>'; return;
  }
  c.innerHTML = '';
  transactions.forEach(tx => {
    const sign = (tx.type==='deposit'||tx.type==='win') ? '+' : '-';
    const col  = (tx.type==='deposit'||tx.type==='win') ? '#00c853' : '#ff5252';
    const icon = { deposit:'ðŸ“¥', win:'ðŸ†', withdraw:'ðŸ“¤', loss:'ðŸ˜ž' }[tx.type] || 'ðŸ“„';
    c.innerHTML += `<div class="history-item">
      <span>${icon} ${tx.note || tx.type}</span>
      <span style="color:${col};font-weight:800;">${sign}${tx.amount} ETB</span></div>`;
  });
}

// =============================================
//  LOBBY CYCLE (cosmetic)
// =============================================
function initStakeCycles() {
  Object.keys(stakeState).forEach(bet => {
    if (NO_PLAYERS_STAKES.has(parseInt(bet))) {
      stakeState[bet].phase = 'no-players'; return;
    }
    const pos = Math.floor(Math.random() * TOTAL_CYCLE);
    stakeState[bet].cyclePos = pos;
    stakeState[bet].phase    = pos < JOIN_DURATION ? 'joining' : 'started';
    stakeState[bet].elapsed  = pos < JOIN_DURATION ? pos : pos - JOIN_DURATION;
  });
}

function updateStakeUI(bet) {
  const state = stakeState[bet];
  const badge = document.getElementById('phase-'+bet);
  const fill  = document.getElementById('timer-fill-'+bet);
  const label = document.getElementById('timer-label-'+bet);
  const bar   = fill ? fill.parentElement : null;
  if (!badge || !fill || !label) return;

  if (state.phase === 'no-players') {
    badge.className = 'stake-phase-badge phase-no-players';
    badge.innerHTML = '<span class="phase-dot"></span><span>á‰°áŒ«á‹‹á‰½ á‹¨áˆˆáˆ</span>';
    fill.style.width = '0%'; label.textContent = '--';
    label.classList.add('disabled'); bar?.classList.add('disabled');
    document.getElementById('p-'+bet).innerText = '0';
    document.getElementById('w-'+bet).innerText = '0';
    return;
  }
  if (state.phase === 'joining') {
    const rem = JOIN_DURATION - state.elapsed;
    badge.className = 'stake-phase-badge phase-joining';
    badge.innerHTML = '<span class="phase-dot"></span><span>áˆ˜á‰€áˆ‹á‰€áˆ á‹­á‰»áˆ‹áˆ</span>';
    fill.className  = 'stake-timer-fill phase-joining-fill';
    fill.style.width = ((rem/JOIN_DURATION)*100) + '%';
    label.textContent = rem + 's';
    label.classList.remove('disabled'); bar?.classList.remove('disabled');
    if (Math.random() < 0.3) fluctuatePlayers(parseInt(bet));
  } else {
    const rem = GAME_DURATION - state.elapsed;
    badge.className = 'stake-phase-badge phase-started';
    badge.innerHTML = '<span class="phase-dot"></span><span>áŒ¨á‹‹á‰³ áŒ€áˆáˆ¯áˆ</span>';
    fill.className  = 'stake-timer-fill phase-started-fill';
    fill.style.width = ((rem/GAME_DURATION)*100) + '%';
    label.textContent = rem + 's';
    label.classList.remove('disabled'); bar?.classList.remove('disabled');
    if (Math.random() < 0.15 && rem < 45) dropPlayers(parseInt(bet));
  }
}

function tickStake(bet) {
  const state = stakeState[bet];
  if (state.phase === 'no-players') return;
  state.cyclePos = (state.cyclePos + 1) % TOTAL_CYCLE;
  if (state.cyclePos < JOIN_DURATION) {
    if (state.phase === 'started') { state.phase = 'joining'; resetPlayers(bet); }
    state.elapsed = state.cyclePos;
  } else {
    if (state.phase === 'joining') state.phase = 'started';
    state.elapsed = state.cyclePos - JOIN_DURATION;
  }
  updateStakeUI(bet);
}

function startAsyncCycles() {
  initStakeCycles();
  [10, 20, 50, 100].forEach(bet => updateStakeUI(bet));
  setInterval(() => tickStake(10),  1000);
  setInterval(() => tickStake(20),  1000);
  setInterval(() => tickStake(50),  1000);
  setInterval(() => tickStake(100), 1000);
}

function fluctuatePlayers(bet) {
  if (NO_PLAYERS_STAKES.has(bet)) return;
  const cfg = { 10:{min:5,max:33,el:'p-10',we:'w-10'}, 50:{min:1,max:12,el:'p-50',we:'w-50'} };
  const c = cfg[bet]; if (!c) return;
  const chg = Math.random() > 0.4 ? Math.floor(Math.random()*4)+1 : -Math.floor(Math.random()*2);
  const cur = parseInt(document.getElementById(c.el).innerText) || 0;
  const nxt = Math.min(Math.max(cur+chg, c.min), c.max);
  document.getElementById(c.el).innerText = nxt;
  document.getElementById(c.we).innerText = nxt * bet;
  if (bet===10) p10=nxt; if (bet===50) p50=nxt;
}
function dropPlayers(bet) {
  if (NO_PLAYERS_STAKES.has(bet)) return;
  const cfg = { 10:{min:5,el:'p-10',we:'w-10'}, 50:{min:1,el:'p-50',we:'w-50'} };
  const c = cfg[bet]; if (!c) return;
  const cur = parseInt(document.getElementById(c.el).innerText) || 0;
  const nxt = Math.max(cur - Math.floor(Math.random()*3) - 1, c.min);
  document.getElementById(c.el).innerText = nxt;
  document.getElementById(c.we).innerText = nxt * bet;
}
function resetPlayers(bet) {
  const s = { 10:8, 50:2 };
  const v = s[bet] || 1;
  document.getElementById('p-'+bet).innerText = v;
  document.getElementById('w-'+bet).innerText = v * bet;
  if (bet===10) p10=v; if (bet===50) p50=v;
}
function getPlayerCountForBet(bet) {
  return ({ 10:p10, 20:p20, 50:p50, 100:p100 }[bet]) || 0;
}

startAsyncCycles();

// =============================================
//  CARD SELECTION
// =============================================
window.showSelection = function(amount) {
  selectedBet = amount;
  document.getElementById('bet-badge').innerText = amount + " Birr";
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('deposit-redirect').style.display = 'none';
  document.getElementById('start-game-btn').style.display = 'block';
  navigateTo('selection-screen');
  listenTakenCards(amount);
  renderTicketList();
  updateBingoPreview(1);
  selectedTicketNum = 1;
  document.getElementById('card-title').innerText = "Card #1";
};

// Real-time listener: grey out cards already taken in active room
function listenTakenCards(bet) {
  if (takenCardsUnsub) { takenCardsUnsub(); takenCardsUnsub = null; }
  takenCards.clear();
  const roomRef = doc(db, "gameRooms", "room_" + bet);
  takenCardsUnsub = onSnapshot(roomRef, snap => {
    takenCards.clear();
    if (snap.exists() && snap.data().status !== 'ended') {
      (snap.data().takenCards || []).forEach(c => takenCards.add(c));
    }
    renderTicketList();
  });
}

function renderTicketList() {
  const list = document.getElementById('card-numbers-list');
  list.innerHTML = '';
  for (let i = 1; i <= 100; i++) {
    const btn = document.createElement('div');
    if (takenCards.has(i)) {
      btn.className = 'card-number card-taken';
      btn.innerText = i;
    } else {
      btn.className = 'card-number' + (i === selectedTicketNum ? ' card-selected' : '');
      btn.innerText = i;
      btn.onclick = () => {
        document.querySelectorAll('.card-number').forEach(el => el.classList.remove('card-selected'));
        btn.classList.add('card-selected');
        selectedTicketNum = i;
        document.getElementById('card-title').innerText = "Card #" + i;
        updateBingoPreview(i);
      };
    }
    list.appendChild(btn);
  }
}

function updateBingoPreview(seed) {
  const grid = document.getElementById('preview-grid');
  grid.innerHTML = '';
  generateBingoCard(seed).forEach((n, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (i === 12) { cell.innerText = "â­"; cell.classList.add('marked'); }
    else cell.innerText = n;
    grid.appendChild(cell);
  });
}

// Seeded deterministic bingo card generator
function generateBingoCard(seed) {
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  let s = seed * 9301 + 49297;
  function rnd() { s = (s*9301+49297) % 233280; return s/233280; }
  const card = [];
  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col];
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    for (let i = pool.length-1; i > 0; i--) {
      const j = Math.floor(rnd()*(i+1));
      [pool[i],pool[j]] = [pool[j],pool[i]];
    }
    card.push(pool.slice(0,5).sort((a,b)=>a-b));
  }
  const result = [];
  for (let row=0; row<5; row++)
    for (let col=0; col<5; col++)
      result.push(card[col][row]);
  result[12] = 0;
  return result;
}

// =============================================
//  GAME START â€” deduct bet, create/join Firestore room
// =============================================
window.startGame = async function() {
  if (userBalance < selectedBet) {
    document.getElementById('error-msg').style.display = 'block';
    document.getElementById('deposit-redirect').style.display = 'block';
    document.getElementById('start-game-btn').style.display = 'none';
    return;
  }

  // â”€â”€ Deduct bet immediately â”€â”€
  userBalance -= selectedBet;
  updateAllBalances();
  await saveBalance();
  addTransaction('loss', selectedBet, "Bet placed (" + selectedBet + " Birr)");

  currentGameBet = selectedBet;
  currentRoomId  = "room_" + selectedBet;
  isRoomHost     = false;

  const roomRef  = doc(db, "gameRooms", currentRoomId);
  const roomSnap = await getDoc(roomRef);

  // Determine host: first player, or re-creator after game ended
  const roomStatus = roomSnap.exists() ? roomSnap.data().status : null;
  if (!roomSnap.exists() || roomStatus === 'ended' || !roomStatus) {
    isRoomHost = true;
  }

  // Register this player's card number in the room
  if (roomSnap.exists() && roomStatus !== 'ended') {
    await updateDoc(roomRef, {
      takenCards : arrayUnion(selectedTicketNum),
      playerCount: increment(1)
    });
  } else {
    // Create fresh room document
    await setDoc(roomRef, {
      bet          : selectedBet,
      takenCards   : [selectedTicketNum],
      playerCount  : 1,
      status       : 'waiting',
      calledNumbers: [],
      currentNumber: null,
      allNumbers   : [],
      callIndex    : 0,
      hostUid      : currentUser.uid,
      winner       : null,
      winnerType   : null,
      bots         : [],
      createdAt    : serverTimestamp()
    });
    isRoomHost = true;
  }

  // â”€â”€ Bot logic â€” HOST ONLY creates bots and writes them to Firestore â”€â”€
  let bots = [];
  const realPlayers = Math.max(getPlayerCountForBet(selectedBet), 1);

  if (selectedBet === 10 && isRoomHost && realPlayers < 6) {
    const botCount = Math.floor(Math.random()*17) + 3; // 3â€“19
    bots = [...BOT_NAMES]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(botCount, BOT_NAMES.length));
    currentGamePlayers = 1 + bots.length;
    await updateDoc(roomRef, {
      bots       : bots,
      playerCount: currentGamePlayers
    });
  } else {
    const freshSnap = await getDoc(roomRef);
    bots               = freshSnap.data()?.bots         || [];
    currentGamePlayers = freshSnap.data()?.playerCount  || realPlayers;
  }

  // â”€â”€ Waiting screen â”€â”€
  const wo = document.getElementById('waitingOverlay');
  wo.classList.add('show');
  document.getElementById('waitingNeeded').innerText = currentGamePlayers;

  const tagContainer = document.getElementById('waitingPlayersList');
  tagContainer.innerHTML = '';
  const myTag = userProfile?.telegramUsername
    ? "@" + userProfile.telegramUsername
    : (userProfile?.telegramName || "You");
  tagContainer.innerHTML = `<div class="waiting-player-tag is-you">${myTag}</div>`;

  let joinedBots = 0, waitCount = 1;
  document.getElementById('waitingCurrent').innerText = waitCount;

  const waitInterval = setInterval(async () => {
    if (joinedBots < bots.length) {
      const batch = Math.min(Math.floor(Math.random()*3)+1, bots.length - joinedBots);
      for (let b = 0; b < batch; b++) {
        tagContainer.innerHTML += `<div class="waiting-player-tag">${bots[joinedBots+b]}</div>`;
      }
      joinedBots += batch;
      waitCount   = 1 + joinedBots;
      document.getElementById('waitingCurrent').innerText = waitCount;
    }
    if (waitCount >= currentGamePlayers) {
      clearInterval(waitInterval);
      setTimeout(async () => {
        wo.classList.remove('show');
        await beginSynchronizedGame(bots);
      }, 700);
    }
  }, 500);

  waitingTimeout = waitInterval;
};

window.cancelWaiting = async function() {
  if (waitingTimeout) clearInterval(waitingTimeout);
  document.getElementById('waitingOverlay').classList.remove('show');

  // Refund bet
  userBalance += currentGameBet;
  updateAllBalances();
  await saveBalance();
  transactions.shift();
  renderSidebarTransactions();

  // Release the reserved card from the room
  try {
    const roomRef  = doc(db, "gameRooms", currentRoomId);
    const roomSnap = await getDoc(roomRef);
    if (roomSnap.exists()) {
      const newCards = (roomSnap.data().takenCards || []).filter(c => c !== selectedTicketNum);
      await updateDoc(roomRef, {
        takenCards : newCards,
        playerCount: increment(-1)
      });
    }
  } catch(e) {}

  showToast("ðŸ”„ áŒˆáŠ•á‹˜á‰¥á‹Ž á‰°áˆ˜áˆáˆ·áˆ");
  navigateTo('betting-screen');
};

// =============================================
//  â‘£ SYNCHRONIZED GAME  (Firestore-driven)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  HOST  : writes allNumbers[], calls one number every 2.5s,
//          checks bot bingo, writes winner to Firestore.
//  CLIENTS: onSnapshot â†’ process each new calledNumber locally,
//           auto-daub card, check player bingo.
// =============================================
async function beginSynchronizedGame(bots) {
  gameActive     = true;
  playerWon      = false;
  calledNumbers  = [];
  lastFourCalled = [];
  daubedCells    = new Set([12]);
  cardNumbers    = generateBingoCard(selectedTicketNum);

  // Reset UI
  document.getElementById('game-bet-pill').innerText     = currentGameBet + " Birr";
  document.getElementById('game-players-pill').innerText = "ðŸ‘¥ " + currentGamePlayers;
  document.getElementById('currentBall').innerText       = "?";
  document.getElementById('callLetterDisplay').innerHTML = "BINGO<span>-</span>";
  document.getElementById('calledHistory').innerHTML     = '';
  document.getElementById('callsCount').innerText        = "0/75";
  document.getElementById('gameStatusText').innerText    = "â³ áŒ¨á‹‹á‰³á‹ áŠ¥á‹¨á‰°áŒ«á‹ˆá‰° áŠá‹...";
  document.getElementById('bingoBtn').classList.remove('can-bingo');

  renderGameCard();
  navigateTo('game-screen');

  const roomRef = doc(db, "gameRooms", currentRoomId);

  // â”€â”€ HOST: initialise game document & drive the number caller â”€â”€
  if (isRoomHost) {
    const allNums = shuffled75();

    await updateDoc(roomRef, {
      status        : 'playing',
      calledNumbers : [],
      allNumbers    : allNums,
      currentNumber : null,
      callIndex     : 0,
      winner        : null,
      winnerType    : null,
      startedAt     : serverTimestamp()
    });

    // Pre-build bot cards for host-side bot-win checking
    const botCards = bots.map(name => ({
      name,
      card  : generateBingoCard(Math.floor(Math.random()*100) + 1),
      daubed: new Set([12])
    }));

    let callIndex = 0;

    callerInterval = setInterval(async () => {
      // Fetch current room state to avoid overwrites / double-call
      let snap;
      try { snap = await getDoc(roomRef); } catch(e) { return; }
      if (!snap.exists()) { clearInterval(callerInterval); return; }
      const data = snap.data();

      if (data.winner || data.status === 'ended') {
        clearInterval(callerInterval); callerInterval = null; return;
      }
      if (callIndex >= data.allNumbers.length) {
        clearInterval(callerInterval); callerInterval = null;
        await updateDoc(roomRef, { status: 'ended' });
        return;
      }

      const num    = data.allNumbers[callIndex];
      const called = [...(data.calledNumbers || []), num];
      callIndex++;

      await updateDoc(roomRef, {
        calledNumbers: called,
        currentNumber: num,
        callIndex
      });

      // â”€â”€ Bot bingo check (host only, after 20 calls) â”€â”€
      if (bots.length > 0 && called.length >= 20) {
        for (const bot of botCards) {
          autoDaubCard(bot.card, bot.daubed, num);
          if (checkBingoForCard(bot.daubed) && Math.random() < 0.025) {
            clearInterval(callerInterval); callerInterval = null;
            await updateDoc(roomRef, {
              status    : 'ended',
              winner    : bot.name,
              winnerType: 'bot'
            });
            return;
          }
        }
      }
    }, 2500);
  }

  // â”€â”€ ALL CLIENTS: listen to room document for live updates â”€â”€
  if (gameDocUnsub) { gameDocUnsub(); gameDocUnsub = null; }

  gameDocUnsub = onSnapshot(roomRef, (snap) => {
    if (!snap.exists() || !gameActive) return;
    const data = snap.data();

    // Sync newly called numbers
    const serverCalled = data.calledNumbers || [];
    if (serverCalled.length > calledNumbers.length) {
      serverCalled.slice(calledNumbers.length).forEach(n => processCalledNumber(n));
    }

    // Bot won â†’ this client loses
    if (data.winnerType === 'bot' && data.winner && !playerWon) {
      stopGameClient();
      setTimeout(() => endGameLoss(data.winner), 600);
    }

    // Another real player won â†’ this client loses
    if (data.winnerType === 'player' && data.winnerUid !== currentUser?.uid && !playerWon) {
      stopGameClient();
      setTimeout(() => endGameLoss(data.winnerName || "áˆŒáˆ‹ á‰°áŒ«á‹‹á‰½"), 600);
    }

    // Game ended with no specific winner recorded
    if (data.status === 'ended' && !playerWon && !data.winner) {
      stopGameClient();
      setTimeout(() => endGameLoss(null), 800);
    }
  });
}

// Process one newly called number from Firestore (runs on every client)
function processCalledNumber(num) {
  calledNumbers.push(num);
  const letter = getLetterForNumber(num);

  document.getElementById('currentBall').innerText = num;
  document.getElementById('callLetterDisplay').innerHTML = letter + "<span>" + num + "</span>";
  document.getElementById('callsCount').innerText = calledNumbers.length + "/75";

  lastFourCalled.push({ num, letter });
  if (lastFourCalled.length > 4) lastFourCalled.shift();
  renderLastFour();

  autoDaub(num);

  if (checkBingo() && !playerWon) {
    document.getElementById('bingoBtn').classList.add('can-bingo');
    document.getElementById('gameStatusText').innerText = "ðŸŽ‰ BINGO! á‹­áŒ«áŠ‘!";
  }
}

function stopGameClient() {
  if (callerInterval) { clearInterval(callerInterval); callerInterval = null; }
  document.getElementById('bingoBtn').classList.remove('can-bingo');
}

function renderLastFour() {
  const strip = document.getElementById('calledHistory');
  strip.innerHTML = '';
  lastFourCalled.forEach(({ num, letter }) => {
    const el = document.createElement('div');
    el.className = 'called-mini-ball ball-' + letter.toLowerCase();
    el.innerText = num;
    strip.appendChild(el);
  });
}

function renderGameCard() {
  const grid = document.getElementById('gameGrid');
  grid.innerHTML = '';
  cardNumbers.forEach((num, i) => {
    const cell = document.createElement('div');
    cell.className = 'game-cell';
    cell.dataset.index = i;
    if (i === 12) {
      cell.classList.add('free-cell', 'auto-daubed');
      cell.innerText = "FREE";
    } else {
      cell.innerText = num;
      cell.onclick = () => manualDaub(i);
    }
    grid.appendChild(cell);
  });
}

function autoDaub(number) {
  cardNumbers.forEach((num, i) => {
    if (num === number && i !== 12) {
      daubedCells.add(i);
      const cells = document.querySelectorAll('#gameGrid .game-cell');
      if (cells[i]) cells[i].classList.add('auto-daubed');
    }
  });
}

function autoDaubCard(card, daubed, number) {
  card.forEach((num, i) => { if (num === number && i !== 12) daubed.add(i); });
}

window.manualDaub = function(index) {
  if (index === 12) return;
  if (calledNumbers.includes(cardNumbers[index])) {
    daubedCells.add(index);
    const cells = document.querySelectorAll('#gameGrid .game-cell');
    if (cells[index]) cells[index].classList.add('daubed');
    if (checkBingo()) {
      document.getElementById('bingoBtn').classList.add('can-bingo');
      document.getElementById('gameStatusText').innerText = "ðŸŽ‰ BINGO! á‹­áŒ«áŠ‘!";
    }
  } else {
    showToast("âš  á‹­áˆ… á‰áŒ¥áˆ­ áŒˆáŠ“ áŠ áˆá‰°áŒ áˆ«áˆ!");
  }
};

function checkBingo() { return checkBingoForCard(daubedCells); }

function checkBingoForCard(daubed) {
  for (let r=0;r<5;r++) {
    let ok=true;
    for (let c=0;c<5;c++) if (!daubed.has(r*5+c)) { ok=false; break; }
    if (ok) return true;
  }
  for (let c=0;c<5;c++) {
    let ok=true;
    for (let r=0;r<5;r++) if (!daubed.has(r*5+c)) { ok=false; break; }
    if (ok) return true;
  }
  let d1=true, d2=true;
  for (let i=0;i<5;i++) {
    if (!daubed.has(i*5+i))   d1=false;
    if (!daubed.has(i*5+4-i)) d2=false;
  }
  return d1 || d2;
}

function getWinningCells() {
  const wc = new Set();
  for (let r=0;r<5;r++) {
    let ok=true; const cells=[];
    for (let c=0;c<5;c++) { cells.push(r*5+c); if(!daubedCells.has(r*5+c)) ok=false; }
    if (ok) cells.forEach(x => wc.add(x));
  }
  for (let c=0;c<5;c++) {
    let ok=true; const cells=[];
    for (let r=0;r<5;r++) { cells.push(r*5+c); if(!daubedCells.has(r*5+c)) ok=false; }
    if (ok) cells.forEach(x => wc.add(x));
  }
  let d1=true, d2=true, dc1=[], dc2=[];
  for (let i=0;i<5;i++) {
    dc1.push(i*5+i); dc2.push(i*5+4-i);
    if (!daubedCells.has(i*5+i))   d1=false;
    if (!daubedCells.has(i*5+4-i)) d2=false;
  }
  if (d1) dc1.forEach(x => wc.add(x));
  if (d2) dc2.forEach(x => wc.add(x));
  return wc;
}

// Player presses BINGO
window.callBingo = async function() {
  if (!checkBingo()) { showToast("âš  áŒˆáŠ“ á‰¢áŠ•áŒŽ áŠ áˆáˆ†áŠáˆ!"); return; }
  playerWon = true;
  stopGameClient();
  if (gameDocUnsub) { gameDocUnsub(); gameDocUnsub = null; }

  // Highlight winning cells
  const winCells = getWinningCells();
  document.querySelectorAll('#gameGrid .game-cell').forEach((c, i) => {
    if (winCells.has(i)) c.classList.add('winning-cell');
  });
  document.getElementById('gameStatusText').innerText = "ðŸ† áŠ áˆ¸áŠ•áˆá‹‹áˆ!";

  const prize = Math.floor(currentGamePlayers * currentGameBet * 0.9);
  userBalance += prize;
  updateAllBalances();
  await saveBalance();
  addTransaction('win', prize, "Won " + currentGameBet + " Birr game");

  // Masked winner name
  const uname  = userProfile?.telegramUsername || userProfile?.telegramName || "player";
  const masked = "@" + uname.substring(0,3) + "***";

  // Write winner to Firestore so other clients see they lost
  try {
    await updateDoc(doc(db, "gameRooms", currentRoomId), {
      status    : 'ended',
      winner    : masked,
      winnerType: 'player',
      winnerUid : currentUser.uid,
      winnerName: masked
    });
  } catch(e) { console.warn("Winner write:", e); }

  setTimeout(() => { showWinModal(prize, masked); launchConfetti(); }, 1200);
};

function endGameLoss(winnerName) {
  if (playerWon) return;
  if (gameDocUnsub) { gameDocUnsub(); gameDocUnsub = null; }
  const winner = winnerName || "áˆŒáˆ‹ á‰°áŒ«á‹‹á‰½";
  document.getElementById('gameStatusText').innerText = "ðŸ˜ž " + winner + " áŠ áˆ¸áŠ•ááˆ";
  document.getElementById('bingoBtn').classList.remove('can-bingo');
  setTimeout(() => showLoseModal(winner), 1500);
}

function showWinModal(prize, masked) {
  document.getElementById('winEmoji').innerText   = "ðŸ†";
  document.getElementById('winTitle').textContent = "áŠ áˆ¸áŠá‰!";
  document.getElementById('winTitle').className   = "win-title gold-title";
  document.getElementById('winAmount').innerText  = "+" + prize + " ETB";
  document.getElementById('winAmount').style.color = "var(--cyan)";
  document.getElementById('winSub').innerText     = "áˆ½áˆáˆ›á‰± á‹ˆá‹° áˆ‚áˆ³á‰¥á‹Ž á‰°áŒ¨áˆáˆ¯áˆ";
  const wt = document.getElementById('winWinnerTag');
  if (wt) { wt.style.display = 'inline-block'; wt.innerText = "Winner: " + masked; }
  document.getElementById('winOverlay').classList.add('show');
}

function showLoseModal(winner) {
  document.getElementById('winEmoji').innerText   = "ðŸ˜ž";
  document.getElementById('winTitle').textContent = "áŠ áˆá‰°áˆ³áŠ«áˆ";
  document.getElementById('winTitle').className   = "win-title red-title";
  document.getElementById('winAmount').innerText  = "-" + currentGameBet + " ETB";
  document.getElementById('winAmount').style.color = "var(--red)";
  document.getElementById('winSub').innerText     = (winner || "áˆŒáˆ‹ á‰°áŒ«á‹‹á‰½") + " áŠ áˆ¸áŠ•ááˆá¢ áŠ¥áŠ•á‹°áŒˆáŠ“ á‹­áˆžáŠ­áˆ©!";
  const wt = document.getElementById('winWinnerTag');
  if (wt) wt.style.display = 'none';
  document.getElementById('winOverlay').classList.add('show');
}

window.closeWinModal = function() {
  document.getElementById('winOverlay').classList.remove('show');
  document.getElementById('confettiContainer').innerHTML = '';
  gameActive = false;
  if (gameDocUnsub) { gameDocUnsub(); gameDocUnsub = null; }
  navigateTo('betting-screen');
};

window.leaveGame = function() {
  stopGameClient();
  if (gameDocUnsub) { gameDocUnsub(); gameDocUnsub = null; }
  gameActive = false; playerWon = false;
  navigateTo('betting-screen');
  showToast("ðŸšª áŒ¨á‹‹á‰³á‹áŠ• áˆˆá‰…á‰€á‹‹áˆ");
};

function launchConfetti() {
  const c = document.getElementById('confettiContainer');
  c.innerHTML = '';
  const colors = ['#ffde00','#ff9500','#ff5252','#00c853','#60efff','#e040fb','#0061ff'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left            = Math.random()*100 + '%';
    p.style.background      = colors[Math.floor(Math.random()*colors.length)];
    p.style.width           = (Math.random()*8+4) + 'px';
    p.style.height          = (Math.random()*8+4) + 'px';
    p.style.borderRadius    = Math.random() > .5 ? '50%' : '2px';
    p.style.animationDuration = (Math.random()*2+1.5) + 's';
    p.style.animationDelay  = (Math.random()) + 's';
    c.appendChild(p);
  }
}

function getLetterForNumber(n) {
  if (n<=15) return 'B'; if (n<=30) return 'I';
  if (n<=45) return 'N'; if (n<=60) return 'G'; return 'O';
}

function shuffled75() {
  const arr = [];
  for (let i = 1; i <= 75; i++) arr.push(i);
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

// =============================================
//  â‘¤ DEPOSIT SYSTEM (fixed)
//  â€” uses auth.currentUser.uid
//  â€” writes to depositRequests collection
//  â€” includes: uid, userName, telegramId, amount, sms, status, createdAt
// =============================================
window.copyNumber = function() {
  const num = document.getElementById('phone-num').innerText;
  navigator.clipboard.writeText(num).then(showCopyToast).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = num; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showCopyToast();
  });
};

function showCopyToast() {
  const t = document.getElementById("copy-toast");
  t.className = "show";
  setTimeout(() => t.className = "", 2000);
}

window.submitDeposit = async function() {
  const amtRaw = document.getElementById('dep-amount').value.trim();
  const sms    = document.getElementById('dep-sms').value.trim();

  if (!amtRaw || !sms) {
    showToast("âš  áŠ¥á‰£áŠ­á‹Ž áˆáˆ‰áŠ•áˆ á‹•áˆ­á‹³á‰³ á‹­áˆ™áˆ‰!"); return;
  }
  const amount = parseFloat(amtRaw);
  if (isNaN(amount) || amount < 50) {
    showToast("âš  á‰¢á‹«áŠ•áˆµ 50 á‰¥áˆ­ áˆ›áˆµáŒˆá‰£á‰µ áŠ áˆˆá‰¥á‹Žá‰µ!"); return;
  }

  // Ensure user is authenticated
  if (!auth.currentUser) {
    showToast("âš  Authentication pending, please retry in a moment.");
    return;
  }

  const uid      = auth.currentUser.uid;                          // â† auth.currentUser.uid
  const userName = userProfile?.telegramUsername
    ? "@" + userProfile.telegramUsername
    : (userProfile?.telegramName || "Unknown");
  const tgId     = userProfile?.telegramId || uid;

  try {
    // Write deposit request to Firestore
    await addDoc(collection(db, "depositRequests"), {
      uid,                    // linked to authenticated user
      userName,               // Telegram display name
      telegramId : tgId,      // Telegram numeric ID
      amount,                 // parsed numeric amount
      sms,                    // SMS confirmation text
      status     : "pending", // initial status
      createdAt  : serverTimestamp()
    });

    // Update local deposit history list
    const container = document.getElementById('deposit-history');
    if (container) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `<span>ðŸ“¥ ${amount} ETB</span><span class="status-pending">â³ Pending...</span>`;
      container.prepend(item);
    }

    document.getElementById('dep-amount').value = '';
    document.getElementById('dep-sms').value    = '';
    showToast("âœ… áŒ¥á‹«á‰„á‹Ž á‰°áˆáŠ³áˆ! áŠ áˆµá‰°á‹³á‹³áˆª áˆ²áˆá‰…á‹± áˆ‚áˆ³á‰¥á‹Ž á‹­á‹˜áˆáŠ“áˆá¢");
  } catch(e) {
    console.error("Deposit write error:", e);
    showToast("âŒ á‹«áˆá‰°áˆ³áŠ«: " + e.message);
  }
};

// =============================================
//  WITHDRAW
// =============================================
window.submitWithdraw = async function() {
  const phone  = document.getElementById('wd-phone').value.trim();
  const amtRaw = document.getElementById('wd-amount').value.trim();
  const errEl  = document.getElementById('wd-error');
  errEl.style.display = 'none';

  if (!phone || !amtRaw) { showToast("âš  áŠ¥á‰£áŠ­á‹Ž áˆáˆ‰áŠ•áˆ á‹•áˆ­á‹³á‰³ á‹­áˆ™áˆ‰!"); return; }
  if (phone.length < 10)  { showToast("âš  á‰µáŠ­áŠ­áˆˆáŠ› áˆµáˆáŠ­ á‰áŒ¥áˆ­ á‹«áˆµáŒˆá‰¡!"); return; }

  const amount = parseFloat(amtRaw);
  if (isNaN(amount) || amount < 20) { showToast("âš  á‰¢á‹«áŠ•áˆµ 20 á‰¥áˆ­ áˆ›á‹áŒ£á‰µ á‹­á‰»áˆ‹áˆ!"); return; }
  if (amount > userBalance) { errEl.style.display = 'block'; return; }

  userBalance -= amount;
  updateAllBalances();
  await saveBalance();
  addTransaction('withdraw', amount, "Withdraw â†’ " + phone);

  try {
    await addDoc(collection(db, "withdrawRequests"), {
      uid       : auth.currentUser?.uid || "guest",
      userName  : userProfile?.telegramName || "Unknown",
      telegramId: userProfile?.telegramId   || "",
      phone, amount,
      status    : "pending",
      createdAt : serverTimestamp()
    });
  } catch(e) { console.error("Withdraw write:", e); }

  const container = document.getElementById('withdraw-history');
  if (container) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.style.borderLeftColor = 'var(--red)';
    item.innerHTML = `<span>ðŸ“¤ ${amount} ETB â†’ ${phone}</span><span class="status-pending">â³ Processing...</span>`;
    container.prepend(item);
  }

  document.getElementById('wd-phone').value  = '';
  document.getElementById('wd-amount').value = '';
  showToast("âœ… á‹¨á‹ˆáŒª áŒ¥á‹«á‰„á‹Ž á‰°áˆáŠ³áˆ!");
};

// =============================================
//  ADMIN PANEL
// =============================================
function startAdminListener() {
  if (depositAdminUnsub) return;
  const q = query(
    collection(db, "depositRequests"),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc")
  );
  depositAdminUnsub = onSnapshot(q, snap => {
    window._pendingDeposits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (document.getElementById('admin-screen')?.classList.contains('active'))
      renderAdminScreen();
  });
}

function renderAdminScreen() {
  const container = document.getElementById('admin-requests');
  if (!container) return;
  const deposits = window._pendingDeposits || [];
  if (!deposits.length) {
    container.innerHTML = '<div class="admin-empty">âœ… Pending áŒ¥á‹«á‰„ á‹¨áˆˆáˆ</div>'; return;
  }
  container.innerHTML = '';
  deposits.forEach(dep => {
    const time = dep.createdAt?.toDate?.()?.toLocaleString?.() || 'â€”';
    container.innerHTML += `
      <div class="deposit-req-item" id="req-${dep.id}">
        <div class="req-user">${dep.userName} (TG ID: ${dep.telegramId})</div>
        <div class="req-user" style="font-size:.68rem;color:rgba(255,255,255,.3);">UID: ${dep.uid}</div>
        <div class="req-amt">${dep.amount} ETB</div>
        <div class="req-sms">SMS: ${dep.sms}</div>
        <div class="req-time">${time}</div>
        <div class="req-actions">
          <button class="approve-btn" onclick="approveDeposit('${dep.id}','${dep.uid}',${dep.amount})">âœ… Approve</button>
          <button class="cancel-btn"  onclick="cancelDeposit('${dep.id}')">âŒ Cancel</button>
        </div>
      </div>`;
  });
}

window.approveDeposit = async function(reqId, uid, amount) {
  try {
    // 1. Mark deposit request as approved
    await updateDoc(doc(db, "depositRequests", reqId), { status: "deposited" });
    // 2. Atomically credit user balance
    await updateDoc(doc(db, "users", uid), { balance: increment(amount) });
    // 3. Record transaction in user's sub-collection
    await addDoc(collection(db, "users", uid, "transactions"), {
      type     : "deposit",
      amount,
      note     : "Deposit approved â€” " + amount + " ETB",
      createdAt: serverTimestamp()
    });
    document.getElementById('req-' + reqId)?.remove();
    showToast("âœ… " + amount + " ETB approved for UID " + uid.substring(0,8) + "...");
  } catch(e) {
    console.error("Approve error:", e);
    showToast("âŒ Error: " + e.message);
  }
};

window.cancelDeposit = async function(reqId) {
  try {
    // Only change status â€” no balance modification
    await updateDoc(doc(db, "depositRequests", reqId), { status: "cancelled" });
    document.getElementById('req-' + reqId)?.remove();
    showToast("ðŸš« áŒ¥á‹«á‰„á‹ á‰°áˆ°áˆ­á‹Ÿáˆ");
  } catch(e) {
    showToast("âŒ Error: " + e.message);
  }
};

// =============================================
//  TOAST
// =============================================
window.showToast = function(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.innerText = msg; t.className = "show";
  setTimeout(() => t.className = "", 3100);
};
