const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Database setup
const db = new Database(path.join(__dirname, 'records.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    father_name TEXT NOT NULL,
    epic_no TEXT,
    ration_card TEXT,
    aadhaar TEXT,
    dob TEXT,
    dod TEXT,
    bank_ac TEXT,
    cif TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
  );
`);

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${file.originalname}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','application/pdf',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Persons CRUD ──────────────────────────────────────────────────────────────

// GET all persons
app.get('/api/persons', (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let query = 'SELECT * FROM persons';
  let countQuery = 'SELECT COUNT(*) as total FROM persons';
  const params = [];

  if (search) {
    const like = `%${search}%`;
    const where = ` WHERE father_name LIKE ? OR epic_no LIKE ? OR ration_card LIKE ? OR aadhaar LIKE ? OR bank_ac LIKE ? OR cif LIKE ?`;
    query += where;
    countQuery += where;
    params.push(like, like, like, like, like, like);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(query).all(...params, Number(limit), Number(offset));
  const { total } = db.prepare(countQuery).get(...params);
  res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
});

// GET single person with documents
app.get('/api/persons/:id', (req, res) => {
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Not found' });
  const docs = db.prepare('SELECT * FROM documents WHERE person_id = ?').all(req.params.id);
  res.json({ ...person, documents: docs });
});

// POST create person
app.post('/api/persons', (req, res) => {
  const { father_name, epic_no, ration_card, aadhaar, dob, dod, bank_ac, cif } = req.body;
  if (!father_name) return res.status(400).json({ error: 'Father\'s name is required' });
  const result = db.prepare(
    `INSERT INTO persons (father_name, epic_no, ration_card, aadhaar, dob, dod, bank_ac, cif)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(father_name, epic_no, ration_card, aadhaar, dob, dod, bank_ac, cif);
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(person);
});

// PUT update person
app.put('/api/persons/:id', (req, res) => {
  const { father_name, epic_no, ration_card, aadhaar, dob, dod, bank_ac, cif } = req.body;
  const existing = db.prepare('SELECT id FROM persons WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    `UPDATE persons SET father_name=?, epic_no=?, ration_card=?, aadhaar=?, dob=?, dod=?, bank_ac=?, cif=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(father_name, epic_no, ration_card, aadhaar, dob, dod, bank_ac, cif, req.params.id);
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  res.json(person);
});

// DELETE person
app.delete('/api/persons/:id', (req, res) => {
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Not found' });
  // Remove associated files
  const docs = db.prepare('SELECT * FROM documents WHERE person_id = ?').all(req.params.id);
  docs.forEach(doc => {
    const fp = path.join(UPLOADS_DIR, doc.stored_name);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Documents ─────────────────────────────────────────────────────────────────

// POST upload documents for a person
app.post('/api/persons/:id/documents', upload.array('documents', 10), (req, res) => {
  const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const inserted = req.files.map(file => {
    const result = db.prepare(
      `INSERT INTO documents (person_id, original_name, stored_name, file_type, file_size)
       VALUES (?, ?, ?, ?, ?)`
    ).run(req.params.id, file.originalname, file.filename, file.mimetype, file.size);
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(result.lastInsertRowid);
  });
  res.status(201).json(inserted);
});

// GET download a document
app.get('/api/documents/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const fp = path.join(UPLOADS_DIR, doc.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File missing on disk' });
  res.download(fp, doc.original_name);
});

// DELETE a document
app.delete('/api/documents/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const fp = path.join(UPLOADS_DIR, doc.stored_name);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM persons').get().c;
  const withDOD = db.prepare("SELECT COUNT(*) as c FROM persons WHERE dod IS NOT NULL AND dod != ''").get().c;
  const docs = db.prepare('SELECT COUNT(*) as c FROM documents').get().c;
  res.json({ total_persons: total, deceased: withDOD, total_documents: docs });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
