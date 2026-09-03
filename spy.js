const { WebSocketServer } = require('ws');

// Word pairs: index 0 = real word (citizens), index 1 = decoy (spy)
const WORDS = [
  ["مطعم", "مقهى"], ["شاطئ", "حمام سباحة"], ["مستشفى", "عيادة"], ["سوبرماركت", "متجر ملابس"],
  ["مدرسة", "جامعة"], ["طائرة", "قطار"], ["مطار", "محطة قطار"], ["شجرة", "نبتة"],
  ["قطة", "كلب"], ["كتاب", "مجلة"], ["قمر", "شمس"], ["بحر", "بحيرة"],
  ["جبل", "تل"], ["حديقة", "غابة"], ["سيارة", "دراجة"], ["سهل", "صحراء"],
  ["ساعة", "سوار"], ["فنجان", "كوب"], ["نظارة", "منظار"], ["قلم", "فرشاة"],
  ["تمثال", "متحف"], ["جسر", "نفق"], ["فندق", "استراحة"], ["مسبح", "نافورة"],
];

// rooms: code -> { code, players: [{id, name, conn}], spyIdx, pair, phase, votes, startTime, revealAt, voteAt }
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function send(conn, obj) {
  if (conn && conn.readyState === 1) {
    try { conn.send(JSON.stringify(obj)); } catch (e) { }
  }
}

function broadcast(room, obj) {
  for (const p of room.players) send(p.conn, obj);
}

function roomPayload(room, excludeId) {
  return {
    type: 'room',
    code: room.code,
    phase: room.phase,
    count: room.players.length,
    max: 8,
    youId: excludeId,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    spyIdx: room.phase === 'result' ? room.spyIdx : undefined,
    pair: room.phase === 'result' ? room.pair : undefined,
    votes: room.phase === 'result' ? room.votes : undefined,
    votesForSpy: room.phase === 'result' ? (room.votes[room.spyIdx] || 0) : undefined,
  };
}

function onJoin(conn) {
  send(conn, { type: 'welcome', roomsize: 8 });
}

function initRoom(room) {
  room.phase = 'playing';
  room.pair = WORDS[Math.floor(Math.random() * WORDS.length)];
  room.spyIdx = Math.floor(Math.random() * room.players.length);
  room.votes = {};
  room.voteOrder = [];
  room.votedSet = {};
  room.startTime = Date.now();
  // reveal window = 30s total
  room.revealAt = Date.now() + 30000;
  room.revealTimer = setTimeout(() => {
    if (room.phase === 'playing') { room.phase = 'voting'; room.voteAt = Date.now() + 120000; startVoteTimer(room); }
  }, 30000);
  for (const p of room.players) {
    const isSpy = room.spyIdx === p.id;
    send(p.conn, {
      type: 'reveal',
      phase: 'reveal',
      revealEndsAt: room.revealAt,
      isSpy,
      word: isSpy ? room.pair[1] : room.pair[0],
      role: isSpy ? 'spy' : 'citizen',
    });
  }
}

function startVoteTimer(room) {
  room.voteAt = Date.now() + 120000;
  if (room.voteTimer) clearTimeout(room.voteTimer);
  room.voteTimer = setTimeout(() => finishRound(room), 120000);
  for (const p of room.players) send(p.conn, { type: 'votePhase', voteEndsAt: room.voteAt });
}

function finishRound(room) {
  if (room.phase === 'result') return;
  room.phase = 'result';
  if (room.revealTimer) clearTimeout(room.revealTimer);
  if (room.voteTimer) clearTimeout(room.voteTimer);
  const got = room.votes[room.spyIdx] || 0;
  broadcast(room, {
    type: 'result',
    ...roomPayload(room),
    caught: got > 0,
    votesForSpy: got,
  });
  // cleanup after a few minutes
  setTimeout(() => {
    for (const p of room.players) { try { p.conn.close(); } catch (e) { } }
    rooms.delete(room.code);
  }, 300000);
}

function handleMessage(conn, data) {
  const msg = (typeof data === 'string') ? data : data.toString('utf8');
  let obj;
  try { obj = JSON.parse(msg); } catch (e) { return; }

  if (obj.type === 'create') {
    const room = { code: genCode(), phase: 'lobby', players: [], votes: {} };
    rooms.set(room.code, room);
    conn.roomCode = room.code;
    conn.playerId = 0;
    room.players.push({ id: 0, name: String(obj.name || 'لاعب 1').slice(0, 14), conn });
    send(conn, { ...roomPayload(room), type: 'joined', code: room.code, id: 0, youId: 0 });
    broadcast(room, roomPayload(room));
    return;
  }

  if (obj.type === 'join') {
    const room = rooms.get(String(obj.code || '').trim().toUpperCase());
    if (!room) { send(conn, { type: 'error', error: 'room-not-found' }); return; }
    if (room.players.length >= 8) { send(conn, { type: 'error', error: 'room-full' }); return; }
    if (room.phase !== 'lobby') { send(conn, { type: 'error', error: 'game-started' }); return; }
    conn.roomCode = room.code;
    conn.playerId = room.players.length;
    room.players.push({ id: room.players.length, name: String(obj.name || ('لاعب ' + (room.players.length + 1))).slice(0, 14), conn });
    send(conn, { ...roomPayload(room), type: 'joined', code: room.code, id: conn.playerId, youId: conn.playerId });
    broadcast(room, roomPayload(room));
    return;
  }

  if (obj.type === 'start') {
    const room = rooms.get(conn.roomCode);
    if (!room) return;
    // only host (id 0) can start, and need 3+ players
    if (conn.playerId !== 0) return;
    if (room.players.length < 3) { send(conn, { type: 'error', error: 'need-more' }); return; }
    initRoom(room);
    return;
  }

  if (obj.type === 'vote') {
    const room = rooms.get(conn.roomCode);
    if (!room || room.phase !== 'voting') return;
    const targetId = obj.targetId;
    if (typeof targetId !== 'number') return;
    if (targetId < 0 || targetId >= room.players.length) return;
    room.votes[targetId] = (room.votes[targetId] || 0) + 1;
    room.votedSet[conn.playerId] = true;
    broadcast(room, { type: 'voteUpdate', votes: room.votes, count: Object.keys(room.votedSet).length, total: room.players.length });
    return;
  }

  if (obj.type === 'revealDone') {
    // client finished viewing its role; nothing special needed for hotseat-equivalent
    return;
  }

  if (obj.type === 'rejoin') {
    const room = rooms.get(conn.roomCode);
    if (room) send(conn, roomPayload(room));
    return;
  }
}

function onClose(conn) {
  const code = conn.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  room.players = room.players.filter(p => p.conn !== conn);
  if (room.players.length === 0) {
    if (room.revealTimer) clearTimeout(room.revealTimer);
    if (room.voteTimer) clearTimeout(room.voteTimer);
    rooms.delete(code);
    return;
  }
  // if host left, promote next player
  if (conn.playerId === 0 && room.players.length > 0) {
    // assign a new id 0? keep simple: just notify
  }
  broadcast(room, roomPayload(room));
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    onJoin(ws);
    ws.on('message', (m) => handleMessage(ws, m));
    ws.on('close', () => onClose(ws));
  });
  return wss;
}

module.exports = { attach };
