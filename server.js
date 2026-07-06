const express = require('express');
const fs = require('fs');
const path = require('path');
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// ---- ユーザー材料データ：PostgreSQL or JSONファイル ----
if (USE_DB) {
  pgPool.query(`
    CREATE TABLE IF NOT EXISTS user_exercises (
      id BIGINT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(e => console.error('DB init error (exercises):', e));
}

async function readUserExercises() {
  if (USE_DB) {
    const res = await pgPool.query('SELECT data FROM user_exercises ORDER BY id DESC');
    return res.rows.map(r => r.data);
  }
  const file = path.join(DATA_DIR, 'user_exercises.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

async function writeUserExercise(ex) {
  if (USE_DB) {
    await pgPool.query(
      'INSERT INTO user_exercises (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data=$2',
      [ex._id, JSON.stringify(ex)]
    );
  } else {
    const file = path.join(DATA_DIR, 'user_exercises.json');
    let items = [];
    if (fs.existsSync(file)) { try { items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
    const idx = items.findIndex(m => m._id == ex._id);
    if (idx >= 0) items[idx] = ex; else items.push(ex);
    fs.writeFileSync(file, JSON.stringify(items, null, 2), 'utf8');
  }
}

async function deleteUserExercise(id) {
  if (USE_DB) {
    await pgPool.query('DELETE FROM user_exercises WHERE id=$1', [id]);
  } else {
    const file = path.join(DATA_DIR, 'user_exercises.json');
    if (!fs.existsSync(file)) return;
    const items = JSON.parse(fs.readFileSync(file, 'utf8')).filter(m => m._id != id);
    fs.writeFileSync(file, JSON.stringify(items, null, 2), 'utf8');
  }
}

// ---- マスターデータAPI ----
app.get('/api/exercises', async (req, res) => {
  try {
    const mdb  = readJSON('exercises.json').map(e => ({ ...e, _source: 'mdb' }));
    const user = (await readUserExercises()).map(e => ({ ...e, _source: 'user' }));
    res.json([...mdb, ...user]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/exercises', async (req, res) => {
  try {
    const mdb  = readJSON('exercises.json');
    const user = await readUserExercises();
    const allIds = [...mdb, ...user].map(e => parseInt(e.ID || e.id || e._id) || 0);
    const nextId = (allIds.length ? Math.max(...allIds) : 0) + 1;
    const ex = { ...req.body, _id: nextId, ID: nextId, _source: 'user', 作成日時: new Date().toISOString() };
    await writeUserExercise(ex);
    res.json({ ok: true, data: ex });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/exercises/:id', async (req, res) => {
  try {
    const items = await readUserExercises();
    const existing = items.find(m => m._id == req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const updated = { ...existing, ...req.body };
    await writeUserExercise(updated);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/exercises/:id', async (req, res) => {
  try {
    await deleteUserExercise(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

// ---- 写真解析API ----
app.post('/api/analyze-photo', upload.single('photo'), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'APIキーが設定されていません' });
  if (!req.file) return res.status(400).json({ error: '画像がありません' });
  try {
    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype || 'image/jpeg';
    const mode = req.body.mode || 'menu'; // 'menu' or 'material'

    const prompt = mode === 'material'
      ? `この画像は水泳の練習材料（個別のセット練習）の写真です。
以下のJSON形式で内容を抽出してください。複数のセットがある場合は配列で返してください。

各フィールドの意味：
- "種目": 泳法の種類（"Swim"/"Kick"/"Pull"/"IM"/"W-up"/"Down"/"Presets" など）← 泳ぎ方の種類のみ
- "練習": 距離×本数のセット表記のみ（例："100x8"、"50x20"）← 数字とxだけの形式
- "内容": 泳ぎ方・種目以外の詳細・条件（例："Descend 1-4"、"Ave-H"、"1-2Des"）← 種目名は含めない
- "サイクル": インターバルのサイクルタイム（例："1'30"、"2'"）
- "トータル": このセットの合計距離（メートルの整数値のみ、例：800）
- "全時間": このセットの合計時間（秒の整数値のみ、例：720）
- "練習パターン": 強度を示す整数（2=AE, 3=EN1, 4=EN2, 5=EN3, 6=AN1, 7=AN2, 8=AN3）
- "分類": メニュー分類の整数（1=Main, 2=Sub, 3=Drill, 4=Kick, 5=Pull, 6=IM, 7=Sprint, 8=Easy）

[
  {
    "種目": "泳法種類（例：Swim）",
    "練習": "距離x本数（例：100x8）",
    "内容": "詳細・条件（例：Descend 1-4）",
    "サイクル": "サイクルタイム（例：1'30）",
    "トータル": 合計距離の整数（単位なし、例：800）,
    "全時間": 合計時間の整数（秒単位、例：720）,
    "練習パターン": 強度の整数（例：4）,
    "分類": 分類の整数（例：1）
  }
]

JSONのみ返してください。`
      : `この画像は水泳の練習メニューの写真です。
以下のJSON形式で内容を抽出してください。

各フィールドの意味：
- "練習": 距離×本数のセット表記のみ（例："100x8"、"50x20"）← 数字とxだけの形式
- "内容": 泳ぎ方・条件・詳細（例："Descend 1-4"、"Ave-H"、"Free Style"）
- "サイクル": インターバルのサイクルタイム（例："1'30"、"2'"）
- "トータル": そのセットの合計距離（メートルの整数値のみ）
- "全時間": そのセットの合計時間（秒の整数値のみ）
- "練習パターン": 強度を示す整数（2=AE, 3=EN1, 4=EN2, 5=EN3, 6=AN1, 7=AN2, 8=AN3）

{
  "日付": "YYYY-MM-DD形式（不明の場合は今日の日付）",
  "ampm": "AM or PM",
  "一言": "メニュー全体のコメントや目標（あれば）",
  "トータル距離": 合計距離の整数（メートル単位）,
  "トータル時間": 合計時間の整数（分単位）,
  "exercises": [
    {
      "練習": "距離x本数（例：100x8）",
      "内容": "泳ぎ方・条件（例：Descend 1-4）",
      "サイクル": "サイクルタイム（例：1'30）",
      "トータル": 合計距離の整数（単位なし）,
      "全時間": 合計時間の整数（秒単位）,
      "練習パターン": 強度の整数（例：4）
    }
  ]
}

JSONのみ返してください。`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(422).json({ error: '解析結果を取得できませんでした' });
    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ ok: true, data: parsed, mode });
  } catch (e) {
    console.error('analyze-photo error:', e);
    res.status(500).json({ error: e.message });
  }
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
