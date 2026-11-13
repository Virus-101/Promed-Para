'use strict';
// Drop-in replacement for the small part of better-sqlite3 that PromedPara uses
// (exec, prepare().run/get/all, close), built on sql.js (SQLite compiled to WebAssembly).
// Reason: Windows 7 32-bit has no prebuilt native SQLite for the last supported Node (12).
// The database lives in memory and is written to disk atomically after every committed change.
const fs = require('fs');
const path = require('path');

const FLUSH_DELAY_MS = 5;
const KEEP_BACKUPS = 30;

function dayStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

class Statement {
  constructor(owner, sql) { this.owner = owner; this.sql = sql; }
  _params(args) {
    const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return flat.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  }
  _rows(args, firstOnly) {
    const stmt = this.owner.sqljs.prepare(this.sql);
    try {
      const params = this._params(args);
      if (params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
        if (firstOnly) break;
      }
      return rows;
    } finally { stmt.free(); }
  }
  get(...args) { return this._rows(args, true)[0]; }
  all(...args) { return this._rows(args, false); }
  run(...args) {
    const params = this._params(args);
    this.owner.sqljs.run(this.sql, params.length ? params : undefined);
    const changes = this.owner.sqljs.getRowsModified();
    this.owner._touch(this.sql);
    return { changes };
  }
}

class Database {
  constructor(file) {
    const SQL = global.__SQL;
    if (!SQL) throw new Error('sql.js not initialised: start the app through main.js');
    this.file = file;
    this.closed = false;
    this.inTransaction = false;
    this.timer = null;
    this.dirty = false;
    this.recoveryInfo = null;   // set when the file on disk was unreadable and a backup was restored automatically
    const existing = fs.existsSync(file) ? fs.readFileSync(file) : null;
    let sqljs = null;
    if (existing && existing.length) {
      try { sqljs = Database._open(SQL, existing); }
      catch (openError) {
        console.error('Base de données illisible (' + openError.message + ') : restauration automatique depuis la dernière sauvegarde…');
        const recovered = this._autoRecover(SQL, openError);
        if (recovered) { sqljs = recovered.sqljs; this.recoveryInfo = recovered.info; }
        else throw openError;   // nothing usable to restore from: fail exactly as before, visibly
      }
    }
    if (existing && existing.length && !this.recoveryInfo) this._dailyBackup();
    this.sqljs = sqljs || new SQL.Database();
    this.sqljs.exec('PRAGMA foreign_keys = ON');
    this._onExit = () => this._flushSync();
    process.on('exit', this._onExit);
  }
  // Opens a buffer as a database AND proves the schema is actually readable (a truncated or zeroed file can
  // otherwise look "open" to sql.js until the first real query touches it).
  static _open(SQL, buffer) {
    const sqljs = new SQL.Database(buffer);
    sqljs.exec('SELECT 1 FROM sqlite_master LIMIT 1');
    return sqljs;
  }
  // The live file could not be opened: try every kept backup (pre-update and daily), newest first, until one
  // opens cleanly. The broken file is kept on disk under a new name, never deleted, in case of a later manual recovery.
  _autoRecover(SQL, originalError) {
    try {
      const dir = path.join(path.dirname(this.file), 'backups');
      if (!fs.existsSync(dir)) return null;
      const candidates = fs.readdirSync(dir)
        .filter(name => /\.sqlite$/.test(name))
        .map(name => path.join(dir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      for (const candidate of candidates) {
        let buffer;
        try { buffer = fs.readFileSync(candidate); } catch (readError) { continue; }
        let sqljs;
        try { sqljs = Database._open(SQL, buffer); } catch (candidateError) { continue; }
        const brokenAside = path.join(path.dirname(this.file), 'promedpara-corrompue-' + Date.now() + '.sqlite');
        try { fs.renameSync(this.file, brokenAside); } catch (moveError) { /* best effort: keep going regardless */ }
        fs.writeFileSync(this.file, buffer);
        return { sqljs: sqljs, info: { from: path.basename(candidate), restoredAt: new Date().toISOString(), savedBroken: path.basename(brokenAside), reason: String(originalError && originalError.message || originalError) } };
      }
    } catch (recoverError) { console.error('Restauration automatique impossible :', recoverError.message); }
    return null;
  }
  _dailyBackup() {
    try {
      const dir = path.join(path.dirname(this.file), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, 'promedpara-' + dayStamp() + '.sqlite');
      if (!fs.existsSync(target)) fs.copyFileSync(this.file, target);
      const old = fs.readdirSync(dir).filter(n => /^promedpara-\d{8}\.sqlite$/.test(n)).sort();
      while (old.length > KEEP_BACKUPS) fs.unlinkSync(path.join(dir, old.shift()));
    } catch (e) { console.error('Backup warning:', e.message); }
  }
  prepare(sql) { return new Statement(this, sql); }
  exec(sql) {
    this.sqljs.exec(sql);
    this._touch(sql);
    return this;
  }
  _touch(sql) {
    const head = String(sql).trim().slice(0, 12).toUpperCase();
    if (head.startsWith('BEGIN')) { this.inTransaction = true; return; }
    if (head.startsWith('COMMIT') || head.startsWith('END')) { this.inTransaction = false; this._schedule(); return; }
    if (head.startsWith('ROLLBACK')) { this.inTransaction = false; return; }
    if (head.startsWith('SELECT') || head.startsWith('PRAGMA')) return;
    if (!this.inTransaction) this._schedule();
  }
  _schedule() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this._flushSync(); }, FLUSH_DELAY_MS);
  }
  /** Save now if something changed (called just before an answer is sent). */
  flushNow() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this._flushSync(); }
  _flushSync() {
    if (!this.dirty || this.closed || this.inTransaction) return;
    try {
      const data = Buffer.from(this.sqljs.export());
      // export() resets connection pragmas in sql.js
      this.sqljs.exec('PRAGMA foreign_keys = ON');
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (error) {
      // Windows can lock the file for a moment (antivirus, indexer): keep the change in memory and try again very soon, never crash
      console.error('Save postponed:', error.message);
      if (!this.timer && !this.closed) { this.timer = setTimeout(() => { this.timer = null; this._flushSync(); }, 400); }
    }
  }
  close() {
    if (this.closed) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.inTransaction) { try { this.sqljs.exec('ROLLBACK'); } catch (e) { /* ignore */ } this.inTransaction = false; }
    this._flushSync();
    this.closed = true;
    process.removeListener('exit', this._onExit);
    this.sqljs.close();
  }
}

module.exports = Database;
