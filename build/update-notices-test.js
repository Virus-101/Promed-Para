'use strict';
// The owner is told (and so the phone, by push) when an update is ready and when it has been installed; the data stays.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_noticesdata');
const PORT = 4199, BASE = 'http://127.0.0.1:' + PORT;
const results = []; let proc;
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const start = async () => {
  proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: '', PROMEDPARA_STAGED_FIRST_MS: '1500' }) });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/status'); return; } catch (e) { await sleep(250); } }
  throw new Error('server did not start');
};
const stop = async () => { try { proc.kill(); } catch (e) { /* gone */ } await sleep(800); };

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  await start();
  let cookie = '';
  const api = async (method, url, body) => {
    const res = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await api('POST', '/api/setup', { name: 'Hicham Amini', pin: 'Notices-Test-1' });
  await api('POST', '/api/products', { name: 'Produit à conserver', price: 12.5, quantity: 7, category: 'Test', cost: 5, reorderLevel: 2, barcode: '' });
  let r = await api('GET', '/api/notifications?afterSeq=0');
  ok('a first start announces nothing about updates', !r.json.notifications.some(n => /Mise à jour/.test(n.title)), r.json.notifications.map(n => n.title));
  await stop();

  // an older version was running before, and a newer one has just been downloaded
  const current = JSON.parse(fs.readFileSync(path.join(KIT, 'app', 'version.json'), 'utf8')).version;
  fs.writeFileSync(path.join(DATA, 'last-version.txt'), '1.0.0');
  fs.writeFileSync(path.join(DATA, 'update-status.json'), JSON.stringify({ enabled: true, current, staged: '99.0.0', saved: [], failed: [] }));
  await start();
  const again = await api('POST', '/api/login', { username: 'Hicham Amini', password: 'Notices-Test-1' });
  ok('the owner signs in again after the restart with the same code', again.status === 200, again);
  let notes = [];
  for (let i = 0; i < 40; i++) { await sleep(500); r = await api('GET', '/api/notifications?afterSeq=0'); notes = (r.json && r.json.notifications) || []; if (notes.some(n => n.title === 'Mise à jour prête')) break; }
  const installed = notes.find(n => n.title === 'Mise à jour installée'), ready = notes.find(n => n.title === 'Mise à jour prête');
  ok('after an update the owner is told which versions, and that data and phones are kept', installed && installed.body.includes('1.0.0') && installed.body.includes(current) && /conservés/.test(installed.body), installed);
  ok('a downloaded update is announced with its version', ready && ready.body.includes('99.0.0') && /Rien à faire/.test(ready.body), ready);
  r = await api('GET', '/api/products');
  ok('the shop data is untouched by the restart', r.json.products.some(p => p.name === 'Produit à conserver' && p.quantity === 7), r.json.products.map(p => p.name));
  await stop();

  // the same update is not announced again after another restart
  await start();
  await api('POST', '/api/login', { username: 'Hicham Amini', password: 'Notices-Test-1' });
  await sleep(4000);
  r = await api('GET', '/api/notifications?afterSeq=0');
  const count = title => r.json.notifications.filter(n => n.title === title).length;
  ok('the same notices are not repeated at the next start', count('Mise à jour prête') === 1 && count('Mise à jour installée') === 1, r.json.notifications.map(n => n.title));
  await stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' update-notice checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); try { proc.kill(); } catch (e) { /* gone */ } process.exit(1); });
