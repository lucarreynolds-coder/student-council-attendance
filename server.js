const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database setup ──────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'attendance.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'member',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id         TEXT    PRIMARY KEY,
    title      TEXT    NOT NULL,
    date       TEXT    NOT NULL,
    time       TEXT    NOT NULL DEFAULT '00:00',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    meeting_id TEXT NOT NULL,
    member_id  INTEGER NOT NULL,
    status     TEXT NOT NULL,
    PRIMARY KEY (meeting_id, member_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id)  REFERENCES members(id)  ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS excuses (
    meeting_id     TEXT    NOT NULL,
    member_id      INTEGER NOT NULL,
    reason         TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'pending',
    PRIMARY KEY (meeting_id, member_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id)  REFERENCES members(id)  ON DELETE CASCADE
  );
`);

// Seed default password if not set
const pwRow = db.prepare("SELECT value FROM settings WHERE key = 'exec_password'").get();
if (!pwRow) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('exec_password', ?)").run('council2027');
}

// ── Middleware ──────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'sc-attendance-secret-2027',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// ── Helpers ─────────────────────────────────────────────────────────
function isExec(req) { return req.session && req.session.role === 'exec'; }

// A member can edit their own attendance if within 24h of meeting start
function memberCanEdit(meetingId, memberId) {
  const meeting = db.prepare("SELECT date, time FROM meetings WHERE id = ?").get(meetingId);
  if (!meeting) return false;
  const meetingStart = new Date(`${meeting.date}T${meeting.time}:00`);
  const now = new Date();
  const diffMs = now - meetingStart;
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

function buildMeetingPayload(meeting) {
  const attendanceRows = db.prepare("SELECT member_id, status FROM attendance WHERE meeting_id = ?").all(meeting.id);
  const excuseRows = db.prepare("SELECT member_id, reason, status FROM excuses WHERE meeting_id = ?").all(meeting.id);
  const attendance = {};
  const excuses = {};
  const excuseStatus = {};
  attendanceRows.forEach(r => { attendance[r.member_id] = r.status; });
  excuseRows.forEach(r => { excuses[r.member_id] = r.reason; excuseStatus[r.member_id] = r.status; });
  return { ...meeting, attendance, excuses, excuseStatus };
}

// ── Auth routes ──────────────────────────────────────────────────────

// Check current session
app.get('/api/session', (req, res) => {
  res.json({ role: req.session.role || 'member' });
});

// Exec login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'exec_password'").get();
  if (password === row.value) {
    req.session.role = 'exec';
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Incorrect password.' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Change password (exec only)
app.post('/api/change-password', (req, res) => {
  if (!isExec(req)) return res.status(403).json({ error: 'Not authorized.' });
  const { currentPassword, newPassword } = req.body;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'exec_password'").get();
  if (currentPassword !== row.value) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });
  db.prepare("UPDATE settings SET value = ? WHERE key = 'exec_password'").run(newPassword);
  res.json({ ok: true });
});

// ── Members routes ───────────────────────────────────────────────────

app.get('/api/members', (req, res) => {
  const members = db.prepare("SELECT * FROM members ORDER BY role DESC, name ASC").all();
  res.json(members);
});

app.post('/api/members', (req, res) => {
  if (!isExec(req)) return res.status(403).json({ error: 'Not authorized.' });
  const { name, role } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  const info = db.prepare("INSERT INTO members (name, role) VALUES (?, ?)").run(name.trim(), role === 'exec' ? 'exec' : 'member');
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(info.lastInsertRowid);
  res.json(member);
});

app.delete('/api/members/:id', (req, res) => {
  if (!isExec(req)) return res.status(403).json({ error: 'Not authorized.' });
  db.prepare("DELETE FROM members WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── Meetings routes ──────────────────────────────────────────────────

app.get('/api/meetings', (req, res) => {
  const meetings = db.prepare("SELECT * FROM meetings ORDER BY date DESC, time DESC").all();
  const full = meetings.map(buildMeetingPayload);
  res.json(full);
});

app.post('/api/meetings', (req, res) => {
  if (!isExec(req)) return res.status(403).json({ error: 'Not authorized.' });
  const { title, date, time } = req.body;
  if (!date) return res.status(400).json({ error: 'Date is required.' });
  const id = 'm' + Date.now();
  db.prepare("INSERT INTO meetings (id, title, date, time) VALUES (?, ?, ?, ?)").run(
    id, (title || 'Meeting').trim(), date, time || '00:00'
  );
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id);
  res.json(buildMeetingPayload(meeting));
});

app.put('/api/meetings/:id', (req, res) => {
  if (!isExec(req)) return res.status(403).json({ error: 'Not authorized.' });
  const { title, date, time } = req.body;
  db.prepare("UPDATE meetings SET title = ?, date = ?, time = ? WHERE id = ?").run(
    (title || 'Meeting').trim(), date, time || '00:00', req.params.id
  );
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });
  res.json(buildMeetingPayload(meeting));
});

app.delete('/api/meetings/:id', (req, res) => {
  if (!isExec(req)) return res.status(403).json({ error: 'Not authorized.' });
  db.prepare("DELETE FROM meetings WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── Attendance routes ─────────────────────────────────────────────────

// Exec: mark any member. Member: mark themselves if within 24h window.
app.post('/api/attendance', (req, res) => {
  const { meetingId, memberId, status } = req.body;
  if (!['P','A','E'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  if (!isExec(req)) {
    const memberIdNum = parseInt(memberId, 10);
    // Members must identify themselves via session or we just enforce by window
    if (!memberCanEdit(meetingId, memberIdNum)) {
      return res.status(403).json({ error: 'The 24-hour editing window for this meeting has closed.' });
    }
  }

  db.prepare(`
    INSERT INTO attendance (meeting_id, member_id, status) VALUES (?, ?, ?)
    ON CONFLICT(meeting_id, member_id) DO UPDATE SET status = excluded.status
  `).run(meetingId, memberId, status);

  // Clear excuse if status is no longer E
  if (status !== 'E') {
    db.prepare("DELETE FROM excuses WHERE meeting_id = ? AND member_id = ?").run(meetingId, memberId);
  }

  res.json({ ok: true });
});

// ── Excuse routes ─────────────────────────────────────────────────────

app.post('/api/excuses', (req, res) => {
  const { meetingId, memberId, reason } = req.body;

  if (!isExec(req)) {
    if (!memberCanEdit(meetingId, memberId)) {
      return res.status(403).json({ error: 'The 24-hour editing window for this meeting has closed.' });
    }
  }

  db.prepare(`
    INSERT INTO excuses (meeting_id, member_id, reason, status) VALUES (?, ?, ?, 'pending')
    ON CONFLICT(meeting_id, member_id) DO UPDATE SET reason = excluded.reason, status = 'pending'
  `).run(meetingId, memberId, reason || '');

  res.json({ ok: true });
});

// Exec only: approve or deny an excuse
app.put('/api/excuses/status', (req, res) => {
  if (!isExec(req)) return res.status(403).json({ error: 'Not authorized.' });
  const { meetingId, memberId, status } = req.body;
  if (!['approved','denied','pending'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare(`
    INSERT INTO excuses (meeting_id, member_id, reason, status) VALUES (?, ?, '', ?)
    ON CONFLICT(meeting_id, member_id) DO UPDATE SET status = excluded.status
  `).run(meetingId, memberId, status);
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Student Council Attendance running on port ${PORT}`);
});
