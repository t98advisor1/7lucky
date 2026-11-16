const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 10000,
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 100;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

app.get('/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

app.get('/practice', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'practice.html'));
});

// --- Network & QR Helpers ---
function getLocalIPv4s() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  // Prioritize typical LAN ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  ips.sort((a, b) => {
    const score = (ip) => {
      if (ip.startsWith('192.168.')) return 0;
      if (ip.startsWith('10.')) return 1;
      if (ip.startsWith('172.')) return 2;
      return 3;
    };
    return score(a.address) - score(b.address);
  });
  return ips;
}

app.get('/api/network-info', (req, res) => {
  const ips = getLocalIPv4s();
  res.json({
    port: PORT,
    ips,
    primaryIp: ips.length > 0 ? ips[0].address : 'localhost',
  });
});

app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).json({ error: 'Missing text parameter' });
  }
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 360,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// --- External Server Time Calibration (TicketTime-style) ---
const TIME_TARGETS = {
  local: { name: '교실 표준 서버 (자체 정밀시계)', url: null },
  interpark: { name: '인터파크 티켓 서버', url: 'https://tickets.interpark.com' },
  melon: { name: '멜론 티켓 서버', url: 'https://ticket.melon.com' },
  yes24: { name: '예스24 티켓 서버', url: 'http://ticket.yes24.com' },
  korail: { name: '코레일 예매 서버', url: 'https://www.letskorail.com' },
  naver: { name: '네이버 표준 서버', url: 'https://www.naver.com' },
};

const timeOffsetCache = new Map(); // key -> { offsetMs, fetchedAt, rttMs, fallback }

async function getTargetTimeOffset(targetKey) {
  const target = TIME_TARGETS[targetKey] || TIME_TARGETS.local;
  if (!target.url) {
    return { targetKey: 'local', name: target.name, offsetMs: 0, rttMs: 0, fallback: false };
  }

  const cached = timeOffsetCache.get(targetKey);
  if (cached && Date.now() - cached.fetchedAt < 30000) {
    return { targetKey, name: target.name, ...cached };
  }

  const t0 = Date.now();
  try {
    const response = await fetch(target.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2500),
      headers: { 'User-Agent': 'ClassroomTicketingPractice/1.0' },
    });
    const t1 = Date.now();
    const rttMs = t1 - t0;
    const dateHeader = response.headers.get('date');
    if (dateHeader) {
      const serverDateMs = new Date(dateHeader).getTime();
      if (!Number.isNaN(serverDateMs)) {
        // Adjust by half RTT; note HTTP Date has 1-second resolution
        const offsetMs = serverDateMs + 500 - (t0 + rttMs / 2);
        const entry = { offsetMs: Math.round(offsetMs), fetchedAt: Date.now(), rttMs, fallback: false };
        timeOffsetCache.set(targetKey, entry);
        return { targetKey, name: target.name, ...entry };
      }
    }
  } catch (err) {
    // Fallback gracefully if blocked or offline
  }

  const fallbackEntry = { offsetMs: 0, fetchedAt: Date.now(), rttMs: 0, fallback: true };
  timeOffsetCache.set(targetKey, fallbackEntry);
  return { targetKey, name: target.name, ...fallbackEntry };
}

app.get('/api/server-time', async (req, res) => {
  const targetKey = req.query.target || 'local';
  const info = await getTargetTimeOffset(targetKey);
  res.json({
    ...info,
    serverNow: Date.now(),
    targetNow: Date.now() + info.offsetMs,
  });
});

app.get('/api/time-targets', (req, res) => {
  res.json(
    Object.entries(TIME_TARGETS).map(([key, val]) => ({
      key,
      name: val.name,
      hasExternalUrl: Boolean(val.url),
    }))
  );
});

// --- Room & Game State Management ---
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function createDefaultOptions() {
  return {
    lucky7: {
      targetSec: 7,
      blindEnabled: true,
      blindAfterSec: 3,
    },
    clicker: {
      durationSec: 10,
      winnerRule: 'highest', // 'highest' | 'lowest' | 'middle' | 'random_rank'
    },
    ticketing: {
      targetServer: 'interpark',
      presetTitle: 'K-POP 콘서트 티켓팅',
      withSeat: true,
      withCaptcha: false,
      countdownSec: 5,
    },
  };
}

function createRoom(hostSocketId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostSocketId,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    players: new Map(), // playerId -> { id, socketId, nickname, connected, joinedAt }
    status: 'waiting', // 'waiting' | 'countdown' | 'playing' | 'finished'
    mode: 'lucky7', // 'lucky7' | 'clicker' | 'ticketing'
    options: createDefaultOptions(),
    roundNumber: 0,
    currentRound: null,
    history: [], // array of finished rounds
    timers: {
      countdown: null,
      endGame: null,
    },
  };
  rooms.set(code, room);
  return room;
}

function clearRoomTimers(room) {
  if (room.timers.countdown) {
    clearTimeout(room.timers.countdown);
    room.timers.countdown = null;
  }
  if (room.timers.endGame) {
    clearTimeout(room.timers.endGame);
    room.timers.endGame = null;
  }
}

function computeRankings(mode, options, resultsMap) {
  const list = Array.from(resultsMap.values());
  if (mode === 'lucky7') {
    list.sort((a, b) => {
      if (a.absDiffMs !== b.absDiffMs) return a.absDiffMs - b.absDiffMs;
      return a.submittedAt - b.submittedAt;
    });
    return list.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }

  if (mode === 'clicker') {
    list.sort((a, b) => {
      if (b.clicks !== a.clicks) return b.clicks - a.clicks;
      return a.submittedAt - b.submittedAt;
    });
    return list.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }

  if (mode === 'ticketing') {
    list.sort((a, b) => {
      if (a.success !== b.success) return a.success ? -1 : 1;
      if (a.totalMs !== b.totalMs) return a.totalMs - b.totalMs;
      return a.reactionMs - b.reactionMs;
    });
    return list.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }

  return list;
}

function pickClickerSpecialWinner(rankings, rule) {
  if (rankings.length === 0) return null;
  if (rule === 'highest') return rankings[0];
  if (rule === 'lowest') return rankings[rankings.length - 1];
  if (rule === 'middle') return rankings[Math.floor(rankings.length / 2)];
  if (rule === 'random_rank') {
    const idx = Math.floor(Math.random() * rankings.length);
    return rankings[idx];
  }
  return rankings[0];
}

function serializePlayers(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    connected: p.connected,
    joinedAt: p.joinedAt,
  }));
}

function serializeRoomState(room) {
  const currentResults = room.currentRound
    ? computeRankings(room.currentRound.mode, room.currentRound.options, room.currentRound.results)
    : [];

  return {
    code: room.code,
    maxPlayers: MAX_PLAYERS,
    status: room.status,
    mode: room.mode,
    options: room.options,
    roundNumber: room.roundNumber,
    players: serializePlayers(room),
    currentRound: room.currentRound
      ? {
          roundNumber: room.currentRound.roundNumber,
          mode: room.currentRound.mode,
          options: room.currentRound.options,
          startedAt: room.currentRound.startedAt,
          endsAt: room.currentRound.endsAt,
          specialWinner: room.currentRound.specialWinner || null,
          results: currentResults,
        }
      : null,
    history: room.history,
  };
}

function broadcastRoomState(room) {
  const state = serializeRoomState(room);
  io.to(`room:${room.code}`).emit('room:state', state);
}

function finalizeCurrentRound(room) {
  if (!room.currentRound || room.status === 'finished') return;
  clearRoomTimers(room);
  room.status = 'finished';

  const rankings = computeRankings(
    room.currentRound.mode,
    room.currentRound.options,
    room.currentRound.results
  );

  let specialWinner = null;
  if (room.currentRound.mode === 'clicker') {
    specialWinner = pickClickerSpecialWinner(
      rankings,
      room.currentRound.options.winnerRule
    );
  } else if (rankings.length > 0) {
    specialWinner = rankings[0];
  }

  room.currentRound.specialWinner = specialWinner;

  const historyEntry = {
    roundNumber: room.currentRound.roundNumber,
    mode: room.currentRound.mode,
    options: room.currentRound.options,
    finishedAt: Date.now(),
    specialWinner,
    results: rankings,
  };
  room.history.push(historyEntry);

  io.to(`room:${room.code}`).emit('game:finished', {
    roundNumber: room.currentRound.roundNumber,
    mode: room.currentRound.mode,
    specialWinner,
    results: rankings,
  });
  broadcastRoomState(room);
}

// Cleanup stale rooms every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.lastActivityAt > 3 * 60 * 60 * 1000) {
      clearRoomTimers(room);
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

// --- Socket.IO Events ---
io.on('connection', (socket) => {
  // Host creates a room
  socket.on('host:create_room', (ack) => {
    const room = createRoom(socket.id);
    socket.join(`room:${room.code}`);
    socket.data = { role: 'host', roomCode: room.code };
    if (typeof ack === 'function') {
      ack({ ok: true, state: serializeRoomState(room) });
    }
  });

  // Host reconnects to an existing room
  socket.on('host:rejoin_room', ({ code }, ack) => {
    const upperCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(upperCode);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: '방을 찾을 수 없습니다.' });
      return;
    }
    room.hostSocketId = socket.id;
    room.lastActivityAt = Date.now();
    socket.join(`room:${room.code}`);
    socket.data = { role: 'host', roomCode: room.code };
    if (typeof ack === 'function') {
      ack({ ok: true, state: serializeRoomState(room) });
    }
  });

  // Host updates game mode or options
  socket.on('host:update_config', ({ mode, options }) => {
    const room = rooms.get(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.status === 'countdown' || room.status === 'playing') return;

    room.lastActivityAt = Date.now();
    if (mode && ['lucky7', 'clicker', 'ticketing'].includes(mode)) {
      room.mode = mode;
    }
    if (options && typeof options === 'object') {
      if (options.lucky7) {
        room.options.lucky7 = { ...room.options.lucky7, ...options.lucky7 };
      }
      if (options.clicker) {
        room.options.clicker = { ...room.options.clicker, ...options.clicker };
      }
      if (options.ticketing) {
        room.options.ticketing = { ...room.options.ticketing, ...options.ticketing };
      }
    }
    broadcastRoomState(room);
  });

  // Host starts the game
  socket.on('host:start_game', (ack) => {
    const room = rooms.get(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) {
      if (typeof ack === 'function') ack({ ok: false, error: '권한이 없습니다.' });
      return;
    }
    if (room.status === 'countdown' || room.status === 'playing') {
      if (typeof ack === 'function') ack({ ok: false, error: '이미 게임이 진행 중입니다.' });
      return;
    }

    clearRoomTimers(room);
    room.lastActivityAt = Date.now();
    room.roundNumber += 1;
    room.status = 'countdown';

    const mode = room.mode;
    const modeOptions = JSON.parse(JSON.stringify(room.options[mode]));
    const countdownSec = mode === 'ticketing' ? Number(modeOptions.countdownSec || 5) : 3;

    room.currentRound = {
      roundNumber: room.roundNumber,
      mode,
      options: modeOptions,
      startedAt: null,
      endsAt: null,
      specialWinner: null,
      results: new Map(),
    };

    const countdownEndsAt = Date.now() + countdownSec * 1000;

    io.to(`room:${room.code}`).emit('game:countdown', {
      roundNumber: room.roundNumber,
      mode,
      options: modeOptions,
      countdownSec,
      countdownEndsAt,
      serverNow: Date.now(),
    });
    broadcastRoomState(room);

    room.timers.countdown = setTimeout(() => {
      if (!rooms.has(room.code) || room.status !== 'countdown') return;

      room.status = 'playing';
      const startedAt = Date.now();
      let endsAt = null;

      if (mode === 'clicker') {
        const durationMs = Math.max(3, Math.min(30, Number(modeOptions.durationSec || 10))) * 1000;
        endsAt = startedAt + durationMs;
        room.timers.endGame = setTimeout(() => {
          finalizeCurrentRound(room);
        }, durationMs + 700); // 700ms grace period for final packets
      }

      room.currentRound.startedAt = startedAt;
      room.currentRound.endsAt = endsAt;

      io.to(`room:${room.code}`).emit('game:start', {
        roundNumber: room.roundNumber,
        mode,
        options: modeOptions,
        startedAt,
        endsAt,
        serverNow: Date.now(),
      });
      broadcastRoomState(room);
    }, countdownSec * 1000);

    if (typeof ack === 'function') ack({ ok: true });
  });

  // Host manually ends the round (useful for Lucky 7 or Ticketing when waiting on stragglers)
  socket.on('host:end_game', () => {
    const room = rooms.get(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    finalizeCurrentRound(room);
  });

  // Host returns room to waiting state for next setup
  socket.on('host:reset_waiting', () => {
    const room = rooms.get(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    clearRoomTimers(room);
    room.status = 'waiting';
    room.currentRound = null;
    broadcastRoomState(room);
  });

  // Host clears accumulated history
  socket.on('host:clear_history', () => {
    const room = rooms.get(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    room.history = [];
    room.roundNumber = 0;
    broadcastRoomState(room);
  });

  // Host kicks a player
  socket.on('host:kick_player', ({ playerId }) => {
    const room = rooms.get(socket.data?.roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    const player = room.players.get(playerId);
    if (player) {
      io.to(player.socketId).emit('player:kicked');
      room.players.delete(playerId);
      broadcastRoomState(room);
    }
  });

  // Player joins room
  socket.on('player:join', ({ code, nickname, playerId }, ack) => {
    const upperCode = String(code || '').trim().toUpperCase();
    const cleanNick = String(nickname || '').trim().slice(0, 16);
    const room = rooms.get(upperCode);

    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: '존재하지 않는 방 코드입니다.' });
      return;
    }
    if (!cleanNick) {
      if (typeof ack === 'function') ack({ ok: false, error: '닉네임을 입력해주세요.' });
      return;
    }

    room.lastActivityAt = Date.now();

    // Check reconnection by playerId
    if (playerId && room.players.has(playerId)) {
      const existing = room.players.get(playerId);
      existing.socketId = socket.id;
      existing.nickname = cleanNick;
      existing.connected = true;
      socket.join(`room:${room.code}`);
      socket.data = { role: 'player', roomCode: room.code, playerId: existing.id };
      broadcastRoomState(room);
      if (typeof ack === 'function') {
        ack({ ok: true, playerId: existing.id, state: serializeRoomState(room) });
      }
      return;
    }

    // Enforce 100-player limit
    if (room.players.size >= MAX_PLAYERS) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: `최대 동시 접속 인원(${MAX_PLAYERS}명)이 가득 찼습니다.` });
      }
      return;
    }

    const newPlayerId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    room.players.set(newPlayerId, {
      id: newPlayerId,
      socketId: socket.id,
      nickname: cleanNick,
      connected: true,
      joinedAt: Date.now(),
    });

    socket.join(`room:${room.code}`);
    socket.data = { role: 'player', roomCode: room.code, playerId: newPlayerId };
    broadcastRoomState(room);

    if (typeof ack === 'function') {
      ack({ ok: true, playerId: newPlayerId, state: serializeRoomState(room) });
    }
  });

  // Player submits Lucky 7 result
  socket.on('player:submit_lucky7', ({ elapsedMs }, ack) => {
    const { roomCode, playerId } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room || !room.currentRound || room.status !== 'playing' || room.currentRound.mode !== 'lucky7') {
      if (typeof ack === 'function') ack({ ok: false, error: '현재 제출 가능한 라운드가 아닙니다.' });
      return;
    }
    const player = room.players.get(playerId);
    if (!player || room.currentRound.results.has(playerId)) return;

    const targetMs = Number(room.currentRound.options.targetSec || 7) * 1000;
    const clampedElapsed = Math.max(0, Math.min(60000, Math.round(Number(elapsedMs) || 0)));
    const diffMs = clampedElapsed - targetMs;
    const absDiffMs = Math.abs(diffMs);

    const entry = {
      playerId,
      nickname: player.nickname,
      elapsedMs: clampedElapsed,
      diffMs,
      absDiffMs,
      submittedAt: Date.now(),
    };
    room.currentRound.results.set(playerId, entry);

    const rankings = computeRankings('lucky7', room.currentRound.options, room.currentRound.results);
    io.to(`room:${room.code}`).emit('game:live_results', {
      mode: 'lucky7',
      results: rankings,
    });

    if (typeof ack === 'function') {
      const myRank = rankings.find((r) => r.playerId === playerId)?.rank || null;
      ack({ ok: true, entry: { ...entry, rank: myRank } });
    }
  });

  // Player sends live clicker progress
  socket.on('player:clicker_progress', ({ clicks }) => {
    const { roomCode, playerId } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room || !room.currentRound || room.status !== 'playing' || room.currentRound.mode !== 'clicker') {
      return;
    }
    const player = room.players.get(playerId);
    if (!player) return;

    const safeClicks = Math.max(0, Math.min(1000, Math.floor(Number(clicks) || 0)));
    room.currentRound.results.set(playerId, {
      playerId,
      nickname: player.nickname,
      clicks: safeClicks,
      submittedAt: Date.now(),
    });

    const rankings = computeRankings('clicker', room.currentRound.options, room.currentRound.results);
    io.to(room.hostSocketId).emit('game:live_results', {
      mode: 'clicker',
      results: rankings,
    });
  });

  // Player submits final clicker count
  socket.on('player:submit_clicker', ({ clicks }) => {
    const { roomCode, playerId } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room || !room.currentRound || room.currentRound.mode !== 'clicker') return;
    if (room.status !== 'playing' && room.status !== 'finished') return;

    const player = room.players.get(playerId);
    if (!player) return;

    const safeClicks = Math.max(0, Math.min(1000, Math.floor(Number(clicks) || 0)));
    const existing = room.currentRound.results.get(playerId);
    if (!existing || safeClicks >= existing.clicks) {
      room.currentRound.results.set(playerId, {
        playerId,
        nickname: player.nickname,
        clicks: safeClicks,
        submittedAt: Date.now(),
      });
    }
  });

  // Player submits ticketing result
  socket.on('player:submit_ticketing', ({ reactionMs, totalMs, seatLabel, earlyPenaltyCount, success }, ack) => {
    const { roomCode, playerId } = socket.data || {};
    const room = rooms.get(roomCode);
    if (!room || !room.currentRound || room.status !== 'playing' || room.currentRound.mode !== 'ticketing') {
      if (typeof ack === 'function') ack({ ok: false, error: '현재 제출 가능한 라운드가 아닙니다.' });
      return;
    }
    const player = room.players.get(playerId);
    if (!player || room.currentRound.results.has(playerId)) return;

    const entry = {
      playerId,
      nickname: player.nickname,
      reactionMs: Math.max(0, Math.round(Number(reactionMs) || 0)),
      totalMs: Math.max(0, Math.round(Number(totalMs) || 0)),
      seatLabel: seatLabel || '자유석',
      earlyPenaltyCount: Math.max(0, Number(earlyPenaltyCount) || 0),
      success: Boolean(success),
      submittedAt: Date.now(),
    };
    room.currentRound.results.set(playerId, entry);

    const rankings = computeRankings('ticketing', room.currentRound.options, room.currentRound.results);
    io.to(`room:${room.code}`).emit('game:live_results', {
      mode: 'ticketing',
      results: rankings,
    });

    if (typeof ack === 'function') {
      const myRank = rankings.find((r) => r.playerId === playerId)?.rank || null;
      ack({ ok: true, entry: { ...entry, rank: myRank } });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const { role, roomCode, playerId } = socket.data || {};
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'player' && playerId && room.players.has(playerId)) {
      const player = room.players.get(playerId);
      if (player.socketId === socket.id) {
        player.connected = false;
        broadcastRoomState(room);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPv4s();
  console.log('====================================================');
  console.log('🎯 행운의 7초 & 교실 복불복 서버가 시작되었습니다!');
  console.log(`▶ 내 PC 접속:       http://localhost:${PORT}`);
  ips.forEach((ip) => {
    console.log(`▶ 같은 와이파이 폰: http://${ip.address}:${PORT} (${ip.name})`);
  });
  console.log('====================================================');
});
