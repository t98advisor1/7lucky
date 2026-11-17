const socket = io();

let roomState = null;
let liveTimerInterval = null;
let countdownInterval = null;
let networkInfo = { primaryIp: 'localhost', port: 3000 };
let ticketingOffsetMs = 0;

// DOM Elements
const roomCodeText = document.getElementById('roomCodeText');
const qrImage = document.getElementById('qrImage');
const joinUrlInput = document.getElementById('joinUrlInput');
const updateQrBtn = document.getElementById('updateQrBtn');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const playerCountBadge = document.getElementById('playerCountBadge');
const playerChips = document.getElementById('playerChips');
const roundBadge = document.getElementById('roundBadge');
const historyCount = document.getElementById('historyCount');

const modeTabs = document.querySelectorAll('.mode-tab');
const optsLucky7 = document.getElementById('opts-lucky7');
const optsClicker = document.getElementById('opts-clicker');
const optsTicketing = document.getElementById('opts-ticketing');

const lucky7Target = document.getElementById('lucky7Target');
const lucky7Blind = document.getElementById('lucky7Blind');
const btnVerVisible = document.getElementById('btnVerVisible');
const btnVerBlind = document.getElementById('btnVerBlind');
const clickerDuration = document.getElementById('clickerDuration');
const clickerRule = document.getElementById('clickerRule');
const ticketingServer = document.getElementById('ticketingServer');
const ticketingSeat = document.getElementById('ticketingSeat');
const ticketingCountdown = document.getElementById('ticketingCountdown');

const stageWaiting = document.getElementById('stageWaiting');
const stageCountdown = document.getElementById('stageCountdown');
const stagePlaying = document.getElementById('stagePlaying');
const stageFinished = document.getElementById('stageFinished');

const waitingTitle = document.getElementById('waitingTitle');
const waitingDesc = document.getElementById('waitingDesc');
const startGameBtn = document.getElementById('startGameBtn');
const countdownNumber = document.getElementById('countdownNumber');
const playingModeLabel = document.getElementById('playingModeLabel');
const hostLiveClock = document.getElementById('hostLiveClock');
const hostLiveSub = document.getElementById('hostLiveSub');
const hostClicker3dBox = document.getElementById('hostClicker3dBox');
const liveResultsContainer = document.getElementById('liveResultsContainer');
const endGameBtn = document.getElementById('endGameBtn');
const hostClickerArena = window.createClicker3DArena ? window.createClicker3DArena(hostClicker3dBox, { maxBalls: 55 }) : null;

const winnerName = document.getElementById('winnerName');
const winnerDetail = document.getElementById('winnerDetail');
const finishedTable = document.getElementById('finishedTable');
const nextRoundBtn = document.getElementById('nextRoundBtn');
const newRoomBtn = document.getElementById('newRoomBtn');

// History Modal Elements
const historyModal = document.getElementById('historyModal');
const openHistoryBtn = document.getElementById('openHistoryBtn');
const viewHistoryFromFinishBtn = document.getElementById('viewHistoryFromFinishBtn');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const tabSummaryBtn = document.getElementById('tabSummaryBtn');
const tabRoundsBtn = document.getElementById('tabRoundsBtn');
const historySummaryView = document.getElementById('historySummaryView');
const historyRoundsView = document.getElementById('historyRoundsView');

// --- Helpers ---
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMsToSec(ms) {
  return (ms / 1000).toFixed(3) + '초';
}

function formatDiffMs(diffMs) {
  const sign = diffMs > 0 ? '+' : diffMs < 0 ? '-' : '';
  return `${sign}${(Math.abs(diffMs) / 1000).toFixed(3)}초`;
}

function getModeLabel(mode) {
  if (mode === 'lucky7') return '행운의 7초';
  if (mode === 'clicker') return '광클 복불복';
  if (mode === 'ticketing') return '티켓팅 연습';
  return mode;
}

function getDefaultJoinUrl(code) {
  const host = window.location.hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  if (isLocalhost && networkInfo.primaryIp && networkInfo.primaryIp !== 'localhost') {
    const portPart = window.location.port ? `:${window.location.port}` : '';
    return `${window.location.protocol}//${networkInfo.primaryIp}${portPart}/join/${code}`;
  }
  return `${window.location.origin}/join/${code}`;
}

async function generateQrForUrl(url) {
  try {
    const res = await fetch(`/api/qr?text=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.dataUrl) {
      qrImage.src = data.dataUrl;
    }
  } catch (err) {
    console.error('QR generation failed', err);
  }
}

function stopStageTimers() {
  if (liveTimerInterval) {
    clearInterval(liveTimerInterval);
    liveTimerInterval = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// --- Init ---
async function init() {
  try {
    const res = await fetch('/api/network-info');
    networkInfo = await res.json();
  } catch (e) {
    // ignore
  }

  const savedCode = sessionStorage.getItem('hostRoomCode');
  if (savedCode) {
    socket.emit('host:rejoin_room', { code: savedCode }, (resp) => {
      if (resp && resp.ok) {
        onRoomReady(resp.state);
      } else {
        createNewRoom();
      }
    });
  } else {
    createNewRoom();
  }
}

function createNewRoom() {
  socket.emit('host:create_room', (resp) => {
    if (resp && resp.ok) {
      sessionStorage.setItem('hostRoomCode', resp.state.code);
      onRoomReady(resp.state);
    }
  });
}

function onRoomReady(state) {
  roomState = state;
  roomCodeText.textContent = state.code;
  const defaultUrl = getDefaultJoinUrl(state.code);
  joinUrlInput.value = defaultUrl;
  generateQrForUrl(defaultUrl);
  renderRoomState(state);
}

// --- Rendering ---
function renderRoomState(state) {
  roomState = state;
  historyCount.textContent = state.history.length;
  roundBadge.textContent = state.roundNumber > 0 ? `${state.roundNumber}라운드` : '대기 중';

  // Players
  const connectedCount = state.players.filter((p) => p.connected).length;
  playerCountBadge.textContent = `${state.players.length} / ${state.maxPlayers}명 (접속 ${connectedCount})`;

  if (state.players.length === 0) {
    playerChips.innerHTML = '<span class="text-muted" style="font-size: 0.9rem;">아직 입장한 학생이 없습니다. QR을 스캔해주세요!</span>';
  } else {
    playerChips.innerHTML = state.players
      .map(
        (p) => `
      <span class="player-chip ${p.connected ? '' : 'offline'}">
        <span class="status-dot ${p.connected ? 'online' : ''}"></span>
        <span>${escapeHtml(p.nickname)}</span>
        <button class="kick-btn" onclick="kickPlayer('${p.id}')" title="내보내기">×</button>
      </span>
    `
      )
      .join('');
  }

  // Sync Mode Tabs & Options
  modeTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === state.mode);
  });
  optsLucky7.classList.toggle('hidden', state.mode !== 'lucky7');
  optsClicker.classList.toggle('hidden', state.mode !== 'clicker');
  optsTicketing.classList.toggle('hidden', state.mode !== 'ticketing');

  lucky7Target.value = String(state.options.lucky7.targetSec);
  lucky7Blind.value = String(state.options.lucky7.blindEnabled);
  if (btnVerVisible && btnVerBlind) {
    const isBlind = Boolean(state.options.lucky7.blindEnabled);
    btnVerVisible.className = isBlind ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
    btnVerBlind.className = isBlind ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  }
  clickerDuration.value = String(state.options.clicker.durationSec);
  clickerRule.value = state.options.clicker.winnerRule;
  ticketingServer.value = state.options.ticketing.targetServer;
  ticketingSeat.value = String(state.options.ticketing.withSeat);
  ticketingCountdown.value = String(state.options.ticketing.countdownSec);

  // Stage Visibility
  stageWaiting.classList.toggle('hidden', state.status !== 'waiting');
  stageCountdown.classList.toggle('hidden', state.status !== 'countdown');
  stagePlaying.classList.toggle('hidden', state.status !== 'playing');
  stageFinished.classList.toggle('hidden', state.status !== 'finished');

  if (state.status === 'waiting') {
    stopStageTimers();
    if (state.mode === 'lucky7') {
      waitingTitle.textContent = `행운의 ${state.options.lucky7.targetSec}초를 잡아라`;
      waitingDesc.textContent = state.options.lucky7.blindEnabled
        ? '시작 3초 뒤 숫자가 가려집니다. 마음속으로 세서 정확히 멈추세요.'
        : '화면의 시계를 보고 목표 시간에 맞춰 정확히 멈추세요.';
    } else if (state.mode === 'clicker') {
      waitingTitle.textContent = `${state.options.clicker.durationSec}초 광클 복불복`;
      const ruleMap = {
        highest: '최다 클릭 1등 당첨',
        lowest: '최소 클릭 꼴찌 당첨',
        middle: '중간 순위 눈치게임 당첨',
        random_rank: '랜덤 순위 완전 복불복 당첨',
      };
      waitingDesc.textContent = `당첨 규칙: ${ruleMap[state.options.clicker.winnerRule]}`;
    } else {
      waitingTitle.textContent = '실시간 티켓팅 연습';
      waitingDesc.textContent = '카운트다운이 0이 되는 순간 예매하기 버튼을 누르고 좌석을 잡으세요.';
    }
  }

  if (state.status === 'playing' && state.currentRound) {
    renderLiveResults(state.currentRound.mode, state.currentRound.results || []);
  }

  if (state.status === 'finished' && state.currentRound) {
    stopStageTimers();
    if (hostClickerArena) hostClickerArena.stop();
    renderFinishedStage(state.currentRound);
  }
}

function renderLiveResults(mode, results) {
  if (hostClicker3dBox) {
    hostClicker3dBox.classList.toggle('hidden', mode !== 'clicker');
    if (mode === 'clicker' && hostClickerArena) {
      hostClickerArena.burst(3);
    }
  }
  if (mode === 'lucky7') {
    if (results.length === 0) {
      liveResultsContainer.innerHTML = '<div class="text-center text-muted">아직 멈춘 학생이 없습니다...</div>';
      return;
    }
    liveResultsContainer.innerHTML = `
      <div class="table-wrap" style="max-height: 260px; overflow-y: auto;">
        <table>
          <thead><tr><th>순위</th><th>닉네임</th><th>기록</th><th>오차</th></tr></thead>
          <tbody>
            ${results
              .slice(0, 30)
              .map(
                (r) => `
              <tr class="${r.rank === 1 ? 'winner-row' : ''}">
                <td><strong>${r.rank}위</strong></td>
                <td>${escapeHtml(r.nickname)}</td>
                <td>${formatMsToSec(r.elapsedMs)}</td>
                <td>${formatDiffMs(r.diffMs)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (mode === 'clicker') {
    if (results.length === 0) {
      liveResultsContainer.innerHTML = '<div class="text-center text-muted">터치 기록을 기다리는 중...</div>';
      return;
    }
    const maxClicks = Math.max(10, results[0]?.clicks || 10);
    liveResultsContainer.innerHTML = results
      .slice(0, 12)
      .map(
        (r) => `
      <div class="bar-row">
        <div class="bar-label">${r.rank}. ${escapeHtml(r.nickname)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${Math.min(100, (r.clicks / maxClicks) * 100)}%"></div>
        </div>
        <div class="bar-val">${r.clicks}회</div>
      </div>
    `
      )
      .join('');
  } else if (mode === 'ticketing') {
    if (results.length === 0) {
      liveResultsContainer.innerHTML = '<div class="text-center text-muted">티켓팅 완료자를 기다리는 중...</div>';
      return;
    }
    liveResultsContainer.innerHTML = `
      <div class="table-wrap" style="max-height: 260px; overflow-y: auto;">
        <table>
          <thead><tr><th>순위</th><th>닉네임</th><th>반응속도</th><th>총 완료시간</th><th>좌석</th></tr></thead>
          <tbody>
            ${results
              .slice(0, 30)
              .map(
                (r) => `
              <tr class="${r.rank === 1 ? 'winner-row' : ''}">
                <td><strong>${r.rank}위</strong></td>
                <td>${escapeHtml(r.nickname)}</td>
                <td>${formatMsToSec(r.reactionMs)}</td>
                <td><strong>${formatMsToSec(r.totalMs)}</strong></td>
                <td>${escapeHtml(r.seatLabel)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }
}

function renderFinishedStage(round) {
  const results = round.results || [];
  const winner = round.specialWinner;

  if (!winner) {
    winnerName.textContent = '참여 기록 없음';
    winnerDetail.textContent = '이번 라운드에 제출된 기록이 없습니다.';
  } else if (round.mode === 'lucky7') {
    winnerName.textContent = `${winner.nickname} (${formatMsToSec(winner.elapsedMs)})`;
    winnerDetail.textContent = `목표와의 오차: ${formatDiffMs(winner.diffMs)}`;
  } else if (round.mode === 'clicker') {
    const ruleLabel = {
      highest: '최다 클릭 1등',
      lowest: '최소 클릭 꼴찌 복불복',
      middle: '중간 순위 눈치게임',
      random_rank: '랜덤 순위 복불복',
    }[round.options.winnerRule];
    winnerName.textContent = `${winner.nickname} (${winner.rank}위 · ${winner.clicks}회)`;
    winnerDetail.textContent = `당첨 규칙: ${ruleLabel}`;
  } else if (round.mode === 'ticketing') {
    winnerName.textContent = `${winner.nickname} (${formatMsToSec(winner.totalMs)})`;
    winnerDetail.textContent = `오픈 반응속도 ${formatMsToSec(winner.reactionMs)} · 좌석 ${winner.seatLabel}`;
  }

  const thead = finishedTable.querySelector('thead');
  const tbody = finishedTable.querySelector('tbody');

  if (round.mode === 'lucky7') {
    thead.innerHTML = '<tr><th>순위</th><th>닉네임</th><th>기록</th><th>오차</th></tr>';
    tbody.innerHTML = results
      .map(
        (r) => `
      <tr class="${winner && r.playerId === winner.playerId ? 'winner-row' : ''}">
        <td><strong>${r.rank}위</strong></td>
        <td>${escapeHtml(r.nickname)}</td>
        <td>${formatMsToSec(r.elapsedMs)}</td>
        <td>${formatDiffMs(r.diffMs)}</td>
      </tr>`
      )
      .join('');
  } else if (round.mode === 'clicker') {
    thead.innerHTML = '<tr><th>순위</th><th>닉네임</th><th>총 클릭 수</th><th>비고</th></tr>';
    tbody.innerHTML = results
      .map(
        (r) => `
      <tr class="${winner && r.playerId === winner.playerId ? 'winner-row' : ''}">
        <td><strong>${r.rank}위</strong></td>
        <td>${escapeHtml(r.nickname)}</td>
        <td><strong>${r.clicks}회</strong></td>
        <td>${winner && r.playerId === winner.playerId ? '당첨' : ''}</td>
      </tr>`
      )
      .join('');
  } else {
    thead.innerHTML = '<tr><th>순위</th><th>닉네임</th><th>반응속도</th><th>총 완료시간</th><th>좌석</th></tr>';
    tbody.innerHTML = results
      .map(
        (r) => `
      <tr class="${winner && r.playerId === winner.playerId ? 'winner-row' : ''}">
        <td><strong>${r.rank}위</strong></td>
        <td>${escapeHtml(r.nickname)}</td>
        <td>${formatMsToSec(r.reactionMs)}</td>
        <td><strong>${formatMsToSec(r.totalMs)}</strong></td>
        <td>${escapeHtml(r.seatLabel)}</td>
      </tr>`
      )
      .join('');
  }
}

// --- Socket Events ---
socket.on('room:state', (state) => {
  renderRoomState(state);
});

socket.on('room:closed_by_admin', () => {
  sessionStorage.removeItem('hostRoomCode');
  alert('관리자에 의해 방이 초기화되었습니다.');
  window.location.href = '/';
});

socket.on('game:countdown', async ({ mode, options, countdownSec, countdownEndsAt, serverNow }) => {
  stopStageTimers();
  const clockSkew = serverNow - Date.now();

  if (mode === 'ticketing') {
    try {
      const resp = await fetch(`/api/server-time?target=${encodeURIComponent(options.targetServer)}`);
      const tData = await resp.json();
      ticketingOffsetMs = tData.offsetMs || 0;
    } catch (e) {
      ticketingOffsetMs = 0;
    }
  }

  function updateCountdown() {
    const remainingMs = countdownEndsAt - (Date.now() + clockSkew);
    const sec = Math.max(1, Math.ceil(remainingMs / 1000));
    countdownNumber.textContent = String(sec);
    if (remainingMs <= 0) {
      clearInterval(countdownInterval);
    }
  }
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 100);
});

socket.on('game:start', ({ mode, options, startedAt, endsAt, serverNow }) => {
  stopStageTimers();
  const clockSkew = serverNow - Date.now();
  playingModeLabel.textContent = getModeLabel(mode);

  const localStartPerf = performance.now();

  if (mode === 'lucky7') {
    hostLiveSub.textContent = `목표: ${options.targetSec}.000초 · 학생들이 멈추는 중입니다!`;
    liveTimerInterval = setInterval(() => {
      const elapsed = performance.now() - localStartPerf;
      hostLiveClock.textContent = formatMsToSec(elapsed);
    }, 31);
  } else if (mode === 'clicker') {
    hostLiveSub.textContent = `광클 진행 중! (${options.durationSec}초)`;
    liveTimerInterval = setInterval(() => {
      const rem = Math.max(0, endsAt - (Date.now() + clockSkew));
      hostLiveClock.textContent = `남은 시간 ${(rem / 1000).toFixed(2)}초`;
    }, 31);
  } else if (mode === 'ticketing') {
    hostLiveSub.textContent = `티켓팅 오픈 완료! 빠른 순으로 기록이 올라옵니다.`;
    liveTimerInterval = setInterval(() => {
      const now = new Date(Date.now() + ticketingOffsetMs);
      const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
      hostLiveClock.textContent = timeStr;
    }, 31);
  }
});

socket.on('game:live_results', ({ mode, results }) => {
  if (roomState && roomState.status === 'playing') {
    renderLiveResults(mode, results);
  }
});

socket.on('game:finished', () => {
  stopStageTimers();
});

// --- UI Actions ---
window.kickPlayer = function (playerId) {
  socket.emit('host:kick_player', { playerId });
};

function sendConfigUpdate(newMode) {
  const mode = newMode || (roomState ? roomState.mode : 'lucky7');
  socket.emit('host:update_config', {
    mode,
    options: {
      lucky7: {
        targetSec: Number(lucky7Target.value),
        blindEnabled: lucky7Blind.value === 'true',
      },
      clicker: {
        durationSec: Number(clickerDuration.value),
        winnerRule: clickerRule.value,
      },
      ticketing: {
        targetServer: ticketingServer.value,
        withSeat: ticketingSeat.value === 'true',
        countdownSec: Number(ticketingCountdown.value),
      },
    },
  });
}

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => sendConfigUpdate(tab.dataset.mode));
});

[lucky7Target, lucky7Blind, clickerDuration, clickerRule, ticketingServer, ticketingSeat, ticketingCountdown].forEach(
  (el) => el.addEventListener('change', () => sendConfigUpdate())
);

if (btnVerVisible && btnVerBlind) {
  btnVerVisible.addEventListener('click', () => {
    lucky7Blind.value = 'false';
    sendConfigUpdate('lucky7');
  });
  btnVerBlind.addEventListener('click', () => {
    lucky7Blind.value = 'true';
    sendConfigUpdate('lucky7');
  });
}

startGameBtn.addEventListener('click', () => {
  socket.emit('host:start_game', (resp) => {
    if (resp && !resp.ok) alert(resp.error);
  });
});

endGameBtn.addEventListener('click', () => {
  socket.emit('host:end_game');
});

nextRoundBtn.addEventListener('click', () => {
  socket.emit('host:reset_waiting');
});

newRoomBtn.addEventListener('click', () => {
  if (confirm('새 방을 만드시겠습니까? 기존 방의 연결은 종료됩니다.')) {
    sessionStorage.removeItem('hostRoomCode');
    createNewRoom();
  }
});

updateQrBtn.addEventListener('click', () => {
  const url = joinUrlInput.value.trim();
  if (url) generateQrForUrl(url);
});

copyUrlBtn.addEventListener('click', async () => {
  const url = joinUrlInput.value.trim();
  try {
    await navigator.clipboard.writeText(url);
    copyUrlBtn.textContent = '링크 복사됨';
    setTimeout(() => {
      copyUrlBtn.textContent = '참여 링크 복사';
    }, 1500);
  } catch (e) {
    prompt('아래 링크를 복사하세요:', url);
  }
});

// --- Accumulated History Modal ---
function renderHistoryModal() {
  if (!roomState) return;
  const history = roomState.history || [];

  // 1. Per-player summary
  const playerMap = new Map();
  history.forEach((round) => {
    round.results.forEach((r) => {
      if (!playerMap.has(r.nickname)) {
        playerMap.set(r.nickname, {
          nickname: r.nickname,
          rounds: 0,
          lucky7Diffs: [],
          lucky7Best: null,
          totalClicks: 0,
          bestTicketingMs: null,
        });
      }
      const stat = playerMap.get(r.nickname);
      stat.rounds += 1;
      if (round.mode === 'lucky7') {
        stat.lucky7Diffs.push(r.absDiffMs);
        if (stat.lucky7Best === null || r.absDiffMs < stat.lucky7Best.absDiffMs) {
          stat.lucky7Best = r;
        }
      } else if (round.mode === 'clicker') {
        stat.totalClicks += r.clicks;
      } else if (round.mode === 'ticketing' && r.success) {
        if (stat.bestTicketingMs === null || r.totalMs < stat.bestTicketingMs) {
          stat.bestTicketingMs = r.totalMs;
        }
      }
    });
  });

  if (playerMap.size === 0) {
    historySummaryView.innerHTML = '<p class="text-muted text-center">아직 완료된 라운드가 없습니다.</p>';
    historyRoundsView.innerHTML = '<p class="text-muted text-center">아직 완료된 라운드가 없습니다.</p>';
    return;
  }

  const summaryList = Array.from(playerMap.values()).sort((a, b) => b.rounds - a.rounds);
  historySummaryView.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>닉네임</th>
          <th>참여 라운드</th>
          <th>7초 최고기록 (오차)</th>
          <th>7초 평균 오차</th>
          <th>광클 누적 합계</th>
          <th>티켓팅 최고기록</th>
        </tr>
      </thead>
      <tbody>
        ${summaryList
          .map((s) => {
            const avgDiff =
              s.lucky7Diffs.length > 0
                ? formatMsToSec(s.lucky7Diffs.reduce((a, b) => a + b, 0) / s.lucky7Diffs.length)
                : '-';
            const best7 = s.lucky7Best
              ? `${formatMsToSec(s.lucky7Best.elapsedMs)} (${formatDiffMs(s.lucky7Best.diffMs)})`
              : '-';
            const bestTicket = s.bestTicketingMs !== null ? formatMsToSec(s.bestTicketingMs) : '-';
            return `
              <tr>
                <td><strong>${escapeHtml(s.nickname)}</strong></td>
                <td>${s.rounds}회</td>
                <td>${best7}</td>
                <td>${avgDiff}</td>
                <td>${s.totalClicks}회</td>
                <td>${bestTicket}</td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  // 2. Round-by-round details
  historyRoundsView.innerHTML = history
    .slice()
    .reverse()
    .map((round) => {
      const winnerText = round.specialWinner ? ` · 당첨/1등: ${escapeHtml(round.specialWinner.nickname)}` : '';
      const rows = round.results
        .map((r) => {
          if (round.mode === 'lucky7') {
            return `<tr><td>${r.rank}위</td><td>${escapeHtml(r.nickname)}</td><td>${formatMsToSec(r.elapsedMs)}</td><td>${formatDiffMs(r.diffMs)}</td></tr>`;
          } else if (round.mode === 'clicker') {
            return `<tr><td>${r.rank}위</td><td>${escapeHtml(r.nickname)}</td><td>${r.clicks}회</td><td>-</td></tr>`;
          } else {
            return `<tr><td>${r.rank}위</td><td>${escapeHtml(r.nickname)}</td><td>${formatMsToSec(r.totalMs)}</td><td>좌석 ${escapeHtml(r.seatLabel)}</td></tr>`;
          }
        })
        .join('');

      return `
        <div class="card mb-2" style="padding: 14px;">
          <div class="flex justify-between items-center mb-2">
            <strong>#${round.roundNumber}라운드 · ${getModeLabel(round.mode)}${winnerText}</strong>
            <span class="text-muted" style="font-size: 0.8rem;">${new Date(round.finishedAt).toLocaleTimeString()}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>순위</th><th>닉네임</th><th>기록</th><th>상세</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join('');
}

openHistoryBtn.addEventListener('click', () => {
  renderHistoryModal();
  historyModal.classList.add('open');
});
viewHistoryFromFinishBtn.addEventListener('click', () => {
  renderHistoryModal();
  historyModal.classList.add('open');
});
closeHistoryBtn.addEventListener('click', () => {
  historyModal.classList.remove('open');
});

tabSummaryBtn.addEventListener('click', () => {
  tabSummaryBtn.className = 'btn btn-primary btn-sm';
  tabRoundsBtn.className = 'btn btn-outline btn-sm';
  historySummaryView.classList.remove('hidden');
  historyRoundsView.classList.add('hidden');
});

tabRoundsBtn.addEventListener('click', () => {
  tabRoundsBtn.className = 'btn btn-primary btn-sm';
  tabSummaryBtn.className = 'btn btn-outline btn-sm';
  historyRoundsView.classList.remove('hidden');
  historySummaryView.classList.add('hidden');
});

clearHistoryBtn.addEventListener('click', () => {
  if (confirm('누적된 모든 라운드 기록을 초기화할까요?')) {
    socket.emit('host:clear_history');
    historyModal.classList.remove('open');
  }
});

exportCsvBtn.addEventListener('click', () => {
  if (!roomState || roomState.history.length === 0) {
    alert('내보낼 기록이 없습니다.');
    return;
  }
  const lines = ['라운드,게임모드,순위,닉네임,기록값,오차/좌석/비고'];
  roomState.history.forEach((round) => {
    round.results.forEach((r) => {
      let val = '';
      let extra = '';
      if (round.mode === 'lucky7') {
        val = formatMsToSec(r.elapsedMs);
        extra = formatDiffMs(r.diffMs);
      } else if (round.mode === 'clicker') {
        val = `${r.clicks}회`;
        extra = round.specialWinner && round.specialWinner.playerId === r.playerId ? '당첨' : '';
      } else {
        val = formatMsToSec(r.totalMs);
        extra = `반응 ${formatMsToSec(r.reactionMs)} / 좌석 ${r.seatLabel}`;
      }
      const safeNick = `"${String(r.nickname).replace(/"/g, '""')}"`;
      lines.push(`${round.roundNumber},${getModeLabel(round.mode)},${r.rank},${safeNick},${val},"${extra}"`);
    });
  });

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `복불복_누적기록_${roomState.code}.csv`;
  a.click();
});

init();
