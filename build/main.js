'use strict';
// Entry point for the Windows 7 / Node 12 build. Written in plain ES2018 on purpose.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('./vendor/sql-wasm.js');

initSqlJs({ wasmBinary: fs.readFileSync(path.join(__dirname, 'vendor', 'sql-wasm.wasm')) })
  .then(function (SQL) {
    global.__SQL = SQL;
    require('./server.bundle.js');
  })
  .catch(function (error) {
    console.error('PromedPara failed to start:', error && error.stack ? error.stack : error);
    process.exit(1);
  });
