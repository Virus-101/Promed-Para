const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const autostart = require('./autostart');
const { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('crypto');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__filename);
const PUBLIC = path.join(ROOT, 'public');
const LEGACY_EXPORT_PATH = String.raw`F:\para\Articles_15-10-2026 22-35-00-touts-ar.csv`;
// Keep the live database on the workstation even when the app itself runs from USB.
const DATA_DIR = path.resolve(process.env.PROMEDPARA_DATA_DIR || path.join(ROOT, 'data'));
const execFileAsync = promisify(execFile);
const RELAY_URL = 'https://promedpara-relay.onrender.com';   // the owner-phone relay (relay/ folder); can be changed in data/relay.json
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version || ''; } catch { return ''; } })();
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'promedpara.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('owner','cashier')), password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    can_receive_stock INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, barcode TEXT UNIQUE, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT 'unité', quantity REAL NOT NULL DEFAULT 0,
    reorder_level REAL NOT NULL DEFAULT 0, price_cents INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0, image_url TEXT NOT NULL DEFAULT '', supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
    active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS products_name_idx ON products(name);
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
    total_cents INTEGER NOT NULL, payment TEXT NOT NULL, received_cents INTEGER NOT NULL DEFAULT 0,
    change_cents INTEGER NOT NULL DEFAULT 0, cashier_id TEXT NOT NULL REFERENCES users(id), cashier_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sale_lines (
    id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL, name TEXT NOT NULL, sku TEXT NOT NULL, qty REAL NOT NULL,
    unit TEXT NOT NULL, unit_price_cents INTEGER NOT NULL, line_total_cents INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, product_name TEXT NOT NULL,
    kind TEXT NOT NULL, quantity_delta REAL NOT NULL, reference TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id), user_name TEXT NOT NULL,
    supplier_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL,
    created_at TEXT NOT NULL, read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS worker_devices (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secret_hex TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    last_accepted_step INTEGER NOT NULL DEFAULT -1, created_at TEXT NOT NULL, last_seen_at TEXT
  );
  CREATE TABLE IF NOT EXISTS worker_pairings (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS worker_recovery_codes (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS product_imports (
    id TEXT PRIMARY KEY, source_name TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
    rows_seen INTEGER NOT NULL, rows_added INTEGER NOT NULL, created_at TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS business_settings (
    setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL DEFAULT ''
  );
`);
// Upgrade workstation databases created by earlier PromedPara builds.
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'can_receive_stock')) {
  db.exec('ALTER TABLE users ADD COLUMN can_receive_stock INTEGER NOT NULL DEFAULT 0');
}
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'can_add_products')) {
  db.exec('ALTER TABLE users ADD COLUMN can_add_products INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE users ADD COLUMN add_products_until TEXT');
}
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  db.exec("UPDATE users SET is_admin=1 WHERE id=(SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1)");
}
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'recovery_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN recovery_hash TEXT');
}
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'pin_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN pin_hash TEXT');
}
db.exec(`CREATE TABLE IF NOT EXISTS unknown_scans (code TEXT PRIMARY KEY, scans INTEGER NOT NULL DEFAULT 1, first_at TEXT NOT NULL, last_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS owner_devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS owner_pairings (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);`);
if (!db.prepare('PRAGMA table_info(products)').all().some(column => column.name === 'image_url')) {
  db.exec("ALTER TABLE products ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const sessions = new Map();
const eventClients = new Set();
const pendingProductImports = new Map();
let deviceCache = null;
let deviceCacheAt = 0;
db.prepare("INSERT OR IGNORE INTO business_settings(setting_key,setting_value) VALUES('shop_whatsapp','')").run();
db.prepare("INSERT OR IGNORE INTO business_settings(setting_key,setting_value) VALUES('shop_delivery_note','Livraison et disponibilité confirmées avec la boutique.')").run();
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.apk': 'application/vnd.android.package-archive' };

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const isoNow = () => new Date().toISOString();
const id = prefix => `${prefix}_${randomUUID()}`;
const clean = (v, max = 180) => String(v ?? '').trim().slice(0, max);
const safeImageUrl = value => {
  const raw = clean(value, 1000);
  if (!raw) return '';
  try { const parsed = new URL(raw); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; }
  catch { return ''; }
};
const cents = value => Math.round(Number(value || 0) * 100);
const money = value => (Number(value || 0) / 100).toFixed(2);
// Temporary, owner-granted right for a cashier to create new products. Expires on its own.
const productAccess = userId => {
  const row = db.prepare('SELECT can_add_products, add_products_until FROM users WHERE id=?').get(userId);
  return Boolean(row && row.can_add_products && row.add_products_until && row.add_products_until > isoNow());
};
const accountFlags = userId => db.prepare('SELECT is_admin, must_change_password, (pin_hash IS NOT NULL) AS has_pin FROM users WHERE id=?').get(userId) || {};
const weakPin = pin => /^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin);
const pinTaken = (pin, exceptId) => db.prepare('SELECT id FROM users WHERE active=1 AND pin_hash IS NOT NULL AND id<>?').all(exceptId || '').length > 0 && db.prepare('SELECT id,pin_hash FROM users WHERE active=1 AND pin_hash IS NOT NULL AND id<>?').all(exceptId || '').some(row => passwordMatches(pin, row.pin_hash));
const randomPin = exceptId => { for (let tries = 0; tries < 80; tries++) { const pin = String(randomBytes(4).readUInt32BE() % 900000 + 100000); if (!weakPin(pin) && !pinTaken(pin, exceptId)) return pin; } throw new HttpError(500, 'Impossible de générer un code, réessayez.'); };
const checkNewPin = (pin, exceptId) => {
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 32) throw new HttpError(400, 'Le code doit contenir entre 4 et 32 caractères (chiffres, lettres ou symboles).');
  if (pinTaken(pin, exceptId)) throw new HttpError(409, 'Ce code est déjà utilisé par quelqu’un d’autre. Choisissez-en un autre.');
};
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRecoveryKey = () => { const bytes = randomBytes(16); let key = ''; for (let i = 0; i < 16; i++) { key += RECOVERY_ALPHABET[bytes[i] % 32]; if (i % 4 === 3 && i < 15) key += '-'; } return key; };
const uniqueUsername = name => {
  let base = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
  if (base.length < 3) base = 'employe';
  let candidate = base, n = 1;
  while (db.prepare('SELECT 1 FROM users WHERE username=?').get(candidate)) candidate = base + (++n);
  return candidate;
};
const normRecovery = key => String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isAdmin = userId => Boolean(accountFlags(userId).is_admin);
const userSafe = user => { const flags = accountFlags(user.id); return { id: user.id, name: user.name, username: user.username, role: user.role, canReceiveStock: Boolean(user.can_receive_stock), canAddProducts: user.role !== 'owner' && productAccess(user.id), isAdmin: Boolean(flags.is_admin), mustChangePassword: Boolean(flags.must_change_password), hasPin: Boolean(flags.has_pin), mustSetPin: user.role === 'owner' && (Boolean(flags.must_change_password) || !flags.has_pin), phones: user.role === 'owner' ? db.prepare('SELECT id,name,last_seen_at FROM owner_devices WHERE user_id=? AND active=1 ORDER BY created_at DESC').all(user.id) : undefined }; };
const setting = key => db.prepare('SELECT setting_value FROM business_settings WHERE setting_key=?').get(key)?.setting_value || '';
const passwordHash = password => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
};
const passwordMatches = (password, stored) => {
  try {
    const [saltHex, hashHex] = stored.split(':');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
};
const cookieToken = request => {
  const cookie = request.headers.cookie || '';
  const value = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('pp_session='));
  return value ? decodeURIComponent(value.slice('pp_session='.length)) : '';
};
const currentUser = request => {
  const session = sessions.get(cookieToken(request));
  if (!session || session.expires < Date.now()) return null;
  const row = db.prepare('SELECT id,name,username,role,active,can_receive_stock FROM users WHERE id=?').get(session.userId);
  return row ? Object.assign({}, row, { scope: session.scope || 'full' }) : null;
};
const requireUser = request => {
  const user = currentUser(request);
  if (!user || !user.active) throw new HttpError(401, 'Connectez-vous pour continuer.');
  // a phone that only proved its device token (no personal code) may receive alerts, nothing else
  if (user.scope === 'alerts' && !/^\/api\/(notifications|events|me|logout|owner\/)/.test(String(request.url || '').split('?')[0])) throw new HttpError(403, 'Entrez votre code personnel dans l’application pour voir les données.');
  lastActivityAt = Date.now();
  return user;
};
const requireOwner = request => {
  const user = requireUser(request);
  if (user.role !== 'owner') throw new HttpError(403, 'Accès réservé au propriétaire.');
  return user;
};
const send = (response, status, data, headers = {}) => {
  // whatever was changed is on disk BEFORE the till says "done": a power cut right after a sale cannot lose it
  if (typeof db.flushNow === 'function') db.flushNow();
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(JSON.stringify(data));
};
const readBody = request => new Promise((resolve, reject) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; if (raw.length > 10_000_000) { reject(new HttpError(413, 'Le fichier est trop volumineux.')); request.destroy(); } });
  request.on('end', () => {
    if (!raw) return resolve({});
    try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'Données JSON invalides.')); }
  });
  request.on('error', reject);
});
const parseCsvGrid = text => {
  text = String(text || '').replace(/^\uFEFF/, '');
  // the column names may come after a title line: find the product-list header in the first lines and read with ITS delimiter
  const head = text.split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 8);
  let delimiter = null, headerIndex = 0;
  for (const candidate of [';', '\t', ',']) {
    const at = head.findIndex(line => isLegacyHeader(line.split(candidate).map(normHeader)));
    if (at >= 0 && (delimiter === null || at < headerIndex)) { delimiter = candidate; headerIndex = at; }
  }
  if (delimiter === null) { const first = head[0] || ''; delimiter = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]; headerIndex = 0; }
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new HttpError(400, 'Le CSV contient une cellule avec des guillemets non fermés.');
  row.push(cell.trim()); if (row.some(value => value !== '')) rows.push(row);
  if (headerIndex > 0) rows.splice(0, headerIndex);
  if (rows.length < 2 || rows.length > 100_001) throw new HttpError(400, 'Le CSV doit contenir un en-tête et au maximum 100 000 lignes.');
  return rows;
};
const normalizeProductName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g, ' ').trim();
const csvNumber = value => {
  const normalized = String(value ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.');
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
};
const notifyOwners = event => {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of eventClients) { try { response.write(payload); } catch { eventClients.delete(response); } }
};
const createNotification = (title, body, kind) => {
  const notification = { id: id('notice'), title, body, kind, createdAt: isoNow() };
  db.prepare('INSERT INTO notifications(id,title,body,kind,created_at) VALUES(?,?,?,?,?)').run(notification.id, title, body, kind, notification.createdAt);
  notification.sequence = Number(db.prepare('SELECT last_insert_rowid() AS n').get().n);
  notifyOwners({ type: 'notification', notification });
};
const tableHas = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const firstRun = () => Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n) === 0;
const isLoopback = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
// requests that arrive through the internet relay come from 127.0.0.1 too, but carry this header: they are never the till itself
const isLocal = request => isLoopback(request.socket.remoteAddress) && !request.headers['x-promed-relay'];
const livePairingCodes = new Map();
const ownerPairTries = new Map(), ownerUnlockFails = new Map();
// QR login: the till shows a QR code, the worker's paired phone approves it with a proof only that phone can compute
const qrChallenges = new Map(), qrById = new Map();
let ringTimes = [];
const activePairingCodes = () => { const now = Date.now(); for (const [code, until] of livePairingCodes) if (until < now) livePairingCodes.delete(code); return Array.from(livePairingCodes.keys()); };
let remoteLink = { enabled: false, connected: false, address: '' };
let startRemote = () => {};
let legacyDbJob = null;

// ---- security of this till: an owner signing in on the till itself can be made to approve it on their own phone
const securityFile = path.join(DATA_DIR, 'security.json');
const loadSecurity = () => { try { return JSON.parse(fs.readFileSync(securityFile, 'utf8')) || {}; } catch (error) { return {}; } };
const saveSecurity = value => fs.writeFileSync(securityFile, JSON.stringify(value, null, 2));
const loginApprovals = new Map();      // id -> { userId, name, wait, status, createdAt }
const APPROVAL_MS = 120_000;
const purgeApprovals = () => { const now = Date.now(); for (const [key, entry] of loginApprovals) if (now - entry.createdAt > APPROVAL_MS + 60_000) loginApprovals.delete(key); };
const ownerUrls = () => ['127.0.0.1','localhost','::1'].includes(HOST) ? [] : Object.values(os.networkInterfaces()).flat().filter(item=>item?.family==='IPv4'&&!item.internal&&!item.address.startsWith('169.254.')).map(item=>`http://${item.address}:${PORT}`);
const attemptWindows = new Map();
let pinFailures = [];
let recoveryFailures = [];
let lastActivityAt = Date.now();
function rateLimit(request, action, max = 12, windowMs = 60_000) {
  const key = `${action}:${request.socket.remoteAddress || 'unknown'}`;
  const now = Date.now(), recent = (attemptWindows.get(key) || []).filter(at => now - at < windowMs);
  if (recent.length >= max) throw new HttpError(429, 'Trop de tentatives. Attendez une minute puis réessayez.');
  recent.push(now); attemptWindows.set(key, recent);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const totpAt = (secretHex, step) => {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(secretHex, 'hex')).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
};
const shopClock = () => { const now = new Date(); return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'); };   // the till's own clock, same as its screen
const createSession = (user, scope) => {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { userId: user.id, expires: Date.now() + 12 * 60 * 60_000, scope: scope || 'full' });
  if (user.role === 'cashier') createNotification('Employé connecté', `${user.name} · a ouvert la caisse`, 'staff');
  return { 'Set-Cookie': `pp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 60 * 60}` };
};

// ---- Detection of the previous software's product export (LOGICA writes "Articles_<date>...csv": Article, Famille, PRIX_A, PRIX_V, Qté, Alert)
const legacyFiles = new Map();
const legacyIdOf = file => createHash('sha256').update(file.toLowerCase()).digest('hex').slice(0, 12);
const LEGACY_NAME_COLUMNS = ['article', 'designation', 'libelle', 'libellearticle', 'produit', 'nomproduit', 'nom', 'denomination', 'medicament', 'specialite'];
const LEGACY_PRICE_COLUMNS = ['prixv', 'prixvente', 'prixa', 'prixachat', 'pv', 'pa', 'prix', 'ppv', 'pph', 'prixttc', 'prixht', 'pvttc', 'puttc', 'tarif', 'prixpublic'];
const OLD_APP_FOLDER = /(logica|winpharma|pharmagest|lgpi|pharmony|officine|pharmacie|parapharm|winstock)/i;
const normHeader = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A product-list header: at least 3 columns, a name column and a price column. Notes, READMEs, customer lists and accounting files never match.
const isLegacyHeader = cells => cells.length >= 3 && cells.some(cell => LEGACY_NAME_COLUMNS.includes(cell)) && cells.some(cell => LEGACY_PRICE_COLUMNS.includes(cell));
// Old software often writes a title line or two before the column names: look at the first lines, with any delimiter.
async function looksLikeLegacyExport(file) {
  try {
    const handle = await fs.promises.open(file, 'r'), buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, 8192, 0); await handle.close();
    const head = buf.slice(0, bytesRead), text = head.length > 1 && head[0] === 0xFF && head[1] === 0xFE ? head.toString('utf16le') : head.toString('latin1');
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 8);
    return lines.some(line => [';', ',', '\t'].some(delimiter => isLegacyHeader(line.split(delimiter).map(normHeader))));
  } catch { return false; }
}
// Asynchronous on purpose: on the shop PC the scan can take seconds and the till must keep answering meanwhile.
// quick: user folders, drive roots and the old software's own folder. deep: much further down every folder (a minute at most).
async function scanLegacyExports(deep, progress) {
  progress = progress || {}; progress.found = progress.found || []; progress.oldApp = progress.oldApp || []; progress.stage = 'Recherche du dossier de l’ancien logiciel…'; progress.visited = 0; progress.rootsDone = 0; progress.rootsTotal = 0; progress.current = '';
  const started = Date.now(), limitMs = deep ? 45000 : 9000, limitEntries = deep ? 200000 : 25000, found = new Map(), searched = [], oldApp = new Set(); let visited = 0;
  const skipDir = /^(windows|program files|program files \(x86\)|programdata|\$recycle\.bin|system volume information|node_modules|promedpara|appdata|recovery|perflogs|msocache|\.git|android|sdk)$/i;
  const walk = async (dir, depth) => {
    if (Date.now() - started > limitMs || visited > limitEntries) return;
    progress.current = dir; progress.visited = visited;
    let entries; try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        visited++;
        if (!/\.(csv|txt)$/i.test(entry.name)) continue;
        try {
          const stat = await fs.promises.stat(full);
          if (stat.size > 0 && stat.size <= 30 * 1024 * 1024 && await looksLikeLegacyExport(full)) { found.set(full.toLowerCase(), { file: full, stat }); progress.found.push({ fileName: entry.name, folder: dir, size: stat.size, modifiedAt: stat.mtime.toISOString() }); }
        } catch { }
      } else if (entry.isDirectory() && depth > 0 && !skipDir.test(entry.name)) await walk(full, depth - 1);
    }
  };
  const roots = [];
  const addRoot = (dir, depth) => { searched.push(dir); roots.push([dir, depth]); };
  for (const extra of String(process.env.PROMEDPARA_LEGACY_DIRS || '').split(';').filter(Boolean)) addRoot(extra, deep ? 6 : 3);
  const systemDrive = process.env.SystemDrive || 'C:';
  try { for (const user of fs.readdirSync(systemDrive + '\\Users')) for (const sub of ['Desktop', 'Documents', 'Downloads']) addRoot(path.join(systemDrive + '\\Users', user, sub), deep ? 6 : 3); } catch { }
  const drives = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const rootDir = letter + ':\\'; if (fs.existsSync(rootDir)) drives.push(rootDir); }
  // find the old software itself (its install or data folder), then look inside it much more thoroughly
  const appParents = [];
  for (const drive of drives) { appParents.push(drive); appParents.push(path.join(drive, 'Program Files')); appParents.push(path.join(drive, 'Program Files (x86)')); appParents.push(path.join(drive, 'ProgramData')); }
  for (const parent of appParents) {
    let entries; try { entries = await fs.promises.readdir(parent, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) if (entry.isDirectory() && OLD_APP_FOLDER.test(entry.name) && !/promedpara/i.test(entry.name)) { const folder = path.join(parent, entry.name); oldApp.add(folder); progress.oldApp = [...oldApp]; addRoot(folder, 6); }
  }
  for (const drive of drives) addRoot(drive, deep ? 5 : 2);
  addRoot(path.dirname(LEGACY_EXPORT_PATH), 3);
  progress.rootsTotal = roots.length;
  for (const [dir, depth] of roots) { progress.stage = 'Vérification de ' + dir; await walk(dir, depth); progress.rootsDone++; }
  progress.visited = visited; progress.stage = 'Terminé'; progress.current = '';
  legacyFiles.clear();
  const rank = ({ file, stat }) => (/^articles/i.test(path.basename(file)) ? 1e15 : 0) + (/(logica|export)/i.test(file) ? 1e14 : 0) + stat.mtimeMs;
  const candidates = [...found.values()].sort((x, y) => rank(y) - rank(x)).slice(0, 12).map(({ file, stat }) => {
    const id = legacyIdOf(file); legacyFiles.set(id, file);
    return { id, fileName: path.basename(file), folder: path.dirname(file), size: stat.size, modifiedAt: stat.mtime.toISOString() };
  });
  return { candidates, oldApp: [...oldApp].slice(0, 6), searched: [...new Set(searched)].slice(0, 20), deep: Boolean(deep), seconds: Math.round((Date.now() - started) / 100) / 10 };
}
// A visible check: one run at a time, with live progress that the screen polls.
let legacyJob = null;
function legacySnapshot() {
  const job = legacyJob;
  if (!job) return { running: false, started: false };
  return { running: job.running, started: true, deep: job.deep, stage: job.stage || '', current: job.current || '', visited: job.visited || 0, rootsDone: job.rootsDone || 0, rootsTotal: job.rootsTotal || 0, found: job.found || [], oldApp: job.oldApp || [], seconds: Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 100) / 10, result: job.running ? null : job.result, error: job.error || '' };
}
function startLegacyJob(deep) {
  if (legacyJob && legacyJob.running) return legacyJob;
  const job = { running: true, deep: Boolean(deep), startedAt: Date.now(), found: [], oldApp: [], result: null, error: '' };
  legacyJob = job;
  scanLegacyExports(job.deep, job).then(result => { job.result = result; job.running = false; job.finishedAt = Date.now(); }).catch(error => { job.error = error.message; job.running = false; job.finishedAt = Date.now(); job.result = { candidates: [], oldApp: [], searched: [], deep: job.deep, seconds: 0 }; });
  return job;
}
// Only a path that the scan itself returned can be read (the browser never supplies a path).
const chosenLegacyPath = id => {
  if (!id) return LEGACY_EXPORT_PATH;
  const file = legacyFiles.get(String(id));
  if (!file) throw new HttpError(404, 'Fichier inconnu : relancez la recherche.');
  return file;
};
async function api(request, response, url) {
  const route = url.pathname;
  if (route === '/api/status' && request.method === 'GET') return send(response, 200, { setupRequired: firstRun(), business: 'PromedPara', version: APP_VERSION, location: 'Errachidia, Maroc', ownerUrls:ownerUrls() });
  if (route === '/api/autostart/status' && request.method === 'GET') { requireOwner(request); return send(response, 200, await autostart.status(process.env.PROMEDPARA_EXE)); }
  if (route === '/api/autostart/enable' && request.method === 'POST') {
    const actor = requireOwner(request);
    if (!isLocal(request)) throw new HttpError(403, 'À activer depuis la caisse elle-même.');
    await autostart.enable(process.env.PROMEDPARA_EXE);
    createNotification('Démarrage automatique activé', 'La caisse s’ouvrira toute seule à l’allumage du PC · par ' + actor.name, 'info');
    return send(response, 200, await autostart.status(process.env.PROMEDPARA_EXE));
  }
  if (route === '/api/legacy-db/scan' && request.method === 'POST') {
    requireOwner(request);
    if (!isLocal(request)) throw new HttpError(403, 'À lancer depuis la caisse elle-même.');
    const body = await readBody(request);
    if (!legacyDbJob || !legacyDbJob.running) {
      const job = { running: true, startedAt: Date.now(), report: null, text: '', error: '' };
      legacyDbJob = job;
      require('./legacy-db').scan({ keyword: clean(body.keyword, 30) || 'logica' }).then(report => {
        job.report = report; job.text = require('./legacy-db').text(report); job.running = false;
        try { fs.writeFileSync(path.join(DATA_DIR, 'rapport-ancien-logiciel.txt'), job.text); } catch (error) { /* the screen still has it */ }
      }).catch(error => { job.error = error.message; job.running = false; });
    }
    return send(response, 200, { running: legacyDbJob.running });
  }
  if (route === '/api/legacy-db/scan' && request.method === 'GET') {
    requireOwner(request);
    const job = legacyDbJob;
    return send(response, 200, job ? { started: true, running: job.running, error: job.error, text: job.text, report: job.report } : { started: false });
  }
  if (route === '/api/legacy-export/check' && request.method === 'POST') {
    requireOwner(request);
    const body = await readBody(request);
    startLegacyJob(Boolean(body.deep));
    return send(response, 200, legacySnapshot());
  }
  if (route === '/api/legacy-export/check' && request.method === 'GET') { requireOwner(request); return send(response, 200, legacySnapshot()); }
  if (route === '/api/legacy-export/scan' && request.method === 'GET') { requireOwner(request); return send(response, 200, await scanLegacyExports(url.searchParams.get('deep') === '1')); }
  if (route === '/api/legacy-export' && request.method === 'GET') {
    requireOwner(request);
    const legacyPath = chosenLegacyPath(url.searchParams.get('id'));
    let stat;
    try { stat = await fs.promises.stat(legacyPath); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(404, `Aucun export trouvé à ${legacyPath}.`);
      throw new HttpError(500, `Impossible de lire l’export à ${legacyPath}.`);
    }
    if (!stat.isFile()) throw new HttpError(404, `Aucun fichier CSV trouvé à ${legacyPath}.`);
    if (stat.size > 20 * 1024 * 1024) throw new HttpError(413, 'Le fichier CSV dépasse la limite de lecture de 20 Mo.');
    let content;
    try { content = await fs.promises.readFile(legacyPath); }
    catch { throw new HttpError(500, `Impossible de lire l’export à ${legacyPath}.`); }
    return send(response, 200, { fileName:path.basename(legacyPath), filePath:legacyPath, size:content.length, modifiedAt:stat.mtime.toISOString(), contentBase64:content.toString('base64') });
  }
  if (route === '/api/setup' && request.method === 'POST') {
    if (!firstRun()) throw new HttpError(409, 'Le propriétaire est déjà configuré.');
    if (!isLocal(request)) throw new HttpError(403, 'Créez le premier propriétaire directement sur le poste de caisse.');
    const body = await readBody(request);
    const name = clean(body.name, 90), username = clean(body.username, 50).toLowerCase(), password = String(body.password || '');
    if (body.pin !== undefined && !body.password) {
      // New first-run flow: administrator with a 6-digit code + a one-time recovery key.
      const pin = String(body.pin).trim();
      if (name.length < 2) throw new HttpError(400, 'Entrez votre nom.');
      checkNewPin(pin, '');
      const adminAccount = { id: id('user'), name, username: username.length >= 3 ? username : 'admin', role: 'owner', password_hash: passwordHash(randomBytes(40).toString('hex')), active: 1, created_at: isoNow() };
      const recoveryKey = newRecoveryKey();
      db.prepare('INSERT INTO users(id,name,username,role,password_hash,active,created_at,is_admin,pin_hash,recovery_hash) VALUES(?,?,?,?,?,?,?,1,?,?)').run(adminAccount.id, adminAccount.name, adminAccount.username, adminAccount.role, adminAccount.password_hash, adminAccount.active, adminAccount.created_at, passwordHash(pin), passwordHash(normRecovery(recoveryKey)));
      return send(response, 201, { user: userSafe(adminAccount), recoveryKey }, createSession(adminAccount));
    }
    if (name.length < 2 || username.length < 3 || password.length < 10) throw new HttpError(400, 'Entrez un nom, un identifiant (3 caractères minimum) et un mot de passe de 10 caractères minimum.');
    const owner = { id: id('user'), name, username, role: 'owner', password_hash: passwordHash(password), active: 1, created_at: isoNow() };
    db.prepare('INSERT INTO users(id,name,username,role,password_hash,active,created_at,is_admin) VALUES(?,?,?,?,?,?,?,1)').run(owner.id, owner.name, owner.username, owner.role, owner.password_hash, owner.active, owner.created_at);
    const token = randomBytes(32).toString('base64url'); sessions.set(token, { userId: owner.id, expires: Date.now() + 30 * 86400_000 });
    return send(response, 201, { user: userSafe(owner) }, { 'Set-Cookie': `pp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}` });
  }
  const needsPhoneApproval = (user, request) => user.role === 'owner' && isLocal(request) && loadSecurity().phoneApproval === true && Boolean(db.prepare('SELECT 1 AS x FROM owner_devices WHERE user_id=? AND active=1').get(user.id));
  const startApproval = (user, response) => {
    purgeApprovals();
    for (const [key, entry] of loginApprovals) if (entry.userId === user.id && entry.status === 'pending') loginApprovals.delete(key);
    const approvalId = randomBytes(8).toString('hex'), wait = randomBytes(12).toString('hex');
    loginApprovals.set(approvalId, { userId: user.id, name: user.name, wait: wait, status: 'pending', createdAt: Date.now() });
    createNotification('Demande de connexion', user.name + ' veut ouvrir la caisse. Ouvrez l’application PromedPara Propriétaire et touchez Approuver.', 'approval');
    return send(response, 202, { approval: { id: approvalId, wait: wait, expiresIn: APPROVAL_MS / 1000 } });
  };
  const approvalWait = /^\/api\/login-approvals\/([a-f0-9]{16})$/.exec(route);
  if (approvalWait && request.method === 'GET') {
    // the till's own sign-in screen asks until the phone answered
    if (!isLocal(request)) throw new HttpError(403, 'Réservé à la caisse.');
    const entry = loginApprovals.get(approvalWait[1]), wait = new URL(request.url, 'http://x').searchParams.get('wait') || '';
    if (entry && Date.now() - entry.createdAt > APPROVAL_MS) loginApprovals.delete(approvalWait[1]);
    if (!entry || entry.wait !== wait || Date.now() - entry.createdAt > APPROVAL_MS) throw new HttpError(410, 'La demande a expiré.');
    if (entry.status === 'pending') return send(response, 200, { status: 'pending' });
    loginApprovals.delete(approvalWait[1]);
    if (entry.status !== 'approved') return send(response, 200, { status: 'refused' });
    const approvedUser = db.prepare('SELECT id,name,username,role,can_receive_stock FROM users WHERE id=? AND active=1').get(entry.userId);
    if (!approvedUser) throw new HttpError(410, 'Compte introuvable.');
    return send(response, 200, { status: 'approved', user: userSafe(approvedUser) }, createSession(approvedUser));
  }
  if (route === '/api/login-approvals' && request.method === 'GET') {
    const me = requireOwner(request);
    if (isLocal(request)) throw new HttpError(403, 'L’approbation se fait sur le téléphone.');
    purgeApprovals();
    const pending = [];
    for (const [key, entry] of loginApprovals) if (entry.userId === me.id && entry.status === 'pending' && Date.now() - entry.createdAt <= APPROVAL_MS) pending.push({ id: key, name: entry.name, at: entry.createdAt });
    return send(response, 200, { pending });
  }
  if (route === '/api/login-approvals/respond' && request.method === 'POST') {
    const me = requireOwner(request);
    if (isLocal(request)) throw new HttpError(403, 'L’approbation se fait sur le téléphone, pas sur la caisse.');
    const body = await readBody(request), entry = loginApprovals.get(String(body.id || ''));
    if (!entry || entry.userId !== me.id || entry.status !== 'pending' || Date.now() - entry.createdAt > APPROVAL_MS) throw new HttpError(410, 'Cette demande a expiré.');
    entry.status = body.decision === 'approve' ? 'approved' : 'refused';
    createNotification(entry.status === 'approved' ? 'Connexion approuvée' : 'Connexion refusée', me.name + ' · depuis le téléphone', 'security');
    return send(response, 200, { ok: true, status: entry.status });
  }
  if (route === '/api/security' && request.method === 'GET') {
    const me = requireOwner(request), security = loadSecurity();
    return send(response, 200, { phoneApproval: security.phoneApproval === true, phones: db.prepare('SELECT COUNT(*) AS n FROM owner_devices WHERE user_id=? AND active=1').get(me.id).n, link: { enabled: remoteLink.enabled, connected: remoteLink.connected }, isAdmin: isAdmin(me.id) });
  }
  if (route === '/api/security' && request.method === 'POST') {
    const me = requireOwner(request), body = await readBody(request);
    if (!isLocal(request)) throw new HttpError(403, 'Réservé à la caisse.');
    if (!isAdmin(me.id)) throw new HttpError(403, 'Seul l’administrateur peut changer ces réglages.');
    const security = loadSecurity();
    if (typeof body.phoneApproval === 'boolean') {
      if (body.phoneApproval && !db.prepare('SELECT 1 AS x FROM owner_devices WHERE user_id=? AND active=1').get(me.id)) throw new HttpError(400, 'Associez d’abord votre téléphone : sinon personne ne pourrait approuver.');
      security.phoneApproval = body.phoneApproval; saveSecurity(security);
      createNotification('Sécurité de la caisse', 'Approbation sur le téléphone ' + (body.phoneApproval ? 'activée' : 'désactivée') + ' · ' + me.name, 'security');
    }
    if (typeof body.phoneLink === 'boolean') {
      const file = path.join(DATA_DIR, 'relay.json'); let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { cfg = {}; }
      cfg.enabled = body.phoneLink; fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
      try { remoteLink.stop(); } catch (error) { /* not running */ }
      startRemote();
  // once per install: leave a single "PromedPara Caisse" shortcut on the desktop (older installs created copies)
  const tidyMark = path.join(DATA_DIR, 'bureau-range-2.txt');
  if (process.env.PROMEDPARA_EXE && !fs.existsSync(tidyMark)) {
    require('./desktop').tidy(process.env.PROMEDPARA_EXE).then(result => {
      if (!result.ok) return;
      fs.writeFileSync(tidyMark, JSON.stringify(result));
      if (result.removed.length) createNotification('Bureau rangé', result.removed.length + ' raccourci(s) en double retiré(s) : il reste un seul « PromedPara Caisse ».', 'info');
    }).catch(() => {});
  }
      createNotification('Sécurité de la caisse', 'Lien internet des téléphones ' + (body.phoneLink ? 'activé' : 'désactivé') + ' · ' + me.name, 'security');
    }
    return send(response, 200, { phoneApproval: security.phoneApproval === true, phones: db.prepare('SELECT COUNT(*) AS n FROM owner_devices WHERE user_id=? AND active=1').get(me.id).n, link: { enabled: remoteLink.enabled, connected: remoteLink.connected }, isAdmin: true });
  }
  if (route === '/api/login' && request.method === 'POST') {
    const body = await readBody(request);
    rateLimit(request, 'login', 15);
    const username = clean(body.username, 50).toLowerCase(), secret = String(body.password || '').trim();
    // the person may type a username or their full name, and either an old password or their personal code (code: on the till only)
    const user = db.prepare('SELECT * FROM users WHERE active=1 AND (username=? OR lower(name)=?)').get(username, username);
    let allowed = Boolean(user) && passwordMatches(secret, user.password_hash);
    if (!allowed && user && user.pin_hash && isLocal(request)) allowed = passwordMatches(secret, user.pin_hash);
    if (!allowed) throw new HttpError(401, 'Nom ou code incorrect.');
    if (needsPhoneApproval(user, request)) return startApproval(user, response);
    const token = randomBytes(32).toString('base64url'); sessions.set(token, { userId: user.id, expires: Date.now() + 30 * 86400_000 });
    return send(response, 200, { user: userSafe(user) }, { 'Set-Cookie': `pp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}` });
  }
  if (route === '/api/ring' && request.method === 'POST') {
    // an owner who cannot sign in asks the administrator for a code: no account needed, but strictly rate-limited
    rateLimit(request, 'ring', 4);
    const now = Date.now();
    ringTimes = ringTimes.filter(at => now - at < 3600_000);
    if (ringTimes.length >= 6) throw new HttpError(429, 'Trop de demandes. Réessayez dans une heure ou appelez l’administrateur.');
    const body = await readBody(request), who = clean(body.name, 60).replace(/[\r\n]+/g, ' ');
    if (who.length < 2) throw new HttpError(400, 'Indiquez votre nom.');
    ringTimes.push(now);
    createNotification('Demande de code', who + ' demande un code d’association pour son téléphone. Comptes équipe → sa fiche → Associer le téléphone.', 'security');
    return send(response, 200, { ok: true });
  }
  if (route === '/api/qr-login/start' && request.method === 'POST') {
    if (!isLocal(request)) throw new HttpError(403, 'Réservé à la caisse.');
    rateLimit(request, 'qr-start', 40);
    const now = Date.now();
    for (const [nonce, entry] of Array.from(qrChallenges.entries())) if (entry.expires < now) { qrChallenges.delete(nonce); qrById.delete(entry.id); }
    if (qrChallenges.size >= 40) { const oldest = qrChallenges.keys().next().value; qrById.delete(qrChallenges.get(oldest).id); qrChallenges.delete(oldest); }
    const id = randomBytes(6).toString('hex'), nonce = randomBytes(8).toString('hex'), local = ownerUrls()[0] || '';
    const entry = { id, nonce, expires: now + 90_000, userId: null };
    qrChallenges.set(nonce, entry); qrById.set(id, entry);
    const query = 'c=' + nonce + (local ? '&l=' + encodeURIComponent(local) : '');
    const payload = remoteLink.enabled ? remoteLink.url.replace(/\/$/, '') + '/w?t=' + remoteLink.tillId + '&' + query : 'promedpara://login?' + query;
    return send(response, 200, { id, payload, expiresIn: 90 });
  }
  const qrPoll = route.match(/^\/api\/qr-login\/([a-f0-9]{12})$/);
  if (qrPoll && request.method === 'GET') {
    if (!isLocal(request)) throw new HttpError(403, 'Réservé à la caisse.');
    const entry = qrById.get(qrPoll[1]);
    if (!entry || entry.expires < Date.now()) return send(response, 410, { error: 'Code expiré.' });
    if (!entry.userId) return send(response, 200, { pending: true });
    qrChallenges.delete(entry.nonce); qrById.delete(entry.id);
    const account = db.prepare('SELECT id,name,username,role,can_receive_stock FROM users WHERE id=? AND active=1').get(entry.userId);
    if (!account) throw new HttpError(401, 'Compte désactivé.');
    return send(response, 200, { user: userSafe(account) }, createSession(account));
  }
  if (route === '/api/qr-login/approve' && request.method === 'POST') {
    rateLimit(request, 'qr-approve', 30);
    const body = await readBody(request), deviceId = clean(body.deviceId, 20), nonce = clean(body.c, 40), proof = clean(body.proof, 80);
    const entry = qrChallenges.get(nonce);
    if (!entry || entry.expires < Date.now() || entry.userId) throw new HttpError(410, 'Code expiré. Scannez le nouveau QR code.');
    const device = db.prepare("SELECT d.secret_hex,u.id,u.name FROM worker_devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.active=1 AND u.active=1 AND u.role='cashier'").get(deviceId);
    const expected = device ? createHmac('sha256', Buffer.from(device.secret_hex, 'hex')).update('qr:' + nonce + ':' + deviceId).digest('hex') : '';
    if (!device || proof.length !== expected.length || !timingSafeEqual(Buffer.from(proof), Buffer.from(expected))) throw new HttpError(401, 'Téléphone non reconnu.');
    entry.userId = device.id;
    db.prepare('UPDATE worker_devices SET last_seen_at=? WHERE id=?').run(isoNow(), deviceId);
    return send(response, 200, { ok: true, name: device.name });
  }
  if (route === '/api/worker/scan-login' && request.method === 'POST') {
    rateLimit(request, 'worker-scan', 20);
    const body = await readBody(request), code = clean(body.code, 40).toUpperCase().replace(/^\*|\*$/g, '');
    const match = /^PP(\d{8})(\d{6})$/.exec(code);
    if (!match) throw new HttpError(401, 'Badge non valide ou expiré.');
    const device = db.prepare(`SELECT d.*,u.id AS account_id,u.name,u.username,u.role,u.active AS account_active,u.can_receive_stock
      FROM worker_devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.active=1`).get(match[1]);
    if (!device || !device.account_active) throw new HttpError(401, 'Badge non valide ou expiré.');
    const currentStep = Math.floor(Date.now() / 30_000), acceptedStep = Number(device.last_accepted_step);
    const step = [currentStep, currentStep - 1, currentStep + 1].find(candidate => candidate > acceptedStep && totpAt(device.secret_hex, candidate) === match[2]);
    if (step === undefined) throw new HttpError(401, 'Badge non valide ou déjà utilisé. Affichez le code actuel et rescannnez.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const updated = db.prepare('UPDATE worker_devices SET last_accepted_step=?,last_seen_at=? WHERE id=? AND active=1 AND last_accepted_step<?').run(step, isoNow(), device.id, step);
      if (!updated.changes) throw new HttpError(401, 'Badge déjà utilisé. Affichez le code actuel et rescannnez.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const user = { id:device.account_id, name:device.name, username:device.username, role:device.role, can_receive_stock:device.can_receive_stock };
    return send(response, 200, { user:userSafe(user) }, createSession(user));
  }
  if (route === '/api/worker/pin-login' && request.method === 'POST') {
    // Short personal code, typed on the till's own touch keypad. Refused from phones/other PCs on purpose.
    if (!isLocal(request)) throw new HttpError(403, 'Le code PIN fonctionne uniquement sur la caisse. Utilisez le badge du téléphone.');
    rateLimit(request, 'worker-pin', 10);
    const now = Date.now();
    pinFailures = pinFailures.filter(at => now - at < 10 * 60_000);
    if (pinFailures.length >= 8) throw new HttpError(429, 'Trop d’essais de code PIN. Attendez 10 minutes ou utilisez le badge du téléphone.');
    const body = await readBody(request), pin = String(body.pin || body.code || '').trim();
    let match = null;
    if (pin.length >= 4 && pin.length <= 64) {
      for (const candidate of db.prepare("SELECT id,name,username,role,can_receive_stock,pin_hash FROM users WHERE active=1 AND (role='cashier' OR '1'=?) AND pin_hash IS NOT NULL").all(process.env.PROMEDPARA_ALLOW_MANY_ACCOUNTS === '1' ? '1' : '0')) {
        if (passwordMatches(pin, candidate.pin_hash)) { match = candidate; break; }
      }
    }
    if (!match && pin.length >= 4 && pin.length <= 64) {
      for (const owner of db.prepare("SELECT pin_hash,password_hash FROM users WHERE active=1 AND role='owner'").all()) {
        if ((owner.pin_hash && passwordMatches(pin, owner.pin_hash)) || (owner.password_hash && passwordMatches(pin, owner.password_hash))) throw new HttpError(403, 'Ce code est celui d’un propriétaire : touchez « Connexion avec mon nom et mon code » en bas de l’écran.');
      }
    }
    if (!match) {
      pinFailures.push(now);
      if (pinFailures.length === 8) createNotification('Tentatives de code PIN répétées', '8 codes PIN incorrects en moins de 10 minutes sur la caisse. Saisie bloquée 10 minutes.', 'security');
      throw new HttpError(401, 'Code PIN incorrect.');
    }
    pinFailures = [];
    if (needsPhoneApproval(match, request)) return startApproval(match, response);
    return send(response, 200, { user: userSafe(match) }, createSession(match));
  }
  // codes scanned at the till that no product has yet (the old export carries no barcodes)
  if (route === '/api/unknown-scans' && request.method === 'POST') {
    requireUser(request);
    const body = await readBody(request), code = clean(body.code, 80);
    if (!code) throw new HttpError(400, 'Code vide.');
    if (db.prepare('SELECT 1 AS x FROM products WHERE barcode=?').get(code)) return send(response, 200, { known: true });
    const now = isoNow();
    db.prepare('INSERT INTO unknown_scans(code,scans,first_at,last_at) VALUES(?,1,?,?) ON CONFLICT(code) DO UPDATE SET scans=scans+1,last_at=excluded.last_at').run(code, now, now);
    return send(response, 200, { recorded: true });
  }
  if (route === '/api/unknown-scans' && request.method === 'GET') {
    requireOwner(request);
    return send(response, 200, { codes: db.prepare('SELECT code,scans,last_at FROM unknown_scans ORDER BY last_at DESC LIMIT 100').all() });
  }
  if (route === '/api/unknown-scans/dismiss' && request.method === 'POST') {
    requireOwner(request);
    const body = await readBody(request);
    db.prepare('DELETE FROM unknown_scans WHERE code=?').run(clean(body.code, 80));
    return send(response, 200, { ok: true });
  }
  if (route === '/api/barcode-link' && request.method === 'POST') {
    const owner = requireUser(request), body = await readBody(request), code = clean(body.code, 80);
    const product = db.prepare('SELECT id,name,barcode FROM products WHERE id=? AND active=1').get(clean(body.productId, 100));
    if (!product) throw new HttpError(404, 'Produit introuvable.');
    if (owner.role !== 'owner' && product.barcode) throw new HttpError(403, 'Ce produit a déjà un code-barres : seul le propriétaire peut le changer.');
    if (!code) throw new HttpError(400, 'Code vide.');
    const clash = db.prepare('SELECT name FROM products WHERE barcode=? AND id<>?').get(code, product.id);
    if (clash) throw new HttpError(409, 'Ce code appartient déjà à « ' + clash.name + ' ».');
    db.prepare('UPDATE products SET barcode=?,updated_at=? WHERE id=?').run(code, isoNow(), product.id);
    db.prepare('DELETE FROM unknown_scans WHERE code=?').run(code);
    createNotification('Code-barres associé', product.name + ' · ' + code + ' · par ' + owner.name, 'stock');
    return send(response, 200, { ok: true, product: { id: product.id, name: product.name, barcode: code } });
  }
  const removeMatch = route.match(/^\/api\/team\/([^/]+)\/remove$/);
  if (removeMatch && request.method === 'POST') {
    const actor = requireOwner(request);
    if (!isAdmin(actor.id)) throw new HttpError(403, 'Seul l’administrateur peut retirer un compte.');
    const user = db.prepare('SELECT id,name,role,active FROM users WHERE id=?').get(clean(decodeURIComponent(removeMatch[1]), 100));
    if (!user || !user.active || user.role !== 'cashier') throw new HttpError(404, 'Compte employé introuvable.');
    db.prepare('UPDATE users SET active=0,pin_hash=NULL WHERE id=?').run(user.id);
    for (const [token, session] of sessions) if (session.userId === user.id) sessions.delete(token);
    createNotification('Employé retiré', user.name + ' ne peut plus ouvrir la caisse · par ' + actor.name, 'security');
    return send(response, 200, { ok: true });
  }
  const renameMatch = route.match(/^\/api\/team\/([^/]+)\/rename$/);
  if (renameMatch && request.method === 'POST') {
    const actor = requireOwner(request), b = await readBody(request), name = clean(b.name, 90);
    if (!isAdmin(actor.id)) throw new HttpError(403, 'Seul l’administrateur peut renommer un compte.');
    const user = db.prepare('SELECT id,name,role,active FROM users WHERE id=?').get(clean(decodeURIComponent(renameMatch[1]), 100));
    if (!user || !user.active || user.role !== 'cashier') throw new HttpError(404, 'Compte employé introuvable.');
    if (name.length < 2) throw new HttpError(400, 'Entrez un nom de 2 caractères au moins.');
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name, user.id);
    createNotification('Compte renommé', user.name + ' devient ' + name + ' · par ' + actor.name, 'security');
    return send(response, 200, { ok: true, name });
  }
  const pinMatch = route.match(/^\/api\/team\/([^/]+)\/pin$/);
  if (pinMatch && request.method === 'POST') {
    const actor = requireOwner(request), b = await readBody(request);
    const user = db.prepare('SELECT id,name,role,active FROM users WHERE id=?').get(clean(decodeURIComponent(pinMatch[1]), 100));
    if (!user || !user.active) throw new HttpError(404, 'Compte actif introuvable.');
    if (user.role === 'owner' && (!isAdmin(actor.id) || user.id === actor.id)) throw new HttpError(403, 'Seul l’administrateur peut donner un nouveau code temporaire à un propriétaire.');
    if (b.remove) {
      if (user.role !== 'cashier') throw new HttpError(400, 'Le code d’un propriétaire ne peut pas être retiré.');
      db.prepare('UPDATE users SET pin_hash=NULL WHERE id=?').run(user.id);
      createNotification('Code PIN retiré', `${user.name} · par ${actor.name}`, 'security');
      return send(response, 200, { ok: true, removed: true });
    }
    let pin = String(b.pin || '').trim(), generated = false;
    if (!pin || user.role === 'owner') { generated = true; pin = randomPin(user.id); }   // an owner always gets a generated temporary code
    checkNewPin(pin, user.id);
    db.prepare('UPDATE users SET pin_hash=?,must_change_password=? WHERE id=?').run(passwordHash(pin), user.role === 'owner' ? 1 : 0, user.id);
    if (user.role === 'owner') for (const [token, session] of sessions) if (session.userId === user.id) sessions.delete(token);
    createNotification(user.role === 'owner' ? 'Code temporaire propriétaire' : 'Code PIN défini', `${user.name} · par ${actor.name}`, 'security');
    return send(response, 200, { ok: true, pin: generated ? pin : undefined, generated });
  }
  if (route === '/api/worker/recovery-login' && request.method === 'POST') {
    rateLimit(request, 'worker-recovery-login', 8);
    const body = await readBody(request), code = clean(body.code, 12).replace(/\D/g, '');
    if (!/^\d{8}$/.test(code)) throw new HttpError(401, 'Code de secours invalide, utilisé ou expiré. Demandez-en un nouveau au propriétaire.');
    const recovery = db.prepare(`SELECT c.token_hash,c.user_id,u.name,u.username,u.role,u.active,u.can_receive_stock
      FROM worker_recovery_codes c JOIN users u ON u.id=c.user_id
      WHERE c.token_hash=? AND c.expires_at>? AND c.used_at IS NULL AND u.active=1 AND u.role='cashier'`).get(sha256(code), isoNow());
    if (!recovery) throw new HttpError(401, 'Code de secours invalide, utilisé ou expiré. Demandez-en un nouveau au propriétaire.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const used = db.prepare('UPDATE worker_recovery_codes SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').run(isoNow(), recovery.token_hash, isoNow());
      if (!used.changes) throw new HttpError(401, 'Ce code a déjà été utilisé. Demandez-en un nouveau au propriétaire.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    createNotification('Connexion de secours employé', `${recovery.name} · accès de secours utilisé`, 'security');
    const user = { id:recovery.user_id, name:recovery.name, username:recovery.username, role:recovery.role, can_receive_stock:recovery.can_receive_stock };
    return send(response, 200, { user:userSafe(user) }, createSession(user));
  }
  if (route === '/api/worker/enroll' && request.method === 'POST') {
    rateLimit(request, 'worker-enroll', 12);
    const body = await readBody(request), code = clean(body.code, 20).toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError(401, 'Code d’association invalide ou expiré.');
    const pairing = db.prepare(`SELECT p.*,u.name,u.active,u.role FROM worker_pairings p JOIN users u ON u.id=p.user_id
      WHERE p.token_hash=? AND p.expires_at>? AND u.active=1 AND u.role='cashier'`).get(sha256(code), isoNow());
    if (!pairing) throw new HttpError(401, 'Code d’association invalide ou expiré.');
    const deviceId = String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8,'0');
    const secret = randomBytes(20).toString('hex'), createdAt = isoNow();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT 1 FROM worker_devices WHERE id=?').get(deviceId)) throw new HttpError(503, 'Réessayez l’association.');
      db.prepare('INSERT INTO worker_devices(id,user_id,secret_hex,created_at) VALUES(?,?,?,?)').run(deviceId,pairing.user_id,secret,createdAt);
      db.prepare('DELETE FROM worker_pairings WHERE token_hash=?').run(pairing.token_hash);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    createNotification('Badge employé associé', `${pairing.name} · téléphone ajouté`, 'security');
    return send(response, 201, { deviceId, secret, name:pairing.name, business:'PromedPara', relay: remoteLink.enabled ? { base: remoteLink.url.replace(/\/$/, ''), tillId: remoteLink.tillId, key: remoteLink.workerKey } : null });
  }
  const shiftOf = userId => {
    const shopDay = date => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value])); return p.year + '-' + p.month + '-' + p.day; };
    const today = shopDay(new Date());
    const rows = db.prepare('SELECT id,total_cents,created_at FROM sales WHERE cashier_id=? AND created_at>=? ORDER BY created_at').all(userId, new Date(Date.now() - 36 * 3600_000).toISOString()).filter(row => shopDay(new Date(row.created_at)) === today);
    let items = 0;
    for (const row of rows) items += Number(db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM sale_lines WHERE sale_id=?').get(row.id).n) || 0;
    return { day: today, tickets: rows.length, totalCents: rows.reduce((sum, row) => sum + row.total_cents, 0), items: items, first: rows.length ? rows[0].created_at : '', last: rows.length ? rows[rows.length - 1].created_at : '' };
  };
  if (route === '/api/me/shift' && request.method === 'GET') {
    const me = requireUser(request);
    return send(response, 200, shiftOf(me.id));
  }
  if (route === '/api/logout' && request.method === 'POST') {
    const ending = sessions.get(cookieToken(request)), who = ending && db.prepare('SELECT name,role FROM users WHERE id=?').get(ending.userId);
    if (who && who.role === 'cashier') { const day = shiftOf(ending.userId); createNotification('Employé déconnecté', `${who.name} · a fermé la caisse · ${day.tickets} ticket(s), ${(day.totalCents / 100).toFixed(2).replace('.', ',')} MAD aujourd’hui`, 'staff'); }
    sessions.delete(cookieToken(request));
    return send(response, 200, { ok: true }, { 'Set-Cookie': 'pp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (route === '/api/update/idle' && request.method === 'GET') {
    // Used by the till's own app to know when nobody has touched the till for a while. Loopback only.
    if (!isLocal(request)) throw new HttpError(403, 'Réservé à la caisse.');
    return send(response, 200, { idleSeconds: Math.round((Date.now() - lastActivityAt) / 1000) });
  }
  if (route === '/api/update/status' && request.method === 'GET') {
    const viewer = requireUser(request);
    let status = {};
    try { status = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'update-status.json'), 'utf8')); } catch { /* not written yet */ }
    if (viewer.role !== 'owner') return send(response, 200, { current: APP_VERSION, staged: status.staged || '' });
    return send(response, 200, Object.assign({ enabled: false, current: APP_VERSION, saved: [] }, status, { current: APP_VERSION }));
  }
  if (route === '/api/update/command' && request.method === 'POST') {
    const actor = requireUser(request), body = await readBody(request), action = String(body.action || '');
    if (!['check', 'apply', 'rollback'].includes(action)) throw new HttpError(400, 'Commande inconnue.');
    if (actor.role !== 'owner') {
      if (action !== 'apply') throw new HttpError(403, 'Réservé au propriétaire.');
      let ready = ''; try { ready = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'update-status.json'), 'utf8')).staged || ''; } catch { /* none */ }
      if (!ready) throw new HttpError(409, 'Aucune mise à jour n’est prête.');
    }
    const version = clean(body.version, 20);
    if (action === 'rollback' && !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new HttpError(400, 'Version invalide.');
    fs.writeFileSync(path.join(DATA_DIR, 'update-command.json'), JSON.stringify({ action, version, by: actor.name, at: isoNow() }));
    createNotification('Mise à jour demandée', `${actor.name} · ${action === 'check' ? 'recherche de mise à jour' : action === 'apply' ? 'installation maintenant' : 'retour à la version ' + version}`, 'security');
    return send(response, 202, { ok: true });
  }
  if (route === '/api/me' && request.method === 'GET') return send(response, 200, { user: userSafe(requireUser(request)) });
  if (route === '/api/shop/products' && request.method === 'GET') {
    const products = db.prepare('SELECT id,name,category,price_cents,quantity,image_url FROM products WHERE active=1 ORDER BY category,name').all()
      .map(product => ({ id:product.id, name:product.name, category:product.category || 'Essentiels', price_cents:product.price_cents, image_url:product.image_url || '', available:product.quantity > 0 }));
    return send(response, 200, { products });
  }
  if (route === '/api/shop/config' && request.method === 'GET') {
    return send(response, 200, { business:'PromedPara', location:'Errachidia, Maroc', whatsapp:setting('shop_whatsapp'), deliveryNote:setting('shop_delivery_note') });
  }
  if (route === '/api/shop/settings' && request.method === 'GET') {
    requireOwner(request);
    return send(response, 200, { whatsapp:setting('shop_whatsapp'), deliveryNote:setting('shop_delivery_note') });
  }
  if (route === '/api/shop/settings' && request.method === 'POST') {
    requireOwner(request);
    const body=await readBody(request), whatsapp=clean(body.whatsapp,40).replace(/[^\d+]/g,'').replace(/^\+/,'');
    if (whatsapp && !/^\d{8,15}$/.test(whatsapp)) throw new HttpError(400,'Entrez un numéro WhatsApp international de 8 à 15 chiffres, sans espaces.');
    const deliveryNote=clean(body.deliveryNote,240);
    db.prepare('INSERT INTO business_settings(setting_key,setting_value) VALUES(?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value').run('shop_whatsapp',whatsapp);
    db.prepare('INSERT INTO business_settings(setting_key,setting_value) VALUES(?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value').run('shop_delivery_note',deliveryNote);
    createNotification('Boutique en ligne mise à jour',whatsapp?'Contact WhatsApp prêt à recevoir les commandes.':'Contact WhatsApp retiré; le panier reste consultable.', 'security');
    return send(response,200,{ok:true,whatsapp,deliveryNote});
  }
  if (route === '/api/products' && request.method === 'GET') {
    const viewer = requireUser(request);
    const q = `%${clean(url.searchParams.get('q'), 80)}%`;
    const hideCost = rows => viewer.role === 'owner' ? rows : rows.map(row => { const { cost_cents, ...rest } = row; return rest; });
    return send(response, 200, { products: hideCost(db.prepare(`SELECT p.*,s.name supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 AND (p.name LIKE ? OR p.sku LIKE ? OR COALESCE(p.barcode,'') LIKE ?) ORDER BY p.name LIMIT 10000`).all(q,q,q)) });
  }
  const productEditMatch = route.match(/^\/api\/products\/([^/]+)$/);
  if (productEditMatch && request.method === 'PATCH') {
    const owner = requireOwner(request); const body = await readBody(request);
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(clean(decodeURIComponent(productEditMatch[1]), 100));
    if (!product) throw new HttpError(404, 'Produit introuvable.');
    const has = key => Object.prototype.hasOwnProperty.call(body, key);
    const name = has('name') ? clean(body.name, 180) : product.name;
    const barcode = has('barcode') ? (clean(body.barcode, 80) || null) : product.barcode;
    const price = has('price') ? cents(body.price) : product.price_cents, cost = has('cost') ? cents(body.cost) : product.cost_cents;
    const reorder = has('reorderLevel') ? Math.max(0, Number(body.reorderLevel)) : product.reorder_level;
    const quantity = has('quantity') ? Number(body.quantity) : product.quantity;
    const active = has('active') ? (body.active ? 1 : 0) : product.active;
    if (!name || price < 0 || cost < 0 || !Number.isFinite(reorder) || !Number.isFinite(quantity) || quantity < 0) throw new HttpError(400, 'Vérifiez le nom, les prix et les quantités.');
    if (barcode) { const clash = db.prepare('SELECT name FROM products WHERE barcode=? AND id<>?').get(barcode, product.id); if (clash) throw new HttpError(409, `Ce code-barres est déjà utilisé par « ${clash.name} ».`); }
    const updatedAt = isoNow();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE products SET name=?,barcode=?,category=?,unit=?,quantity=?,reorder_level=?,price_cents=?,cost_cents=?,active=?,updated_at=? WHERE id=?')
        .run(name, barcode, has('category') ? clean(body.category, 80) : product.category, has('unit') ? (clean(body.unit, 30) || 'unité') : product.unit, quantity, reorder, price, cost, active, updatedAt, product.id);
      if (quantity !== product.quantity) db.prepare('INSERT INTO stock_movements(id,product_id,product_name,kind,quantity_delta,reference,user_id,user_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id('move'), product.id, name, 'Ajustement', quantity - product.quantity, 'Correction manuelle', owner.id, owner.name, updatedAt);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const notes = [];
    if (price !== product.price_cents) notes.push(`prix ${money(product.price_cents)} → ${money(price)}`);
    if (quantity !== product.quantity) notes.push(`stock ${product.quantity} → ${quantity}`);
    if (barcode !== product.barcode) notes.push(barcode ? 'code-barres enregistré' : 'code-barres retiré');
    if (active !== product.active) notes.push(active ? 'réactivé' : 'archivé');
    if (notes.length) createNotification('Produit modifié', `${name} · ${notes.join(' · ')}`, 'stock');
    return send(response, 200, { ok: true });
  }
  if (route === '/api/products' && request.method === 'POST') {
    const actor = requireUser(request);
    if (actor.role !== 'owner' && !productAccess(actor.id)) throw new HttpError(403, 'Vous n’avez pas l’autorisation d’ajouter des produits. Demandez-la au propriétaire.');
    const body = await readBody(request);
    const name = clean(body.name, 180), sku = clean(body.sku, 60) || `PP-${Date.now()}`;
    const price = cents(body.price), quantity = Number(body.quantity || 0), threshold = Number(body.reorderLevel || 0);
    if (!name || price < 0 || !Number.isFinite(quantity) || quantity < 0) throw new HttpError(400, 'Vérifiez le nom, le prix et la quantité.');
    const product = { id: id('prod'), barcode: clean(body.barcode, 80) || null, sku, name, category: clean(body.category, 80), unit: clean(body.unit, 30) || 'unité', quantity, reorderLevel: Math.max(0, threshold), priceCents: price, costCents: cents(body.cost), imageUrl: safeImageUrl(body.imageUrl), supplierId: clean(body.supplierId, 80) || null, updatedAt: isoNow() };
    db.prepare('INSERT INTO products(id,barcode,sku,name,category,unit,quantity,reorder_level,price_cents,cost_cents,image_url,supplier_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(product.id, product.barcode, product.sku, product.name, product.category, product.unit, product.quantity, product.reorderLevel, product.priceCents, product.costCents, product.imageUrl, product.supplierId, product.updatedAt);
    createNotification('Produit ajouté', `${product.name} · stock initial ${product.quantity} ${product.unit}${actor.role === 'owner' ? '' : ` · ajouté par ${actor.name}`}`, 'stock');
    return send(response, 201, { product });
  }
  if (route === '/api/products/import/preview' && request.method === 'POST') {
    requireOwner(request);
    const body=await readBody(request), content=String(body.content||''), sourceName=clean(body.fileName,180)||'catalogue.csv';
    if (!content || Buffer.byteLength(content,'utf8')>7_000_000) throw new HttpError(413,'Choisissez un CSV de moins de 7 Mo.');
    const grid=parseCsvGrid(content), headers=grid.shift(), sourceHash=sha256(content);
    const duplicate=Boolean(db.prepare('SELECT 1 FROM product_imports WHERE source_hash=?').get(sourceHash));
    const stageId=randomBytes(24).toString('base64url');
    for(const [key,stage] of pendingProductImports) if(stage.expiresAt<Date.now()) pendingProductImports.delete(key);
    pendingProductImports.set(stageId,{grid,headers,sourceHash,sourceName,expiresAt:Date.now()+30*60_000});
    return send(response,201,{stageId,headers,rowCount:grid.filter(row=>row.some(value=>value.trim())).length,duplicate,expiresAt:new Date(Date.now()+30*60_000).toISOString()});
  }
  if (route === '/api/products/import/commit' && request.method === 'POST') {
    const owner=requireOwner(request), body=await readBody(request), stage=pendingProductImports.get(clean(body.stageId,80));
    if(!stage||stage.expiresAt<Date.now())throw new HttpError(410,'L’aperçu a expiré. Sélectionnez de nouveau le fichier.');
    if(db.prepare('SELECT 1 FROM product_imports WHERE source_hash=?').get(stage.sourceHash))throw new HttpError(409,'Ce fichier a déjà été importé sur ce poste.');
    const required=['name','price','quantity'],optional=['category','cost','threshold','image'],mapping=body.mapping||{};
    if(!['skip','add_separate','update'].includes(body.duplicatePolicy))throw new HttpError(400,'Choisissez la règle de traitement des noms répétés.');
    for(const key of required){const index=Number(mapping[key]);if(!Number.isInteger(index)||index<0||index>=stage.headers.length)throw new HttpError(400,`Associez une colonne valide au champ ${key}.`);}
    for(const key of optional){const index=Number(mapping[key]??-1);if(!Number.isInteger(index)||index < -1||index>=stage.headers.length)throw new HttpError(400,`Colonne invalide pour ${key}.`);}
    const selected = new Map(), byName = new Map(), updates = [];
    const existing = db.prepare('SELECT id,name,quantity FROM products WHERE active=1').all();
    for(const product of existing){selected.set(normalizeProductName(product.name),'existing');byName.set(normalizeProductName(product.name),product);}
    let added=0, skippedExisting=0, skippedInvalid=0, skippedZeroPrice=0, negativeQuantity=0;
    const inserts=[];
    for(let index=0;index<stage.grid.length;index++){
      const row=stage.grid[index], lineNumber=index+1;
      if(!row.some(value=>String(value||'').trim()))continue;
      const get=key=>String(row[Number(mapping[key])]??'').trim(),name=clean(get('name'),180),normalizedName=normalizeProductName(name);
      const category=mapping.category>=0?clean(get('category'),80):'',cost=mapping.cost>=0?csvNumber(get('cost')):0,price=csvNumber(get('price')),quantity=csvNumber(get('quantity')),threshold=mapping.threshold>=0?csvNumber(get('threshold')):0,imageUrl=mapping.image>=0?safeImageUrl(get('image')):'';
      if(!name||!normalizedName||cost===null||price===null||quantity===null||threshold===null||cost<0||price<0||quantity<0||threshold<0){skippedInvalid++;if(quantity!==null&&quantity<0)negativeQuantity++;continue;}
      if(price===0&&!body.allowZeroSalePrice){skippedZeroPrice++;continue;}
      if(body.duplicatePolicy==='update'&&byName.has(normalizedName)&&selected.get(normalizedName)==='existing'){updates.push({product:byName.get(normalizedName),priceCents:cents(price),costCents:cents(cost),quantity,threshold,hasThreshold:mapping.threshold>=0,hasCost:mapping.cost>=0});selected.set(normalizedName,'updated');continue;}
      if(body.duplicatePolicy==='update'&&selected.has(normalizedName)){skippedExisting++;continue;}
      if(body.duplicatePolicy==='skip'&&selected.has(normalizedName)){skippedExisting++;continue;}
      if(body.duplicatePolicy==='skip')selected.set(normalizedName,'source');
      const createdAt=isoNow(),productId=id('prod'),sku=`IMP-${stage.sourceHash.slice(0,8)}-${String(lineNumber).padStart(5,'0')}`;
      inserts.push({id:productId,sku,name,category,quantity,reorderLevel:threshold,priceCents:cents(price),costCents:cents(cost),imageUrl,createdAt,lineNumber});
    }
    if(!inserts.length&&!updates.length)throw new HttpError(409,'Aucune ligne admissible. Vérifiez les colonnes, les prix nuls et les quantités négatives avant de réessayer.');
    db.exec('BEGIN IMMEDIATE');
    try{
      const addProduct=db.prepare('INSERT INTO products(id,barcode,sku,name,category,unit,quantity,reorder_level,price_cents,cost_cents,image_url,updated_at) VALUES(?,NULL,?,?,? ,\'unité\',?,?,?,?,?,?)');
      const addMovement=db.prepare('INSERT INTO stock_movements(id,product_id,product_name,kind,quantity_delta,reference,user_id,user_name,supplier_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
      for(const product of inserts){
        addProduct.run(product.id,product.sku,product.name,product.category,product.quantity,product.reorderLevel,product.priceCents,product.costCents,product.imageUrl,product.createdAt);
        addMovement.run(id('move'),product.id,product.name,'Import catalogue',product.quantity,stage.sourceName,owner.id,owner.name,'',product.createdAt);
      }
      const refresh=db.prepare('UPDATE products SET quantity=?,price_cents=?,cost_cents=CASE WHEN ? THEN ? ELSE cost_cents END,reorder_level=CASE WHEN ? THEN ? ELSE reorder_level END,updated_at=? WHERE id=?');
      for(const change of updates){
        const stamp=isoNow();
        refresh.run(change.quantity,change.priceCents,change.hasCost?1:0,change.costCents,change.hasThreshold?1:0,change.threshold,stamp,change.product.id);
        const delta=change.quantity-Number(change.product.quantity||0);
        if(delta!==0)addMovement.run(id('move'),change.product.id,change.product.name,'Mise à jour catalogue',delta,stage.sourceName,owner.id,owner.name,'',stamp);
      }
      db.prepare('INSERT INTO product_imports(id,source_name,source_hash,rows_seen,rows_added,created_at,user_id) VALUES(?,?,?,?,?,?,?)').run(id('import'),stage.sourceName,stage.sourceHash,stage.grid.length,inserts.length,isoNow(),owner.id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    pendingProductImports.delete(body.stageId);
    added=inserts.length;
    createNotification('Catalogue importé',`${added} produit(s) ajouté(s)${updates.length?' · '+updates.length+' mis à jour':''} depuis ${stage.sourceName} · ${skippedExisting} doublon(s) ignoré(s)`, 'stock');
    return send(response,201,{ok:true,added,updated:updates.length,skippedExisting,skippedInvalid,skippedZeroPrice,negativeQuantity,sourceName:stage.sourceName});
  }
  if (route === '/api/sales' && request.method === 'POST') {
    const user = requireUser(request), body = await readBody(request), lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length || lines.length > 100) throw new HttpError(400, 'Ajoutez au moins un article au ticket.');
    const payment = ['Espèces','Carte','Autre'].includes(body.payment) ? body.payment : 'Espèces';
    const saleId = id('sale'), createdAt = isoNow();
    let sale;
    db.exec('BEGIN IMMEDIATE');
    try {
      let totalCents = 0; const requested = new Map();
      for (const line of lines) {
        const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(clean(line.productId,80));
        const qty = Number(line.qty);
        if (!product || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Un article du ticket est invalide.');
        const existing = requested.get(product.id);
        requested.set(product.id,{product,qty:(existing?.qty||0)+qty});
      }
      const snapshots = [...requested.values()].map(({product,qty})=>({product,qty,lineCents:Math.round(product.price_cents*qty)}));
      for (const snapshot of snapshots) { if (snapshot.product.quantity < snapshot.qty) throw new HttpError(409, `Stock insuffisant : ${snapshot.product.name}.`); totalCents += snapshot.lineCents; }
      const receivedCents = payment === 'Espèces' ? cents(body.received) : totalCents;
      if (payment === 'Espèces' && receivedCents < totalCents) throw new HttpError(400, 'Le montant reçu est inférieur au total.');
      const nextNumber = Number(db.prepare("SELECT COUNT(*) n FROM sales WHERE substr(created_at,1,4)=strftime('%Y','now')").get().n) + 1;
      const number = `V-${new Date().getFullYear()}-${String(nextNumber).padStart(5,'0')}`;
      const changeCents = Math.max(0, receivedCents-totalCents);
      db.prepare('INSERT INTO sales(id,number,created_at,total_cents,payment,received_cents,change_cents,cashier_id,cashier_name,note) VALUES(?,?,?,?,?,?,?,?,?,?)').run(saleId,number,createdAt,totalCents,payment,receivedCents,changeCents,user.id,user.name,clean(body.note,250));
      const addLine = db.prepare('INSERT INTO sale_lines(id,sale_id,product_id,name,sku,qty,unit,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?,?)');
      const updateStock = db.prepare('UPDATE products SET quantity=quantity-?,updated_at=? WHERE id=?');
      const addMove = db.prepare('INSERT INTO stock_movements(id,product_id,product_name,kind,quantity_delta,reference,user_id,user_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
      for (const snapshot of snapshots) {
        const p = snapshot.product;
        addLine.run(id('line'),saleId,p.id,p.name,p.sku,snapshot.qty,p.unit,p.price_cents,snapshot.lineCents);
        updateStock.run(snapshot.qty,createdAt,p.id);
        addMove.run(id('move'),p.id,p.name,'Vente',-snapshot.qty,number,user.id,user.name,createdAt);
      }
      const lowStockCrossings = snapshots.filter(({product,qty}) => product.quantity > product.reorder_level && product.quantity - qty <= product.reorder_level).map(({product,qty}) => ({name:product.name, quantity:product.quantity-qty, unit:product.unit, threshold:product.reorder_level}));
      sale = { id:saleId, number, createdAt, totalCents, payment, receivedCents, changeCents, cashierName:user.name, lines:snapshots.map(x=>({name:x.product.name,sku:x.product.sku,qty:x.qty,unit:x.product.unit,priceCents:x.product.price_cents,lineTotalCents:x.lineCents})) };
      db.exec('COMMIT');
      sale.lowStockCrossings = lowStockCrossings;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const items=sale.lines.slice(0,4).map(line=>`${line.qty} ${line.unit} ${line.name}`).join(', ');
    const more=sale.lines.length>4?` · +${sale.lines.length-4} autre(s)`:'';
    createNotification('Nouvelle vente', `${sale.number} · ${money(sale.totalCents)} MAD · ${sale.cashierName} · ${items}${more}`, 'sale');
    for (const product of sale.lowStockCrossings) createNotification('Alerte stock bas', `${product.name} · reste ${product.quantity} ${product.unit} · seuil ${product.threshold}`, 'low-stock');
    return send(response, 201, { sale });
  }
  if (route === '/api/remote/status' && request.method === 'GET') {
    requireOwner(request);
    return send(response, 200, { enabled: remoteLink.enabled, connected: remoteLink.connected, address: remoteLink.address, lastOk: remoteLink.lastOk || 0, lastAttempt: remoteLink.lastAttempt || null });
  }
  if (route === '/api/overview' && request.method === 'GET') {
    requireOwner(request);
    // Sales are stored in UTC, but "today" and the 7-day chart follow the shop's own calendar day (Africa/Casablanca).
    const shopDay = date => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Casablanca',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value])); return `${p.year}-${p.month}-${p.day}`; };
    const today = shopDay(new Date());
    const totalsByDay = {};
    for (const sale of db.prepare('SELECT created_at,total_cents FROM sales WHERE created_at>=?').all(new Date(Date.now()-9*86400_000).toISOString())) {
      const day = shopDay(new Date(sale.created_at)), entry = totalsByDay[day] || (totalsByDay[day] = { n: 0, total: 0 });
      entry.n++; entry.total += sale.total_cents;
    }
    const sales = { n: (totalsByDay[today] || { n: 0 }).n, total: (totalsByDay[today] || { total: 0 }).total };
    const lowStock = db.prepare('SELECT id,name,sku,quantity,reorder_level FROM products WHERE active=1 AND quantity<=reorder_level ORDER BY quantity LIMIT 20').all();
    const recent = db.prepare('SELECT id,number,created_at,total_cents,payment,cashier_name FROM sales ORDER BY created_at DESC LIMIT 12').all();
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 25').all();
    const salesTrend=[];
    for(let offset=6;offset>=0;offset--){const date=new Date(Date.now()-offset*86400_000),day=shopDay(date);salesTrend.push({day,label:new Intl.DateTimeFormat('fr-MA',{timeZone:'Africa/Casablanca',weekday:'short'}).format(date),totalCents:Number((totalsByDay[day]||{total:0}).total)});}
    return send(response, 200, { today, salesCount:sales.n, revenueCents:sales.total, lowStock, recent, notifications, productCount:db.prepare('SELECT COUNT(*) n FROM products WHERE active=1').get().n, salesTrend });
  }
  if (route === '/api/sales' && request.method === 'GET') {
    requireOwner(request);
    const sales = db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 200').all();
    return send(response, 200, { sales:sales.map(s=>({...s,lines:db.prepare('SELECT * FROM sale_lines WHERE sale_id=?').all(s.id)})) });
  }
  if (route === '/api/suppliers' && request.method === 'GET') { const user=requireUser(request);if(user.role!=='owner'&&!user.can_receive_stock)throw new HttpError(403,'Accès réservé au propriétaire.');return send(response,200,{suppliers:db.prepare('SELECT * FROM suppliers ORDER BY name').all()}); }
  if (route === '/api/suppliers' && request.method === 'POST') {
    requireOwner(request); const b=await readBody(request), name=clean(b.name,150);
    if (!name) throw new HttpError(400,'Saisissez le nom du fournisseur.');
    const supplier={id:id('supplier'),name,category:clean(b.category,120),contact:clean(b.contact,120),phone:clean(b.phone,60),email:clean(b.email,150),notes:clean(b.notes,300),createdAt:isoNow()};
    db.prepare('INSERT INTO suppliers(id,name,category,contact,phone,email,notes,created_at) VALUES(?,?,?,?,?,?,?,?)').run(supplier.id,supplier.name,supplier.category,supplier.contact,supplier.phone,supplier.email,supplier.notes,supplier.createdAt);
    return send(response,201,{supplier});
  }
  if (route === '/api/stock/receive' && request.method === 'POST') {
    const user=requireUser(request);
    if(user.role!=='owner'&&!user.can_receive_stock)throw new HttpError(403,'Votre compte ne peut pas réceptionner le stock. Demandez l’autorisation au propriétaire.');
    const b=await readBody(request), product=db.prepare('SELECT * FROM products WHERE id=?').get(clean(b.productId,80)), qty=Number(b.quantity);
    if(!product||!Number.isFinite(qty)||qty<=0) throw new HttpError(400,'Produit ou quantité invalide.');
    const supplier=db.prepare('SELECT * FROM suppliers WHERE id=?').get(clean(b.supplierId,80));
    const reference=clean(b.reference,100)||`REC-${Date.now()}`, createdAt=isoNow();
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare('UPDATE products SET quantity=quantity+?,updated_at=? WHERE id=?').run(qty,createdAt,product.id); db.prepare('INSERT INTO stock_movements(id,product_id,product_name,kind,quantity_delta,reference,user_id,user_name,supplier_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id('move'),product.id,product.name,'Réception',qty,reference,user.id,user.name,supplier?.name||'',createdAt); db.exec('COMMIT'); }
    catch(error){db.exec('ROLLBACK');throw error;}
    createNotification('Stock réceptionné',`${qty} ${product.unit} · ${product.name}${supplier?` · ${supplier.name}`:''}`,'stock');
    return send(response,201,{ok:true});
  }
  const stockPermissionMatch = route.match(/^\/api\/team\/([^/]+)\/stock-permission$/);
  if (stockPermissionMatch && request.method === 'POST') {
    requireOwner(request); const userId=clean(decodeURIComponent(stockPermissionMatch[1]),100), b=await readBody(request);
    const user=db.prepare('SELECT id,role FROM users WHERE id=?').get(userId);
    if(!user||user.role!=='cashier')throw new HttpError(404,'Compte employé introuvable.');
    const allowed=Boolean(b.allowed);db.prepare('UPDATE users SET can_receive_stock=? WHERE id=?').run(allowed?1:0,userId);
    createNotification('Autorisation de stock modifiée', `${db.prepare('SELECT name FROM users WHERE id=?').get(userId).name} · ${allowed?'réception autorisée':'réception retirée'}`, 'security');
    return send(response,200,{ok:true,allowed});
  }
  if (route === '/api/change-password' && request.method === 'POST') {
    rateLimit(request, 'change-password', 8);
    const me = requireUser(request), b = await readBody(request), next = String(b.newPassword || '');
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(me.id);
    if (!passwordMatches(String(b.currentPassword || ''), row.password_hash)) throw new HttpError(401, 'Le mot de passe actuel est incorrect.');
    if (next.length < 10) throw new HttpError(400, 'Le nouveau mot de passe doit contenir au moins 10 caractères.');
    if (next === String(b.currentPassword)) throw new HttpError(400, 'Choisissez un mot de passe différent du mot de passe temporaire.');
    db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(passwordHash(next), me.id);
    createNotification('Mot de passe changé', `${me.name} · nouveau mot de passe défini`, 'security');
    return send(response, 200, { ok: true });
  }
  if (route === '/api/change-pin' && request.method === 'POST') {
    rateLimit(request, 'change-pin', 12);
    const me = requireUser(request), b = await readBody(request), next = String(b.newPin || '').trim();
    if (me.role !== 'owner') throw new HttpError(403, 'Demandez au propriétaire de changer votre code.');
    const row = db.prepare('SELECT pin_hash,must_change_password FROM users WHERE id=?').get(me.id);
    const recoveryKey = String(b.recoveryKey || '').trim();
    if (recoveryKey) {
      // an administrator who forgot the current code proves who they are with the recovery key shown at setup (on the till itself only)
      if (!isLocal(request) || !isAdmin(me.id)) throw new HttpError(403, 'La clé de récupération s’utilise sur la caisse, par l’administrateur.');
      const holder = db.prepare('SELECT recovery_hash FROM users WHERE id=?').get(me.id);
      if (!holder || !holder.recovery_hash || !passwordMatches(normRecovery(recoveryKey), holder.recovery_hash)) throw new HttpError(401, 'Clé de récupération incorrecte.');
    } else if (row.pin_hash && !row.must_change_password && !passwordMatches(String(b.currentPin || ''), row.pin_hash)) throw new HttpError(401, 'Le code actuel est incorrect.');
    checkNewPin(next, me.id);
    db.prepare('UPDATE users SET pin_hash=?,must_change_password=0 WHERE id=?').run(passwordHash(next), me.id);
    createNotification('Code personnel modifié', me.name, 'security');
    return send(response, 200, { ok: true });
  }
  if (route === '/api/recover' && request.method === 'POST') {
    // Administrator forgot the code: recovery key (shown once at setup) + a new code. Only on the till itself.
    if (!isLocal(request)) throw new HttpError(403, 'La récupération se fait sur la caisse elle-même.');
    const now = Date.now();
    recoveryFailures = recoveryFailures.filter(at => now - at < 3600_000);
    if (recoveryFailures.length >= 5) throw new HttpError(429, 'Trop d’essais. Réessayez dans une heure, ou utilisez RESET-CODE-ADMIN.bat sur la caisse.');
    const b = await readBody(request), key = normRecovery(b.recoveryKey), next = String(b.newPin || '').trim();
    const admin = db.prepare('SELECT id,name,username,role,can_receive_stock,recovery_hash FROM users WHERE is_admin=1 AND active=1 LIMIT 1').get();
    if (!admin || !admin.recovery_hash || key.length !== 16 || !passwordMatches(key, admin.recovery_hash)) {
      recoveryFailures.push(now);
      if (recoveryFailures.length === 5) createNotification('Clé de récupération : essais répétés', '5 clés incorrectes en moins d’une heure sur la caisse.', 'security');
      throw new HttpError(401, 'Clé de récupération incorrecte.');
    }
    checkNewPin(next, admin.id);
    const fresh = newRecoveryKey();
    db.prepare('UPDATE users SET pin_hash=?,recovery_hash=?,must_change_password=0 WHERE id=?').run(passwordHash(next), passwordHash(normRecovery(fresh)), admin.id);
    recoveryFailures = [];
    createNotification('Code administrateur réinitialisé', 'Avec la clé de récupération. Une nouvelle clé a été générée.', 'security');
    return send(response, 200, { user: userSafe(admin), recoveryKey: fresh }, createSession(admin));
  }
  if (route === '/api/recovery-key' && request.method === 'POST') {
    rateLimit(request, 'recovery-key', 6);
    const me = requireOwner(request), b = await readBody(request);
    if (!isAdmin(me.id)) throw new HttpError(403, 'Réservé à l’administrateur.');
    const row = db.prepare('SELECT pin_hash FROM users WHERE id=?').get(me.id);
    if (!row.pin_hash || !passwordMatches(String(b.currentPin || ''), row.pin_hash)) throw new HttpError(401, 'Le code actuel est incorrect.');
    const fresh = newRecoveryKey();
    db.prepare('UPDATE users SET recovery_hash=? WHERE id=?').run(passwordHash(normRecovery(fresh)), me.id);
    createNotification('Nouvelle clé de récupération', `${me.name} · l’ancienne clé ne fonctionne plus`, 'security');
    return send(response, 200, { recoveryKey: fresh });
  }
  // Owner phones: one-time pairing code -> long random device token kept by the Android app (stored hashed here).
  const ownerPairingMatch = route.match(/^\/api\/team\/([^/]+)\/owner-pairing$/);
  if (ownerPairingMatch && request.method === 'POST') {
    const actor = requireOwner(request), userId = clean(decodeURIComponent(ownerPairingMatch[1]), 100);
    const user = db.prepare('SELECT id,name,role,active FROM users WHERE id=?').get(userId);
    if (!user || user.role !== 'owner' || !user.active) throw new HttpError(404, 'Compte propriétaire introuvable.');
    if (user.id !== actor.id && !isAdmin(actor.id)) throw new HttpError(403, 'Seul le propriétaire concerné ou l’administrateur peut associer ce téléphone.');
    const code = randomBytes(8).toString('hex').slice(0, 12).toUpperCase(), createdAt = isoNow(), expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    db.prepare('DELETE FROM owner_pairings WHERE user_id=? OR expires_at<=?').run(userId, createdAt);
    livePairingCodes.set(code, Date.now() + 5 * 60_000);
    db.prepare('INSERT INTO owner_pairings(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sha256(code), userId, expiresAt, createdAt);
    return send(response, 201, { code, expiresAt, kind: 'owner', name: user.name, remote: remoteLink.enabled ? { address: remoteLink.address, connected: remoteLink.connected } : null, serverUrls: ownerUrls(), workerUrls: ownerUrls().map(url => `${url}/owner-app`), workerApkUrls: ownerUrls().map(url => `${url}/PromedPara-Owner.apk`) });
  }
  if (route === '/api/owner/enroll-direct' && request.method === 'POST') {
    // the phone only knows the owner's name and personal code; the relay address is built into the app
    rateLimit(request, 'owner-enroll-direct', 20);
    const body = await readBody(request), wanted = clean(body.name, 80).toLowerCase();
    const rows = db.prepare("SELECT id,name,username,role,active,can_receive_stock,pin_hash FROM users WHERE role='owner' AND active=1").all();
    const user = wanted && rows.find(row => String(row.name).toLowerCase() === wanted || String(row.username).toLowerCase() === wanted);
    if (!user) throw new HttpError(401, 'Nom ou code personnel incorrect.');
    const failure = ownerPairTries.get('direct:' + user.id) || { count: 0, until: 0 };
    if (failure.until > Date.now()) throw new HttpError(429, 'Trop d’essais. Réessayez dans ' + Math.ceil((failure.until - Date.now()) / 60000) + ' minute(s).');
    if (!user.pin_hash) throw new HttpError(409, 'Créez d’abord votre code personnel sur la caisse (bouton « Mon code »).');
    if (!passwordMatches(String(body.pin || '').trim(), user.pin_hash)) {
      failure.count++; if (failure.count >= 5) { failure.until = Date.now() + 10 * 60000; failure.count = 0; createNotification('Association de téléphone bloquée', user.name + ' · 5 codes personnels incorrects : nouvel essai possible dans 10 minutes.', 'security'); }
      ownerPairTries.set('direct:' + user.id, failure);
      throw new HttpError(401, 'Nom ou code personnel incorrect.');
    }
    ownerPairTries.delete('direct:' + user.id);
    const token = randomBytes(32).toString('hex'), deviceId = id('odev'), createdAt = isoNow(), deviceName = clean(body.deviceName, 60) || 'Téléphone';
    db.prepare('INSERT INTO owner_devices(id,user_id,token_hash,name,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(deviceId, user.id, sha256(token), deviceName, createdAt, createdAt);
    createNotification('Téléphone propriétaire associé', user.name + ' · ' + deviceName, 'security');
    return send(response, 201, { user: userSafe(user), deviceToken: token }, createSession(user));
  }
  if (route === '/api/owner/enroll' && request.method === 'POST') {
    rateLimit(request, 'owner-enroll', 12);
    const body = await readBody(request), code = clean(body.code, 20).toUpperCase().replace(/[^A-F0-9]/g, '');
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError(401, 'Code d’association invalide ou expiré.');
    const pairing = db.prepare("SELECT p.token_hash,p.user_id,u.id,u.name,u.username,u.role,u.active,u.can_receive_stock,u.pin_hash FROM owner_pairings p JOIN users u ON u.id=p.user_id WHERE p.token_hash=? AND p.expires_at>? AND u.active=1 AND u.role='owner'").get(sha256(code), isoNow());
    if (!pairing) throw new HttpError(401, 'Code d’association invalide ou expiré.');
    if (!pairing.pin_hash) throw new HttpError(409, 'Créez d’abord votre code personnel sur la caisse (bouton « Mon code »).');
    if (!passwordMatches(String(body.pin || '').trim(), pairing.pin_hash)) {
      const tries = (ownerPairTries.get(pairing.token_hash) || 0) + 1; ownerPairTries.set(pairing.token_hash, tries);
      if (tries >= 5) { db.prepare('DELETE FROM owner_pairings WHERE token_hash=?').run(pairing.token_hash); ownerPairTries.delete(pairing.token_hash); createNotification('Association de téléphone bloquée', pairing.name + ' · 5 codes personnels incorrects : le code d’association a été annulé.', 'security'); throw new HttpError(401, 'Trop d’essais. Demandez un nouveau code d’association.'); }
      throw new HttpError(401, 'Votre code personnel est incorrect (c’est celui que vous tapez sur la caisse).');
    }
    ownerPairTries.delete(pairing.token_hash);
    const token = randomBytes(32).toString('hex'), deviceId = id('odev'), createdAt = isoNow(), deviceName = clean(body.deviceName, 60) || 'Téléphone';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO owner_devices(id,user_id,token_hash,name,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(deviceId, pairing.user_id, sha256(token), deviceName, createdAt, createdAt);
      db.prepare('DELETE FROM owner_pairings WHERE token_hash=?').run(pairing.token_hash);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    createNotification('Téléphone propriétaire associé', `${pairing.name} · ${deviceName}`, 'security');
    return send(response, 201, { user: userSafe(pairing), deviceToken: token }, createSession(pairing));
  }
  if (route === '/api/owner/device-login' && request.method === 'POST') {
    rateLimit(request, 'owner-device-login', 30);
    const body = await readBody(request), token = String(body.deviceToken || '');
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Téléphone non reconnu. Associez-le à nouveau.');
    const device = db.prepare("SELECT d.id AS device_id,u.id,u.name,u.username,u.role,u.can_receive_stock FROM owner_devices d JOIN users u ON u.id=d.user_id WHERE d.token_hash=? AND d.active=1 AND u.active=1 AND u.role='owner'").get(sha256(token));
    if (!device) throw new HttpError(401, 'Téléphone non reconnu. Associez-le à nouveau.');
    db.prepare('UPDATE owner_devices SET last_seen_at=? WHERE id=?').run(isoNow(), device.device_id);
    return send(response, 200, { user: userSafe(device) }, createSession(device, 'alerts'));
  }
  if (route === '/api/owner/unlock' && request.method === 'POST') {
    // opening the phone app: the device token AND the owner's personal code
    rateLimit(request, 'owner-unlock', 30);
    const body = await readBody(request), token = String(body.deviceToken || '');
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Téléphone non reconnu. Associez-le à nouveau.');
    const device = db.prepare("SELECT d.id AS device_id,u.id,u.name,u.username,u.role,u.can_receive_stock,u.pin_hash FROM owner_devices d JOIN users u ON u.id=d.user_id WHERE d.token_hash=? AND d.active=1 AND u.active=1 AND u.role='owner'").get(sha256(token));
    if (!device) throw new HttpError(401, 'Téléphone non reconnu. Associez-le à nouveau.');
    const failure = ownerUnlockFails.get(device.device_id) || { count: 0, until: 0 };
    if (failure.until > Date.now()) throw new HttpError(429, 'Trop d’essais. Réessayez dans ' + Math.ceil((failure.until - Date.now()) / 60000) + ' minute(s).');
    if (!device.pin_hash) throw new HttpError(409, 'Créez d’abord votre code personnel sur la caisse (bouton « Mon code »).');
    if (!passwordMatches(String(body.pin || '').trim(), device.pin_hash)) {
      failure.count++; if (failure.count >= 5) { failure.until = Date.now() + 10 * 60000; failure.count = 0; createNotification('Téléphone propriétaire : essais de code', device.name + ' · 5 codes personnels incorrects sur un téléphone. Il est bloqué 10 minutes.', 'security'); }
      ownerUnlockFails.set(device.device_id, failure);
      throw new HttpError(401, 'Code personnel incorrect.');
    }
    ownerUnlockFails.delete(device.device_id);
    db.prepare('UPDATE owner_devices SET last_seen_at=? WHERE id=?').run(isoNow(), device.device_id);
    return send(response, 200, { user: userSafe(device) }, createSession(device, 'full'));
  }
  if (route === '/api/owner/device-logout' && request.method === 'POST') {
    const body = await readBody(request), token = String(body.deviceToken || '');
    if (/^[a-f0-9]{64}$/.test(token)) db.prepare('UPDATE owner_devices SET active=0 WHERE token_hash=?').run(sha256(token));
    return send(response, 200, { ok: true });
  }
  const revokeOwnerDeviceMatch = route.match(/^\/api\/owner\/devices\/([^/]+)$/);
  if (revokeOwnerDeviceMatch && request.method === 'DELETE') {
    const actor = requireOwner(request), deviceId = clean(decodeURIComponent(revokeOwnerDeviceMatch[1]), 60);
    const device = db.prepare('SELECT d.id,d.user_id,d.name,u.name AS owner_name FROM owner_devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.active=1').get(deviceId);
    if (!device) throw new HttpError(404, 'Téléphone introuvable.');
    if (device.user_id !== actor.id && !isAdmin(actor.id)) throw new HttpError(403, 'Seul le propriétaire concerné ou l’administrateur peut révoquer ce téléphone.');
    db.prepare('UPDATE owner_devices SET active=0 WHERE id=?').run(deviceId);
    createNotification('Téléphone propriétaire révoqué', `${device.owner_name} · ${device.name} · par ${actor.name}`, 'security');
    return send(response, 200, { ok: true });
  }
  const resetPasswordMatch = route.match(/^\/api\/team\/([^/]+)\/reset-password$/);
  if (resetPasswordMatch && request.method === 'POST') {
    const actor = requireOwner(request);
    if (!isAdmin(actor.id)) throw new HttpError(403, 'Seul l’administrateur peut réinitialiser un mot de passe propriétaire.');
    const target = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(clean(decodeURIComponent(resetPasswordMatch[1]), 100)), b = await readBody(request), temp = String(b.password || '');
    if (!target || target.role !== 'owner' || target.id === actor.id) throw new HttpError(404, 'Compte propriétaire introuvable.');
    if (temp.length < 10) throw new HttpError(400, 'Le mot de passe temporaire doit contenir au moins 10 caractères.');
    db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(passwordHash(temp), target.id);
    for (const [token, session] of sessions) if (session.userId === target.id) sessions.delete(token);
    createNotification('Mot de passe propriétaire réinitialisé', `${target.name} · par ${actor.name}`, 'security');
    return send(response, 200, { ok: true });
  }
  const productPermissionMatch = route.match(/^\/api\/team\/([^/]+)\/product-permission$/);
  if (productPermissionMatch && request.method === 'POST') {
    requireOwner(request); const userId = clean(decodeURIComponent(productPermissionMatch[1]), 100), b = await readBody(request);
    const user = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(userId);
    if (!user || user.role !== 'cashier') throw new HttpError(404, 'Compte employé introuvable.');
    const allowed = Boolean(b.allowed), hours = Math.min(24, Math.max(1, Math.round(Number(b.hours) || 8)));
    const until = allowed ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    db.prepare('UPDATE users SET can_add_products=?,add_products_until=? WHERE id=?').run(allowed ? 1 : 0, until, userId);
    createNotification('Autorisation produits modifiée', `${user.name} · ${allowed ? `peut ajouter des produits pendant ${hours} h` : 'ajout de produits retiré'}`, 'security');
    return send(response, 200, { ok: true, allowed, until });
  }
  const pairingMatch = route.match(/^\/api\/team\/([^/]+)\/phone-pairing$/);
  if (pairingMatch && request.method === 'POST') {
    requireOwner(request); const userId=clean(decodeURIComponent(pairingMatch[1]),100);
    const user=db.prepare('SELECT id,role,active FROM users WHERE id=?').get(userId);
    if(!user||user.role!=='cashier'||!user.active)throw new HttpError(404,'Compte employé actif introuvable.');
    const code=randomBytes(8).toString('hex').slice(0,12).toUpperCase(), createdAt=isoNow(), expiresAt=new Date(Date.now()+5*60_000).toISOString();
    db.prepare('DELETE FROM worker_pairings WHERE user_id=? OR expires_at<=?').run(userId,createdAt);
    db.prepare('INSERT INTO worker_pairings(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sha256(code),userId,expiresAt,createdAt);
    livePairingCodes.set(code, Date.now() + 5 * 60_000);
    return send(response,201,{code,expiresAt,remote: remoteLink.enabled ? { address: remoteLink.address, connected: remoteLink.connected } : null,serverUrls:ownerUrls(),workerUrls:ownerUrls().map(url=>`${url}/worker`),workerApkUrls:ownerUrls().map(url=>`${url}/PromedPara-Worker.apk`)});
  }
  const recoveryMatch=route.match(/^\/api\/team\/([^/]+)\/recovery-code$/);
  if(recoveryMatch&&request.method==='POST'){
    requireOwner(request);const userId=clean(decodeURIComponent(recoveryMatch[1]),100),user=db.prepare('SELECT id,name,role,active FROM users WHERE id=?').get(userId);
    if(!user||user.role!=='cashier'||!user.active)throw new HttpError(404,'Compte employé actif introuvable.');
    const code=String(randomBytes(4).readUInt32BE()%100_000_000).padStart(8,'0'),createdAt=isoNow(),expiresAt=new Date(Date.now()+10*60_000).toISOString();
    db.prepare('DELETE FROM worker_recovery_codes WHERE user_id=? OR expires_at<=?').run(userId,createdAt);
    db.prepare('INSERT INTO worker_recovery_codes(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sha256(code),userId,expiresAt,createdAt);
    createNotification('Code de secours employé créé',`${user.name} · code à usage unique valable 10 minutes`, 'security');
    return send(response,201,{code,expiresAt,userName:user.name});
  }
  const revokeDeviceMatch = route.match(/^\/api\/worker\/devices\/([^/]+)$/);
  if (revokeDeviceMatch && request.method === 'DELETE') {
    requireOwner(request);const deviceId=clean(decodeURIComponent(revokeDeviceMatch[1]),40);
    const device=db.prepare('SELECT d.user_id,u.name FROM worker_devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.active=1').get(deviceId);
    const result=db.prepare('UPDATE worker_devices SET active=0 WHERE id=? AND active=1').run(deviceId);
    if(!result.changes)throw new HttpError(404,'Téléphone actif introuvable.');
    createNotification('Téléphone employé révoqué', `${device.name} · le badge ne pourra plus ouvrir la caisse`, 'security');
    return send(response,200,{ok:true});
  }
  if (route === '/api/team' && request.method === 'GET') {
    requireOwner(request);
    const users=db.prepare(`SELECT u.id,u.name,u.username,u.role,u.active,u.created_at,u.can_receive_stock,(u.pin_hash IS NOT NULL) AS has_pin,u.can_add_products,u.add_products_until,
      (SELECT COUNT(*) FROM worker_devices d WHERE d.user_id=u.id AND d.active=1) AS active_devices
      FROM users u WHERE u.active=1 OR u.role='owner' ORDER BY u.role,u.name`).all();
    for(const user of users)user.devices=user.role==='cashier'?db.prepare('SELECT id,created_at,last_seen_at FROM worker_devices WHERE user_id=? AND active=1 ORDER BY created_at DESC').all(user.id):db.prepare('SELECT id,name,created_at,last_seen_at FROM owner_devices WHERE user_id=? AND active=1 ORDER BY created_at DESC').all(user.id);
    return send(response,200,{users});
  }
  if (route === '/api/team' && request.method === 'POST') {
    const actor=requireOwner(request); const b=await readBody(request), name=clean(b.name,90), username0=clean(b.username,50).toLowerCase(), role=b.role==='owner'?'owner':'cashier', password=String(b.password||'');
    const username=username0.length>=3?username0:uniqueUsername(name);
    if(role==='owner'&&!isAdmin(actor.id))throw new HttpError(403,'Seul l’administrateur peut créer un compte propriétaire.');
    // one owner (the administrator) and one shared employee account per till
    if (role === 'owner' && process.env.PROMEDPARA_ALLOW_MANY_ACCOUNTS !== '1' && db.prepare("SELECT 1 AS x FROM users WHERE role='owner' AND active=1").get()) throw new HttpError(409, 'Cette caisse a un seul compte propriétaire (l’administrateur).');
    if(name.length<2||username.length<3||(password&&password.length<10))throw new HttpError(400,'Nom et identifiant (3+) requis; un mot de passe propriétaire doit contenir au moins 10 caractères.');
    const user={id:id('user'),name,username,role,password_hash:passwordHash(password||randomBytes(40).toString('base64url')),active:1,created_at:isoNow()};
    const askedPin = String(b.pin || '').trim();
    const workerPinGenerated = role === 'cashier' && !askedPin && Boolean(b.generatePin);
    const workerPin = role === 'cashier' && (askedPin || b.generatePin) ? (askedPin || randomPin(user.id)) : '';
    if (workerPin) checkNewPin(workerPin, user.id);
    db.prepare('INSERT INTO users(id,name,username,role,password_hash,active,created_at,must_change_password) VALUES(?,?,?,?,?,?,?,?)').run(user.id,user.name,user.username,user.role,user.password_hash,user.active,user.created_at,role==='owner'?1:0);
    if (workerPin) db.prepare('UPDATE users SET pin_hash=? WHERE id=?').run(passwordHash(workerPin), user.id);
    if (role === 'cashier' && b.canReceiveStock) { db.prepare('UPDATE users SET can_receive_stock=1 WHERE id=?').run(user.id); user.can_receive_stock = 1; }
    let tempPin;
    if (role === 'owner' && !password) { tempPin = randomPin(user.id); db.prepare('UPDATE users SET pin_hash=? WHERE id=?').run(passwordHash(tempPin), user.id); }
    createNotification('Compte créé',`${name} · ${role==='owner'?'propriétaire (code temporaire)':'employé'} · par ${actor.name}`,'security');
    return send(response,201,{user:userSafe(user),tempPin,pin:workerPinGenerated?workerPin:undefined});
  }
  if (route === '/api/events' && request.method === 'GET') {
    requireOwner(request); response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}); eventClients.add(response); const sequence=Number(db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM notifications').get().n); response.write(`data: ${JSON.stringify({type:'ready',sequence})}\n\n`);
    const heartbeat=setInterval(()=>{try{response.write(': keepalive\n\n')}catch{}},20_000);
    response.on('close',()=>{clearInterval(heartbeat);eventClients.delete(response)}); return;
  }
  if (route === '/api/notifications' && request.method === 'GET') {
    requireOwner(request);
    const afterSeq=Math.max(0,Number(url.searchParams.get('afterSeq')||0));
    if(!Number.isSafeInteger(afterSeq))throw new HttpError(400,'Curseur de notification invalide.');
    const notifications=db.prepare('SELECT rowid AS sequence,id,title,body,kind,created_at,read_at FROM notifications WHERE rowid>? ORDER BY rowid LIMIT 500').all(afterSeq);
    return send(response,200,{notifications,latestSequence:Number(db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM notifications').get().n)});
  }
  if (route === '/api/notifications/read' && request.method === 'POST') { requireOwner(request); const b=await readBody(request); if(b.id)db.prepare('UPDATE notifications SET read_at=? WHERE id=?').run(isoNow(),clean(b.id,100)); else db.prepare('UPDATE notifications SET read_at=? WHERE read_at IS NULL').run(isoNow()); return send(response,200,{ok:true}); }
  if (route === '/api/device-status' && request.method === 'GET') {
    requireUser(request);
    if(!deviceCache||Date.now()-deviceCacheAt>45_000){
      let ports=[],printers=[];
      if(os.platform()==='win32'){
        const [portResult,printerResult]=await Promise.allSettled([
          execFileAsync('reg.exe',['query','HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'],{timeout:2500,windowsHide:true}),
          execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'],{timeout:3500,windowsHide:true})
        ]);
        if(portResult.status==='fulfilled')ports=[...portResult.value.stdout.matchAll(/REG_SZ\s+(COM\d+)/gi)].map(m=>m[1]);
        if(printerResult.status==='fulfilled'){try{const parsed=JSON.parse(printerResult.value.stdout||'[]');printers=Array.isArray(parsed)?parsed:parsed?[parsed]:[];}catch{}}
      }
      deviceCache={ports,printers};deviceCacheAt=Date.now();
    }
    const {ports,printers}=deviceCache;
    return send(response,200,{scanner:{mode:'USB clavier',status:'Prêt quand le champ code-barres est sélectionné'},printer:{mode:'Pilote Windows',status:printers.length?printers.join(' · '):'Aucune imprimante Windows détectée; utiliser le pilote Xprinter'},customerDisplay:{mode:'À identifier',status:ports.length?`Ports série visibles : ${ports.join(', ')} · protocole à confirmer`:'Afficheur numérique arrière — aucun port série détecté'},cashDrawer:{mode:'À vérifier',status:'Le branchement au tiroir ou à l’imprimante reste à confirmer'},ports,printers});
  }
  throw new HttpError(404,'Route introuvable.');
}

function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname === '/services' ? 'services.html' : pathname === '/shop' ? 'shop.html' : pathname === '/owner-app' ? 'owner-app.html' : pathname === '/worker' ? 'worker.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404,'Page introuvable.');
  const headers={'Content-Type':mimeTypes[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'};
  if(path.extname(file)==='.apk')headers['Content-Disposition']=`attachment; filename="${path.basename(file)}"`;
  response.writeHead(200,headers);
  fs.createReadStream(file).pipe(response);
}

const server=http.createServer(async(request,response)=>{
  try {
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/')) return await api(request,response,url);
    return serveStatic(request,response,url.pathname);
  } catch(error) {
    if(response.headersSent){response.end();return;}
    const status=error instanceof HttpError?error.status:500;
    if(status>=500)console.error(error);
    return send(response,status,{error:status===500?'Erreur locale inattendue.':error.message});
  }
});
server.listen(PORT,HOST,()=>{
  createNotification('Serveur', 'Le serveur PromedPara a démarré', 'info');
  try {
    // an update that was just installed: the owner is told, and the data and paired phones are untouched
    const marker = path.join(DATA_DIR, 'last-version.txt'); let previous = '';
    try { previous = fs.readFileSync(marker, 'utf8').trim(); } catch { /* first start */ }
    if (previous && APP_VERSION && previous !== APP_VERSION) createNotification('Mise à jour installée', 'PromedPara est passé de la version ' + previous + ' à ' + APP_VERSION + '. Vos données, vos comptes et vos téléphones associés sont conservés.', 'info');
    if (APP_VERSION) fs.writeFileSync(marker, APP_VERSION);
    // an update that has been downloaded and waits for a quiet moment
    const stagedMarker = path.join(DATA_DIR, 'last-staged.txt'); let announced = '';
    try { announced = fs.readFileSync(stagedMarker, 'utf8').trim(); } catch { /* none yet */ }
    const watchStaged = () => {
      try {
        const status = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'update-status.json'), 'utf8'));
        if (status.staged && status.staged !== announced) {
          announced = status.staged; fs.writeFileSync(stagedMarker, announced);
          createNotification('Mise à jour prête', 'La version ' + announced + ' est téléchargée. Elle s’installe toute seule quand la caisse est au repos ou cette nuit. Rien à faire : vos données sont conservées.', 'info');
        }
      } catch { /* no status yet */ }
    };
    setTimeout(watchStaged, Number(process.env.PROMEDPARA_STAGED_FIRST_MS) || 60000); const timer = setInterval(watchStaged, 10 * 60000); if (timer.unref) timer.unref();
  } catch (error) { console.error('update notices:', error.message); }
  startRemote = () => { try { remoteLink = require('./relay-client').start({ dataDir: DATA_DIR, port: PORT, defaultUrl: process.env.PROMEDPARA_RELAY_URL !== undefined ? process.env.PROMEDPARA_RELAY_URL : RELAY_URL, activeCodes: activePairingCodes, ownerNames: () => { const names = []; for (const row of db.prepare("SELECT name,username FROM users WHERE role='owner' AND active=1").all()) names.push(row.name, row.username); return names; } }); } catch (error) { console.error('relay client:', error.message); } };
  startRemote();
  console.log(`PromedPara local service: http://localhost:${PORT}`);
  for(const entries of Object.values(os.networkInterfaces()))for(const item of entries||[])if(item.family==='IPv4'&&!item.internal)console.log(`Owner phone (same Wi-Fi): http://${item.address}:${PORT}`);
});for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();db.close();process.exit(0)});
