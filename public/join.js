const socket = io();

let myPlayerId = null;
let myRoomCode = null;
let myNickname = null;
let roomState = null;

let localTimerInterval = null;
let countdownInterval = null;
let clickerSyncInterval = null;

// Game-specific transient state
let lucky7StartPerf = 0;
let lucky7Submitted = false;

let clickerCount = 0;
let clickerActive = false;

let ticketingOffsetMs = 0;
let ticketOpenPerf = 0;
let ticketEarlyPenaltyCount = 0;
let ticketReactionMs = 0;
let ticketSubmitted = false;
let earlyLockUntil = 0;

// DOM Elements
const headerStatusBadge = document.getElementById('headerStatusBadge');
const joinFormView = document.getElementById('joinFormView');
const roomView = document.getElementById('roomView');
const roomCodeInput = document.getElementById('roomCodeInput');
const nicknameInput = document.getElementById('nicknameInput');
const joinError = document.getElementById('joinError');
const joinBtn = document.getElementById('joinBtn');

const myNickLabel = document.getElementById('myNickLabel');
const myRoomLabel = document.getElementById('myRoomLabel');
const roomPeopleLabel = document.getElementById('roomPeopleLabel');
const currentModeBadge = document.getElementById('currentModeBadge');

const pStageWaiting = document.getElementById('pStageWaiting');
const pWaitTitle = document.getElementById('pWaitTitle');
const pWaitDesc = document.getElementById('pWaitDesc');

const pStageCountdown = document.getElementById('pStageCountdown');
const pCountdownNum = document.getElementById('pCountdownNum');
const pTicketingCountdownBox = document.getElementById('pTicketingCountdownBox');
const pTicketingClock = document.getElementById('pTicketingClock');
const pEarlyWarn = document.getElementById('pEarlyWarn');
const pTicketingEarlyBtn = document.getElementById('pTicketingEarlyBtn');

const pStageLucky7 = document.getElementById('pStageLucky7');
const pLucky7Goal = document.getElementById('pLucky7Goal');
const pLucky7Clock = document.getElementById('pLucky7Clock');
const pLucky7BlindHint = document.getElementById('pLucky7BlindHint');
const pLucky7StopBtn = document.getElementById('pLucky7StopBtn');
const pLucky7Result = document.getElementById('pLucky7Result');
const pLucky7ResultText = document.getElementById('pLucky7ResultText');
const pLucky7RankText = document.getElementById('pLucky7RankText');

const pStageClicker = document.getElementById('pStageClicker');
const pClickerTimeLeft = document.getElementById('pClickerTimeLeft');
const pClickerCount = document.getElementById('pClickerCount');
const playerClicker3dBox = document.getElementById('playerClicker3dBox');
const pClickerTapBtn = document.getElementById('pClickerTapBtn');
const playerClickerArena = window.createClicker3DArena ? window.createClicker3DArena(playerClicker3dBox, { maxBalls: 45 }) : null;

const pStageTicketing = document.getElementById('pStageTicketing');
const pTicketLiveClock = document.getElementById('pTicketLiveClock');
const pTicketStep1 = document.getElementById('pTicketStep1');
const pTicketBookBtn = document.getElementById('pTicketBookBtn');
const pTicketStep2 = document.getElementById('pTicketStep2');
const pSeatGrid = document.getElementById('pSeatGrid');
const pTicketDone = document.getElementById('pTicketDone');
const pTicketResultText = document.getElementById('pTicketResultText');
const pTicketRankText = document.getElementById('pTicketRankText');

const pStageFinished = document.getElementById('pStageFinished');
const pFinishWinner = document.getElementById('pFinishWinner');
const pFinishMyRecord = document.getElementById('pFinishMyRecord');
const pMyHistoryList = document.getElementById('pMyHistoryList');

// --- Helpers ---
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMsToSec(ms) {
  return (ms / 1000).toFixed(3) + '초';
}

function formatDiffMs(diffMs) {
  const sign = diffMs > 0 ? '+' : diffMs < 0 ? '-' : '';
  return `${sign}${(Math.abs(diffMs) / 1000).toFixed(3)}초`;
}

function formatClock(ms) {
  const d = new Date(ms);
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function getModeLabel(mode) {
  if (mode === 'lucky7') return '행운의 7초';
  if (mode === 'clicker') return '광클 복불복';
  if (mode === 'ticketing') return '티켓팅 연습';
  return mode;
}

function stopAllTimers() {
  if (localTimerInterval) {
    clearInterval(localTimerInterval);
    localTimerInterval = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (clickerSyncInterval) {
    clearInterval(clickerSyncInterval);
    clickerSyncInterval = null;
  }
}

function hideAllStages() {
  pStageWaiting.classList.add('hidden');
  pStageCountdown.classList.add('hidden');
  pStageLucky7.classList.add('hidden');
  pStageClicker.classList.add('hidden');
  pStageTicketing.classList.add('hidden');
  pStageFinished.classList.add('hidden');
}

// --- Join Logic ---
function getInitialCode() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'join' && parts[1]) {
    return parts[1].toUpperCase();
  }
  const params = new URLSearchParams(window.location.search);
  return (params.get('code') || '').toUpperCase();
}

function attemptJoin(code, nickname, savedPlayerId) {
  joinError.classList.add('hidden');
  joinBtn.disabled = true;

  socket.emit('player:join', { code, nickname, playerId: savedPlayerId }, (resp) => {
    joinBtn.disabled = false;
    if (!resp || !resp.ok) {
      joinError.textContent = resp?.error || '입장에 실패했습니다.';
      joinError.classList.remove('hidden');
      return;
    }

    myPlayerId = resp.playerId;
    myRoomCode = resp.state.code;
    myNickname = nickname;

    sessionStorage.setItem('playerRoomCode', myRoomCode);
    sessionStorage.setItem('playerNickname', myNickname);
    sessionStorage.setItem('playerId', myPlayerId);

    joinFormView.classList.add('hidden');
    roomView.classList.remove('hidden');
    headerStatusBadge.textContent = '접속 중';
    headerStatusBadge.className = 'badge badge-success';

    renderRoomState(resp.state);
  });
}

joinBtn.addEventListener('click', () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  const nick = nicknameInput.value.trim();
  if (!code || code.length < 4) {
    joinError.textContent = '방 코드 6자리를 입력해주세요.';
    joinError.classList.remove('hidden');
    return;
  }
  if (!nick) {
    joinError.textContent = '닉네임을 입력해주세요.';
    joinError.classList.remove('hidden');
    return;
  }
  attemptJoin(code, nick, null);
});

nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

// Init on load
(function init() {
  const urlCode = getInitialCode();
  const savedCode = sessionStorage.getItem('playerRoomCode');
  const savedNick = sessionStorage.getItem('playerNickname');
  const savedId = sessionStorage.getItem('playerId');

  if (urlCode) {
    roomCodeInput.value = urlCode;
  } else if (savedCode) {
    roomCodeInput.value = savedCode;
  }
  if (savedNick) {
    nicknameInput.value = savedNick;
  }

  // Auto-rejoin if refreshing inside the same room
  if (savedCode && savedNick && savedId && (!urlCode || urlCode === savedCode)) {
    attemptJoin(savedCode, savedNick, savedId);
  }
})();

// --- Render Room State ---
function renderRoomState(state) {
  roomState = state;
  myNickLabel.textContent = myNickname;
  myRoomLabel.textContent = state.code;
  roomPeopleLabel.textContent = `${state.players.length}명 참여 중`;
  currentModeBadge.textContent = getModeLabel(state.mode);

  if (state.status === 'waiting') {
    stopAllTimers();
    hideAllStages();
    pStageWaiting.classList.remove('hidden');
    pWaitTitle.textContent = `${getModeLabel(state.mode)} 대기 중`;
    if (state.mode === 'lucky7') {
      pWaitDesc.textContent = `목표 ${state.options.lucky7.targetSec}초! 방장이 시작 버튼을 누르면 바로 시작됩니다.`;
    } else if (state.mode === 'clicker') {
      pWaitDesc.textContent = `${state.options.clicker.durationSec}초 동안 화면을 열심히 터치하는 복불복입니다!`;
    } else {
      pWaitDesc.textContent = '카운트다운이 끝나고 정각이 되면 빠르게 예매하기를 누르세요!';
    }
  } else if (state.status === 'finished' && state.currentRound) {
    stopAllTimers();
    clickerActive = false;
    hideAllStages();
    pStageFinished.classList.remove('hidden');

    const winner = state.currentRound.specialWinner;
    pFinishWinner.textContent = winner ? `당첨/1등: ${winner.nickname}` : '기록 없음';

    const myRes = (state.currentRound.results || []).find((r) => r.playerId === myPlayerId);
    if (!myRes) {
      pFinishMyRecord.textContent = '이번 라운드 내 기록: 미제출';
    } else if (state.currentRound.mode === 'lucky7') {
      pFinishMyRecord.textContent = `내 기록: ${myRes.rank}위 · ${formatMsToSec(myRes.elapsedMs)} (${formatDiffMs(myRes.diffMs)})`;
    } else if (state.currentRound.mode === 'clicker') {
      pFinishMyRecord.textContent = `내 기록: ${myRes.rank}위 · 총 ${myRes.clicks}회 터치`;
    } else {
      pFinishMyRecord.textContent = `내 기록: ${myRes.rank}위 · ${formatMsToSec(myRes.totalMs)} (좌석 ${myRes.seatLabel})`;
    }
  }

  renderMyHistory(state.history || []);
}

function renderMyHistory(history) {
  const myEntries = [];
  history.forEach((round) => {
    const found = (round.results || []).find((r) => r.playerId === myPlayerId);
    if (found) {
      myEntries.push({ roundNumber: round.roundNumber, mode: round.mode, result: found });
    }
  });

  if (myEntries.length === 0) {
    pMyHistoryList.innerHTML = '아직 완료한 라운드가 없습니다.';
    return;
  }

  pMyHistoryList.innerHTML = myEntries
    .slice()
    .reverse()
    .map((item) => {
      let detail = '';
      if (item.mode === 'lucky7') {
        detail = `${formatMsToSec(item.result.elapsedMs)} (오차 ${formatDiffMs(item.result.diffMs)})`;
      } else if (item.mode === 'clicker') {
        detail = `${item.result.clicks}회 터치`;
      } else {
        detail = `${formatMsToSec(item.result.totalMs)} · 좌석 ${item.result.seatLabel}`;
      }
      return `
        <div class="flex justify-between items-center" style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
          <span><strong>#${item.roundNumber}</strong> ${getModeLabel(item.mode)}</span>
          <span><strong>${item.result.rank}위</strong> · ${detail}</span>
        </div>
      `;
    })
    .join('');
}

// --- Socket Game Events ---
socket.on('room:state', (state) => {
  if (!myPlayerId) return;
  renderRoomState(state);
});

socket.on('player:kicked', () => {
  alert('방장에 의해 퇴장되었습니다.');
  sessionStorage.removeItem('playerId');
  window.location.href = '/';
});

socket.on('room:closed_by_admin', () => {
  alert('관리자에 의해 방이 종료되었습니다.');
  sessionStorage.removeItem('playerId');
  sessionStorage.removeItem('playerRoomCode');
  window.location.href = '/';
});

socket.on('game:countdown', async ({ mode, options, countdownEndsAt, serverNow }) => {
  stopAllTimers();
  hideAllStages();
  pStageCountdown.classList.remove('hidden');

  const clockSkew = serverNow - Date.now();
  ticketEarlyPenaltyCount = 0;
  pEarlyWarn.textContent = '';

  if (mode === 'ticketing') {
    pTicketingCountdownBox.classList.remove('hidden');
    try {
      const resp = await fetch(`/api/server-time?target=${encodeURIComponent(options.targetServer)}`);
      const tData = await resp.json();
      ticketingOffsetMs = tData.offsetMs || 0;
    } catch (e) {
      ticketingOffsetMs = 0;
    }
  } else {
    pTicketingCountdownBox.classList.add('hidden');
  }

  function tick() {
    const remMs = countdownEndsAt - (Date.now() + clockSkew);
    const sec = Math.max(1, Math.ceil(remMs / 1000));
    pCountdownNum.textContent = String(sec);
    if (mode === 'ticketing') {
      pTicketingClock.textContent = formatClock(Date.now() + ticketingOffsetMs);
    }
    if (remMs <= 0) {
      clearInterval(countdownInterval);
    }
  }
  tick();
  countdownInterval = setInterval(tick, 40);
});

// Early click trap for ticketing
pTicketingEarlyBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  ticketEarlyPenaltyCount += 1;
  earlyLockUntil = Date.now() + 500;
  pEarlyWarn.textContent = `아직 오픈 전입니다. (${ticketEarlyPenaltyCount}회 부정클릭)`;
  if (navigator.vibrate) navigator.vibrate(30);
});

socket.on('game:start', ({ mode, options, endsAt, serverNow }) => {
  stopAllTimers();
  hideAllStages();
  const clockSkew = serverNow - Date.now();

  if (mode === 'lucky7') {
    pStageLucky7.classList.remove('hidden');
    lucky7Submitted = false;
    lucky7StartPerf = performance.now();
    pLucky7StopBtn.disabled = false;
    pLucky7StopBtn.classList.remove('hidden');
    pLucky7Result.classList.add('hidden');
    pLucky7Clock.classList.remove('timer-blind');
    pLucky7Goal.textContent = `목표: ${options.targetSec}.000초`;
    pLucky7BlindHint.textContent = options.blindEnabled ? '3초 후 숫자가 가려집니다!' : '';

    const blindAfterMs = (options.blindAfterSec || 3) * 1000;
    localTimerInterval = setInterval(() => {
      const elapsed = performance.now() - lucky7StartPerf;
      pLucky7Clock.textContent = formatMsToSec(elapsed);
      if (options.blindEnabled && elapsed >= blindAfterMs && !lucky7Submitted) {
        pLucky7Clock.classList.add('timer-blind');
        pLucky7BlindHint.textContent = '블라인드 중 — 마음속으로 세세요';
      }
    }, 25);
  } else if (mode === 'clicker') {
    pStageClicker.classList.remove('hidden');
    clickerCount = 0;
    clickerActive = true;
    pClickerCount.textContent = '0회';
    pClickerTapBtn.disabled = false;
    if (playerClickerArena) playerClickerArena.start();

    localTimerInterval = setInterval(() => {
      const remMs = Math.max(0, endsAt - (Date.now() + clockSkew));
      pClickerTimeLeft.textContent = `${(remMs / 1000).toFixed(1)}초`;
      if (remMs <= 0) {
        clickerActive = false;
        pClickerTapBtn.disabled = true;
        clearInterval(localTimerInterval);
        clearInterval(clickerSyncInterval);
        socket.emit('player:submit_clicker', { clicks: clickerCount });
      }
    }, 50);

    clickerSyncInterval = setInterval(() => {
      if (clickerActive) {
        socket.emit('player:clicker_progress', { clicks: clickerCount });
      }
    }, 180);
  } else if (mode === 'ticketing') {
    pStageTicketing.classList.remove('hidden');
    ticketOpenPerf = performance.now();
    ticketSubmitted = false;
    ticketReactionMs = 0;

    pTicketStep1.classList.remove('hidden');
    pTicketStep2.classList.add('hidden');
    pTicketDone.classList.add('hidden');
    pTicketBookBtn.disabled = false;

    localTimerInterval = setInterval(() => {
      pTicketLiveClock.textContent = formatClock(Date.now() + ticketingOffsetMs);
    }, 40);
  }
});

// --- Lucky 7 Stop ---
pLucky7StopBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (lucky7Submitted) return;
  lucky7Submitted = true;

  const elapsedMs = Math.round(performance.now() - lucky7StartPerf);
  clearInterval(localTimerInterval);
  pLucky7Clock.classList.remove('timer-blind');
  pLucky7Clock.textContent = formatMsToSec(elapsedMs);
  pLucky7BlindHint.textContent = '';
  pLucky7StopBtn.disabled = true;
  pLucky7StopBtn.classList.add('hidden');

  if (navigator.vibrate) navigator.vibrate(25);

  socket.emit('player:submit_lucky7', { elapsedMs }, (resp) => {
    pLucky7Result.classList.remove('hidden');
    if (resp && resp.ok) {
      pLucky7ResultText.textContent = `${formatMsToSec(resp.entry.elapsedMs)} (오차 ${formatDiffMs(resp.entry.diffMs)})`;
      pLucky7RankText.textContent = `현재 실시간 순위: ${resp.entry.rank}위`;
    }
  });
});

// --- Clicker Tap ---
pClickerTapBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!clickerActive) return;
  clickerCount += 1;
  pClickerCount.textContent = `${clickerCount}회`;
  if (playerClickerArena) playerClickerArena.burst(2);
  if (navigator.vibrate) navigator.vibrate(8);
});

// --- Ticketing Flow ---
pTicketBookBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (ticketSubmitted) return;
  if (Date.now() < earlyLockUntil) {
    pTicketBookBtn.textContent = '부정클릭 잠금 중...';
    setTimeout(() => {
      pTicketBookBtn.textContent = '지금 예매하기';
    }, 300);
    return;
  }

  ticketReactionMs = Math.round(performance.now() - ticketOpenPerf);
  if (navigator.vibrate) navigator.vibrate(15);

  const withSeat = roomState?.currentRound?.options?.withSeat ?? true;
  if (!withSeat) {
    completeTicketing('자유석');
    return;
  }

  pTicketStep1.classList.add('hidden');
  pTicketStep2.classList.remove('hidden');
  buildSeatGrid();
});

function buildSeatGrid() {
  const rows = ['A', 'B', 'C', 'D'];
  const cols = [1, 2, 3, 4, 5];
  // Randomly pre-occupy 6 seats so students have to spot a purple seat
  const allLabels = [];
  rows.forEach((r) => cols.forEach((c) => allLabels.push(`${r}${c}`)));
  const takenSet = new Set();
  while (takenSet.size < 6) {
    takenSet.add(allLabels[Math.floor(Math.random() * allLabels.length)]);
  }

  pSeatGrid.innerHTML = allLabels
    .map((label) => {
      const isTaken = takenSet.has(label);
      return `<button class="seat-btn ${isTaken ? 'taken' : ''}" data-seat="${label}" ${isTaken ? 'disabled' : ''}>${label}</button>`;
    })
    .join('');

  pSeatGrid.querySelectorAll('.seat-btn:not(.taken)').forEach((btn) => {
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (ticketSubmitted) return;
      completeTicketing(btn.dataset.seat);
    });
  });
}

function completeTicketing(seatLabel) {
  ticketSubmitted = true;
  const totalMs = Math.round(performance.now() - ticketOpenPerf) + ticketEarlyPenaltyCount * 500;
  pTicketStep1.classList.add('hidden');
  pTicketStep2.classList.add('hidden');
  pTicketDone.classList.remove('hidden');

  socket.emit(
    'player:submit_ticketing',
    {
      reactionMs: ticketReactionMs,
      totalMs,
      seatLabel,
      earlyPenaltyCount: ticketEarlyPenaltyCount,
      success: true,
    },
    (resp) => {
      if (resp && resp.ok) {
        pTicketResultText.textContent = `총 ${formatMsToSec(resp.entry.totalMs)} (좌석 ${seatLabel})`;
        pTicketRankText.textContent = `반응속도 ${formatMsToSec(resp.entry.reactionMs)} · 실시간 ${resp.entry.rank}위`;
      }
    }
  );
}
