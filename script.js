// =============================================
//  BARON BINGO PRO — script.js
//  Full Firebase Modular SDK integration
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc,
  collection, onSnapshot, query, where, orderBy, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── Firebase Config ──
const firebaseConfig = {
  apiKey: "AIzaSyAZxHUnuaRNc6GfJQHNBnggJ_jfZFt_0mA",
  authDomain: "baron-24c9e.firebaseapp.com",
  projectId: "baron-24c9e",
  storageBucket: "baron-24c9e.firebasestorage.app",
  messagingSenderId: "559650974936",
  appId: "1:559650974936:web:dd133acca1be5fec8cfbad"
};


const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ── Admin Telegram ID ──
const ADMIN_ID = "6452034854";

// ── Bot names (masked) ──
const BOT_NAMES = [
  "bek***","ale**","muli**","aben***","fits**","hayl**","mery**",
  "kedi**","tseg**","dagi**","abdu**","eyer**","kal***","nati**",
  "geta***","zelu**","daw***","rob**","feti**"
];

// ── Global State ──
let currentUser       = null;
let userProfile       = null;
let userBalance       = 0;
let selectedBet       = 10;
let selectedTicketNum = 1;
let gameActive        = false;
let gameInterval      = null;
let calledNumbers     = [];
let allNumbers        = [];
let cardNumbers       = [];
let daubedCells       = new Set();
let currentGameBet    = 10;
let currentGamePlayers= 18;
let waitingTimeout    = null;
let playerWon         = false;
let takenCards        = new Set();
let transactions      = [];
let lastFourCalled    = [];

// Stake cycle state
const JOIN_DURATION = 30;
const GAME_DURATION = 60;
const TOTAL_CYCLE   = JOIN_DURATION + GAME_DURATION;
let p10=18, p20=0, p50=3, p100=0;
const NO_PLAYERS_STAKES = new Set([20,100]);
const stakeState = {
  10:{phase:'joining',elapsed:0,cyclePos:0},
  20:{phase:'joining',elapsed:0,cyclePos:0},
  50:{phase:'joining',elapsed:0,cyclePos:0},
  100:{phase:'joining',elapsed:0,cyclePos:0}
};

// =============================================
//  AUTH & USER INIT
// =============================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadOrCreateProfile(user.uid);
  }
});

async function loadOrCreateProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    userProfile = snap.data();
    userBalance = userProfile.balance || 0;
  } else {
    // New user — detect Telegram WebApp data if available
    const tg = window.Telegram?.WebApp?.initDataUnsafe?.user;
    userProfile = {
      uid,
      telegramId   : tg?.id?.toString()    || uid,
      telegramName : tg?.first_name         || "Guest",
      telegramUsername: tg?.username        || "",
      phone        : tg?.phone_number       || "",
      balance      : 0,
      createdAt    : serverTimestamp()
    };
    await setDoc(ref, userProfile);
    userBalance = 0;
  }
  updateAllBalances();
  renderMenuUserInfo();
  loadTransactionHistory();
  listenDeposits(); // start deposit listener for admin
}

async function saveBalance() {
  if (!currentUser) return;
  await updateDoc(doc(db, "users", currentUser.uid), { balance: userBalance });
}

// ── Telegram WebApp init ──
window.Telegram?.WebApp?.ready();

// =============================================
//  NAVIGATION
// =============================================
window.navigateTo = function(id) {
  if (gameActive && id !== 'game-screen') { showToast("⚠ ጨዋታ እየተጫወቱ ነው!"); return; }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'balance-screen')  renderBalanceScreen();
  if (id === 'admin-screen')    renderAdminScreen();
  if (id === 'history-screen')  renderHistoryScreen();
};

window.toggleMenu = function() {
  document.getElementById('sideMenu').classList.toggle('open');
  document.getElementById('menuOverlay').classList.toggle('open');
  renderMenuUserInfo();
  renderSidebarTransactions();
};

function renderMenuUserInfo() {
  if (!userProfile) return;
  const name  = userProfile.telegramName || "Guest";
  const phone = userProfile.phone        || "N/A";
  const id    = userProfile.telegramId   || "";
  document.getElementById('menu-user-name').textContent  = "@" + (userProfile.telegramUsername || name);
  document.getElementById('menu-user-phone').textContent = phone || ("ID: " + id);
  document.getElementById('menu-balance-val').textContent = userBalance + " ETB";
  // Show admin item only for admin
  const adminItem = document.getElementById('admin-menu-item');
  if (adminItem) adminItem.style.display = (id === ADMIN_ID) ? 'flex' : 'none';
}

function updateAllBalances() {
  document.getElementById('global-balance').innerText = userBalance;
  document.getElementById('menu-balance-val').innerText = userBalance + " ETB";
  const bd = document.getElementById('balance-display');
  if (bd) bd.innerText = userBalance;
}

function renderBalanceScreen() {
  document.getElementById('balance-display').innerText = userBalance;
}

// =============================================
//  TRANSACTIONS
// =============================================
function addTransaction(type, amount, note) {
  const tx = { type, amount, note, time: new Date().toLocaleTimeString() };
  transactions.unshift(tx);
  if (transactions.length > 50) transactions.pop();
  renderSidebarTransactions();
  // Persist to Firestore
  if (currentUser) {
    addDoc(collection(db, "users", currentUser.uid, "transactions"), {
      ...tx, createdAt: serverTimestamp()
    });
  }
}

async function loadTransactionHistory() {
  if (!currentUser) return;
  const q = query(
    collection(db, "users", currentUser.uid, "transactions"),
    orderBy("createdAt","desc")
  );
  onSnapshot(q, snap => {
    transactions = snap.docs.map(d => d.data());
    renderSidebarTransactions();
    renderHistoryScreen();
  });
}

function renderSidebarTransactions() {
  const container = document.getElementById('sidebar-tx-list');
  if (!container) return;
  if (transactions.length === 0) {
    container.innerHTML = '<div class="menu-tx-empty">ምንም ታሪክ የለም</div>';
    return;
  }
  container.innerHTML = '';
  transactions.slice(0,6).forEach(tx => {
    const sign = (tx.type==='deposit'||tx.type==='win') ? '+' : '-';
    const cls  = tx.type==='deposit'?'tx-deposit':tx.type==='win'?'tx-win':tx.type==='withdraw'?'tx-withdraw':'tx-loss';
    const label = tx.type==='deposit'?'📥 Deposit':tx.type==='win'?'🏆 Win':tx.type==='withdraw'?'📤 Withdraw':'😞 Loss';
    container.innerHTML += `
      <div class="menu-tx-item ${cls}">
        <span class="tx-label">${label}</span>
        <span class="tx-amt">${sign}${tx.amount} ETB</span>
      </div>`;
  });
}

function renderHistoryScreen() {
  const container = document.getElementById('history-list');
  if (!container) return;
  if (transactions.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,.3);">ምንም ታሪክ የለም</div>';
    return;
  }
  container.innerHTML = '';
  transactions.forEach(tx => {
    const sign = (tx.type==='deposit'||tx.type==='win') ? '+' : '-';
    const col  = (tx.type==='deposit'||tx.type==='win') ? '#00c853' : '#ff5252';
    const icon = tx.type==='deposit'?'📥':tx.type==='win'?'🏆':tx.type==='withdraw'?'📤':'😞';
    container.innerHTML += `
      <div class="history-item">
        <span>${icon} ${tx.note || tx.type}</span>
        <span style="color:${col};font-weight:800;">${sign}${tx.amount} ETB</span>
      </div>`;
  });
}

// =============================================
//  STAKE CYCLE ENGINE
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
  const badge  = document.getElementById('phase-'+bet);
  const fill   = document.getElementById('timer-fill-'+bet);
  const label  = document.getElementById('timer-label-'+bet);
  const bar    = fill ? fill.parentElement : null;
  if (!badge) return;

  if (state.phase === 'no-players') {
    badge.className = 'stake-phase-badge phase-no-players';
    badge.innerHTML = '<span class="phase-dot"></span><span>ተጫዋች የለም</span>';
    fill.style.width = '0%'; label.textContent = '--';
    label.classList.add('disabled'); if(bar) bar.classList.add('disabled');
    document.getElementById('p-'+bet).innerText = '0';
    document.getElementById('w-'+bet).innerText = '0';
    return;
  }
  if (state.phase === 'joining') {
    const rem = JOIN_DURATION - state.elapsed;
    badge.className = 'stake-phase-badge phase-joining';
    badge.innerHTML = '<span class="phase-dot"></span><span>መቀላቀል ይቻላል</span>';
    fill.className  = 'stake-timer-fill phase-joining-fill';
    fill.style.width = ((rem/JOIN_DURATION)*100) + '%';
    label.textContent = rem + 's';
    label.classList.remove('disabled'); if(bar) bar.classList.remove('disabled');
    if (Math.random() < 0.3) fluctuatePlayers(parseInt(bet));
  } else {
    const rem = GAME_DURATION - state.elapsed;
    badge.className = 'stake-phase-badge phase-started';
    badge.innerHTML = '<span class="phase-dot"></span><span>ጨዋታ ጀምሯል</span>';
    fill.className  = 'stake-timer-fill phase-started-fill';
    fill.style.width = ((rem/GAME_DURATION)*100) + '%';
    label.textContent = rem + 's';
    label.classList.remove('disabled'); if(bar) bar.classList.remove('disabled');
    if (Math.random() < 0.15 && rem < 45) dropPlayers(parseInt(bet));
  }
}

function tickStake(bet) {
  const state = stakeState[bet];
  if (state.phase === 'no-players') return;
  state.cyclePos = (state.cyclePos+1) % TOTAL_CYCLE;
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
  [10,20,50,100].forEach(bet => updateStakeUI(bet));
  setInterval(()=>tickStake(10),  1000);
  setInterval(()=>tickStake(20),  1000);
  setInterval(()=>tickStake(50),  1000);
  setInterval(()=>tickStake(100), 1000);
}

function fluctuatePlayers(bet) {
  if (NO_PLAYERS_STAKES.has(bet)) return;
  const cfg = {10:{min:5,max:33,el:'p-10',we:'w-10'},50:{min:1,max:12,el:'p-50',we:'w-50'}};
  const c = cfg[bet]; if (!c) return;
  const up  = Math.random() > 0.4;
  const chg = up ? Math.floor(Math.random()*4)+1 : -Math.floor(Math.random()*2);
  const cur = parseInt(document.getElementById(c.el).innerText)||0;
  const nxt = Math.min(Math.max(cur+chg,c.min),c.max);
  document.getElementById(c.el).innerText = nxt;
  document.getElementById(c.we).innerText = nxt*bet;
  if(bet===10) p10=nxt; if(bet===50) p50=nxt;
}
function dropPlayers(bet) {
  if (NO_PLAYERS_STAKES.has(bet)) return;
  const cfg = {10:{min:5,el:'p-10',we:'w-10'},50:{min:1,el:'p-50',we:'w-50'}};
  const c=cfg[bet]; if(!c) return;
  const cur=parseInt(document.getElementById(c.el).innerText)||0;
  const nxt=Math.max(cur-Math.floor(Math.random()*3)-1,c.min);
  document.getElementById(c.el).innerText=nxt;
  document.getElementById(c.we).innerText=nxt*bet;
}
function resetPlayers(bet) {
  const s={10:8,50:2}; const v=s[bet]||1;
  const el='p-'+bet, we='w-'+bet;
  document.getElementById(el).innerText=v;
  document.getElementById(we).innerText=v*bet;
  if(bet===10)p10=v; if(bet===50)p50=v;
}
function getPlayerCountForBet(bet) {
  return {10:p10,20:p20,50:p50,100:p100}[bet]||0;
}

startAsyncCycles();

// =============================================
//  BETTING SCREEN
// =============================================
window.showSelection = function(amount) {
  selectedBet = amount;
  document.getElementById('bet-badge').innerText = amount + " Birr";
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('deposit-redirect').style.display = 'none';
  document.getElementById('start-game-btn').style.display = 'block';
  navigateTo('selection-screen');
  loadTakenCards(amount);
  renderTicketList();
  updateBingoPreview(1);
  selectedTicketNum = 1;
  document.getElementById('card-title').innerText = "Card #1";
};

async function loadTakenCards(bet) {
  takenCards.clear();
  // Fetch active game session for this bet room
  try {
    const q = query(collection(db,"gameSessions"), where("bet","==",bet), where("active","==",true));
    onSnapshot(q, snap => {
      takenCards.clear();
      snap.docs.forEach(d => {
        const taken = d.data().takenCards || [];
        taken.forEach(c => takenCards.add(c));
      });
      renderTicketList();
    });
  } catch(e) { /* offline fallback */ }
}

function renderTicketList() {
  const list = document.getElementById('card-numbers-list');
  list.innerHTML = '';
  for (let i=1; i<=100; i++) {
    const btn = document.createElement('div');
    if (takenCards.has(i)) {
      btn.className = 'card-number card-taken';
      btn.innerText = i;
    } else {
      btn.className = 'card-number' + (i===selectedTicketNum?' card-selected':'');
      btn.innerText = i;
      btn.onclick = () => {
        document.querySelectorAll('.card-number').forEach(el=>el.classList.remove('card-selected'));
        btn.classList.add('card-selected');
        selectedTicketNum = i;
        document.getElementById('card-title').innerText = "Card #"+i;
        updateBingoPreview(i);
      };
    }
    list.appendChild(btn);
  }
}

function updateBingoPreview(seed) {
  const grid = document.getElementById('preview-grid');
  grid.innerHTML = '';
  const nums = generateBingoCard(seed);
  nums.forEach((n,i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (i===12) { cell.innerText="⭐"; cell.classList.add('marked'); }
    else { cell.innerText = n; }
    grid.appendChild(cell);
  });
}

function generateBingoCard(seed) {
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  let s = seed*9301+49297;
  function seededRandom() { s=(s*9301+49297)%233280; return s/233280; }
  let card=[];
  for (let col=0;col<5;col++) {
    let [min,max]=ranges[col], pool=[];
    for (let n=min;n<=max;n++) pool.push(n);
    for (let i=pool.length-1;i>0;i--) { let j=Math.floor(seededRandom()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
    let cn=pool.slice(0,5); cn.sort((a,b)=>a-b); card.push(cn);
  }
  let result=[];
  for (let row=0;row<5;row++) for(let col=0;col<5;col++) result.push(card[col][row]);
  result[12]=0; return result;
}

// =============================================
//  GAME START
// =============================================
window.startGame = function() {
  if (userBalance < selectedBet) {
    document.getElementById('error-msg').style.display = 'block';
    document.getElementById('deposit-redirect').style.display = 'block';
    document.getElementById('start-game-btn').style.display = 'none';
    return;
  }

  // Deduct immediately
  userBalance -= selectedBet;
  updateAllBalances();
  saveBalance();
  addTransaction('loss', selectedBet, "Bet placed ("+selectedBet+" Birr)");

  currentGameBet     = selectedBet;
  const realPlayers  = Math.max(getPlayerCountForBet(selectedBet), 1);
  currentGamePlayers = realPlayers;

  // Bot logic for 10 ETB room
  let bots = [];
  if (selectedBet === 10 && realPlayers < 6) {
    const botCount = Math.floor(Math.random()*17)+3; // 3-19
    const shuffled = [...BOT_NAMES].sort(()=>Math.random()-.5);
    bots = shuffled.slice(0, Math.min(botCount, BOT_NAMES.length));
    currentGamePlayers = 1 + bots.length;
  }

  // Show waiting screen
  const wo = document.getElementById('waitingOverlay');
  wo.classList.add('show');
  document.getElementById('waitingNeeded').innerText = currentGamePlayers;

  // Render player tags (user + bots)
  const tagContainer = document.getElementById('waitingPlayersList');
  tagContainer.innerHTML = '';
  const userName = "@"+(userProfile?.telegramUsername || userProfile?.telegramName || "You");
  tagContainer.innerHTML += `<div class="waiting-player-tag is-you">${userName}</div>`;

  let joinedBots = 0;
  let waitCount  = 1;
  document.getElementById('waitingCurrent').innerText = waitCount;

  const waitInterval = setInterval(() => {
    if (joinedBots < bots.length) {
      const batch = Math.min(Math.floor(Math.random()*3)+1, bots.length-joinedBots);
      for (let b=0; b<batch; b++) {
        const name = bots[joinedBots+b];
        tagContainer.innerHTML += `<div class="waiting-player-tag">${name}</div>`;
      }
      joinedBots += batch;
      waitCount = 1 + joinedBots;
      document.getElementById('waitingCurrent').innerText = waitCount;
    }
    if (waitCount >= currentGamePlayers) {
      clearInterval(waitInterval);
      setTimeout(() => {
        wo.classList.remove('show');
        initGame(bots);
      }, 700);
    }
  }, 550);

  waitingTimeout = waitInterval;
};

window.cancelWaiting = function() {
  if (waitingTimeout) clearInterval(waitingTimeout);
  document.getElementById('waitingOverlay').classList.remove('show');
  userBalance += currentGameBet;
  updateAllBalances();
  saveBalance();
  // Remove the loss transaction
  transactions.shift();
  showToast("🔄 ገንዘብዎ ተመልሷል");
  navigateTo('betting-screen');
};

// =============================================
//  GAME LOGIC
// =============================================
function initGame(bots=[]) {
  gameActive    = true;
  playerWon     = false;
  calledNumbers = [];
  lastFourCalled= [];
  daubedCells   = new Set();
  daubedCells.add(12);

  cardNumbers = generateBingoCard(selectedTicketNum);

  allNumbers = [];
  for (let i=1;i<=75;i++) allNumbers.push(i);
  shuffleArray(allNumbers);

  document.getElementById('game-bet-pill').innerText     = currentGameBet + " Birr";
  document.getElementById('game-players-pill').innerText = "👥 " + currentGamePlayers;
  document.getElementById('currentBall').innerText       = "?";
  document.getElementById('callLetterDisplay').innerHTML = "BINGO<span>-</span>";
  document.getElementById('calledHistory').innerHTML     = '';
  document.getElementById('callsCount').innerText        = "0/75";
  document.getElementById('gameStatusText').innerText    = "⏳ ጨዋታው እየተጫወተ ነው...";
  document.getElementById('bingoBtn').classList.remove('can-bingo');

  renderGameCard();
  navigateTo('game-screen');

  // Generate bot cards for win checking
  const botCards = bots.map((name, i) => ({
    name,
    card: generateBingoCard(Math.floor(Math.random()*100)+1),
    daubed: new Set([12])
  }));

  let callIndex = 0;
  gameInterval = setInterval(() => {
    if (callIndex >= allNumbers.length || playerWon) {
      clearInterval(gameInterval); gameInterval = null;
      if (!playerWon) setTimeout(()=>endGameLoss(), 1500);
      return;
    }

    const num = allNumbers[callIndex];
    calledNumbers.push(num);
    callIndex++;

    const letter = getLetterForNumber(num);
    document.getElementById('currentBall').innerText = num;
    document.getElementById('callLetterDisplay').innerHTML = letter + "<span>"+num+"</span>";
    document.getElementById('callsCount').innerText = calledNumbers.length + "/75";

    // Update last-4 strip (sliding window)
    lastFourCalled.push({num, letter});
    if (lastFourCalled.length > 4) lastFourCalled.shift();
    renderLastFour();

    autoDaub(num);

    // Check player bingo
    if (checkBingo()) {
      document.getElementById('bingoBtn').classList.add('can-bingo');
      document.getElementById('gameStatusText').innerText = "🎉 BINGO! ይጫኑ!";
    }

    // Check bot bingo
    if (bots.length > 0 && calledNumbers.length >= 20) {
      for (const bot of botCards) {
        autoDaubCard(bot.card, bot.daubed, num);
        if (checkBingoForCard(bot.daubed) && !playerWon) {
          const botWinProb = 0.025;
          if (Math.random() < botWinProb) {
            clearInterval(gameInterval); gameInterval = null;
            setTimeout(()=>endGameLoss(bot.name), 1200);
            return;
          }
        }
      }
    }
  }, 2500);
}

function renderLastFour() {
  const strip = document.getElementById('calledHistory');
  strip.innerHTML = '';
  lastFourCalled.forEach(({num, letter}) => {
    const el = document.createElement('div');
    el.className = 'called-mini-ball ball-'+letter.toLowerCase();
    el.innerText = num;
    el.style.animation = 'popIn .3s ease';
    strip.appendChild(el);
  });
}

function renderGameCard() {
  const grid = document.getElementById('gameGrid');
  grid.innerHTML = '';
  cardNumbers.forEach((num,i) => {
    const cell = document.createElement('div');
    cell.className = 'game-cell';
    cell.dataset.index = i;
    if (i===12) { cell.classList.add('free-cell','auto-daubed'); cell.innerText="FREE"; }
    else { cell.innerText=num; cell.onclick=()=>manualDaub(i); }
    grid.appendChild(cell);
  });
}

function autoDaub(number) {
  cardNumbers.forEach((num,i) => {
    if (num===number && i!==12) {
      daubedCells.add(i);
      const cells = document.querySelectorAll('#gameGrid .game-cell');
      if (cells[i]) cells[i].classList.add('auto-daubed');
    }
  });
}

function autoDaubCard(card, daubed, number) {
  card.forEach((num,i) => { if(num===number && i!==12) daubed.add(i); });
}

window.manualDaub = function(index) {
  if (index===12) return;
  const num = cardNumbers[index];
  if (calledNumbers.includes(num)) {
    daubedCells.add(index);
    const cells = document.querySelectorAll('#gameGrid .game-cell');
    if (cells[index]) cells[index].classList.add('daubed');
    if (checkBingo()) {
      document.getElementById('bingoBtn').classList.add('can-bingo');
      document.getElementById('gameStatusText').innerText = "🎉 BINGO! ይጫኑ!";
    }
  } else {
    showToast("⚠ ይህ ቁጥር ገና አልተጠራም!");
  }
};

function checkBingo() { return checkBingoForCard(daubedCells); }

function checkBingoForCard(daubed) {
  for (let r=0;r<5;r++) {
    let ok=true; for(let c=0;c<5;c++) if(!daubed.has(r*5+c)){ok=false;break;} if(ok) return true;
  }
  for (let c=0;c<5;c++) {
    let ok=true; for(let r=0;r<5;r++) if(!daubed.has(r*5+c)){ok=false;break;} if(ok) return true;
  }
  let d1=true,d2=true;
  for(let i=0;i<5;i++){if(!daubed.has(i*5+i))d1=false; if(!daubed.has(i*5+(4-i)))d2=false;}
  return d1||d2;
}

function getWinningCells() {
  let wc=new Set();
  for(let r=0;r<5;r++){let ok=true,cells=[];for(let c=0;c<5;c++){cells.push(r*5+c);if(!daubedCells.has(r*5+c))ok=false;}if(ok)cells.forEach(x=>wc.add(x));}
  for(let c=0;c<5;c++){let ok=true,cells=[];for(let r=0;r<5;r++){cells.push(r*5+c);if(!daubedCells.has(r*5+c))ok=false;}if(ok)cells.forEach(x=>wc.add(x));}
  let d1=true,d2=true,dc1=[],dc2=[];
  for(let i=0;i<5;i++){dc1.push(i*5+i);dc2.push(i*5+(4-i));if(!daubedCells.has(i*5+i))d1=false;if(!daubedCells.has(i*5+(4-i)))d2=false;}
  if(d1)dc1.forEach(x=>wc.add(x)); if(d2)dc2.forEach(x=>wc.add(x));
  return wc;
}

window.callBingo = function() {
  if (!checkBingo()) { showToast("⚠ ገና ቢንጎ አልሆነም!"); return; }
  playerWon = true;
  if (gameInterval) { clearInterval(gameInterval); gameInterval=null; }

  const winCells = getWinningCells();
  document.querySelectorAll('#gameGrid .game-cell').forEach((c,i) => { if(winCells.has(i)) c.classList.add('winning-cell'); });
  document.getElementById('gameStatusText').innerText = "🏆 አሸንፈዋል!";

  const pool  = currentGamePlayers * currentGameBet;
  const prize = Math.floor(pool * 0.9); // 10% platform fee
  userBalance += prize;
  updateAllBalances();
  saveBalance();
  addTransaction('win', prize, "Won "+currentGameBet+" Birr game");

  const uname = userProfile?.telegramUsername || userProfile?.telegramName || "you";
  const masked = "@" + uname.substring(0,3) + "***";

  setTimeout(() => { showWinModal(prize, masked); launchConfetti(); }, 1200);
};

function endGameLoss(botName=null) {
  if (playerWon) return;
  if (gameInterval) { clearInterval(gameInterval); gameInterval=null; }
  const winner = botName || "ሌላ ተጫዋች";
  document.getElementById('gameStatusText').innerText = "😞 "+winner+" አሸንፏል";
  document.getElementById('bingoBtn').classList.remove('can-bingo');
  setTimeout(() => showLoseModal(botName), 1500);
}

function showWinModal(prize, masked) {
  document.getElementById('winEmoji').innerText   = "🏆";
  document.getElementById('winTitle').textContent = "አሸነፉ!";
  document.getElementById('winTitle').className   = "win-title gold-title";
  document.getElementById('winAmount').innerText  = "+" + prize + " ETB";
  document.getElementById('winAmount').style.color= "var(--cyan)";
  document.getElementById('winSub').innerText     = "ሽልማቱ ወደ ሂሳብዎ ተጨምሯል";
  document.getElementById('winWinnerTag').style.display = 'inline-block';
  document.getElementById('winWinnerTag').innerText     = "Winner: " + masked;
  document.getElementById('winOverlay').classList.add('show');
}

function showLoseModal(botName) {
  document.getElementById('winEmoji').innerText   = "😞";
  document.getElementById('winTitle').textContent = "አልተሳካም";
  document.getElementById('winTitle').className   = "win-title red-title";
  document.getElementById('winAmount').innerText  = "-" + currentGameBet + " ETB";
  document.getElementById('winAmount').style.color= "var(--red)";
  const winner = botName ? botName : "ሌላ ተጫዋች";
  document.getElementById('winSub').innerText     = winner + " አሸንፏል። እንደገና ይሞክሩ!";
  document.getElementById('winWinnerTag').style.display = 'none';
  document.getElementById('winOverlay').classList.add('show');
}

window.closeWinModal = function() {
  document.getElementById('winOverlay').classList.remove('show');
  document.getElementById('confettiContainer').innerHTML = '';
  gameActive = false;
  navigateTo('betting-screen');
};

window.leaveGame = function() {
  if (gameInterval) { clearInterval(gameInterval); gameInterval=null; }
  gameActive = false; playerWon = false;
  navigateTo('betting-screen');
  showToast("🚪 ጨዋታውን ለቅቀዋል");
};

function launchConfetti() {
  const c = document.getElementById('confettiContainer');
  c.innerHTML = '';
  const colors=['#ffde00','#ff9500','#ff5252','#00c853','#60efff','#e040fb','#0061ff'];
  for(let i=0;i<80;i++){
    const p=document.createElement('div'); p.className='confetti-piece';
    p.style.left=Math.random()*100+'%';
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.width=(Math.random()*8+4)+'px'; p.style.height=(Math.random()*8+4)+'px';
    p.style.borderRadius=Math.random()>.5?'50%':'2px';
    p.style.animationDuration=(Math.random()*2+1.5)+'s';
    p.style.animationDelay=(Math.random()*1)+'s';
    c.appendChild(p);
  }
}

function getLetterForNumber(n) {
  if(n<=15) return 'B'; if(n<=30) return 'I'; if(n<=45) return 'N'; if(n<=60) return 'G'; return 'O';
}

function shuffleArray(arr) {
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
}

// =============================================
//  DEPOSIT
// =============================================
window.copyNumber = function() {
  const num = document.getElementById('phone-num').innerText;
  navigator.clipboard.writeText(num).then(showCopyToast).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=num; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); showCopyToast();
  });
};

function showCopyToast() {
  const t=document.getElementById("copy-toast"); t.className="show";
  setTimeout(()=>t.className="",2000);
}

window.submitDeposit = async function() {
  const amt = document.getElementById('dep-amount').value;
  const sms = document.getElementById('dep-sms').value;
  if (!amt||!sms) { showToast("⚠ እባክዎ መረጃውን በትክክል ይሙሉ!"); return; }
  if (parseFloat(amt)<50) { showToast("⚠ ቢያንስ 50 ብር ማስገባት አለብዎት!"); return; }

  try {
    await addDoc(collection(db,"depositRequests"), {
      uid      : currentUser?.uid || "guest",
      userName : userProfile?.telegramName || "Unknown",
      telegramId: userProfile?.telegramId || "",
      amount   : parseFloat(amt),
      sms,
      status   : "pending",
      createdAt: serverTimestamp()
    });
    const container = document.getElementById('deposit-history');
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `<span>📥 ${amt} ETB</span><span class="status-pending">⏳ Pending...</span>`;
    container.prepend(item);
    document.getElementById('dep-amount').value='';
    document.getElementById('dep-sms').value='';
    showToast("✅ ጥያቄዎ ተልኳል! እባክዎ ይጠብቁ...");
  } catch(e) {
    showToast("❌ Error: " + e.message);
  }
};

// =============================================
//  WITHDRAW
// =============================================
window.submitWithdraw = async function() {
  const phone = document.getElementById('wd-phone').value;
  const amt   = document.getElementById('wd-amount').value;
  const errEl = document.getElementById('wd-error');
  errEl.style.display='none';
  if (!phone||!amt) { showToast("⚠ እባክዎ መረጃውን በትክክል ይሙሉ!"); return; }
  if (phone.length<10) { showToast("⚠ ትክክለኛ ስልክ ቁጥር ያስገቡ!"); return; }
  const amount=parseFloat(amt);
  if (amount<20) { showToast("⚠ ቢያንስ 20 ብር ማውጣት ይቻላል!"); return; }
  if (amount>userBalance) { errEl.style.display='block'; return; }

  userBalance -= amount;
  updateAllBalances();
  saveBalance();
  addTransaction('withdraw', amount, "Withdraw → "+phone);

  try {
    await addDoc(collection(db,"withdrawRequests"),{
      uid:currentUser?.uid||"guest",
      userName:userProfile?.telegramName||"Unknown",
      phone, amount, status:"pending", createdAt:serverTimestamp()
    });
  } catch(e){}

  const container = document.getElementById('withdraw-history');
  const item=document.createElement('div'); item.className='history-item'; item.style.borderLeftColor='var(--red)';
  item.innerHTML=`<span>📤 ${amt} ETB → ${phone}</span><span class="status-pending">⏳ Processing...</span>`;
  container.prepend(item);
  document.getElementById('wd-phone').value='';
  document.getElementById('wd-amount').value='';
  showToast("✅ የወጪ ጥያቄዎ ተልኳል!");
};

// =============================================
//  ADMIN PANEL
// =============================================
let depositListener = null;

function listenDeposits() {
  if (userProfile?.telegramId !== ADMIN_ID) return;
  const q = query(collection(db,"depositRequests"), where("status","==","pending"), orderBy("createdAt","desc"));
  depositListener = onSnapshot(q, snap => {
    window._pendingDeposits = snap.docs.map(d=>({id:d.id,...d.data()}));
    if (document.getElementById('admin-screen')?.classList.contains('active')) renderAdminScreen();
  });
}

function renderAdminScreen() {
  const container = document.getElementById('admin-requests');
  if (!container) return;
  const deposits = window._pendingDeposits || [];
  if (deposits.length===0) {
    container.innerHTML='<div class="admin-empty">✅ Pending ጥያቄ የለም</div>'; return;
  }
  container.innerHTML='';
  deposits.forEach(dep => {
    const time = dep.createdAt?.toDate?.()?.toLocaleString() || '';
    container.innerHTML += `
      <div class="deposit-req-item" id="req-${dep.id}">
        <div class="req-user">${dep.userName} (${dep.telegramId})</div>
        <div class="req-amt">${dep.amount} ETB</div>
        <div class="req-sms">SMS: ${dep.sms}</div>
        <div class="req-time">${time}</div>
        <div class="req-actions">
          <button class="approve-btn" onclick="approveDeposit('${dep.id}','${dep.uid}',${dep.amount})">✅ Approve</button>
          <button class="cancel-btn"  onclick="cancelDeposit('${dep.id}')">❌ Cancel</button>
        </div>
      </div>`;
  });
}

window.approveDeposit = async function(reqId, uid, amount) {
  try {
    // Update deposit request status
    await updateDoc(doc(db,"depositRequests",reqId), { status:"deposited" });
    // Credit user balance
    await updateDoc(doc(db,"users",uid), { balance: increment(amount) });
    // Add user transaction
    await addDoc(collection(db,"users",uid,"transactions"),{
      type:"deposit", amount, note:"Deposit approved "+amount+" ETB", createdAt:serverTimestamp()
    });
    document.getElementById('req-'+reqId)?.remove();
    showToast("✅ "+amount+" ETB ተፈቅዷል!");
  } catch(e) { showToast("❌ Error: "+e.message); }
};

window.cancelDeposit = async function(reqId) {
  try {
    await updateDoc(doc(db,"depositRequests",reqId), { status:"cancelled" });
    document.getElementById('req-'+reqId)?.remove();
    showToast("🚫 ጥያቄው ተሰርዟል");
  } catch(e) { showToast("❌ Error: "+e.message); }
};

// =============================================
//  TOAST / UTILS
// =============================================
window.showToast = function(msg) {
  const t=document.getElementById("toast"); t.innerText=msg; t.className="show";
  setTimeout(()=>t.className="",3100);
};

// Sign in anonymously on load
signInAnonymously(auth).catch(e => console.warn("Auth:", e));
