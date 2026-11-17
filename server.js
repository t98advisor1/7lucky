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
const MAX_ROOMS = 50;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '7777');

function getKstDateKey() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

const visitorStats = {
  dateKey: getKstDateKey(),
  today: 0,
  total: 0,
};

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

app.get('/manual', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manual.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

function requireAdmin(req, res) {
  const pw = String(req.headers['x-admin-password'] || '');
  if (pw !== ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, error: '관리자 비밀번호가 올바르지 않습니다.' });
    return false;
  }
  return true;
}

app.post('/api/admin/login', (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: '비밀번호가 일치하지 않습니다.' });
  }
  res.json({ ok: true });
});

app.get('/api/admin/rooms', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const list = Array.from(rooms.values())
    .map((room) => {
      const playersArr = Array.from(room.players.values());
      const connectedCount = playersArr.filter((p) => p.connected).length;
      return {
        code: room.code,
        status: room.status,
        mode: room.mode,
        playerCount: playersArr.length,
        connectedCount,
        roundNumber: room.roundNumber,
        historyCount: room.history.length,
        createdAt: room.createdAt,
        lastActivityAt: room.lastActivityAt,
      };
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  const totalPlayers = list.reduce((acc, r) => acc + r.playerCount, 0);
  res.json({
    ok: true,
    stats: {
      onlineSockets: io.engine ? io.engine.clientsCount : 0,
      todayVisitors: visitorStats.today,
      totalVisitors: visitorStats.total,
      activeRooms: rooms.size,
      maxRooms: MAX_ROOMS,
      maxPlayersPerRoom: MAX_PLAYERS,
      totalPlayers,
    },
    rooms: list,
  });
});

app.delete('/api/admin/rooms/:code', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ ok: false, error: '해당 방을 찾을 수 없습니다.' });
  }
  clearRoomTimers(room);
  io.to(`room:${code}`).emit('room:closed_by_admin');
  rooms.delete(code);
  res.json({ ok: true, deleted: code });
});

app.post('/api/admin/reset-all', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const resetVisitors = Boolean(req.body?.resetVisitors);
  const count = rooms.size;
  for (const [code, room] of rooms.entries()) {
    clearRoomTimers(room);
    io.to(`room:${code}`).emit('room:closed_by_admin');
  }
  rooms.clear();

  if (resetVisitors) {
    visitorStats.today = 0;
    visitorStats.total = 0;
  }

  res.json({ ok: true, clearedRooms: count, resetVisitors });
});

app.get('/api/visitors', (req, res) => {
  const currentKey = getKstDateKey();
  if (visitorStats.dateKey !== currentKey) {
    visitorStats.dateKey = currentKey;
    visitorStats.today = 0;
  }
  if (req.query.hit === '1') {
    visitorStats.today += 1;
    visitorStats.total += 1;
  }
  const onlineCount = Math.max(1, io.engine ? io.engine.clientsCount : 1);
  res.json({
    online: onlineCount,
    today: Math.max(1, visitorStats.today),
    total: Math.max(1, visitorStats.total),
    activeRooms: rooms.size,
    maxRooms: MAX_ROOMS,
    maxPlayersPerRoom: MAX_PLAYERS,
  });
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
  // 공연 · 콘서트 · 팬클럽
  interpark: { category: '공연 · 콘서트', name: '인터파크 티켓 (ticket.interpark.com)', url: 'https://tickets.interpark.com' },
  'nol-interpark': { category: '공연 · 콘서트', name: '인터파크 NOL 티켓 (nol.interpark.com)', url: 'https://nol.interpark.com' },
  melon: { category: '공연 · 콘서트', name: '멜론티켓 (ticket.melon.com)', url: 'https://ticket.melon.com' },
  ticketlink: { category: '공연 · 콘서트', name: '티켓링크 (ticketlink.co.kr)', url: 'https://www.ticketlink.co.kr' },
  yes24: { category: '공연 · 콘서트', name: '예스24 티켓 (ticket.yes24.com)', url: 'http://ticket.yes24.com' },
  weverse: { category: '공연 · 콘서트', name: '위버스 (weverse.io)', url: 'https://weverse.io' },
  coupangplay: { category: '공연 · 콘서트', name: '쿠팡플레이 (coupangplay.com)', url: 'https://www.coupangplay.com' },
  fans: { category: '공연 · 콘서트', name: '팬즈 FANS (app.fans)', url: 'https://app.fans' },
  berriz: { category: '공연 · 콘서트', name: '베리즈 (berriz.in)', url: 'https://berriz.in' },
  bstage: { category: '공연 · 콘서트', name: '비스테이지 (bstage.in)', url: 'https://bstage.in' },
  sejongpac: { category: '공연 · 콘서트', name: '세종문화회관 (sejongpac.or.kr)', url: 'https://www.sejongpac.or.kr' },

  // 교통 · 여행 · 캠핑
  korail: { category: '교통 · 여행 · 캠핑', name: '코레일 KTX (letskorail.com)', url: 'https://www.letskorail.com' },
  srt: { category: '교통 · 여행 · 캠핑', name: 'SRT 승차권 (etk.srail.kr)', url: 'https://etk.srail.kr' },
  knps: { category: '교통 · 여행 · 캠핑', name: '국립공원 예약시스템 (knps.or.kr)', url: 'https://reservation.knps.or.kr' },
  campingkorea: { category: '교통 · 여행 · 캠핑', name: '캠핑코리아 (campingkorea.or.kr)', url: 'https://www.campingkorea.or.kr' },
  foresttrip: { category: '교통 · 여행 · 캠핑', name: '숲나들e 자연휴양림 (foresttrip.go.kr)', url: 'https://www.foresttrip.go.kr' },
  yanolja: { category: '교통 · 여행 · 캠핑', name: 'NOL 야놀자 (nol.yanolja.com)', url: 'https://nol.yanolja.com' },
  agoda: { category: '교통 · 여행 · 캠핑', name: '아고다 (agoda.com)', url: 'https://www.agoda.com' },
  trip: { category: '교통 · 여행 · 캠핑', name: '트립닷컴 (kr.trip.com)', url: 'https://kr.trip.com' },

  // 영화 · 스포츠 · 레저
  cgv: { category: '영화 · 스포츠 · 레저', name: 'CGV (cgv.co.kr)', url: 'https://www.cgv.co.kr' },
  megabox: { category: '영화 · 스포츠 · 레저', name: '메가박스 (megabox.co.kr)', url: 'https://www.megabox.co.kr' },
  lottecinema: { category: '영화 · 스포츠 · 레저', name: '롯데시네마 (lottecinema.co.kr)', url: 'https://www.lottecinema.co.kr' },
  doosanbears: { category: '영화 · 스포츠 · 레저', name: '두산 베어스 (doosanbears.com)', url: 'https://www.doosanbears.com' },
  ssglanders: { category: '영화 · 스포츠 · 레저', name: 'SSG 랜더스 (ssglanders.com)', url: 'https://www.ssglanders.com' },
  lgtwins: { category: '영화 · 스포츠 · 레저', name: 'LG 트윈스 (lgtwins.com)', url: 'https://www.lgtwins.com' },
  kbl: { category: '영화 · 스포츠 · 레저', name: 'KBL 프로농구 (kbl.or.kr)', url: 'https://www.kbl.or.kr' },
  kovo: { category: '영화 · 스포츠 · 레저', name: 'KOVO 프로배구 (kovo.co.kr)', url: 'https://www.kovo.co.kr' },
  runable: { category: '영화 · 스포츠 · 레저', name: '러너블 대회 신청 (runable.me)', url: 'https://runable.me' },
  chuncheonmarathon: { category: '영화 · 스포츠 · 레저', name: '춘천마라톤 (chuncheonmarathon.com)', url: 'https://www.chuncheonmarathon.com' },

  // 수강신청 · 포털 · 쇼핑 · 맛집
  sugang: { category: '수강신청 · 포털 · 쇼핑', name: '전국 대학교 수강신청 표준시', url: 'https://www.naver.com' },
  naver: { category: '수강신청 · 포털 · 쇼핑', name: '네이버 표준시 / 네이버예약 (naver.com)', url: 'https://www.naver.com' },
  kakao: { category: '수강신청 · 포털 · 쇼핑', name: '카카오 / 카카오예약 (kakao.com)', url: 'https://www.kakao.com' },
  catchtable: { category: '수강신청 · 포털 · 쇼핑', name: '캐치테이블 (catchtable.co.kr)', url: 'https://app.catchtable.co.kr' },
  musinsa: { category: '수강신청 · 포털 · 쇼핑', name: '무신사 (musinsa.com)', url: 'https://www.musinsa.com' },
  oliveyoung: { category: '수강신청 · 포털 · 쇼핑', name: '올리브영 (oliveyoung.co.kr)', url: 'https://www.oliveyoung.co.kr' },
  '29cm': { category: '수강신청 · 포털 · 쇼핑', name: '29CM (29cm.co.kr)', url: 'https://www.29cm.co.kr' },
  nike: { category: '수강신청 · 포털 · 쇼핑', name: '나이키 SNKRS (nike.com)', url: 'https://www.nike.com' },
  popmart: { category: '수강신청 · 포털 · 쇼핑', name: '팝마트 (popmart.com)', url: 'https://www.popmart.com' },
  witchform: { category: '수강신청 · 포털 · 쇼핑', name: '윗치폼 (witchform.com)', url: 'https://witchform.com' },
  local: { category: '교실 기본 서버', name: '교실 표준 서버 (자체 정밀시계)', url: null },
};

const timeOffsetCache = new Map(); // key -> { offsetMs, fetchedAt, rttMs, fallback }

async function getTargetTimeOffset(targetKey, customUrl) {
  let target = TIME_TARGETS[targetKey];
  let cacheKey = targetKey;

  if (targetKey === 'custom' && customUrl) {
    let normalized = String(customUrl).trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'https://' + normalized;
    }
    try {
      const parsed = new URL(normalized);
      target = {
        category: '직접 입력 도메인',
        name: `직접 입력 (${parsed.hostname})`,
        url: parsed.origin,
      };
      cacheKey = `custom:${parsed.hostname}`;
    } catch (e) {
      target = TIME_TARGETS.local;
    }
  }

  if (!target) target = TIME_TARGETS.local;
  if (!target.url) {
    return { targetKey: 'local', name: target.name, offsetMs: 0, rttMs: 0, fallback: false };
  }

  const cached = timeOffsetCache.get(cacheKey);
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
        timeOffsetCache.set(cacheKey, entry);
        return { targetKey, name: target.name, ...entry };
      }
    }
  } catch (err) {
    // Fallback gracefully if blocked or offline
  }

  const fallbackEntry = { offsetMs: 0, fetchedAt: Date.now(), rttMs: 0, fallback: true };
  timeOffsetCache.set(cacheKey, fallbackEntry);
  return { targetKey, name: target.name, ...fallbackEntry };
}

app.get('/api/server-time', async (req, res) => {
  const targetKey = req.query.target || 'local';
  const customUrl = req.query.customUrl || '';
  const info = await getTargetTimeOffset(targetKey, customUrl);
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
      category: val.category || '기타',
      name: val.name,
      url: val.url,
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
  if (rooms.size >= MAX_ROOMS) {
    // Evict oldest inactive room if limit reached
    let oldestCode = null;
    let oldestTime = Infinity;
    for (const [c, r] of rooms.entries()) {
      if (r.lastActivityAt < oldestTime) {
        oldestTime = r.lastActivityAt;
        oldestCode = c;
      }
    }
    if (oldestCode) {
      clearRoomTimers(rooms.get(oldestCode));
      rooms.delete(oldestCode);
    }
  }
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
      clickerBroadcast: null,
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
  if (room.timers.clickerBroadcast) {
    clearInterval(room.timers.clickerBroadcast);
    room.timers.clickerBroadcast = null;
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
        room.timers.clickerBroadcast = setInterval(() => {
          if (!room.currentRound || room.status !== 'playing' || !room.currentRound.dirty) return;
          room.currentRound.dirty = false;
          const rankings = computeRankings('clicker', room.currentRound.options, room.currentRound.results);
          io.to(room.hostSocketId).emit('game:live_results', {
            mode: 'clicker',
            results: rankings,
          });
        }, 250);
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
    room.currentRound.dirty = true;
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
