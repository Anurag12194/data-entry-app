const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const initSqlJs = require('sql.js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const USERNAME = process.env.APP_USERNAME || 'admin';
const PASSWORD = process.env.APP_PASSWORD || 'change_this_password';

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DB_PATH = path.join(__dirname, 'records.json');
const SESSIONS = new Map();

let SQL, db;

async function initDB() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      db = new SQL.Database(Buffer.from(data.buffer, 'base64'));
    } catch(e) { db = new SQL.Database(); }
  } else { db = new SQL.Database(); }
  db.run(`CREATE TABLE IF NOT EXISTS persons (id INTEGER PRIMARY KEY AUTOINCREMENT, father_name TEXT NOT NULL, epic_no TEXT, ration_card TEXT, aadhaar TEXT, dob TEXT, dod TEXT, bank_ac TEXT, cif TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, file_type TEXT, file_size INTEGER, uploaded_at TEXT DEFAULT (datetime('now')))`);
  saveDB();
}

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify({ buffer: Buffer.from(db.export()).toString('base64') }));
}
function query(sql, params = []) {
  const stmt = db.prepare(sql); stmt.bind(params);
  const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows;
}
function run(sql, params = []) { db.run(sql, params); saveDB(); }
function getLastId() { return query('SELECT last_insert_rowid() as id')[0].id; }

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || !SESSIONS.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  const session = SESSIONS.get(token);
  if (Date.now() > session.expires) { SESSIONS.delete(token); return res.status(401).json({ error: 'Session expired' }); }
  session.expires = Date.now() + 8 * 60 * 60 * 1000;
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10*1024*1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg','image/png','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype))
});

app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === USERNAME && password === PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    SESSIONS.set(token, { expires: Date.now() + 8 * 60 * 60 * 1000 });
    return res.json({ success: true, token });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) SESSIONS.delete(token);
  res.json({ success: true });
});

app.get('/api/me', authMiddleware, (req, res) => res.json({ username: USERNAME }));

app.get('/api/persons', authMiddleware, (req, res) => {
  const { search, page=1, limit=20 } = req.query;
  const offset = (Number(page)-1)*Number(limit);
  let where='', params=[];
  if (search) { const l=`%${search}%`; where=` WHERE father_name LIKE ? OR epic_no LIKE ? OR ration_card LIKE ? OR aadhaar LIKE ? OR bank_ac LIKE ? OR cif LIKE ?`; params=[l,l,l,l,l,l]; }
  const data = query(`SELECT * FROM persons${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, Number(limit), offset]);
  const total = query(`SELECT COUNT(*) as total FROM persons${where}`, params)[0]?.total || 0;
  res.json({ data, total, page: Number(page), limit: Number(limit) });
});

app.get('/api/persons/:id', authMiddleware, (req, res) => {
  const rows = query('SELECT * FROM persons WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ...rows[0], documents: query('SELECT * FROM documents WHERE person_id=?', [req.params.id]) });
});

app.post('/api/persons', authMiddleware, (req, res) => {
  const { father_name, epic_no='', ration_card='', aadhaar='', dob='', dod='', bank_ac='', cif='' } = req.body;
  if (!father_name) return res.status(400).json({ error: "Father's name is required" });
  run(`INSERT INTO persons (father_name,epic_no,ration_card,aadhaar,dob,dod,bank_ac,cif) VALUES (?,?,?,?,?,?,?,?)`,
