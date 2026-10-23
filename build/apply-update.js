'use strict';
// Update/rollback helper. Started detached by the Electron app (using the bundled Node 12), then the app exits.
// Steps: wait for the app to exit -> stop the server -> back up the database -> swap folders (old versions are kept)
// -> start the app -> health check (/api/status must report the expected version) -> otherwise swap everything back.
const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const core = require('./updater-core');

const args = {};
for (const a of process.argv.slice(2)) { const m = /^--([a-z-]+)=(.*)$/.exec(a); if (m) args[m[1]] = m[2]; }
const ROOT = args.root;
const PORT = Number(args.port || 4173);
const DATA_DIR = args.data || path.join(ROOT, 'data');
const MODE = args.mode || 'apply';               // apply | rollback
const TARGET = args.version;                      // version we expect to be running afterwards
const SOURCE = args.source;                       // staged dir (apply) or versions/<v> dir (rollback)
const HEALTH_SECONDS = Number(args.health || 90);
const KEEP_VERSIONS = 3;
const TEST = args.test === '1';                   // tests start the server directly instead of the Electron app

const DIRS = { app: 'app', shell: path.join('electron', 'resources', 'app'), tools: 'tools' };
const logFile = path.join(ROOT, 'logs', 'update.log');
function log(message) { try { core.mkdirp(path.dirname(logFile)); fs.appendFileSync(logFile, new Date().toISOString() + '  ' + message + '\n'); } catch (e) { /* ignore */ } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
const versionOf = dir => (readJson(path.join(dir, 'version.json'), {}) || {}).version || '';

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function listeningPid() {
  try {
    const out = cp.execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
    for (const line of out.split(/\r?\n/)) { const t = line.trim().split(/\s+/); if (t.length >= 5 && t[3] === 'LISTENING' && t[1].slice(-(':' + PORT).length) === ':' + PORT) return Number(t[4]); }
  } catch (e) { /* ignore */ }
  return 0;
}
async function stopServer() {
  for (let i = 0; i < 10; i++) {
    const pid = listeningPid();
    if (!pid) return;
    try { cp.execSync('taskkill /F /PID ' + pid, { windowsHide: true, stdio: 'ignore' }); } catch (e) { /* retry */ }
    await sleep(700);
  }
}
function status(timeout) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/status', timeout: timeout || 1500 }, res => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
async function renameRetry(from, to) {
  for (let i = 0; i < 20; i++) {
    try { fs.renameSync(from, to); return; } catch (e) { if (i === 19) throw e; await sleep(500); }
  }
}
function launchApp() {
  if (TEST) {
    const env = Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA_DIR, PORT: String(PORT), HOST: '127.0.0.1' });
    const child = cp.spawn(path.join(ROOT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(ROOT, 'app'), env, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref(); return;
  }
  const exe = path.join(ROOT, 'electron', 'PromedPara.exe');
  const child = cp.spawn(exe, [], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.unref();
}

// Moves the current folders into versions/<currentVersion>/ and puts the new ones in place. Returns an undo function.
async function swapIn(sourceDirs, currentVersion) {
  const stash = path.join(ROOT, 'versions', currentVersion || ('unknown-' + Date.now()));
  core.rimraf(stash); core.mkdirp(stash);
  const done = [];
  try {
    for (const key of Object.keys(DIRS)) {
      const live = path.join(ROOT, DIRS[key]);
      if (!sourceDirs[key]) continue;
      if (fs.existsSync(live)) { await renameRetry(live, path.join(stash, key)); done.push({ key, stashed: true }); }
      await renameRetry(sourceDirs[key], live); done.push({ key, placed: true });
    }
  } catch (e) { await undoSwap(done, stash, sourceDirs); throw e; }
  return async () => undoSwap(done, stash, sourceDirs);
}
async function undoSwap(done, stash, sourceDirs) {
  for (let i = done.length - 1; i >= 0; i--) {
    const d = done[i], live = path.join(ROOT, DIRS[d.key]);
    try {
      if (d.placed) await renameRetry(live, path.join(ROOT, 'updates', 'failed-' + d.key + '-' + Date.now()));
      if (d.stashed) await renameRetry(path.join(stash, d.key), live);
    } catch (e) { log('UNDO ERROR ' + d.key + ': ' + e.message); }
  }
}
function pruneVersions(current) {
  const dir = path.join(ROOT, 'versions');
  if (!fs.existsSync(dir)) return;
  const names = fs.readdirSync(dir).filter(n => core.isVersion(n) && n !== current).sort((a, b) => core.compareVersions(b, a));
  for (const n of names.slice(KEEP_VERSIONS)) { try { core.rimraf(path.join(dir, n)); log('ancienne version supprimee: ' + n); } catch (e) { /* ignore */ } }
}
function backupDatabase(from, to) {
  const db = path.join(DATA_DIR, 'promedpara.sqlite');
  if (!fs.existsSync(db)) return;
  const dir = path.join(DATA_DIR, 'backups'); core.mkdirp(dir);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  fs.copyFileSync(db, path.join(dir, 'avant-mise-a-jour-' + from + '-vers-' + to + '-' + stamp + '.sqlite'));
  const olds = fs.readdirSync(dir).filter(n => /^avant-mise-a-jour-/.test(n)).sort();
  while (olds.length > 8) fs.unlinkSync(path.join(dir, olds.shift()));
}
function recordFailure(version, message) {
  const file = path.join(ROOT, 'updates', 'failed.json'); core.mkdirp(path.dirname(file));
  const list = readJson(file, []); if (list.indexOf(version) < 0) list.push(version);
  fs.writeFileSync(file, JSON.stringify(list));
  fs.writeFileSync(path.join(ROOT, 'updates', 'last-apply.json'), JSON.stringify({ ok: false, version, at: new Date().toISOString(), error: message }));
}

async function main() {
  core.mkdirp(path.join(ROOT, 'updates'));
  log('=== ' + MODE + ' vers ' + TARGET + ' (source ' + SOURCE + ')');
  if (args.pid) { for (let i = 0; i < 60 && pidAlive(Number(args.pid)); i++) await sleep(500); }
  await stopServer();
  const current = versionOf(path.join(ROOT, 'app'));
  log('version actuelle ' + current);

  // Source folders: staged update (kit-relative layout) or a saved version (flat layout)
  const sources = MODE === 'rollback'
    ? { app: path.join(SOURCE, 'app'), shell: path.join(SOURCE, 'shell'), tools: path.join(SOURCE, 'tools') }
    : { app: path.join(SOURCE, 'app'), shell: path.join(SOURCE, 'electron', 'resources', 'app'), tools: path.join(SOURCE, 'tools') };
  for (const k of Object.keys(sources)) if (!fs.existsSync(sources[k])) delete sources[k];
  if (!sources.app) throw new Error('dossier app absent dans la source');
  if (versionOf(sources.app) !== TARGET) throw new Error('la source ne contient pas la version ' + TARGET);

  backupDatabase(current, TARGET);
  const undo = await swapIn(sources, current);
  // Loose files (guides, launchers, manifest) are small and low-risk: overwritten in place.
  if (MODE !== 'rollback') for (const f of core.ALLOWED_ROOT_FILES) { const s = path.join(SOURCE, f); if (fs.existsSync(s)) { try { fs.copyFileSync(s, path.join(ROOT, f)); } catch (e) { log('fichier ignore ' + f + ': ' + e.message); } } }
  log('dossiers remplaces, demarrage...');
  launchApp();
  let healthy = false;
  for (let i = 0; i < HEALTH_SECONDS * 2; i++) {
    await sleep(500);
    const st = await status(1200);
    if (st && st.business === 'PromedPara' && st.version === TARGET) { healthy = true; break; }
  }
  if (!healthy) {
    log('ECHEC: la nouvelle version ne repond pas, retour a la version ' + current);
    await stopServer();
    await undo();
    if (MODE !== 'rollback') recordFailure(TARGET, 'la nouvelle version ne demarre pas');
    launchApp();
    return 1;
  }
  fs.writeFileSync(path.join(ROOT, 'updates', 'last-apply.json'), JSON.stringify({ ok: true, version: TARGET, previous: current, at: new Date().toISOString(), mode: MODE }));
  if (MODE !== 'rollback') { try { core.rimraf(SOURCE); } catch (e) { /* ignore */ } }
  try { fs.rmdirSync(path.join(ROOT, 'versions', TARGET)); } catch (e) { /* not empty or absent */ }
  pruneVersions(TARGET);
  log('OK version ' + TARGET + ' en service (precedente conservee: ' + current + ')');
  return 0;
}
main().then(code => process.exit(code), e => { log('ERREUR ' + (e && e.stack || e)); try { launchApp(); } catch (x) { /* ignore */ } process.exit(2); });
