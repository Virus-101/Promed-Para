'use strict';
// Auto-update logic inside the Electron app (runs in Electron's Node 16).
// check -> verify signature -> download -> verify checksum -> stage. Applying is done by apply-update.js (Node 12) after the app exits.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./updater-core');

function create(options) {
  const root = options.root, dataDir = options.dataDir, log = options.log || (() => {});
  const port = options.port || 4173;
  const statusFile = path.join(dataDir, 'update-status.json');
  const commandFile = path.join(dataDir, 'update-command.json');
  const configFile = path.join(root, 'config', 'update.json');
  const updatesDir = path.join(root, 'updates');
  let busy = false, lastTickCheck = 0, lastNightAttempt = '', lastIdleAttempt = 0;

  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
  const currentVersion = () => (readJson(path.join(root, 'app', 'version.json'), {}) || {}).version || '0.0.0';
  const config = () => {
    const c = readJson(configFile, {}) || {};
    return { repo: String(c.repo || '').trim(), baseUrl: c.baseUrl || '', publicKey: c.publicKey || '', checkEveryHours: Math.min(Number(c.checkEveryHours) || 6, 0.5), nightWindow: c.nightWindow || '03:00-05:00', idleMinutes: Math.min(Number(c.idleMinutes) > 0 ? Number(c.idleMinutes) : 3, 3) };
  };
  const baseUrl = c => (c.baseUrl || ('https://github.com/' + c.repo + '/releases/latest/download/')).replace(/\/?$/, '/');
  const failedList = () => readJson(path.join(updatesDir, 'failed.json'), []);
  const savedVersions = () => { try { return fs.readdirSync(path.join(root, 'versions')).filter(core.isVersion).sort((a, b) => core.compareVersions(b, a)); } catch (e) { return []; } };
  const stagedUpdate = () => {
    try {
      for (const name of fs.readdirSync(updatesDir)) {
        const m = /^staged-(\d+\.\d+\.\d+)$/.exec(name), dir = path.join(updatesDir, name);
        if (m && fs.existsSync(path.join(dir, '.ready')) && core.compareVersions(m[1], currentVersion()) > 0 && failedList().indexOf(m[1]) < 0) return { version: m[1], dir };
      }
    } catch (e) { /* none */ }
    return null;
  };

  function setStatus(patch) {
    const c = config(), staged = stagedUpdate();
    const previous = readJson(statusFile, {}) || {};
    const next = Object.assign({}, previous, patch, {
      current: currentVersion(), enabled: !!(c.repo || c.baseUrl) && !!c.publicKey, repo: c.repo, nightWindow: c.nightWindow,
      staged: staged ? staged.version : null, needsRestart: staged ? shellChanged(staged.dir) : false, saved: savedVersions(), failed: failedList(), updatedAt: new Date().toISOString()
    });
    const applied = readJson(path.join(updatesDir, 'last-apply.json'), null);
    if (applied) next.lastApply = applied;
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(statusFile, JSON.stringify(next)); } catch (e) { log('status non ecrit: ' + e.message); }
  }

  async function check(reason) {
    if (busy) return;
    busy = true;
    const c = config();
    try {
      if (!c.publicKey || (!c.repo && !c.baseUrl)) { setStatus({ lastCheck: new Date().toISOString(), message: 'Mises à jour non configurées (dépôt GitHub manquant).', available: null }); return; }
      const base = baseUrl(c);
      let manifestBuf;
      try { manifestBuf = await core.fetchBuffer(base + 'latest.json', { maxBytes: 100000 }); }
      catch (e) {
        if (e.status === 404) { setStatus({ lastCheck: new Date().toISOString(), message: 'Aucune mise à jour publiée pour le moment.', available: null }); return; }
        throw e;
      }
      const sig = (await core.fetchBuffer(base + 'latest.json.sig', { maxBytes: 4000 })).toString('utf8');
      if (!core.verifySignature(manifestBuf, sig, c.publicKey)) {
        log('SIGNATURE INVALIDE pour latest.json: mise a jour ignoree');
        setStatus({ lastCheck: new Date().toISOString(), message: 'Signature invalide : mise à jour refusée par sécurité.', available: null }); return;
      }
      const m = JSON.parse(manifestBuf.toString('utf8'));
      if (!core.isVersion(m.version) || typeof m.file !== 'string' || !/^[\w.-]+\.ppk$/.test(m.file) || !/^[0-9a-f]{64}$/.test(m.sha256 || '') || !(m.size > 0 && m.size <= 60 * 1024 * 1024)) throw new Error('manifeste invalide');
      const cur = currentVersion();
      if (core.compareVersions(m.version, cur) <= 0) { setStatus({ lastCheck: new Date().toISOString(), message: 'La caisse est à jour (version ' + cur + ').', available: null }); return; }
      if (failedList().indexOf(m.version) >= 0) { setStatus({ lastCheck: new Date().toISOString(), message: 'La version ' + m.version + ' a échoué sur cette caisse et est ignorée.', available: { version: m.version, notes: m.notes || '' } }); return; }
      const dest = path.join(updatesDir, 'staged-' + m.version);
      if (fs.existsSync(path.join(dest, '.ready'))) { setStatus({ lastCheck: new Date().toISOString(), message: 'Version ' + m.version + ' prête à installer.', available: { version: m.version, notes: m.notes || '' } }); return; }
      setStatus({ lastCheck: new Date().toISOString(), message: 'Téléchargement de la version ' + m.version + '…', available: { version: m.version, notes: m.notes || '' } });
      const pkg = await core.fetchBuffer(base + m.file, { maxBytes: m.size + 1024, timeout: 120000 });
      if (pkg.length !== m.size || core.sha256(pkg) !== m.sha256) throw new Error('somme de controle du paquet incorrecte');
      core.extractPackage(pkg, dest);
      const stagedVersion = (readJson(path.join(dest, 'app', 'version.json'), {}) || {}).version;
      if (stagedVersion !== m.version) { core.rimraf(dest); throw new Error('version du paquet differente du manifeste'); }
      fs.writeFileSync(path.join(dest, '.ready'), new Date().toISOString());
      log('mise a jour ' + m.version + ' telechargee et verifiee (' + reason + ')');
      setStatus({ lastCheck: new Date().toISOString(), message: 'Version ' + m.version + ' prête : elle s’installera cette nuit ou au prochain démarrage.', available: { version: m.version, notes: m.notes || '' } });
    } catch (e) {
      log('verification des mises a jour: ' + e.message);
      setStatus({ lastCheck: new Date().toISOString(), message: 'Vérification impossible : ' + e.message + '.' });
    } finally { busy = false; }
  }

  function housekeeping() {
    try { const staged = stagedUpdate(); core.housekeeping(root, { keepVersions: 2, current: currentVersion(), stagedKeep: staged ? staged.version : '', log }); } catch (e) { log('nettoyage: ' + e.message); }
  }

  function spawnHelper(extra) {
    const tmp = path.join(os.tmpdir(), 'promedpara-apply-' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of ['apply-update.js', 'updater-core.js']) fs.copyFileSync(path.join(__dirname, f), path.join(tmp, f));
    const node = path.join(root, 'runtime', 'node.exe');
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    const out = fs.openSync(path.join(root, 'logs', 'update.log'), 'a');
    const testing = !!process.env.PROMEDPARA_APPLY_TEST;
    const hot = extra.indexOf('--mode=hot') >= 0;
    const args = [path.join(tmp, 'apply-update.js'), '--root=' + root, '--data=' + dataDir, '--port=' + port].concat(testing ? ['--test=1', '--health=20'] : (hot ? [] : ['--pid=' + process.pid])).concat(extra);
    const child = spawn(node, args, { detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    log('assistant de mise a jour lance: ' + extra.join(' '));
  }
  // Files of the app shell (window, preload, updater): when none changed, the update only needs the server and the screens swapped.
  function shellChanged(dir) {
    try {
      const staged = path.join(dir, 'electron', 'resources', 'app'), live = path.join(root, 'electron', 'resources', 'app');
      if (!fs.existsSync(staged)) return false;
      const list = base => { const out = []; (function walk(d) { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walk(f); else out.push(path.relative(base, f)); } })(base); return out.sort(); };
      const a = list(staged), b = list(live);
      if (a.join('|') !== b.join('|')) return true;
      for (const rel of a) if (core.sha256(fs.readFileSync(path.join(staged, rel))) !== core.sha256(fs.readFileSync(path.join(live, rel)))) return true;
      return false;
    } catch (e) { return true; }
  }
  function watchHot(version) {
    let tries = 0;
    const timer = setInterval(() => {
      const req = require('http').get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1500 }, res => {
        let body = ''; res.on('data', d => { body += d; });
        res.on('end', () => {
          let v = ''; try { v = JSON.parse(body).version; } catch (e) { /* not up yet */ }
          if (v === version || ++tries > 100) { clearInterval(timer); log(v === version ? 'mise a jour a chaud ' + version + ' en service' : 'mise a jour a chaud: retour a la version precedente'); setStatus({}); if (options.reload) options.reload(); }
        });
      });
      req.on('error', () => { if (++tries > 100) { clearInterval(timer); if (options.reload) options.reload(); } });
      req.on('timeout', () => req.destroy());
    }, 700);
  }
  // returns true (full restart needed: the caller quits the app), 'hot' (server and screens swapped, window refreshes itself) or false
  function applyStaged(forceFull) {
    const staged = stagedUpdate();
    if (!staged) return false;
    if (options.hot && !forceFull && !shellChanged(staged.dir)) {
      spawnHelper(['--mode=hot', '--version=' + staged.version, '--source=' + staged.dir, '--exe=' + process.execPath]);
      watchHot(staged.version);
      return 'hot';
    }
    spawnHelper(['--mode=apply', '--version=' + staged.version, '--source=' + staged.dir]);
    return true;
  }
  function rollbackTo(version) {
    if (!core.isVersion(version) || savedVersions().indexOf(version) < 0) return false;
    spawnHelper(['--mode=rollback', '--version=' + version, '--source=' + path.join(root, 'versions', version)]);
    return true;
  }
  function idleSeconds() {
    return new Promise(resolve => {
      const req = require('http').get({ host: '127.0.0.1', port, path: '/api/update/idle', timeout: 2000 }, res => {
        let body = ''; res.on('data', d => { body += d; });
        res.on('end', () => { try { resolve(Number(JSON.parse(body).idleSeconds)); } catch (e) { resolve(-1); } });
      });
      req.on('error', () => resolve(-1)); req.on('timeout', () => { req.destroy(); resolve(-1); });
    });
  }
  function inNightWindow(c) {
    const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(c.nightWindow); if (!m) return false;
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes(), a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    return a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
  }

  async function tick() {
    // Owner commands arrive as a small file written by the local server.
    const cmd = readJson(commandFile, null);
    if (cmd) {
      try { fs.unlinkSync(commandFile); } catch (e) { /* ignore */ }
      log('commande: ' + JSON.stringify(cmd));
      if (cmd.action === 'check') await check('manuel');
      else if (cmd.action === 'apply') { if (!stagedUpdate()) await check('avant installation'); const r = applyStaged(); if (r === true) { options.quit(); return; } if (r === 'hot') return; }
      else if (cmd.action === 'rollback') { if (rollbackTo(cmd.version)) { options.quit(); return; } }
    }
    const c = config(), now = Date.now();
    if (now - lastTickCheck > c.checkEveryHours * 3600000) { lastTickCheck = now; await check('planifie'); }
    const day = new Date().toDateString();
    if (stagedUpdate() && inNightWindow(c) && lastNightAttempt !== day) { lastNightAttempt = day; if (applyStaged() === true) options.quit(); return; }
    // Fully automatic, whenever the till is on: once an update is ready and nobody has touched the till for a moment, install it.
    // A screens-only update waits 90 seconds of quiet, one that needs a restart waits 3 minutes; a failed attempt is retried after 10 minutes.
    const staged = stagedUpdate();
    if (staged && now - lastIdleAttempt > 600000) {
      const idle = await idleSeconds();
      const full = !options.hot || shellChanged(staged.dir);
      const need = full ? c.idleMinutes * 60 : Math.min(c.idleMinutes * 60, 90);
      if (idle >= need) { lastIdleAttempt = now; log('caisse inactive depuis ' + idle + ' s : installation automatique (' + (full ? 'avec redemarrage' : 'a chaud') + ')'); if (applyStaged() === true) options.quit(); }
    }
  }

  return {
    // Called before the cashier window opens: an already downloaded update is installed right away.
    applyAtStart() { return applyStaged(true); },
    start() { housekeeping(); setStatus({}); setTimeout(() => { lastTickCheck = Date.now(); check('demarrage'); }, 20000); setInterval(() => { tick().catch(e => log('tick: ' + e.message)); }, 10000); },
    check, applyStaged, rollbackTo, setStatus, tick, housekeeping
  };
}

module.exports = { create };
