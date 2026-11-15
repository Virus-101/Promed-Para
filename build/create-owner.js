'use strict';
// Creates a brand-new, fully working owner/administrator account (needs Windows administrator rights on the till,
// run via CREER-NOUVEAU-PROPRIETAIRE.bat). Does NOT delete anything: existing owner accounts are only deactivated
// (sales and stock history keep referring to them, which SQLite's foreign keys require), products/sales/stock are untouched.
// The server must be stopped: the database file is rewritten.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('./vendor/sql-wasm.js');

const dataDir = process.argv[2], name = (process.argv[3] || '').trim(), pin = process.argv[4] || '';
if (!dataDir || !name || !pin) { console.log('Usage: create-owner.js <data folder> <nom> <code>'); process.exit(1); }
if (name.length < 2 || name.length > 60) { console.log('Le nom doit faire entre 2 et 60 caractères.'); process.exit(1); }
if (pin.length < 4 || pin.length > 32) { console.log('Le code doit faire entre 4 et 32 caractères.'); process.exit(1); }
const file = path.join(dataDir, 'promedpara.sqlite');
if (!fs.existsSync(file)) { console.log('Base de donnees introuvable : ' + file); process.exit(1); }

const hash = secret => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(secret, salt, 64).toString('hex'); };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const id = prefix => prefix + '_' + crypto.randomBytes(8).toString('hex');
const isoNow = () => new Date().toISOString();

initSqlJs({ wasmBinary: fs.readFileSync(path.join(__dirname, 'vendor', 'sql-wasm.wasm')) }).then(SQL => {
  const db = new SQL.Database(fs.readFileSync(file));
  db.exec('SELECT 1 FROM sqlite_master LIMIT 1');  // proves the file actually opened, not just that bytes were accepted
  const run = (sql, params) => { const st = db.prepare(sql); st.bind(params || []); st.step(); st.free(); };
  const rows = (sql, params) => { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };

  const columns = rows('PRAGMA table_info(users)').map(c => c.name);
  for (const col of ['is_admin', 'pin_hash', 'recovery_hash', 'must_change_password']) {
    if (columns.indexOf(col) < 0) db.run('ALTER TABLE users ADD COLUMN ' + col + (col === 'pin_hash' || col === 'recovery_hash' ? ' TEXT' : ' INTEGER NOT NULL DEFAULT 0'));
  }

  const deactivated = rows("SELECT id,name FROM users WHERE role='owner' AND active=1");
  run("UPDATE users SET active=0,pin_hash=NULL WHERE role='owner' AND active=1");

  const userId = id('user'), createdAt = isoNow();
  let username = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'owner';
  let candidate = username, n = 1;
  while (rows('SELECT id FROM users WHERE username=?', [candidate]).length) { candidate = username + '-' + (++n); }
  username = candidate;
  const recoveryBytes = crypto.randomBytes(16);
  let recoveryKey = '';
  for (let i = 0; i < 16; i++) { recoveryKey += ALPHABET[recoveryBytes[i] % 32]; if (i % 4 === 3 && i < 15) recoveryKey += '-'; }

  run('INSERT INTO users(id,name,username,role,password_hash,active,created_at,is_admin,pin_hash,recovery_hash,must_change_password) VALUES(?,?,?,?,?,?,?,1,?,?,0)',
    [userId, name, username, 'owner', hash(crypto.randomBytes(40).toString('hex')), 1, createdAt, hash(pin), hash(recoveryKey.replace(/-/g, ''))]);
  run('INSERT INTO notifications(id,title,body,kind,created_at) VALUES(?,?,?,?,?)',
    ['note_' + crypto.randomBytes(8).toString('hex'), 'Nouveau compte propriétaire créé', name + ' (CREER-NOUVEAU-PROPRIETAIRE, droits Windows). ' + deactivated.length + ' ancien(s) compte(s) propriétaire désactivé(s), ventes et stock conservés.', 'security', createdAt]);

  const backup = path.join(dataDir, 'backups'); fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(file, path.join(backup, 'avant-nouveau-proprietaire-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16) + '.sqlite'));
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, Buffer.from(db.export())); fs.renameSync(tmp, file);

  console.log('');
  console.log('  Compte cree : ' + name + '  (identifiant : ' + username + ')');
  console.log('  CODE PERSONNEL : ' + pin);
  console.log('  CLE DE RECUPERATION : ' + recoveryKey);
  console.log('');
  if (deactivated.length) console.log('  Anciens comptes propriétaire désactivés : ' + deactivated.map(u => u.name).join(', ') + '  (ventes et stock conservés, rien supprimé)');
  console.log('  Notez la clé de récupération sur papier. Elle ne sera plus affichée.');
  console.log('  Ouvrez ensuite l\'app Android (ou "Connexion avec mon nom" sur la caisse) avec ce nom et ce code.');
  process.exit(0);
}).catch(e => { console.log('Erreur : ' + e.message); process.exit(1); });
