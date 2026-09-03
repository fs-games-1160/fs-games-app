const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = process.env.GIT_DATA_REPO;
const TOKEN = process.env.GIT_DATA_TOKEN;
const WORK = path.join(os.tmpdir(), 'fsgames-data-repo');
const REMOTE_PUBLIC = `https://github.com/${REPO}.git`;
const REMOTE_AUTH = `https://x-access-token:${TOKEN}@github.com/${REPO}.git`;

function sh(c) {
  try { return execSync(c, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return String(e.stderr || ''); }
}

function ensureClone() {
  if (!fs.existsSync(path.join(WORK, '.git'))) {
    fs.rmSync(WORK, { recursive: true, force: true });
    sh(`git clone ${REMOTE_AUTH} ${WORK}`);
  }
  sh(`git -C ${WORK} remote set-url origin ${REMOTE_AUTH}`);
}

function pull() { sh(`git -C ${WORK} fetch origin`); sh(`git -C ${WORK} reset --hard origin/main`); }

// Restore DB from GitHub before opening the database connection.
function restore(dbPath, retries = 3) {
  if (!REPO || !TOKEN) return;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  ensureClone();
  pull();
  const f = path.join(WORK, 'fsgames.db');
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(f)) {
        const buf = fs.readFileSync(f);
        // Only trust it if it looks like a real SQLite database.
        if (buf.length > 16 && buf.toString('ascii', 0, 16) === 'SQLite format 3\u0000') {
          fs.copyFileSync(f, dbPath);
        } else {
          // corrupt/placeholder file: remove so a fresh DB is created
          fs.rmSync(f, { force: true });
        }
      }
      return;
    } catch (e) { }
  }
}

// Upload the DB file to GitHub. Best-effort, safe to call repeatedly.
function backup(dbPath) {
  if (!REPO || !TOKEN || !fs.existsSync(dbPath)) return;
  ensureClone();
  const out = path.join(WORK, 'fsgames.db');
  const tmp = path.join(WORK, 'fsgames.db.tmp');
  try {
    fs.copyFileSync(dbPath, tmp);
    fs.renameSync(tmp, out);
    sh(`git -C ${WORK} add -A`);
    const status = sh(`git -C ${WORK} status --porcelain`).trim();
    if (!status) return;
    sh(`git -C ${WORK} -c user.name="fs-games-app" -c user.email="fs-games-app@users.noreply.github.com" commit -m "data update ${Date.now()}"`);
    sh(`git -C ${WORK} push origin main`);
  } catch (e) { }
}

module.exports = { restore, backup };
