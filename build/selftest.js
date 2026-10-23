'use strict';
// Quick health test run by the checker on the till: Node + WebAssembly + SQLite + crypto. Prints one line.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('./vendor/sql-wasm.js');

initSqlJs({ wasmBinary: fs.readFileSync(path.join(__dirname, 'vendor', 'sql-wasm.wasm')) })
  .then(function (SQL) {
    const db = new SQL.Database();
    db.run('CREATE TABLE t(a INTEGER)');
    db.run('INSERT INTO t VALUES (?)', [41]);
    const value = db.exec('SELECT a+1 FROM t')[0].values[0][0];
    if (value !== 42) throw new Error('SQLite returned ' + value);
    crypto.scryptSync('test', 'salt', 16);
    crypto.createHmac('sha1', Buffer.from('00', 'hex')).update('x').digest();
    console.log('SELFTEST OK  node ' + process.version + ' ' + process.arch + ', SQLite ' + db.exec('select sqlite_version()')[0].values[0][0]);
  })
  .catch(function (e) { console.log('SELFTEST FAIL ' + (e && e.message)); process.exit(1); });
