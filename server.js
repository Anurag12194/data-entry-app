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
    try { const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); db = new SQL.Database(Buffer.from(data.buffer, 'base64')); }
    catch(e) { db = new SQL.Database(); }
  } else { db = new SQL.Database(); }
  db.run(`CREATE TABLE IF NOT EXISTS persons (id INTEGER PRIMARY KEY AUTOINCREMENT, father_name TEXT NOT NULL, epic_no TEXT, ration_card TEXT, aadhaar TEXT, dob TEXT, dod TEXT, bank_ac TEXT, cif TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, file_type TEXT, file_size INTEGER, uploaded_at TEXT DEFAULT (datetime('now')))`);
  saveDB();
}

function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify({ buffer: Buffer.from(db.export()).toString('base64') })); }
function query(sql, params=[]) { const s=db.prepare(sql); s.bind(params); const r=[]; while(s.step()) r.push(s.getAsObject()); s.free(); return r; }
function run(sql, params=[]) { db.run(sql, params); saveDB(); }
function getLastId() { return query('SELECT last_insert_rowid() as id')[0].id; }

function auth(req, res, next) {
  const t = req.headers['x-auth-token'];
  if (!t || !SESSIONS.has(t)) return res.status(401).json({ error: 'Unauthorized' });
  const s = SESSIONS.get(t);
  if (Date.now() > s.expires) { SESSIONS.delete(t); return res.status(401).json({ error: 'Session expired' }); }
  s.expires = Date.now() + 8*60*60*1000;
  next();
}

const store = multer.diskStorage({
  destination: (req,file,cb) => cb(null, UPLOADS_DIR),
  filename: (req,file,cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}-${file.originalname}`)
});
const upload = multer({ storage: store, limits: { fileSize: 10*1024*1024 },
  fileFilter: (req,file,cb) => cb(null, ['image/jpeg','image/png','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype))
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req,res) => {
  const {username,password} = req.body;
  if (username===USERNAME && password===PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    SESSIONS.set(token, { expires: Date.now()+8*60*60*1000 });
    return res.json({ success:true, token });
  }
  res.status(401).json({ error:'Invalid username or password' });
});

app.post('/api/logout', (req,res) => { if(req.headers['x-auth-token']) SESSIONS.delete(req.headers['x-auth-token']); res.json({success:true}); });
app.get('/api/me', auth, (req,res) => res.json({ username:USERNAME }));

app.get('/api/persons', auth, (req,res) => {
  const {search,page=1,limit=20} = req.query;
  const offset = (Number(page)-1)*Number(limit);
  let where='', params=[];
  if (search) { const l=`%${search}%`; where=` WHERE father_name LIKE ? OR epic_no LIKE ? OR ration_card LIKE ? OR aadhaar LIKE ? OR bank_ac LIKE ? OR cif LIKE ?`; params=[l,l,l,l,l,l]; }
  const data = query(`SELECT * FROM persons${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params,Number(limit),offset]);
  const total = query(`SELECT COUNT(*) as total FROM persons${where}`, params)[0]?.total || 0;
  res.json({ data, total, page:Number(page), limit:Number(limit) });
});

app.get('/api/persons/:id', auth, (req,res) => {
  const rows = query('SELECT * FROM persons WHERE id=?',[req.params.id]);
  if (!rows.length) return res.status(404).json({error:'Not found'});
  res.json({...rows[0], documents: query('SELECT * FROM documents WHERE person_id=?',[req.params.id])});
});

app.post('/api/persons', auth, (req,res) => {
  const {father_name,epic_no='',ration_card='',aadhaar='',dob='',dod='',bank_ac='',cif=''} = req.body;
  if (!father_name) return res.status(400).json({error:"Father's name is required"});
  run(`INSERT INTO persons (father_name,epic_no,ration_card,aadhaar,dob,dod,bank_ac,cif) VALUES (?,?,?,?,?,?,?,?)`,[father_name,epic_no,ration_card,aadhaar,dob,dod,bank_ac,cif]);
  res.status(201).json(query('SELECT * FROM persons WHERE id=?',[getLastId()])[0]);
});

app.put('/api/persons/:id', auth, (req,res) => {
  const {father_name,epic_no='',ration_card='',aadhaar='',dob='',dod='',bank_ac='',cif=''} = req.body;
  if (!query('SELECT id FROM persons WHERE id=?',[req.params.id]).length) return res.status(404).json({error:'Not found'});
  run(`UPDATE persons SET father_name=?,epic_no=?,ration_card=?,aadhaar=?,dob=?,dod=?,bank_ac=?,cif=?,updated_at=datetime('now') WHERE id=?`,[father_name,epic_no,ration_card,aadhaar,dob,dod,bank_ac,cif,req.params.id]);
  res.json(query('SELECT * FROM persons WHERE id=?',[req.params.id])[0]);
});

app.delete('/api/persons/:id', auth, (req,res) => {
  if (!query('SELECT id FROM persons WHERE id=?',[req.params.id]).length) return res.status(404).json({error:'Not found'});
  query('SELECT * FROM documents WHERE person_id=?',[req.params.id]).forEach(doc => { try { fs.unlinkSync(path.join(UPLOADS_DIR,doc.stored_name)); } catch(e){} });
  run('DELETE FROM documents WHERE person_id=?',[req.params.id]);
  run('DELETE FROM persons WHERE id=?',[req.params.id]);
  res.json({success:true});
});

app.post('/api/persons/:id/documents', auth, upload.array('documents',10), (req,res) => {
  if (!query('SELECT id FROM persons WHERE id=?',[req.params.id]).length) return res.status(404).json({error:'Not found'});
  if (!req.files?.length) return res.status(400).json({error:'No files'});
  const inserted = req.files.map(file => {
    run(`INSERT INTO documents (person_id,original_name,stored_name,file_type,file_size) VALUES (?,?,?,?,?)`,[req.params.id,file.originalname,file.filename,file.mimetype,file.size]);
    return query('SELECT * FROM documents WHERE id=?',[getLastId()])[0];
  });
  res.status(201).json(inserted);
});

app.get('/api/documents/:id/download', auth, (req,res) => {
  const rows = query('SELECT * FROM documents WHERE id=?',[req.params.id]);
  if (!rows.length) return res.status(404).json({error:'Not found'});
  const fp = path.join(UPLOADS_DIR,rows[0].stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({error:'File missing'});
  res.download(fp, rows[0].original_name);
});

app.delete('/api/documents/:id', auth, (req,res) => {
  const rows = query('SELECT * FROM documents WHERE id=?',[req.params.id]);
  if (!rows.length) return res.status(404).json({error:'Not found'});
  try { fs.unlinkSync(path.join(UPLOADS_DIR,rows[0].stored_name)); } catch(e){}
  run('DELETE FROM documents WHERE id=?',[req.params.id]);
  res.json({success:true});
});

app.get('/api/stats', auth, (req,res) => {
  res.json({
    total_persons: query('SELECT COUNT(*) as c FROM persons')[0].c,
    deceased: query("SELECT COUNT(*) as c FROM persons WHERE dod IS NOT NULL AND dod != ''")[0].c,
    total_documents: query('SELECT COUNT(*) as c FROM documents')[0].c
  });
});

initDB().then(() => app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`)));
