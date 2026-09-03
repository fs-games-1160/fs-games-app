const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db, dbPath } = require('./db');
const { backup } = require('./backup');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'fs-games-secret-key-change-me-2026';

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

function sign(u) {
  return jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email || null,
    gender: u.gender,
    is_guest: u.is_guest,
    avatar_color: u.avatar_color,
  };
}

// ============ AUTH ============

app.post('/api/register', (req, res) => {
  const { username, email, password, gender } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username-password-required' });
  if (String(username).length < 3) return res.status(400).json({ error: 'username-short' });
  if (String(password).length < 4) return res.status(400).json({ error: 'password-short' });
  if (gender && !['male', 'female'].includes(gender)) return res.status(400).json({ error: 'gender-invalid' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'username-taken' });

  if (email) {
    const e = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (e) return res.status(409).json({ error: 'email-taken' });
  }

  const hash = bcrypt.hashSync(String(password), 10);
  const g = gender || 'male';
  const avatar = g === 'female' ? '#e75480' : '#4f6ef7';

  const info = db.prepare(
    'INSERT INTO users (username, email, password_hash, gender, is_guest, avatar_color) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(String(username), email ? String(email).toLowerCase() : null, hash, g, avatar);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { usernameOrEmail, password } = req.body || {};
  if (!usernameOrEmail || !password) return res.status(400).json({ error: 'credentials-required' });

  const q = String(usernameOrEmail).toLowerCase();
  const user = db.prepare(
    'SELECT * FROM users WHERE LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?) AND is_guest = 0'
  ).get(q, q);

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'wrong-credentials' });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/guest', (req, res) => {
  const { gender } = req.body || {};
  const g = gender && ['male', 'female'].includes(gender) ? gender : 'male';
  const avatar = g === 'female' ? '#e75480' : '#4f6ef7';
  const name = 'Guest_' + Math.random().toString(36).slice(2, 7);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, gender, is_guest, avatar_color) VALUES (?, ?, ?, 1, ?)'
  ).run(name, bcrypt.hashSync('guest' + Math.random(), 10), g, avatar);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'not-found' });
  const score = db.prepare('SELECT * FROM scores WHERE user_id = ?').get(user.id) || { total_score: 0, games_won: 0 };
  res.json({ user: publicUser(user), score: { total_score: score.total_score, games_won: score.games_won } });
});

// ============ SCORES ============

app.post('/api/score', auth, (req, res) => {
  const { total_score, games_won } = req.body || {};
  const cur = db.prepare('SELECT * FROM scores WHERE user_id = ?').get(req.userId);
  if (cur) {
    db.prepare('UPDATE scores SET total_score = ?, games_won = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(typeof total_score === 'number' ? total_score : cur.total_score,
           typeof games_won === 'number' ? games_won : cur.games_won, req.userId);
  } else {
    db.prepare('INSERT INTO scores (user_id, total_score, games_won) VALUES (?, ?, ?)')
      .run(req.userId, typeof total_score === 'number' ? total_score : 0, typeof games_won === 'number' ? games_won : 0);
  }
  const s = db.prepare('SELECT * FROM scores WHERE user_id = ?').get(req.userId);
  res.json({ total_score: s.total_score, games_won: s.games_won });
});

// ============ FRIENDS ============

app.post('/api/friends/add', auth, (req, res) => {
  const { friendUsername } = req.body || {};
  if (!friendUsername) return res.status(400).json({ error: 'friend-required' });

  const friend = db.prepare('SELECT * FROM users WHERE username = ? AND is_guest = 0').get(String(friendUsername));
  if (!friend) return res.status(404).json({ error: 'friend-not-found' });
  if (friend.id === req.userId) return res.status(400).json({ error: 'cannot-add-self' });

  const dup = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?').get(req.userId, friend.id);
  if (dup) return res.status(409).json({ error: 'already-friends-or-pending' });

  db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, \'pending\')').run(req.userId, friend.id);
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, \'pending\')').run(friend.id, req.userId);

  res.json({ ok: true, message: 'friend-request-sent' });
});

app.post('/api/friends/respond', auth, (req, res) => {
  const { friendId, action } = req.body || {};
  if (!friendId || !['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'bad-request' });

  const row = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = \'pending\'').get(req.userId, friendId);
  if (!row) return res.status(404).json({ error: 'request-not-found' });

  if (action === 'accept') {
    db.prepare('UPDATE friends SET status = \'accepted\' WHERE user_id = ? AND friend_id = ?').run(req.userId, friendId);
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, \'accepted\')').run(friendId, req.userId);
    db.prepare('UPDATE friends SET status = \'accepted\' WHERE user_id = ? AND friend_id = ?').run(friendId, req.userId);
  } else {
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.userId, friendId);
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(friendId, req.userId);
  }
  res.json({ ok: true });
});

function loadFriends(userId) {
  const rows = db.prepare(
    `SELECT f.friend_id, f.status, u.username, u.gender, u.avatar_color, u.is_guest,
            COALESCE(s.total_score,0) AS total_score
     FROM friends f
     JOIN users u ON u.id = f.friend_id
     LEFT JOIN scores s ON s.user_id = f.friend_id
     WHERE f.user_id = ?`
  ).all(userId);
  return rows.map(r => ({
    id: r.friend_id,
    username: r.username,
    gender: r.gender,
    avatar_color: r.avatar_color,
    is_guest: r.is_guest,
    status: r.status,
    total_score: r.total_score,
  }));
}

app.get('/api/friends', auth, (req, res) => {
  res.json({ friends: loadFriends(req.userId) });
});

// search users to add by name
app.get('/api/users/search', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const rows = db.prepare(
    `SELECT id, username, gender, avatar_color FROM users
     WHERE is_guest = 0 AND username LIKE ? LIMIT 10`
  ).all('%' + q + '%');
  res.json({ results: rows.map(publicUser) });
});

// ============ ADMIN ============

const ADMIN_PIN = process.env.ADMIN_PIN || '0000';

// list all registered users (admin only)
app.get('/api/users/all', (req, res) => {
  const pin = req.headers['x-admin-pin'];
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'bad-admin-pin' });
  const users = db.prepare(
    `SELECT u.id, u.username, u.email, u.gender, u.is_guest, u.avatar_color, u.created_at,
            COALESCE(s.total_score,0) AS total_score, COALESCE(s.games_won,0) AS games_won
     FROM users u
     LEFT JOIN scores s ON s.user_id = u.id
     ORDER BY u.id`
  ).all();
  res.json({ users });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('F&S Games server running on port ' + PORT);
  // persist DB to GitHub backup every 45 seconds (best-effort)
  setInterval(() => backup(dbPath), 45000);
});
