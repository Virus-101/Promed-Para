'use strict';
// Last-resort reset of the administrator code (needs Windows administrator rights on the till, run via RESET-CODE-ADMIN.bat).
// The server must be stopped: the database file is rewritten. Prints a temporary code and a new recovery key.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('./vendor/sql-wasm.js');

const dataDir = process.argv[2];
if (!dataDir) { console.log('Usage: reset-admin.js <data folder>'); process.exit(1); }
const file = path.join(dataDir, 'promedpara.sqlite');
if (!fs.existsSync(file)) { console.log('Base de donnees introuvable : ' + file); process.exit(1); }

const hash = secret => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(secret, salt, 64).toString('hex'); };
const matches = (secret, stored) => { try { const parts = stored.split(':'); const a = crypto.scryptSync(secret, Buffer.from(parts[0], 'hex'), 64), b = Buffer.from(parts[1], 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch (e) { return false; } };
const weak = p => /^(\d)\1{5}$/.test(p) || '0123456789'.indexOf(p) >= 0 || '9876543210'.indexOf(p) >= 0;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

initSqlJs({ wasmBinary: fs.readFileSync(path.join(__dirname, 'vendor', 'sql-wasm.wasm')) }).then(SQL => {
  const db = new SQL.Database(fs.readFileSync(file));
  const rows = (sql, params) => { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
  const columns = rows('PRAGMA table_info(users)').map(c => c.name);
  for (const col of ['is_admin', 'pin_hash', 'recovery_hash', 'must_change_password']) {
    if (columns.indexOf(col) < 0) db.run('ALTER TABLE users ADD COLUMN ' + col + (col === 'pin_hash' || col === 'recovery_hash' ? ' TEXT' : ' INTEGER NOT NULL DEFAULT 0'));
  }
  let admin = rows('SELECT id,name FROM users WHERE is_admin=1 AND active=1 LIMIT 1')[0];
  if (!admin) { admin = rows("SELECT id,name FROM users WHERE role='owner' AND active=1 ORDER BY created_at LIMIT 1")[0]; if (admin) db.run('UPDATE users SET is_admin=1 WHERE id=?', [admin.id]); }
  if (!admin) { console.log('Aucun compte administrateur ou propriétaire dans la base.'); process.exit(1); }

  const others = rows('SELECT pin_hash FROM users WHERE active=1 AND pin_hash IS NOT NULL AND id<>?', [admin.id]);
  let pin = '';
  for (let i = 0; i < 100; i++) { const c = String(crypto.randomBytes(4).readUInt32BE(0) % 900000 + 100000); if (!weak(c) && !others.some(o => matches(c, o.pin_hash))) { pin = c; break; } }
  let key = ''; const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) { key += ALPHABET[bytes[i] % 32]; if (i % 4 === 3 && i < 15) key += '-'; }

  db.run('UPDATE users SET pin_hash=?, recovery_hash=?, must_change_password=1 WHERE id=?', [hash(pin), hash(key.replace(/-/g, '')), admin.id]);
  db.run('INSERT INTO notifications(id,title,body,kind,created_at) VALUES(?,?,?,?,?)', ['note_' + crypto.randomBytes(8).toString('hex'), 'Code administrateur réinitialisé sur la caisse', 'RESET-CODE-ADMIN utilisé avec les droits Windows. Nouvelle clé de récupération générée.', 'security', new Date().toISOString()]);
  const backup = path.join(dataDir, 'backups'); fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(file, path.join(backup, 'avant-reinitialisation-admin-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16) + '.sqlite'));
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, Buffer.from(db.export())); fs.renameSync(tmp, file);
  console.log('');
  console.log('  Compte : ' + admin.name);
  console.log('  CODE TEMPORAIRE : ' + pin + '   (vous choisirez le vôtre à la connexion)');
  console.log('  NOUVELLE CLE DE RECUPERATION : ' + key);
  console.log('');
  console.log('  Notez la clé sur papier. Elle ne sera plus affichée.');
  process.exit(0);
}).catch(e => { console.log('Erreur : ' + e.message); process.exit(1); });
