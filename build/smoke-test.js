'use strict';
// End-to-end check of the built kit using the real Node 12 x86 runtime. Run with a modern Node: node smoke-test.js
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_testdata');
const PORT = 4199, BASE = 'http://127.0.0.1:' + PORT;
let proc;
const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };

function start() {
  proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], {
    cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '0.0.0.0' })
  });
  proc.stderr.on('data', d => process.stderr.write('[server] ' + d));
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/status'); return resolve(); } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
    reject(new Error('server did not start'));
  });
}
function stop() { return new Promise(r => { proc.on('exit', r); proc.kill(); }); }
const jar = () => { let cookie = ''; return async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  let json = null; try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, json };
}; };
const totp = (secretHex, step) => {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step));
  const d = crypto.createHmac('sha1', Buffer.from(secretHex, 'hex')).update(c).digest();
  const o = d[d.length - 1] & 15;
  const n = ((d[o] & 0x7f) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
  return String(n % 1000000).padStart(6, '0');
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  await start();
  const owner = jar(), cashier = jar(), anon = jar();

  let r = await anon('GET', '/api/status'); ok('fresh DB asks for owner setup', r.json.setupRequired === true, r);
  r = await owner('POST', '/api/setup', { name: 'Test Owner', username: 'owner', password: 'correct-horse-9' }); ok('owner setup', r.status === 201, r);
  r = await owner('GET', '/api/me'); ok('first account created on the till is the admin', r.json.user.isAdmin === true && r.json.user.mustChangePassword === false, r.json);
  r = await owner('POST', '/api/team', { name: 'Hamid Owner', username: 'hamid', role: 'owner', password: 'temp-pass-123' }); ok('admin creates the owner login with a temporary password', r.status === 201 && r.json.user.mustChangePassword === true, r);
  const boss = jar();
  r = await boss('POST', '/api/login', { username: 'hamid', password: 'temp-pass-123' }); ok('owner signs in with the temporary password', r.status === 200, r);
  r = await boss('GET', '/api/me'); ok('owner is flagged to choose a new password', r.json.user.mustChangePassword === true && r.json.user.isAdmin === false, r.json);
  r = await boss('POST', '/api/team', { name: 'Autre', username: 'autre', role: 'owner', password: 'another-pass-1' }); ok('owner cannot create another owner', r.status === 403, r);
  r = await boss('POST', '/api/change-password', { currentPassword: 'wrong-wrong-1', newPassword: 'my-own-password-1' }); ok('password change needs the right current password', r.status === 401, r);
  r = await boss('POST', '/api/change-password', { currentPassword: 'temp-pass-123', newPassword: 'short' }); ok('new password must be 10+ characters', r.status === 400, r);
  r = await boss('POST', '/api/change-password', { currentPassword: 'temp-pass-123', newPassword: 'my-own-password-1' }); ok('owner sets their own password', r.status === 200, r);
  r = await boss('GET', '/api/me'); ok('flag cleared after the change', r.json.user.mustChangePassword === false, r.json);
  const bossId = r.json.user.id;
  r = await anon('POST', '/api/login', { username: 'hamid', password: 'temp-pass-123' }); ok('temporary password no longer works', r.status === 401, r);
  r = await boss('POST', '/api/team', { name: 'Karim', username: 'karim', role: 'cashier' }); ok('owner creates a worker (badge-only)', r.status === 201, r);
  r = await boss('POST', '/api/team/' + bossId + '/reset-password', { password: 'whatever-1234' }); ok('owner cannot reset owner passwords', r.status === 403, r);
  r = await owner('POST', '/api/team/' + bossId + '/reset-password', { password: 'second-temp-12' }); ok('admin can reset the owner password', r.status === 200, r);
  r = await boss('GET', '/api/me'); ok('owner session is closed by the reset', r.status === 401, r);
  r = await boss('POST', '/api/login', { username: 'hamid', password: 'second-temp-12' }); ok('owner signs in with the new temporary password', r.status === 200, r);
  r = await boss('POST', '/api/change-password', { currentPassword: 'second-temp-12', newPassword: 'my-own-password-2' }); ok('owner picks a password again', r.status === 200, r);
  r = await owner('POST', '/api/products', { name: 'Doliprane 1000', barcode: '6111000000017', price: 25.5, cost: 18, quantity: 4, reorderLevel: 3, category: 'Medicaments' });
  ok('create product', r.status === 201, r); const productId = r.json.product.id;
  r = await owner('POST', '/api/team', { name: 'Sara', username: 'sara', role: 'cashier' }); ok('create badge-only worker', r.status === 201, r); const sara = r.json.user.id;
  r = await owner('POST', '/api/team/' + sara + '/phone-pairing'); ok('pairing code issued', r.status === 201 && /^[A-F0-9]{12}$/.test(r.json.code), r);
  const phone = jar(); r = await phone('POST', '/api/worker/enroll', { code: r.json.code }); ok('phone enrolls', r.status === 201 || r.status === 200, r);
  const secretHex = r.json.secretHex || r.json.secret || r.json.seed; const deviceId = r.json.deviceId || r.json.id;
  ok('enroll returns device id + secret', deviceId && secretHex, r.json);

  const step = Math.floor(Date.now() / 30000);
  const badge = 'PP' + deviceId + totp(secretHex, step);
  r = await cashier('POST', '/api/worker/scan-login', { code: '*' + badge + '*' }); ok('badge scan logs the worker in (Code39 asterisks stripped)', r.status === 200 && r.json.user.username === 'sara', r);
  r = await anon('POST', '/api/worker/scan-login', { code: badge }); ok('same badge cannot be replayed', r.status === 401, r);
  r = await anon('POST', '/api/worker/scan-login', { code: 'PP' + deviceId + '000000' }); ok('wrong code refused', r.status === 401, r);

  r = await cashier('GET', '/api/products'); ok('worker can list products', r.status === 200, r);
  r = await cashier('GET', '/api/overview'); ok('worker cannot read owner overview', r.status === 403 || r.status === 401, r);
  r = await cashier('POST', '/api/products', { name: 'Hack', price: 1 }); ok('worker cannot add products by default', r.status === 403 || r.status === 401, r);
  r = await cashier('POST', '/api/sales', { lines: [{ productId, qty: 2 }], payment: 'Espèces', received: 100 });
  ok('worker makes a sale', r.status === 201 || r.status === 200, r); ok('change is correct (100 - 51 = 49)', r.json && r.json.sale && r.json.sale.changeCents === 4900, r.json);
  r = await cashier('POST', '/api/sales', { lines: [{ productId, qty: 5 }], payment: 'Espèces', received: 500 }); ok('cannot oversell stock', r.status === 409, r);

  r = await owner('POST', '/api/team/' + sara + '/product-permission', { allowed: true, hours: 8 }); ok('owner grants "add products" for 8 h', r.status === 200 && r.json.until, r);
  r = await cashier('POST', '/api/products', { name: 'Savon doux', barcode: '6111000000024', price: 12, quantity: 5, reorderLevel: 1 }); ok('worker with grant can add a product', r.status === 201, r);
  r = await cashier('GET', '/api/me'); ok('worker session reports canAddProducts', r.json && r.json.user && r.json.user.canAddProducts === true, r.json);
  r = await cashier('GET', '/api/team'); ok('worker still cannot read the team list', r.status === 403 || r.status === 401, r);
  r = await owner('POST', '/api/team/' + sara + '/product-permission', { allowed: false }); ok('owner revokes the grant', r.status === 200, r);
  r = await cashier('POST', '/api/products', { name: 'Interdit', price: 1 }); ok('worker is refused again after revoke', r.status === 403, r);
  r = await owner('POST', '/api/team/' + sara + '/product-permission', { allowed: true, hours: 1 });
  ok('grant can be re-issued with a different duration', r.status === 200, r);
  r = await owner('GET', '/api/notifications?afterSeq=0'); ok('owner is notified who added the product', r.json.notifications.some(n => /ajouté par Sara/.test(n.body)), r.json.notifications.map(n => n.body));
  await owner('POST', '/api/team/' + sara + '/product-permission', { allowed: false });

  r = await cashier('GET', '/api/products'); ok('worker does not receive purchase costs', r.json.products.length > 0 && r.json.products.every(p => !('cost_cents' in p)), r.json.products[0]);
  r = await owner('GET', '/api/products'); ok('owner does receive purchase costs', r.json.products.every(p => 'cost_cents' in p));
  const savon = r.json.products.find(p => p.name === 'Savon doux');
  r = await cashier('PATCH', '/api/products/' + productId, { price: 1 }); ok('worker cannot edit a product', r.status === 403, r);
  r = await owner('PATCH', '/api/products/' + productId, { barcode: '6111000000024' }); ok('cannot reuse a barcode already on another product', r.status === 409, r);
  r = await owner('PATCH', '/api/products/' + productId, { price: 27, quantity: 10, barcode: '6111999999999' }); ok('owner edits price, stock and barcode', r.status === 200, r);
  r = await owner('GET', '/api/products'); const edited = r.json.products.find(p => p.id === productId);
  ok('edit is saved (price 27.00, stock 10, barcode set)', edited.price_cents === 2700 && edited.quantity === 10 && edited.barcode === '6111999999999', edited);
  r = await owner('PATCH', '/api/products/' + productId, { quantity: 2 }); r = await owner('GET', '/api/notifications?afterSeq=0');
  ok('owner is notified of price/stock/barcode changes', r.json.notifications.some(n => /Produit modifié/.test(n.title) && /prix 25.50 → 27.00/.test(n.body)), r.json.notifications.map(n => n.title + ' ' + n.body));
  r = await owner('PATCH', '/api/products/' + productId, { quantity: 2 }); // restore stock to the value the overview checks below expect
  r = await owner('GET', '/api/overview'); ok('owner overview counts the sale', r.json.salesCount === 1 && r.json.revenueCents === 5100, r.json);
  ok('low-stock alert raised (4 -> 2, threshold 3)', r.json.lowStock && r.json.lowStock.length === 1, r.json.lowStock);
  r = await owner('GET', '/api/notifications?afterSeq=0'); ok('owner notifications include the sale', r.json.notifications.some(n => /V-\d{4}-\d{5}/.test(n.title + n.body) || /vente/i.test(n.title)), r.json.notifications.map(n => n.title));

  // ---- owner phone pairing (Android owner app) ----
  r = await owner('GET', '/api/me'); const adminId = r.json.user.id;
  r = await cashier('POST', '/api/team/' + bossId + '/owner-pairing'); ok('a worker cannot create an owner pairing code', r.status === 403 || r.status === 401, r);
  r = await boss('POST', '/api/team/' + adminId + '/owner-pairing'); ok('an owner cannot pair a phone to the admin account', r.status === 403, r);
  r = await boss('POST', '/api/team/' + bossId + '/owner-pairing'); ok('an owner can pair a phone to their own account', r.status === 201 && /^[A-F0-9]{12}$/.test(r.json.code) && r.json.kind === 'owner', r);
  const phoneCode = r.json.code;
  r = await anon('POST', '/api/owner/enroll', { code: 'AAAAAAAAAAAA' }); ok('wrong pairing code refused', r.status === 401, r);
  const ownerPhone = jar(); r = await ownerPhone('POST', '/api/owner/enroll', { code: phoneCode.slice(0, 4) + '-' + phoneCode.slice(4), deviceName: 'Pixel de test' });
  ok('phone enrolls (dashes tolerated) and gets a long device token + a session', r.status === 201 && /^[a-f0-9]{64}$/.test(r.json.deviceToken) && r.json.user.role === 'owner', r);
  const deviceToken = r.json.deviceToken;
  r = await ownerPhone('GET', '/api/overview'); ok('the enrolment session can read the owner dashboard', r.status === 200, r);
  r = await anon('POST', '/api/owner/enroll', { code: phoneCode }); ok('a pairing code works only once', r.status === 401, r);
  const ownerPhone2 = jar(); r = await ownerPhone2('POST', '/api/owner/device-login', { deviceToken }); ok('device token signs the phone in later without any code or password', r.status === 200 && r.json.user.role === 'owner', r);
  r = await ownerPhone2('GET', '/api/overview'); ok('device-login session works', r.status === 200, r);
  r = await anon('POST', '/api/owner/device-login', { deviceToken: 'a'.repeat(64) }); ok('unknown token refused', r.status === 401, r);
  r = await anon('POST', '/api/owner/device-login', { deviceToken: 'nonsense' }); ok('malformed token refused', r.status === 401, r);
  r = await boss('GET', '/api/team'); const bossCard = r.json.users.find(u => u.id === bossId);
  ok('the team list shows the paired phone (and never its token)', bossCard.devices.length === 1 && bossCard.devices[0].name === 'Pixel de test' && !JSON.stringify(r.json).includes(deviceToken), bossCard.devices);
  const oneDevice = bossCard.devices[0].id;
  r = await cashier('DELETE', '/api/owner/devices/' + oneDevice); ok('a worker cannot revoke a phone', r.status === 403 || r.status === 401, r);
  r = await owner('DELETE', '/api/owner/devices/' + oneDevice); ok('the admin can revoke an owner phone', r.status === 200, r);
  r = await anon('POST', '/api/owner/device-login', { deviceToken }); ok('a revoked phone can no longer sign in', r.status === 401, r);
  r = await boss('POST', '/api/team/' + bossId + '/owner-pairing'); const code2 = r.json.code; r = await jar()('POST', '/api/owner/enroll', { code: code2, deviceName: 'Second' }); const token2 = r.json.deviceToken;
  r = await anon('POST', '/api/owner/device-logout', { deviceToken: token2 }); ok('logging out of the app deactivates the phone on the till', r.status === 200, r);
  r = await anon('POST', '/api/owner/device-login', { deviceToken: token2 }); ok('...and its token stops working', r.status === 401, r);

  // ---- one-step worker creation ----
  r = await boss('POST', '/api/team', { name: 'Fatima Zahra', role: 'cashier', generatePin: true, canReceiveStock: true });
  ok('wizard: worker created from just a name, with a generated 6-digit code and a derived username', r.status === 201 && /^\d{6}$/.test(r.json.pin) && r.json.user.username === 'fatimazahra' && r.json.user.canReceiveStock === true, r);
  const fatimaPin = r.json.pin;
  r = await boss('POST', '/api/team', { name: 'Fatima Zahra', role: 'cashier', pin: '864209' }); ok('wizard: same name gets a unique username and keeps the chosen code', r.status === 201 && r.json.user.username === 'fatimazahra2' && r.json.pin === undefined, r);
  r = await boss('POST', '/api/team', { name: 'Zineb', role: 'cashier', pin: '864209' }); ok('wizard: a code already in use is refused', r.status === 409, r);
  r = await boss('POST', '/api/team', { name: 'Zineb', role: 'cashier', pin: '12' }); ok('wizard: a too-short code is refused', r.status === 400, r);
  r = await boss('GET', '/api/team'); ok('refused attempts leave no half-created account', !r.json.users.some(u => u.name === 'Zineb'), r.json.users.map(u => u.name));
  const fatima = jar(); r = await fatima('POST', '/api/worker/pin-login', { pin: fatimaPin }); ok('the new worker signs in with the generated code', r.status === 200 && r.json.user.canReceiveStock === true, r);
  r = await anon('GET', '/api/update/idle'); ok('idle endpoint answers on the till itself', r.status === 200 && typeof r.json.idleSeconds === 'number', r);

  // ---- detection of the previous software's export ----
  const legacyDir = path.resolve(__dirname, '..', '..', '_legacytest'); fs.mkdirSync(legacyDir, { recursive: true });
  const legacyCsv = 'Article;Famille;PRIX_A;PRIX_V;Qté;Alert\r\nDOLIPRANE 1G;MEDICAMENTS;12,50;18,00;40;5\r\nSAVON DOUX;HYGIENE;6,00;9,50;12;3\r\n';
  fs.writeFileSync(path.join(legacyDir, 'Articles_15-10-2026 22-35-00-touts-ar.csv'), Buffer.from(legacyCsv, 'latin1'));
  fs.writeFileSync(path.join(legacyDir, 'export-sans-nom-clair.csv'), Buffer.from(legacyCsv, 'latin1'));
  fs.writeFileSync(path.join(legacyDir, 'autre-fichier.csv'), 'colonne1;colonne2\r\n1;2\r\n');
  r = await cashier('GET', '/api/legacy-export/scan'); ok('a worker cannot scan the till for files', r.status === 403 || r.status === 401, r);
  r = await owner('GET', '/api/legacy-export/scan');
  const mine = (r.json.candidates || []).filter(c => c.folder.endsWith('_legacytest'));
  ok('scan finds the old export by name AND a differently-named one by its LOGICA headers', mine.length === 2 && mine.some(c => /^Articles_/.test(c.fileName)) && mine.some(c => c.fileName === 'export-sans-nom-clair.csv'), mine);
  ok('scan ignores unrelated CSV files', !(r.json.candidates || []).some(c => c.fileName === 'autre-fichier.csv'), r.json.candidates);
  r = await owner('GET', '/api/legacy-export?id=' + encodeURIComponent(mine.find(c => /^Articles_/.test(c.fileName)).id));
  ok('the detected file loads through its id', r.status === 200 && Buffer.from(r.json.contentBase64, 'base64').toString('latin1') === legacyCsv, r.status);
  r = await owner('GET', '/api/legacy-export?id=' + encodeURIComponent('..\\..\\Windows\\win.ini')); ok('an arbitrary path cannot be read through the endpoint', r.status === 404, r);
  fs.rmSync(legacyDir, { recursive: true, force: true });

  // ---- short PIN login ----
  r = await boss('POST', '/api/team', { name: 'Nadia', username: 'nadia', role: 'cashier' }); const nadia = r.json.user.id;
  r = await owner('POST', '/api/team/' + sara + '/pin', { pin: '123' }); ok('3-character code refused', r.status === 400, r);
  r = await owner('POST', '/api/team/' + sara + '/pin', { pin: 'x'.repeat(33) }); ok('33-character code refused', r.status === 400, r);
  r = await owner('POST', '/api/team/' + sara + '/pin', { pin: 'Caisse#2026' }); ok('letters and symbols are accepted as a code', r.status === 200, r);
  r = await owner('POST', '/api/team/' + sara + '/pin', { pin: '482913' }); ok('owner sets a PIN for a worker', r.status === 200, r);
  r = await owner('POST', '/api/team/' + nadia + '/pin', { pin: '482913' }); ok('same PIN refused for a second worker', r.status === 409, r);
  r = await boss('POST', '/api/team/' + nadia + '/pin', {}); ok('owner can generate a random PIN', r.status === 200 && /^\d{6}$/.test(r.json.pin) && r.json.generated === true, r);
  const nadiaPin = r.json.pin;
  r = await cashier('POST', '/api/team/' + nadia + '/pin', { pin: '246810' }); ok('a worker cannot set PINs', r.status === 403, r);
  const pinSession = jar();
  r = await pinSession('POST', '/api/worker/pin-login', { pin: '482913' }); ok('PIN logs the right worker in', r.status === 200 && r.json.user.username === 'sara', r);
  r = await pinSession('GET', '/api/products'); ok('PIN session can use the till', r.status === 200, r);
  r = await anon('POST', '/api/worker/pin-login', { code: nadiaPin }); ok('second worker PIN works via the single-field "code" form', r.status === 200 && r.json.user.username === 'nadia', r);
  r = await anon('POST', '/api/worker/pin-login', { pin: '999000' }); ok('wrong PIN refused', r.status === 401, r);
  r = await owner('GET', '/api/team'); ok('team list says who has a PIN but never exposes it', r.json.users.find(u => u.id === sara).has_pin === 1 && !JSON.stringify(r.json).includes('482913') && !JSON.stringify(r.json).includes('pin_hash'), r.json.users.map(u => u.has_pin));
  r = await owner('POST', '/api/team/' + sara + '/pin', { remove: true }); ok('owner removes a PIN', r.status === 200, r);
  r = await anon('POST', '/api/worker/pin-login', { pin: '482913' }); ok('removed PIN no longer works', r.status === 401, r);
  await new Promise(r => setTimeout(r, 61000));   // let the per-minute rate-limit window pass, so the lockout rule itself is what gets tested
  const seqBefore = (await owner('GET', '/api/notifications?afterSeq=0')).json.latestSequence;
  for (let i = 0; i < 9; i++) await anon('POST', '/api/worker/pin-login', { pin: '00000' + i });
  r = await anon('POST', '/api/worker/pin-login', { pin: nadiaPin }); ok('PIN entry locks after repeated failures (even for a right PIN)', r.status === 429, r);
  r = await owner('GET', '/api/notifications?afterSeq=' + seqBefore); ok('owner is notified of the lockout', r.json.notifications.some(n => /PIN répétées/.test(n.title)), r.json.notifications.map(n => n.title));

  await new Promise(r => setTimeout(r, 600));
  await stop(); await start();
  const owner2 = jar();
  r = await owner2('POST', '/api/login', { username: 'owner', password: 'correct-horse-9' }); ok('data survives restart: owner can log in', r.status === 200, r);
  r = await owner2('GET', '/api/overview'); ok('data survives restart: sale still there', r.json.salesCount === 1, r.json);
  r = await owner2('POST', '/api/login', { username: 'owner', password: 'wrong-password-1' }); ok('wrong password refused', r.status === 401, r);
  ok('backup folder created on second start', fs.existsSync(path.join(DATA, 'backups')) && fs.readdirSync(path.join(DATA, 'backups')).length === 1);

  for (const f of ['/icons.js', '/icons-LICENSE.txt', '/img/mark.png', '/img/mark-light.png', '/img/mark-black.png', '/img/logo-full-light.png', '/img/favicon.ico', '/img/app-icon-180.png']) { r = await fetch(BASE + f); ok('brand/icon file ' + f + ' is served', r.status === 200); }
  r = await fetch(BASE + '/shop'); ok('/shop page served', r.status === 200);
  r = await fetch(BASE + '/PromedPara-Owner.apk'); const apk = Buffer.from(await r.arrayBuffer()); ok('owner APK downloadable and intact (zip header)', r.status === 200 && apk.length === fs.statSync(path.join(KIT, 'android', 'PromedPara-Owner.apk')).size && apk.slice(0, 2).toString() === 'PK', { status: r.status, len: apk.length });
  await stop();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* scratch data of this test only */ }
  const failed = results.filter(x => !x).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); try { proc.kill(); } catch (x) { /* */ } process.exit(1); });
