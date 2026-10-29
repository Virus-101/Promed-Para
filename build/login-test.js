'use strict';
// Tests the single short-code login on a FRESH database, with the real Node 12 x86 runtime.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_logindata');
const PORT = 4197, BASE = 'http://127.0.0.1:' + PORT;
let proc; const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const start = async () => {
  proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '0.0.0.0' }) });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/status'); return; } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
};
const stop = () => new Promise(r => { proc.on('exit', r); proc.kill(); });
const jar = () => { let cookie = ''; return async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  let json = null; try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, json };
}; };

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  await start();
  const admin = jar(), anon = jar(), owner = jar();
  let r = await anon('GET', '/api/status'); ok('fresh install asks for setup', r.json.setupRequired === true && /^\d+\.\d+\.\d+$/.test(r.json.version), r.json);
  r = await anon('POST', '/api/setup', { name: 'Hicham', pin: '123' }); ok('setup refuses a too-short code', r.status === 400, r);
  r = await anon('POST', '/api/setup', { name: 'Hicham', pin: 'x'.repeat(40) }); ok('setup refuses a code longer than 32 characters', r.status === 400, r);
  r = await admin('POST', '/api/setup', { name: 'Hicham', pin: '482913' });
  ok('administrator created with a 6-digit code and a recovery key', r.status === 201 && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(r.json.recoveryKey), r);
  let recoveryKey = r.json.recoveryKey;
  r = await admin('GET', '/api/me'); ok('setup signs the admin in; admin flags correct', r.json.user.isAdmin && r.json.user.hasPin && !r.json.user.mustSetPin, r.json);
  r = await anon('POST', '/api/setup', { name: 'Intrus', pin: '735192' }); ok('setup cannot be repeated', r.status === 409, r);
  r = await admin('POST', '/api/change-pin', { recoveryKey: 'AAAA-BBBB-CCCC-DDDD', newPin: 'Zz-Brand-New-9' }); ok('change-code with a wrong recovery key is refused', r.status === 401, r);
  r = await admin('POST', '/api/change-pin', { recoveryKey: recoveryKey.toLowerCase().replace(/-/g, ' '), newPin: 'A-Long-Personal-Code-2026' }); ok('administrator can change the code with the recovery key (any spacing)', r.status === 200, r);
  r = await admin('POST', '/api/change-pin', { currentPin: 'A-Long-Personal-Code-2026', newPin: '482913' }); ok('a code longer than 6 characters works as the current code', r.status === 200, r);
  r = await anon('POST', '/api/login', { username: 'hicham', password: '482913' }); ok('login with the name (any case) and personal code', r.status === 200 && r.json.user.isAdmin, r);
  r = await anon('POST', '/api/login', { username: 'Hicham', password: '482914' }); ok('wrong code through the name form is refused', r.status === 401, r);

  const s1 = jar(); r = await s1('POST', '/api/worker/pin-login', { pin: '482913' }); ok('admin signs in with just the code', r.status === 200 && r.json.user.isAdmin === true, r);
  r = await anon('POST', '/api/worker/pin-login', { pin: '111222' }); ok('wrong code refused', r.status === 401, r);

  r = await admin('POST', '/api/team', { name: 'Karim (propriétaire)', username: 'karim', role: 'owner' });
  ok('admin creates an owner and gets a one-time temporary code', r.status === 201 && /^\d{6}$/.test(r.json.tempPin) && r.json.user.mustSetPin === true, r);
  const tempPin = r.json.tempPin, ownerId = r.json.user.id;
  r = await owner('POST', '/api/worker/pin-login', { pin: tempPin }); ok('owner signs in with the temporary code and is told to choose his own', r.status === 200 && r.json.user.mustSetPin === true, r);
  r = await owner('POST', '/api/change-pin', { newPin: '482913' }); ok('owner cannot take the admin\'s code', r.status === 409, r);
  r = await owner('POST', '/api/change-pin', { newPin: '12' }); ok('owner cannot choose a too-short code', r.status === 400, r);
  r = await owner('POST', '/api/change-pin', { newPin: '739150' }); ok('owner chooses his own code (no old code needed the first time)', r.status === 200, r);
  r = await owner('GET', '/api/me'); ok('owner no longer asked to change', r.json.user.mustSetPin === false, r.json);
  r = await anon('POST', '/api/worker/pin-login', { pin: tempPin }); ok('temporary code is dead', r.status === 401, r);
  r = await owner('POST', '/api/change-pin', { currentPin: '000999', newPin: '618420' }); ok('later changes need the current code', r.status === 401, r);
  r = await owner('POST', '/api/change-pin', { currentPin: '739150', newPin: '618420' }); ok('owner changes his code with the current one', r.status === 200, r);

  r = await owner('POST', '/api/team', { name: 'Sara', username: 'sara', role: 'cashier' }); const sara = r.json.user.id;
  r = await owner('POST', '/api/team/' + sara + '/pin', { pin: '905731' }); ok('owner gives a worker a code', r.status === 200, r);
  const w = jar(); r = await w('POST', '/api/worker/pin-login', { pin: '905731' }); ok('worker signs in with the code', r.status === 200 && r.json.user.role === 'cashier', r);
  r = await w('POST', '/api/change-pin', { newPin: '246810' }); ok('a worker cannot change codes on their own', r.status === 403, r);
  r = await owner('POST', '/api/team/' + ownerId + '/pin', {}); ok('an owner cannot reset another owner/admin code', r.status === 403, r);

  r = await admin('POST', '/api/team/' + ownerId + '/pin', {}); const resetPin = r.json.pin;
  ok('admin gives the owner a new temporary code', r.status === 200 && /^\d{6}$/.test(resetPin), r);
  r = await owner('GET', '/api/me'); ok('the owner session is closed by the reset', r.status === 401, r);
  r = await anon('POST', '/api/worker/pin-login', { pin: '618420' }); ok('the owner\'s old code no longer works', r.status === 401, r);

  // ---- admin forgot the code
  r = await anon('POST', '/api/recover', { recoveryKey: 'AAAA-BBBB-CCCC-DDDD', newPin: '357951' }); ok('wrong recovery key refused', r.status === 401, r);
  r = await anon('POST', '/api/recover', { recoveryKey: recoveryKey, newPin: '12' }); ok('recovery refuses a too-short new code (and does not burn the key)', r.status === 400, r);
  const back = jar(); r = await back('POST', '/api/recover', { recoveryKey: recoveryKey.toLowerCase().replace(/-/g, ' '), newPin: '357951' });
  ok('admin recovers access with the key (case/spacing tolerant)', r.status === 200 && r.json.user.isAdmin === true && r.json.recoveryKey && r.json.recoveryKey !== recoveryKey, r);
  const oldKey = recoveryKey; recoveryKey = r.json.recoveryKey;
  r = await anon('POST', '/api/recover', { recoveryKey: oldKey, newPin: '864209' }); ok('the used recovery key is dead; a new one was issued', r.status === 401, r);
  r = await anon('POST', '/api/worker/pin-login', { pin: '482913' }); ok('the forgotten code no longer works', r.status === 401, r);
  r = await anon('POST', '/api/worker/pin-login', { pin: '357951' }); ok('the new code works', r.status === 200 && r.json.user.isAdmin, r);
  r = await back('POST', '/api/recovery-key', { currentPin: '000111' }); ok('new recovery key needs the current code', r.status === 401, r);
  r = await back('POST', '/api/recovery-key', { currentPin: '357951' }); ok('admin can issue a fresh recovery key', r.status === 200 && r.json.recoveryKey !== recoveryKey, r);
  recoveryKey = r.json.recoveryKey;

  // ---- persistence across restart
  await new Promise(r => setTimeout(r, 600)); await stop(); await start();
  r = await anon('POST', '/api/worker/pin-login', { pin: '357951' }); ok('codes survive a restart', r.status === 200, r);
  r = await anon('POST', '/api/recover', { recoveryKey, newPin: '864209' }); ok('recovery key survives a restart', r.status === 200, r);
  recoveryKey = r.json.recoveryKey;

  // ---- last resort: physical reset tool (server stopped)
  await new Promise(r => setTimeout(r, 600)); await stop();
  const cp = require('child_process');
  const out = cp.execFileSync(path.join(KIT, 'runtime', 'node.exe'), [path.join(KIT, 'app', 'reset-admin.js'), DATA], { encoding: 'utf8' });
  const tmpPin = /CODE TEMPORAIRE : (\d{6})/.exec(out), tmpKey = /RECUPERATION : ([A-Z2-9-]{19})/.exec(out);
  ok('reset tool prints a temporary code and a new recovery key', !!tmpPin && !!tmpKey, out);
  ok('reset tool kept a database backup', fs.readdirSync(path.join(DATA, 'backups')).some(n => /^avant-reinitialisation-admin/.test(n)));
  await start();
  r = await anon('POST', '/api/worker/pin-login', { pin: '864209' }); ok('the lost code no longer works after the reset', r.status === 401, r);
  const reset = jar(); r = await reset('POST', '/api/worker/pin-login', { pin: tmpPin[1] }); ok('the temporary code works and forces a new personal code', r.status === 200 && r.json.user.mustSetPin === true && r.json.user.isAdmin, r);
  r = await reset('POST', '/api/change-pin', { newPin: '264817' }); ok('admin picks a new code after the reset', r.status === 200, r);
  r = await anon('POST', '/api/recover', { recoveryKey: recoveryKey, newPin: '864209' }); ok('the recovery key from before the reset is dead', r.status === 401, r);
  recoveryKey = tmpKey[1];

  // ---- recovery brute force
  for (let i = 0; i < 5; i++) await anon('POST', '/api/recover', { recoveryKey: 'ZZZZ-ZZZZ-ZZZZ-ZZ' + i + '2', newPin: '864209' });
  r = await anon('POST', '/api/recover', { recoveryKey, newPin: '864209' }); ok('recovery locks after repeated wrong keys', r.status === 429, r);

  await stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  const failed = results.filter(x => !x).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' login checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); try { proc.kill(); } catch (x) { /* */ } process.exit(1); });
