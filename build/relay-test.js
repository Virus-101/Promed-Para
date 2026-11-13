'use strict';
// End-to-end test of the internet link: a local relay, the real till (kit, Node 12), and a simulated owner phone doing exactly what the Android app does.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_relaydata');
const RELAY_PORT = 8788, TILL_PORT = 4199, RELAY = 'http://127.0.0.1:' + RELAY_PORT, TILL = 'http://127.0.0.1:' + TILL_PORT;
const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { seal, open, enrollKey } = require('../relay-client.js');

let relay, till;
const stopAll = () => { try { relay.kill(); } catch (e) { /* gone */ } try { till.kill(); } catch (e) { /* gone */ } };

// ---- the phone side, same wire format as the Android app
const phone = (tillId) => {
  const post = async (mode, key, request) => {
    const plain = JSON.stringify(Object.assign({ n: crypto.randomBytes(8).toString('hex'), t: Date.now() }, request));
    const body = JSON.stringify({ m: mode, d: seal(key, plain) });
    const res = await fetch(RELAY + '/p/' + tillId, { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (res.status !== 200) return { relayStatus: res.status, json };
    if (json.e) return { relayStatus: 200, auth: json.e };
    const inner = JSON.parse(open(key, json.d));
    return { relayStatus: 200, status: inner.s, cookie: inner.c, body: inner.b ? JSON.parse(inner.b) : null, replay: body, mode };
  };
  return { post };
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  relay = spawn(process.execPath, [path.join(__dirname, '..', 'relay', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(RELAY_PORT) }) });
  for (let i = 0; i < 40; i++) { try { await fetch(RELAY + '/'); break; } catch (e) { await sleep(200); } }
  till = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(TILL_PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: RELAY, PROMEDPARA_ENABLE_PHONE_APPROVAL: '1' }) });
  for (let i = 0; i < 60; i++) { try { await fetch(TILL + '/api/status'); break; } catch (e) { await sleep(250); } }

  let cookie = '';
  const api = async (method, url, body, headers) => {
    const res = await fetch(TILL + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, headers || {}), body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  let r = await api('POST', '/api/setup', { name: 'Hicham Amini', pin: 'Remote-Test-1' });
  ok('till set up', r.status === 201, r);
  const adminId = r.json.user.id;
  await sleep(2500);
  r = await api('POST', '/api/team/' + adminId + '/owner-pairing', {});
  ok('pairing response carries the internet address', r.status === 201 && r.json.remote && /^http:\/\/127\.0\.0\.1:8788\/[a-f0-9]{16}$/.test(r.json.remote.address), r.json);
  const code = r.json.code, tillId = r.json.remote.address.split('/').pop();
  r = await api('GET', '/api/remote/status');
  ok('till reports the link as connected', r.json.enabled && r.json.connected, r.json);

  const p = phone(tillId);
  const k0 = enrollKey(code, tillId);
  let e = await p.post('e', k0, { x: 'POST', p: '/api/owner/enroll', c: '', b: JSON.stringify({ code, pin: 'Remote-Test-1', deviceName: 'Test phone' }) });
  ok('phone enrols through the relay with the one-time code', e.status === 201 && e.body.deviceToken && /^[a-f0-9]{64}$/.test(e.body.key) && e.body.tillId === tillId, e);
  const key = Buffer.from(e.body.key, 'hex'), deviceToken = e.body.deviceToken;
  let phoneCookie = e.cookie;

  e = await p.post('e', k0, { x: 'POST', p: '/api/owner/enroll', c: '', b: JSON.stringify({ code, deviceName: 'Again' }) });
  ok('the one-time code cannot enrol twice', e.status && e.status >= 400, e);

  e = await p.post('k', key, { x: 'POST', p: '/api/owner/device-login', c: '', b: JSON.stringify({ deviceToken }) });
  ok('device login through the relay returns a session', e.status === 200 && /^pp_session=/.test(e.cookie) && e.body.user.isAdmin, e);
  const alertsCookie = e.cookie;
  e = await p.post('k', key, { x: 'GET', p: '/api/overview', c: alertsCookie, b: '' });
  ok('through the relay the device token alone cannot read the dashboard', e.status === 403, e);
  e = await p.post('k', key, { x: 'POST', p: '/api/owner/unlock', c: '', b: JSON.stringify({ deviceToken, pin: 'Remote-Test-1' }) });
  ok('the personal code unlocks it through the relay', e.status === 200 && /^pp_session=/.test(e.cookie), e);
  phoneCookie = e.cookie;
  e = await p.post('k', key, { x: 'GET', p: '/api/overview', c: phoneCookie, b: '' });
  ok('overview through the relay', e.status === 200 && typeof e.body.productCount === 'number', e);
  e = await p.post('k', key, { x: 'GET', p: '/api/notifications?afterSeq=0', c: phoneCookie, b: '' });
  ok('notifications through the relay', e.status === 200 && Array.isArray(e.body.notifications) && e.body.notifications.length > 0, e);

  const bad = await p.post('k', key, { x: 'GET', p: '/api/team', c: phoneCookie, b: '' });
  ok('routes outside the allow-list are refused', bad.status === 403, bad);
  const pin = await p.post('k', key, { x: 'POST', p: '/api/worker/pin-login', c: '', b: JSON.stringify({ code: 'Remote-Test-1' }) });
  ok('PIN login is impossible through the relay', pin.status === 403, pin);
  const direct = await api('POST', '/api/worker/pin-login', { code: 'Remote-Test-1' }, { 'x-promed-relay': 'x' });
  ok('a request flagged as coming from the relay is never treated as the till itself', direct.status === 403, direct);

  const replayed = await fetch(RELAY + '/p/' + tillId, { method: 'POST', body: e.replay }).then(x => x.json());
  const replayInner = replayed.d ? JSON.parse(open(key, replayed.d)) : replayed;
  ok('a recorded request cannot be replayed', replayInner.s === 400, replayInner);
  const wrong = await p.post('k', crypto.randomBytes(32), { x: 'GET', p: '/api/overview', c: phoneCookie, b: '' });
  ok('a wrong key gets nothing', wrong.auth === 'auth', wrong);
  const ghost = await fetch(RELAY + '/p/0123456789abcdef', { method: 'POST', body: '{}' });
  ok('an unknown till id is reported offline', ghost.status === 503, ghost.status);
  const sniff = JSON.stringify(await fetch(RELAY + '/').then(x => x.json()));
  ok('relay holds no readable shop data', !/Hicham|Remote-Test/.test(sniff), sniff);

  // ---- worker: pair through the relay, then log in with the QR code shown on the till
  r = await api('POST', '/api/team', { name: 'Sara Test', role: 'cashier', pin: '4821' });
  const sara = r.json.user.id;
  r = await api('POST', '/api/team/' + sara + '/phone-pairing', {});
  ok('worker pairing response carries the internet address', r.status === 201 && r.json.remote && r.json.remote.address.endsWith(tillId), r.json);
  const workerCode = r.json.code;
  let w = await p.post('e', enrollKey(workerCode, tillId), { x: 'POST', p: '/api/worker/enroll', c: '', b: JSON.stringify({ code: workerCode }) });
  ok('worker phone enrols through the relay and receives the worker key', w.status === 201 && /^[a-f0-9]{64}$/.test(w.body.key) && w.body.key !== key.toString('hex') && w.body.deviceId && w.body.secret, w);
  const wkey = Buffer.from(w.body.key, 'hex'), deviceId = w.body.deviceId, secret = Buffer.from(w.body.secret, 'hex');
  const proofFor = nonce => crypto.createHmac('sha256', secret).update('qr:' + nonce + ':' + deviceId).digest('hex');
  const nonceOf = payload => new URL(payload).searchParams.get('c');

  r = await api('POST', '/api/qr-login/start', {});
  ok('till shows a QR address pointing at the relay scan page', r.status === 200 && new RegExp('^http://127\\.0\\.0\\.1:8788/w\\?t=' + tillId + '&c=[a-f0-9]{16}').test(r.json.payload), r.json);
  let qr = r.json, nonce = nonceOf(qr.payload);
  let polled = await fetch(TILL + '/api/qr-login/' + qr.id).then(x => x.json());
  ok('login is pending until the phone approves', polled.pending === true, polled);
  let a1 = await p.post('w', wkey, { x: 'POST', p: '/api/qr-login/approve', c: '', b: JSON.stringify({ deviceId, c: nonce, proof: 'f'.repeat(64) }) });
  ok('a wrong proof is refused', a1.status === 401, a1);
  a1 = await p.post('w', wkey, { x: 'POST', p: '/api/qr-login/approve', c: '', b: JSON.stringify({ deviceId, c: nonce, proof: proofFor(nonce) }) });
  ok('the paired phone approves through the relay', a1.status === 200 && a1.body.ok, a1);
  const poll = await fetch(TILL + '/api/qr-login/' + qr.id);
  const pollJson = await poll.json();
  ok('the till logs the worker in and sets a session', poll.status === 200 && pollJson.user && pollJson.user.name === 'Sara Test' && /pp_session=/.test(poll.headers.get('set-cookie') || ''), pollJson);
  const again = await fetch(TILL + '/api/qr-login/' + qr.id);
  ok('a QR login can be used only once', again.status === 410, again.status);
  a1 = await p.post('w', wkey, { x: 'POST', p: '/api/qr-login/approve', c: '', b: JSON.stringify({ deviceId, c: nonce, proof: proofFor(nonce) }) });
  ok('an approved code cannot be approved again', a1.status === 410, a1);

  r = await api('POST', '/api/qr-login/start', {});
  qr = r.json; nonce = nonceOf(qr.payload);
  const lan = await api('POST', '/api/qr-login/approve', { deviceId, c: nonce, proof: proofFor(nonce) });
  ok('a phone on the shop Wi-Fi can approve directly too', lan.status === 200, lan);
  const lanPoll = await fetch(TILL + '/api/qr-login/' + qr.id).then(x => x.json());
  ok('and the till logs the worker in', lanPoll.user && lanPoll.user.name === 'Sara Test', lanPoll);

  const crossOwner = await p.post('k', key, { x: 'POST', p: '/api/qr-login/approve', c: '', b: '{}' });
  ok('the owner key cannot be used for worker approvals', crossOwner.status === 403, crossOwner);
  const crossWorker = await p.post('w', wkey, { x: 'GET', p: '/api/overview', c: phoneCookie, b: '' });
  ok('the worker key cannot read the owner dashboard', crossWorker.status === 403, crossWorker);
  const fromRelay = await fetch(TILL + '/api/qr-login/start', { method: 'POST', headers: { 'x-promed-relay': 'x', 'Content-Type': 'application/json' }, body: '{}' });
  ok('only the till itself can start a QR login', fromRelay.status === 403, fromRelay.status);
  const scanPage = await fetch(RELAY + '/w?t=' + tillId + '&c=abc').then(x => x.text());
  ok('the relay serves the scan page that opens the worker app', /intent:\/\/login/.test(scanPage) && /ma\.promedpara\.worker/.test(scanPage), scanPage.slice(0, 80));

  const badEnroll = await p.post('e', enrollKey('000000000000', tillId), { x: 'POST', p: '/api/owner/enroll', c: '', b: JSON.stringify({ code: '000000000000', deviceName: 'x' }) });
  const seenStatus = await api('GET', '/api/remote/status');
  ok('a failed pairing attempt is shown on the till with its reason', badEnroll.auth === 'auth' && seenStatus.json.lastAttempt && seenStatus.json.lastAttempt.ok === false && /code/.test(seenStatus.json.lastAttempt.reason), seenStatus.json);

  // ---- a till restart must not break paired phones: same internet address, same keys, no new login
  till.kill(); await sleep(1500);
  till = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(TILL_PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: RELAY, PROMEDPARA_ENABLE_PHONE_APPROVAL: '1' }) });
  for (let i = 0; i < 60; i++) { try { await fetch(TILL + '/api/status'); break; } catch (e) { await sleep(250); } }
  await sleep(3000);
  const afterRestart = JSON.parse(fs.readFileSync(path.join(DATA, 'relay.json'), 'utf8'));
  ok('the internet address is the same after a till restart', afterRestart.tillId === tillId, afterRestart.tillId);
  const relogin = await p.post('k', key, { x: 'POST', p: '/api/owner/device-login', c: '', b: JSON.stringify({ deviceToken }) });
  ok('a paired phone signs in again after the till restarted, with no new pairing', relogin.status === 200 && /^pp_session=/.test(relogin.cookie), relogin);

  // ---- an owner who cannot sign in asks the administrator for a code
  const ringRes = await fetch(RELAY + '/p/' + tillId, { method: 'POST', body: JSON.stringify({ m: 'r', name: 'Karim Owner' }) }).then(x => x.json());
  ok('ringing the administrator works through the relay without any key', ringRes.r && ringRes.r.s === 200, ringRes);
  cookie = '';   // the till restarted above, so sessions are gone: sign the administrator in again
  await api('POST', '/api/login', { username: 'Hicham Amini', password: 'Remote-Test-1' });
  const ringNotes = await api('GET', '/api/notifications?afterSeq=0');
  ok('the administrator gets a notification naming the owner', ringNotes.json.notifications.some(x => x.title === 'Demande de code' && /Karim Owner/.test(x.body)), ringNotes.json.notifications.map(x => x.title));
  const ringBad = await fetch(RELAY + '/p/' + tillId, { method: 'POST', body: JSON.stringify({ m: 'r', name: 'x' }) }).then(x => x.json());
  ok('a request without a real name is refused', ringBad.r && ringBad.r.s === 400, ringBad);

  // ---- pairing with only a name and the personal code (no address, no one-time code)
  {
    const handle = n => crypto.createHash('sha256').update('promed-handle:' + n.trim().toLowerCase()).digest('hex');
    const lookup = async n => (await (await fetch(RELAY + '/h/' + handle(n))).json()).tills;
    await sleep(1500);
    let found = await lookup('hicham AMINI');
    ok('the relay finds the till from the owner name alone', found.length === 1 && found[0].id === tillId && /^[a-f0-9]{130}$/.test(found[0].pub), found);
    ok('an unknown name finds nothing', (await lookup('Somebody Else')).length === 0);
    const appVersion = JSON.parse(fs.readFileSync(path.join(KIT, 'app', 'version.json'), 'utf8')).version;
    ok('the till reports its version to the relay', found[0].version === appVersion, { found: found[0].version, expected: appVersion });
    const status = await (await fetch(RELAY + '/s/' + tillId)).json();
    ok('anyone can ask the relay whether the till is online and which version it runs', status.online === true && status.version === appVersion, status);
    const direct = async (name, pin) => {
      const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
      const key = crypto.createHash('sha256').update(ecdh.computeSecret(Buffer.from(found[0].pub, 'hex'))).digest();
      const plain = JSON.stringify({ n: crypto.randomBytes(8).toString('hex'), t: Date.now(), x: 'POST', p: '/api/owner/enroll-direct', c: '', b: JSON.stringify({ name, pin, deviceName: 'Phone 2' }) });
      const res = await fetch(RELAY + '/p/' + tillId, { method: 'POST', body: JSON.stringify({ m: 'n', k: ecdh.getPublicKey('hex'), d: seal(key, plain) }) });
      const json = await res.json();
      if (json.e) return { auth: json.e };
      const inner = JSON.parse(open(key, json.d));
      return { status: inner.s, cookie: inner.c, body: inner.b ? JSON.parse(inner.b) : null };
    };
    let d = await direct('Hicham Amini', 'wrong-code');
    ok('a wrong personal code is refused', d.status === 401, d);
    d = await direct('Hicham Amini', 'Remote-Test-1');
    ok('name + personal code pairs the phone and returns the device key', d.status === 201 && d.body.deviceToken && /^[a-f0-9]{64}$/.test(d.body.key) && d.body.tillId === tillId && d.body.user.role === 'owner', d);
    const k2 = Buffer.from(d.body.key, 'hex');
    const again = await phone(tillId).post('k', k2, { x: 'POST', p: '/api/owner/unlock', c: '', b: JSON.stringify({ deviceToken: d.body.deviceToken, pin: 'Remote-Test-1' }) });
    ok('the new phone can then unlock with its key', again.status === 200, again);
    for (let i = 0; i < 5; i++) d = await direct('Hicham Amini', 'bad' + i);
    d = await direct('Hicham Amini', 'Remote-Test-1');
    ok('five wrong codes block pairing for ten minutes', d.status === 429, d);
    const forged = await fetch(RELAY + '/p/' + tillId, { method: 'POST', body: JSON.stringify({ m: 'n', k: '04' + 'ab'.repeat(64), d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }) });
    ok('a garbled key exchange is rejected', (await forged.json()).e === 'auth');
    // ---- an owner opening the till must approve it on the phone
    {
      r = await api('POST', '/api/security', { phoneApproval: true });
      ok('approval can be required once a phone is paired', r.status === 200 && r.json.phoneApproval === true, r);
      const admin = cookie; cookie = '';
      r = await api('POST', '/api/login', { username: 'Hicham Amini', password: 'Remote-Test-1' });
      ok('an owner sign-in on the till now waits for the phone', r.status === 202 && r.json.approval && r.json.approval.id && !cookie, r);
      const ap = r.json.approval;
      let w = await api('GET', '/api/login-approvals/' + ap.id + '?wait=' + ap.wait);
      ok('it stays pending until the phone answers', w.json.status === 'pending' && !cookie, w);
      w = await api('GET', '/api/login-approvals/' + ap.id + '?wait=wrong');
      ok('a wrong wait secret is refused', w.status === 410, w);
      const pk = phone(tillId);
      const list = await pk.post('k', k2, { x: 'GET', p: '/api/login-approvals', c: again.cookie, b: '' });
      ok('the phone sees the request through the relay', list.status === 200 && list.body.pending.length === 1 && list.body.pending[0].id === ap.id, list);
      cookie = admin;
      r = await api('POST', '/api/login-approvals/respond', { id: ap.id, decision: 'approve' });
      ok('the till itself cannot approve its own request', r.status === 403, r);
      cookie = '';
      const yes = await pk.post('k', k2, { x: 'POST', p: '/api/login-approvals/respond', c: again.cookie, b: JSON.stringify({ id: ap.id, decision: 'approve' }) });
      ok('the phone approves', yes.status === 200 && yes.body.status === 'approved', yes);
      w = await api('GET', '/api/login-approvals/' + ap.id + '?wait=' + ap.wait);
      ok('the till then opens the session', w.json.status === 'approved' && Boolean(cookie), w);
      r = await api('GET', '/api/me');
      ok('and that session works', r.status === 200 && r.json.user.role === 'owner', r);
      const admin2 = cookie; cookie = '';
      r = await api('POST', '/api/login', { username: 'Hicham Amini', password: 'Remote-Test-1' });
      const ap2 = r.json.approval;
      const no = await pk.post('k', k2, { x: 'POST', p: '/api/login-approvals/respond', c: again.cookie, b: JSON.stringify({ id: ap2.id, decision: 'refuse' }) });
      w = await api('GET', '/api/login-approvals/' + ap2.id + '?wait=' + ap2.wait);
      ok('a refusal on the phone keeps the till closed', no.status === 200 && w.json.status === 'refused' && !cookie, { no: no.status, w });
      cookie = admin2;
      r = await api('POST', '/api/security', { phoneApproval: false });
      ok('the owner can switch the approval off again', r.status === 200 && r.json.phoneApproval === false, r);
      r = await api('POST', '/api/security', { phoneLink: false });
      ok('the internet link of this till can be switched off', r.status === 200 && r.json.link.enabled === false, r);
    }
  }
  stopAll(); await sleep(800);
  fs.rmSync(DATA, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' internet-link checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); stopAll(); process.exit(1); });
