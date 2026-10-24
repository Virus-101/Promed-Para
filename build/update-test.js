'use strict';
// End-to-end test of the auto-update chain against a local fake "GitHub", using the real Node 12 x86 runtime for the swap.
// Run after building the kit:  node build.js && node update-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const core = require('./updater-core');
const { createRelease } = require('./make-release');
const { create } = require(path.join(KIT, 'electron', 'resources', 'app', 'updater'));

const PORT = 4192, HTTP_PORT = 4291;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ppk-test-'));
const ROOT = path.join(T, 'root'), DATA = path.join(ROOT, 'data');
const publicKey = fs.readFileSync(path.join(__dirname, 'update-public.pem'), 'utf8');
const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function copyDir(from, to) { core.mkdirp(to); for (const n of fs.readdirSync(from)) { const a = path.join(from, n), b = path.join(to, n); if (fs.lstatSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); } }
function status() { return new Promise(res => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/status', timeout: 1500 }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } }); }); r.on('error', () => res(null)); r.on('timeout', () => { r.destroy(); res(null); }); }); }
async function waitVersion(v, seconds) { for (let i = 0; i < seconds * 2; i++) { const s = await status(); if (s && s.version === v) return true; await sleep(500); } return false; }
function stopServer() { try { const out = cp.execSync('netstat -ano -p tcp', { encoding: 'utf8' }); for (const l of out.split(/\r?\n/)) { const t = l.trim().split(/\s+/); if (t[3] === 'LISTENING' && t[1].endsWith(':' + PORT)) cp.execSync('taskkill /F /PID ' + t[4], { stdio: 'ignore' }); } } catch (e) { /* none */ } }
function startServer() { const c = cp.spawn(path.join(ROOT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(ROOT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1' }), detached: true, stdio: 'ignore' }); c.unref(); }

// kit-shaped folder at a given version, with an optional tweak
function makeKit(version, tweak) {
  const dir = path.join(T, 'kit-' + version + '-' + Math.random().toString(36).slice(2, 6));
  copyDir(path.join(ROOT, 'app'), path.join(dir, 'app')); copyDir(path.join(ROOT, 'electron', 'resources', 'app'), path.join(dir, 'electron', 'resources', 'app')); copyDir(path.join(ROOT, 'tools'), path.join(dir, 'tools'));
  fs.writeFileSync(path.join(dir, 'app', 'version.json'), JSON.stringify({ version }));
  if (tweak) tweak(dir);
  return dir;
}

(async () => {
  // Installed root = copy of the built kit (without the 190 MB Electron binaries)
  copyDir(path.join(KIT, 'app'), path.join(ROOT, 'app')); copyDir(path.join(KIT, 'runtime'), path.join(ROOT, 'runtime')); copyDir(path.join(KIT, 'tools'), path.join(ROOT, 'tools'));
  copyDir(path.join(KIT, 'electron', 'resources', 'app'), path.join(ROOT, 'electron', 'resources', 'app'));
  core.mkdirp(path.join(ROOT, 'config')); core.mkdirp(DATA);
  fs.writeFileSync(path.join(ROOT, 'config', 'update.json'), JSON.stringify({ repo: '', baseUrl: 'http://127.0.0.1:' + HTTP_PORT + '/', publicKey, checkEveryHours: 6, nightWindow: '03:00-05:00', idleMinutes: 0.1 }));
  process.env.PROMEDPARA_APPLY_TEST = '1';
  const installed = readJson(path.join(ROOT, 'app', 'version.json')).version;

  // fake GitHub
  let served = {};
  const web = http.createServer((req, res) => { const f = served[decodeURIComponent(req.url.slice(1))]; if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200); res.end(f); }).listen(HTTP_PORT, '127.0.0.1');
  const publish = (rel, mutate) => { served = {}; for (const n of fs.readdirSync(rel)) served[n] = fs.readFileSync(path.join(rel, n)); if (mutate) mutate(served); };
  const logs = [];
  const updater = create({ root: ROOT, dataDir: DATA, port: PORT, log: m => logs.push(m), quit: () => {} });
  const st = () => readJson(path.join(DATA, 'update-status.json'));

  startServer();
  ok('installed test copy runs and reports its version', await waitVersion(installed, 30), installed);

  // --- core safety rules
  let threw = false; try { core.extractPackage(core.buildPackage([{ rel: 'app/../evil.txt', abs: path.join(ROOT, 'app', 'version.json') }]), path.join(T, 'x1')); } catch (e) { threw = true; }
  ok('package with ../ path is refused', threw && !fs.existsSync(path.join(T, 'evil.txt')));
  threw = false; try { core.extractPackage(core.buildPackage([{ rel: 'runtime/node.exe', abs: path.join(ROOT, 'app', 'version.json') }]), path.join(T, 'x2')); } catch (e) { threw = true; }
  ok('package that tries to replace runtime/ is refused', threw);

  // --- nothing published yet
  served = {};
  await updater.check('test'); ok('no release published: reported, not an error', /Aucune mise/.test(st().message), st());

  // --- good release 9.1.1
  const good = path.join(T, 'rel-good'); createRelease({ kitDir: makeKit('9.1.1', d => fs.writeFileSync(path.join(d, 'app', 'public', 'new-feature.txt'), 'hello')), outDir: good, version: '9.1.1', notes: 'test' });

  publish(good, f => { const k = Object.keys(f).find(n => n.endsWith('.ppk')); const b = Buffer.from(f[k]); b[b.length - 5] ^= 1; f[k] = b; });
  await updater.check('test'); ok('tampered package is rejected (checksum)', !st().staged && /ontr|incorrect|invalide|Vérification impossible/.test(st().message), st());

  publish(good, f => { f['latest.json'] = Buffer.from(f['latest.json'].toString().replace('9.1.1', '9.9.9')); });
  await updater.check('test'); ok('forged manifest is rejected (signature)', /Signature invalide/.test(st().message) && !st().staged, st());

  publish(good, f => { f['latest.json.sig'] = Buffer.from('AAAA'); });
  await updater.check('test'); ok('garbage signature is rejected', /Signature invalide/.test(st().message), st());

  const old = path.join(T, 'rel-old'); createRelease({ kitDir: makeKit('2.0.0'), outDir: old, version: '2.0.0' });
  publish(old); await updater.check('test'); ok('older (replayed) release is ignored: no downgrade', !st().staged && /à jour/.test(st().message), st());

  publish(good); await updater.check('test');
  ok('good signed release is downloaded, verified and staged', st().staged === '9.1.1' && fs.existsSync(path.join(ROOT, 'updates', 'staged-9.1.1', '.ready')), st());

  // --- apply
  fs.writeFileSync(path.join(DATA, 'marker.txt'), 'data must survive');
  ok('apply starts the helper', updater.applyStaged() === true);
  ok('new version comes up and passes the health check', await waitVersion('9.1.1', 60), await status());
  ok('new files are in place', fs.existsSync(path.join(ROOT, 'app', 'public', 'new-feature.txt')));
  ok('previous version is kept for rollback', fs.existsSync(path.join(ROOT, 'versions', installed, 'app', 'version.json')));
  ok('database was backed up before the update', fs.readdirSync(path.join(DATA, 'backups')).some(n => /^avant-mise-a-jour-/.test(n)));
  ok('data folder untouched by the update', fs.readFileSync(path.join(DATA, 'marker.txt'), 'utf8') === 'data must survive');
  for (let i = 0; i < 40 && fs.existsSync(path.join(ROOT, 'updates', 'staged-9.1.1')); i++) await sleep(250);
  ok('staging folder cleaned up', !fs.existsSync(path.join(ROOT, 'updates', 'staged-9.1.1')));

  // --- manual rollback to the saved version
  ok('rollback helper starts', updater.rollbackTo(installed) === true);
  ok('rollback restores the previous version', await waitVersion(installed, 60), await status());
  ok('the newer version is saved too (can go forward again)', fs.existsSync(path.join(ROOT, 'versions', '9.1.1', 'app', 'version.json')));
  ok('rollback removed the new-feature file', !fs.existsSync(path.join(ROOT, 'app', 'public', 'new-feature.txt')));

  // --- broken release must roll itself back
  const bad = path.join(T, 'rel-bad');
  createRelease({ kitDir: makeKit('9.1.2', d => fs.writeFileSync(path.join(d, 'app', 'main.js'), 'process.exit(3);')), outDir: bad, version: '9.1.2' });
  publish(bad); await updater.check('test'); ok('broken release is staged (it looks valid)', st().staged === '9.1.2', st());
  updater.applyStaged();
  const failFile = path.join(ROOT, 'updates', 'failed.json');
  for (let i = 0; i < 120 && !fs.existsSync(failFile); i++) await sleep(500);
  ok('broken release fails the health check (helper gives its verdict)', fs.existsSync(failFile));
  ok('the till is back on the working version and answering', await waitVersion(installed, 60), await status());
  ok('the failure is remembered, the broken version will not be retried', JSON.stringify(readJson(path.join(ROOT, 'updates', 'failed.json'))) === '["9.1.2"]');
  await updater.check('test'); ok('status explains it was ignored', /a échoué/.test(st().message) && !st().staged, st());
  ok('working folders intact after failed update', fs.existsSync(path.join(ROOT, 'app', 'server.bundle.js')) && fs.existsSync(path.join(ROOT, 'tools', 'check.ps1')));

  // --- housekeeping: only what is necessary stays in the install folder
  for (const v of ['1.0.0', '1.0.1', '1.0.2']) core.mkdirp(path.join(ROOT, 'versions', v));
  core.mkdirp(path.join(ROOT, 'updates', 'staged-9.9.9')); core.mkdirp(path.join(ROOT, 'updates', 'failed-app-1000000000000')); core.mkdirp(path.join(ROOT, 'updates', 'failed-app-' + Date.now()));
  const staleTmp = path.join(os.tmpdir(), 'promedpara-apply-111'); core.mkdirp(staleTmp); const twoDaysAgo = new Date(Date.now() - 2 * 86400000); fs.utimesSync(staleTmp, twoDaysAgo, twoDaysAgo);
  core.mkdirp(path.join(ROOT, 'logs')); fs.writeFileSync(path.join(ROOT, 'logs', 'big.log'), Buffer.alloc(2 * 1024 * 1024, 65));
  updater.housekeeping();
  ok('housekeeping keeps only the 2 newest saved versions', JSON.stringify(fs.readdirSync(path.join(ROOT, 'versions')).sort()) === JSON.stringify(['1.0.2', '9.1.1']), fs.readdirSync(path.join(ROOT, 'versions')));
  ok('housekeeping removes unready staging and old failed leftovers (keeps a fresh failure for inspection)', !fs.existsSync(path.join(ROOT, 'updates', 'staged-9.9.9')) && !fs.existsSync(path.join(ROOT, 'updates', 'failed-app-1000000000000')) && fs.readdirSync(path.join(ROOT, 'updates')).some(n => /^failed-app-\d{13}$/.test(n) && n !== 'failed-app-1000000000000'), fs.readdirSync(path.join(ROOT, 'updates')));
  ok('housekeeping removes stale temp folders', !fs.existsSync(staleTmp));
  ok('housekeeping shrinks oversized logs', fs.statSync(path.join(ROOT, 'logs', 'big.log')).size <= 200000);
  ok('failure memory and last result are never deleted', fs.existsSync(path.join(ROOT, 'updates', 'failed.json')) && fs.existsSync(path.join(ROOT, 'updates', 'last-apply.json')));

  // --- fully automatic: installs by itself once the till has been idle, but never while it is in use
  const auto = path.join(T, 'rel-auto'); createRelease({ kitDir: makeKit('9.1.3'), outDir: auto, version: '9.1.3' });
  publish(auto); await updater.check('test'); ok('next release is staged', st().staged === '9.1.3', st());
  const api = (m, u, b, cookie) => fetch('http://127.0.0.1:' + PORT + u, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: b ? JSON.stringify(b) : undefined });
  const su = await api('POST', '/api/setup', { name: 'Test Owner', username: 'owner', password: 'correct-horse-9' }); const cookie = su.headers.get('set-cookie').split(';')[0];
  await api('GET', '/api/me', null, cookie);   // activity right now
  await updater.tick(); await sleep(2500);
  ok('NOT installed while the till was just used', (await status()).version === installed && st().staged === '9.1.3', await status());
  await sleep(7000);
  await updater.tick();
  ok('installed automatically after the idle time, with nobody pressing anything', await waitVersion('9.1.3', 60), await status());

  stopServer(); web.close();
  await sleep(500);
  try { core.rimraf(T); } catch (e) { /* ignore */ }
  const failed = results.filter(x => !x).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' update checks passed');
  if (failed) console.log(logs.slice(-12).join('\n'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); stopServer(); process.exit(1); });
