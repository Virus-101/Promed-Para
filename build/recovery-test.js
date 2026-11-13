'use strict';
// A corrupted database file on disk must not take down the till all day: it restores itself from the newest
// good backup at the next start, tells the owner clearly, and keeps the broken file for later inspection.
// When nothing usable can be restored, it must still fail loudly rather than quietly start empty.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_recoverydata');
const PORT = 4198, BASE = 'http://127.0.0.1:' + PORT;
const results = []; let proc;
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const start = async (timeoutMs) => {
  proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: '' }) });
  const until = Date.now() + (timeoutMs || 15000);
  while (Date.now() < until) { try { await fetch(BASE + '/api/status'); return true; } catch (e) { await sleep(150); } }
  return false;
};
const stop = async () => { try { proc.kill(); } catch (e) { /* already gone */ } await sleep(500); };
const api = async (method, url, body, cookieRef) => {
  const res = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookieRef && cookieRef.v ? { Cookie: cookieRef.v } : {}), body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie'); if (set && cookieRef) cookieRef.v = set.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => null) };
};

(async () => {
  // --- build a real, healthy database with one owner and one product, via the real kit
  fs.rmSync(DATA, { recursive: true, force: true });
  ok('the till starts on an empty data folder', await start());
  const cookie = { v: '' };
  await api('POST', '/api/setup', { name: 'Hicham Amini', pin: 'Recovery-Test-1' }, cookie);
  await api('POST', '/api/products', { name: 'Doliprane', price: 25, quantity: 10, category: 'Test', cost: 15, reorderLevel: 2, barcode: '' }, cookie);
  await stop();
  // a healthy snapshot, as a backup would look the day before the crash
  fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
  fs.copyFileSync(path.join(DATA, 'promedpara.sqlite'), path.join(DATA, 'backups', 'avant-mise-a-jour-1.0.0-vers-1.0.1-2026-11-01-08-00.sqlite'));

  // --- corrupt the live file exactly like a bad power cut or a bad sector would (truncated, not a database)
  fs.writeFileSync(path.join(DATA, 'promedpara.sqlite'), Buffer.from('not a database at all, just garbage bytes'));
  const booted = await start(20000);
  ok('the till still comes up with a corrupted live file (it used to crash on this)', booted);
  if (booted) {
    const status = await api('GET', '/api/status');
    ok('and reports a normal version, not an error page', status.status === 200 && status.json && status.json.business === 'PromedPara', status);
    const cookie2 = { v: '' };
    const login = await api('POST', '/api/login', { username: 'Hicham Amini', password: 'Recovery-Test-1' }, cookie2);
    ok('the owner account from the backup works: nothing had to be recreated by hand', login.status === 200, login);
    const products = await api('GET', '/api/products', null, cookie2);
    ok('the product from the backup is there too', products.json && products.json.products.some(p => p.name === 'Doliprane'), products.json);
    const notices = await api('GET', '/api/notifications?afterSeq=0', null, cookie2);
    const notice = notices.json && notices.json.notifications.find(n => /restaurée automatiquement/.test(n.title));
    ok('the owner is told plainly that an automatic restore happened, and from which backup', Boolean(notice) && /avant-mise-a-jour-1\.0\.0-vers-1\.0\.1/.test(notice.body) && /fichier.*illisible|illisible/.test(notice.body), notice);
    ok('the broken file is kept on disk, not thrown away', fs.readdirSync(DATA).some(n => /^promedpara-corrompue-\d+\.sqlite$/.test(n)), fs.readdirSync(DATA));
  }
  await stop();

  // --- nothing usable to restore from: the till must still refuse to start rather than silently wipe the shop
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'promedpara.sqlite'), Buffer.from('also garbage, and no backups folder at all'));
  const bootedNoBackup = await start(10000);
  ok('with no usable backup anywhere, the till refuses to start rather than opening a blank shop', !bootedNoBackup);
  await stop();

  fs.rmSync(DATA, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' auto-recovery checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); try { proc.kill(); } catch (e) { /* gone */ } process.exit(1); });
