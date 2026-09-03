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
const REVEAL_MS = parseInt(process.env.SPY_REVEAL_MS || '30000', 10);
const VOTE_MS = parseInt(process.env.SPY_VOTE_MS || '120000', 10);

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
    game: room.game || 'spy',
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
  room.revealAt = Date.now() + REVEAL_MS;
  room.revealTimer = setTimeout(() => {
    if (room.phase === 'playing') { room.phase = 'voting'; room.voteAt = Date.now() + VOTE_MS; startVoteTimer(room); }
  }, REVEAL_MS);
  for (const p of room.players) {
    const isSpy = room.spyIdx === p.id;
    send(p.conn, {
      type: 'reveal',
      phase: 'reveal',
      revealEndsAt: room.revealAt,
      isSpy,
      word: isSpy ? room.pair[1] : room.pair[0],
      role: isSpy ? 'spy' : 'citizen',
      players: room.players.map(x => ({ id: x.id, name: x.name })),
      youId: p.id,
    });
  }
}

function startVoteTimer(room) {
  room.voteAt = Date.now() + VOTE_MS;
  if (room.voteTimer) clearTimeout(room.voteTimer);
  room.voteTimer = setTimeout(() => finishRound(room), VOTE_MS);
  for (const p of room.players) {
    send(p.conn, { ...roomPayload(room, p.id), type: 'votePhase', voteEndsAt: room.voteAt, youId: p.id });
  }
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

/* ================= Knowledge Race (أونلاين) ================= */
const RACE_QUESTIONS = [
  {q:"كم عدد أيام الأسبوع؟",a:["5","6","7","8"],c:2},
  {q:"ما هي أكبر قارة في العالم؟",a:["أفريقيا","آسيا","أوروبا","أمريكا"],c:1},
  {q:"كم عدد ألوان قوس قزح؟",a:["5","6","7","8"],c:2},
  {q:"ما هي عاصمة السعودية؟",a:["جدة","الرياض","مكة","الدمام"],c:1},
  {q:"كم عدد أرجل العنكبوت؟",a:["6","8","10","4"],c:1},
  {q:"ما هو أكبر محيط في العالم؟",a:["الأطلسي","الهادي","الهندي","المتجمد"],c:1},
  {q:"كم عدد ساعات اليوم؟",a:["12","20","24","30"],c:2},
  {q:"كم عدد أصابع اليد الواحدة؟",a:["3","4","5","6"],c:2},
  {q:"ما هي عاصمة قطر؟",a:["الدوحة","أبوظبي","المنامة","مسقط"],c:0},
  {q:"ما هو أسرع وسيلة نقل في الهواء؟",a:["السيارة","الطائرة","السفينة","القطار"],c:1},
  {q:"كم عدد القارات في العالم؟",a:["5","6","7","8"],c:2},
  {q:"ما هي عاصمة فرنسا؟",a:["لندن","باريس","روما","مدريد"],c:1},
  {q:"كم عدد كواكب المجموعة الشمسية؟",a:["7","8","9","10"],c:1},
  {q:"ما هو لون العشب عادةً؟",a:["أحمر","أخضر","أزرق","أسود"],c:1},
  {q:"كم عدد أطراف النجمة الخماسية؟",a:["3","4","5","6"],c:2},
  {q:"كم عدد ألوان إشارة المرور؟",a:["2","3","4","5"],c:1},
  {q:"ما هي اللغة التي يتحدث بها أهل مصر؟",a:["الإنجليزية","العربية","الفرنسية","التركية"],c:1},
  {q:"في أي بلد يقع برج إيفل؟",a:["إيطاليا","إسبانيا","فرنسا","ألمانيا"],c:2},
  {q:"ما هو الكوكب الأحمر؟",a:["الأرض","المريخ","المشتري","زحل"],c:1},
  {q:"كم عدد عجلات السيارة؟",a:["2","3","4","6"],c:2},
  {q:"كم عدد أشهر السنة الميلادية؟",a:["10","11","12","13"],c:2},
  {q:"كم عدد أيام الأسبوع الدراسي في أغلب الدول؟",a:["4","5","6","7"],c:1},
  {q:"ما هو أصغر كوكب في المجموعة الشمسية؟",a:["عطارد","المريخ","الزهرة","بلوتو"],c:0},
  {q:"كم عدد حروف اللغة العربية؟",a:["26","28","29","30"],c:1},
];
const RACE_ROUNDS = parseInt(process.env.SPY_RACE_ROUNDS || '8', 10);
const RACE_Q_MS = parseInt(process.env.SPY_RACE_Q_MS || '15000', 10);

function initRace(room){
  room.phase = 'race';
  room.scores = {};
  room.qIndex = 0;
  room.qs = RACE_QUESTIONS.slice().sort(() => Math.random() - 0.5).slice(0, RACE_ROUNDS);
  sendRaceQ(room);
}
function sendRaceQ(room){
  if (room.phase !== 'race') return;
  if (room.qIndex >= room.qs.length){ finishRace(room); return; }
  const q = room.qs[room.qIndex];
  const order = q.a.map((_, i) => i).sort(() => Math.random() - 0.5);
  room.curQ = { ...q, opts: order.map(i => ({ idx: i, text: q.a[i] })), scored: false };
  room.answered = {};
  room.qDeadline = Date.now() + RACE_Q_MS;
  if (room.qTimer) clearTimeout(room.qTimer);
  room.qTimer = setTimeout(() => revealRaceQ(room), RACE_Q_MS);
  broadcast(room, {
    type: 'raceQ',
    round: room.qIndex + 1,
    total: room.qs.length,
    text: q.q,
    opts: room.curQ.opts,
    endsAt: room.qDeadline,
    scores: room.scores,
  });
}
function revealRaceQ(room){
  if (room.phase !== 'race') return;
  if (room.qTimer) clearTimeout(room.qTimer);
  const q = room.qs[room.qIndex];
  broadcast(room, {
    type: 'raceReveal',
    round: room.qIndex + 1,
    correct: q.c,
    text: q.q,
    scores: room.scores,
  });
  room.qIndex++;
  setTimeout(() => sendRaceQ(room), 3200);
}
function finishRace(room){
  if (room.phase !== 'race') return;
  room.phase = 'result';
  if (room.qTimer) clearTimeout(room.qTimer);
  const ranked = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id] || 0 }))
    .sort((x, y) => y.score - x.score);
  broadcast(room, { type: 'raceFinal', ranked, scores: room.scores });
  setTimeout(() => { for (const p of room.players) { try { p.conn.close(); } catch (e) { } } rooms.delete(room.code); }, 180000);
}
function onRaceAns(room, conn, idx){
  if (room.phase !== 'race' || !room.curQ) return;
  if (room.answered[conn.playerId]) return;
  room.answered[conn.playerId] = true;
  const correct = idx === room.curQ.c;
  if (correct && !room.curQ.scored){
    room.curQ.scored = true;
    room.scores[conn.playerId] = (room.scores[conn.playerId] || 0) + 1;
    broadcast(room, { type: 'raceScored', id: conn.playerId, name: conn.name, scores: room.scores });
  }
  send(conn, { type: 'raceAnswer', correct });
}

/* ================= اكشف الكلمة / شرح وتخمين (أونلاين) ================= */
const WL_WORDS = [
  "تفاح","موز","برتقال","عنب","بطيخ","فراولة","جزر","بطاطس","طماطم","خيار",
  "سيارة","طائرة","قطار","دراجة","حافلة","سفينة","صاروخ","غواصة",
  "قط","كلب","حمار","حصان","فيل","أسد","نمر","دب","ذئب","ثعلب",
  "مدرسة","مستشفى","مطار","ملعب","مسجد","بيت","فندق","مكتبة","مطعم","سوق",
  "شمس","قمر","نجمة","غيمة","مطر","ثلج","رياح","برق","قوس قزح","صحراء",
  "هاتف","كمبيوتر","تلفاز","كاميرا","ساعة","نظارة","مفتاح","محفظة","حقيبة","مظلة",
];
const WL_ROUNDS = parseInt(process.env.SPY_WL_ROUNDS || '8', 10);
const WL_TURN_MS = parseInt(process.env.SPY_WL_TURN_MS || '30000', 10);

function initWordl(room){
  room.phase = 'wordl';
  room.scores = {};
  room.wlRound = 0;
  room.wlTurns = [];
  room.wlGuessed = {};
  room.wlWords = [];
  // each player explains one word; build a list of words (reuse for all)
  for (let i = 0; i < room.players.length; i++) room.wlTurns.push(room.players[i].id);
  room.wlWords = WL_WORDS.slice().sort(() => Math.random() - 0.5).slice(0, room.players.length);
  startWordlTurn(room);
}
function startWordlTurn(room){
  if (room.phase !== 'wordl') return;
  if (room.wlRound >= room.wlTurns.length){ finishWordl(room); return; }
  const darId = room.wlTurns[room.wlRound];
  const word = room.wlWords[room.wlRound];
  room.wlGuessed = {};
  room.darId = darId;
  room.wlWord = word;
  if (room.wlTimer) clearTimeout(room.wlTimer);
  room.wlTimer = setTimeout(() => broadcastWordlSkill(room, false), WL_TURN_MS);
  for (const p of room.players) {
    const isDar = p.id === darId;
    send(p.conn, {
      type: 'wlTurn',
      round: room.wlRound + 1,
      total: room.wlTurns.length,
      areDar: isDar,
      word: isDar ? word : undefined,
      darName: room.players.find(x => x.id === darId).name,
      scores: room.scores,
      endsAt: Date.now() + WL_TURN_MS,
      youId: p.id,
    });
  }
}
function broadcastWordlSkill(room, passed){
  // time up or skipped: reveal the word and move on
  if (room.phase !== 'wordl') return;
  if (room.wlTimer) clearTimeout(room.wlTimer);
  broadcast(room, {
    type: 'wlReveal',
    word: room.wlWord,
    passed,
    scores: room.scores,
    round: room.wlRound + 1,
  });
  room.wlRound++;
  setTimeout(() => startWordlTurn(room), 3200);
}
function onWordlGuess(room, conn, guess){
  if (room.phase !== 'wordl') return;
  if (!room.wlWord) return;
  if (conn.playerId === room.darId) return; // the dar cannot guess own word
  if (room.wlGuessed[conn.playerId]) return; // one guess per player per turn
  room.wlGuessed[conn.playerId] = true;
  const ok = String(guess || '').trim() === room.wlWord;
  send(conn, { type: 'wlGuessR', correct: ok });
  if (ok){
    room.scores[conn.playerId] = (room.scores[conn.playerId] || 0) + 1;
    broadcast(room, { type: 'wlCorrect', id: conn.playerId, name: conn.name, word: room.wlWord, scores: room.scores });
    if (room.wlTimer) clearTimeout(room.wlTimer);
    room.wlRound++;
    setTimeout(() => startWordlTurn(room), 3200);
  }
}
function finishWordl(room){
  if (room.phase !== 'wordl') return;
  room.phase = 'result';
  if (room.wlTimer) clearTimeout(room.wlTimer);
  const ranked = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id] || 0 })).sort((x, y) => y.score - x.score);
  broadcast(room, { type: 'wlFinal', ranked, scores: room.scores, words: room.wlWords });
  setTimeout(() => { for (const p of room.players) { try { p.conn.close(); } catch (e) { } } rooms.delete(room.code); }, 180000);
}

function handleMessage(conn, data) {
  const msg = (typeof data === 'string') ? data : data.toString('utf8');
  let obj;
  try { obj = JSON.parse(msg); } catch (e) { return; }

  if (obj.type === 'create') {
    const game = (obj.game === 'race' || obj.game === 'wordl') ? obj.game : 'spy';
    const room = { code: genCode(), phase: 'lobby', players: [], votes: {}, game };
    rooms.set(room.code, room);
    conn.roomCode = room.code;
    conn.playerId = 0;
    conn.name = String(obj.name || 'لاعب 1').slice(0, 14);
    room.players.push({ id: 0, name: conn.name, conn });
    send(conn, { ...roomPayload(room), type: 'joined', code: room.code, id: 0, youId: 0, game });
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
    conn.name = String(obj.name || ('لاعب ' + (room.players.length + 1))).slice(0, 14);
    room.players.push({ id: room.players.length, name: conn.name, conn });
    send(conn, { ...roomPayload(room), type: 'joined', code: room.code, id: conn.playerId, youId: conn.playerId, game: room.game });
    broadcast(room, roomPayload(room));
    return;
  }

  if (obj.type === 'start') {
    const room = rooms.get(conn.roomCode);
    if (!room) return;
    // only host (id 0) can start, and need 3+ players
    if (conn.playerId !== 0) return;
    if (room.players.length < 3) { send(conn, { type: 'error', error: 'need-more' }); return; }
    if (room.game === 'race') initRace(room);
    else if (room.game === 'wordl') initWordl(room);
    else initRoom(room);
    return;
  }

  if (obj.type === 'raceAns') {
    const room = rooms.get(conn.roomCode);
    if (room) onRaceAns(room, conn, obj.idx);
    return;
  }

  if (obj.type === 'wlGuess') {
    const room = rooms.get(conn.roomCode);
    if (room) onWordlGuess(room, conn, obj.word);
    return;
  }

  if (obj.type === 'wlNext') {
    const room = rooms.get(conn.roomCode);
    if (!room) return;
    if (conn.playerId !== room.darId) return; // only the current dar can skip
    broadcastWordlSkill(room, true);
    return;
  }

  if (obj.type === 'vote') {
    const room = rooms.get(conn.roomCode);
    if (!room || room.phase !== 'voting') return;
    // every player votes exactly once
    if (room.voters && room.voters[conn.playerId] !== undefined) {
      send(conn, { type: 'error', error: 'already-voted' });
      return;
    }
    const targetId = obj.targetId;
    if (typeof targetId !== 'number') return;
    if (targetId < 0 || targetId >= room.players.length) return;
    room.voters = room.voters || {};
    room.voters[conn.playerId] = targetId;
    room.votes[targetId] = (room.votes[targetId] || 0) + 1;
    room.votedSet[conn.playerId] = true;
    broadcast(room, {
      type: 'voteUpdate',
      votes: room.votes,
      voters: room.voters,
      count: Object.keys(room.votedSet).length,
      total: room.players.length,
    });
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
    if (room.qTimer) clearTimeout(room.qTimer);
    if (room.wlTimer) clearTimeout(room.wlTimer);
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
