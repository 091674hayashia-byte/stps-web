const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- データ読み込み（MDBエクスポートJSON） ----
function readJSON(file) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw);
  } catch { return []; }
}

// ---- ユーザーデータ：PostgreSQL or JSONファイル ----
const USE_DB = !!process.env.DATABASE_URL;
let pgPool = null;

if (USE_DB) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  // テーブル初期化
  pgPool.query(`
    CREATE TABLE IF NOT EXISTS user_menus (
      id BIGINT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(e => console.error('DB init error:', e));
}

async function readUserMenus() {
  if (USE_DB) {
    const res = await pgPool.query('SELECT data FROM user_menus ORDER BY (data->>\'作成日時\') DESC');
    return res.rows.map(r => r.data);
  }
  const file = path.join(DATA_DIR, 'user_menus.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

async function writeUserMenu(menu) {
  if (USE_DB) {
    await pgPool.query(
      'INSERT INTO user_menus (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data=$2',
      [menu._id, JSON.stringify(menu)]
    );
  } else {
    const file = path.join(DATA_DIR, 'user_menus.json');
    let menus = [];
    if (fs.existsSync(file)) { try { menus = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
    const idx = menus.findIndex(m => m._id == menu._id);
    if (idx >= 0) menus[idx] = menu; else menus.push(menu);
    fs.writeFileSync(file, JSON.stringify(menus, null, 2), 'utf8');
  }
}

async function deleteUserMenu(id) {
  if (USE_DB) {
    await pgPool.query('DELETE FROM user_menus WHERE id=$1', [id]);
  } else {
    const file = path.join(DATA_DIR, 'user_menus.json');
    if (!fs.existsSync(file)) return;
    const menus = JSON.parse(fs.readFileSync(file, 'utf8')).filter(m => m._id != id);
    fs.writeFileSync(file, JSON.stringify(menus, null, 2), 'utf8');
  }
}

// ---- マスターデータAPI ----
app.get('/api/exercises',   (req, res) => res.json(readJSON('exercises.json')));
app.get('/api/intensities', (req, res) => res.json(readJSON('intensities.json')));
app.get('/api/categories',  (req, res) => res.json(readJSON('categories.json')));
app.get('/api/distances',   (req, res) => res.json(readJSON('distances.json')));
app.get('/api/parts',       (req, res) => res.json(readJSON('parts.json')));
app.get('/api/bunrui',      (req, res) => res.json(readJSON('bunrui.json')));

// ---- 練習日誌API ----
app.get('/api/menus', async (req, res) => {
  try {
    const mdbMenus  = readJSON('menus.json').map(m => ({ ...m, _source: 'mdb' }));
    const userMenus = (await readUserMenus()).map(m => ({ ...m, _source: 'user' }));
    const all = [...mdbMenus, ...userMenus].sort((a, b) =>
      new Date(b['日付'] || b.date || 0) - new Date(a['日付'] || a.date || 0)
    );
    res.json(all);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/menus', async (req, res) => {
  try {
    const menu = { ...req.body, _id: Date.now(), _source: 'user', 作成日時: new Date().toISOString() };
    await writeUserMenu(menu);
    res.json({ ok: true, data: menu });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/menus/:id', async (req, res) => {
  try {
    const menus = await readUserMenus();
    const existing = menus.find(m => m._id == req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const updated = { ...existing, ...req.body };
    await writeUserMenu(updated);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/menus/:id', async (req, res) => {
  try {
    await deleteUserMenu(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 統計API ----
app.get('/api/stats', (req, res) => {
  const menus = readJSON('menus.json');
  const yearly = {};
  for (const m of menus) {
    const y = m['年'] || (m['日付'] ? new Date(m['日付']).getFullYear() : null);
    if (!y) continue;
    if (!yearly[y]) yearly[y] = { year: y, count: 0, totalDistance: 0, totalTime: 0 };
    yearly[y].count++;
    yearly[y].totalDistance += m['トータル距離'] || 0;
    yearly[y].totalTime += m['トータル時間'] || 0;
  }
  res.json(Object.values(yearly).sort((a, b) => a.year - b.year));
});

app.listen(PORT, () => {
  console.log(`STPS Web App 起動中 → http://localhost:${PORT}`);
  console.log(USE_DB ? '📦 PostgreSQL モード' : '📁 ローカルJSONモード');
});
