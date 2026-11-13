'use strict';
// A power cut right after the till says "done" must not lose that change (real Node 12 x86 runtime, killed at once).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_durabilitydata');
const PORT = 4196;
const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (url, body, cookie) => fetch('http://127.0.0.1:' + PORT + url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: JSON.stringify(body) });

(async () => {
  const SQL = await require('sql.js')();
  const count = (table) => { try { const db = new SQL.Database(fs.readFileSync(path.join(DATA, 'promedpara.sqlite'))); return db.exec('SELECT count(*) FROM ' + table)[0].values[0][0]; } catch (e) { return -1; } };
  for (let round = 1; round <= 4; round++) {
    fs.rmSync(DATA, { recursive: true, force: true });
    const proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: '' }) });
    for (let i = 0; i < 80; i++) { try { await fetch('http://127.0.0.1:' + PORT + '/api/status'); break; } catch (e) { await sleep(150); } }
    const setup = await post('/api/setup', { name: 'Hicham Amini', pin: 'Durable-Code-1' });
    const cookie = (setup.headers.get('set-cookie') || '').split(';')[0];
    proc.kill(); await sleep(500);
    ok('round ' + round + ': a new account is on disk the moment the till answered', setup.status === 201 && count('users') === 1, count('users'));
  }
  // and a sale rung just before the cut
  fs.rmSync(DATA, { recursive: true, force: true });
  const proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: '' }) });
  for (let i = 0; i < 80; i++) { try { await fetch('http://127.0.0.1:' + PORT + '/api/status'); break; } catch (e) { await sleep(150); } }
  const setup = await post('/api/setup', { name: 'Hicham Amini', pin: 'Durable-Code-1' });
  const cookie = (setup.headers.get('set-cookie') || '').split(';')[0];
  const product = await (await post('/api/products', { name: 'Doliprane', price: 25, quantity: 10, category: 'Test', cost: 15, reorderLevel: 2, barcode: '' }, cookie)).json();
  const sale = await post('/api/sales', { lines: [{ productId: product.product.id, qty: 2 }], payment: 'Espèces', received: 100, note: '' }, cookie);
  proc.kill(); await sleep(500);
  ok('a sale is on disk the moment the till said it was recorded', sale.status === 201 && count('sales') === 1, { status: sale.status, sales: count('sales') });
  fs.rmSync(DATA, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' durability checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
