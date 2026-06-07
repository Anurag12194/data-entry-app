# Records Entry System — Deployment Guide

## Project Structure
```
data-entry-app/
├── server.js          ← Express backend + API
├── package.json
├── records.db         ← SQLite database (auto-created on first run)
├── uploads/           ← Uploaded documents (auto-created)
└── public/
    └── index.html     ← Full frontend SPA
```

---

## Option A — Local Development (Test on your machine)

### Prerequisites
- Node.js 18+ installed → https://nodejs.org
- Terminal / Command Prompt

### Steps
```bash
# 1. Enter the project folder
cd data-entry-app

# 2. Install dependencies
npm install

# 3. Start the server
npm start

# 4. Open in browser
# Visit: http://localhost:3000
```

---

## Option B — Deploy on Railway (Free, Recommended)

Railway is the simplest way to get this live at a public URL.

### Steps

1. **Create a free account** at https://railway.app

2. **Install Railway CLI** (optional, or use the web UI):
   ```bash
   npm install -g @railway/cli
   railway login
   ```

3. **Push your project to GitHub first** (Railway deploys from Git):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   # Create a new repo on github.com, then:
   git remote add origin https://github.com/YOUR_USERNAME/data-entry-app.git
   git push -u origin main
   ```

4. **In Railway dashboard:**
   - Click **New Project → Deploy from GitHub repo**
   - Select your `data-entry-app` repository
   - Railway auto-detects Node.js and runs `npm start`
   - Your app gets a public URL like `https://data-entry-app-production.up.railway.app`

5. **Environment variable (optional):**
   - In Railway → Variables, add: `PORT = 3000`

> ⚠️ **Persistent Storage Note:** Railway's free tier uses ephemeral storage. For production, add a Railway Volume or switch to a hosted database (see Option D).

---

## Option C — Deploy on Render (Free tier available)

1. Push code to GitHub (same as above)
2. Go to https://render.com → **New Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Click **Create Web Service**
6. You'll get a URL like `https://data-entry-app.onrender.com`

> ⚠️ Free tier spins down after 15 minutes of inactivity (cold start ~30s).

---

## Option D — Deploy on a VPS (DigitalOcean / Hetzner / Contabo)

Best for production with persistent data.

### Steps (Ubuntu 22.04)

```bash
# 1. SSH into your server
ssh root@YOUR_SERVER_IP

# 2. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install PM2 (process manager)
sudo npm install -g pm2

# 4. Upload your project (from local machine):
scp -r data-entry-app/ root@YOUR_SERVER_IP:/var/www/

# 5. On the server:
cd /var/www/data-entry-app
npm install
pm2 start server.js --name "records-app"
pm2 save
pm2 startup   # Auto-start on reboot

# 6. Install Nginx as reverse proxy
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/records-app
```

Nginx config:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/records-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 7. Add HTTPS with Let's Encrypt (free SSL)
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

---

## Option E — Deploy on Heroku

```bash
# Install Heroku CLI, then:
heroku login
heroku create my-records-app
git push heroku main
heroku open
```

Add a `Procfile` in the project root:
```
web: node server.js
```

> ⚠️ Heroku's ephemeral filesystem loses uploaded files on dyno restart. Use Cloudinary or S3 for file storage in production.

---

## Security Checklist for Production

- [ ] Add authentication (username/password) — consider `express-session` + `bcrypt`
- [ ] Use HTTPS (free with Let's Encrypt)
- [ ] Set `NODE_ENV=production` environment variable
- [ ] Restrict CORS to your domain: `app.use(cors({ origin: 'https://yourdomain.com' }))`
- [ ] Add rate limiting: `npm install express-rate-limit`
- [ ] Store `uploads/` on a persistent volume or cloud storage (S3, Cloudinary)
- [ ] Regular database backups: `cp records.db records.db.backup`
- [ ] Consider PostgreSQL instead of SQLite for multi-user production use

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/persons` | List all records (supports `?search=`, `?page=`, `?limit=`) |
| GET | `/api/persons/:id` | Get single record with documents |
| POST | `/api/persons` | Create new record |
| PUT | `/api/persons/:id` | Update record |
| DELETE | `/api/persons/:id` | Delete record + all documents |
| POST | `/api/persons/:id/documents` | Upload documents (multipart, field: `documents`) |
| GET | `/api/documents/:id/download` | Download a document |
| DELETE | `/api/documents/:id` | Delete a document |
| GET | `/api/stats` | Get total counts |

---

## Database Schema

```sql
-- persons table
CREATE TABLE persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  father_name TEXT NOT NULL,
  epic_no TEXT,          -- Voter ID
  ration_card TEXT,
  aadhaar TEXT,
  dob TEXT,              -- Date of Birth (YYYY-MM-DD)
  dod TEXT,              -- Date of Death (YYYY-MM-DD), NULL if alive
  bank_ac TEXT,          -- Bank Account Number
  cif TEXT,              -- Customer Information File No
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- documents table
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,   -- Original filename
  stored_name TEXT NOT NULL,     -- Stored filename (unique)
  file_type TEXT,                -- MIME type
  file_size INTEGER,             -- Size in bytes
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);
```
