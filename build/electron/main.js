'use strict';
// PromedPara desktop shell. Electron 22 is the last release that runs on Windows 7 (32-bit build used here).
const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const argv = process.argv.slice(1);
const argValue = name => { const hit = argv.find(a => a.indexOf('--' + name + '=') === 0); return hit ? hit.slice(name.length + 3) : ''; };

// --- Self test used by the system checker: opens a hidden window, evaluates JS, writes one line to a file. ---
if (argv.indexOf('--selftest') >= 0) {
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    let result;
    try {
      const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await w.loadURL('data:text/html,<title>ok</title><body>ok</body>');
      const value = await w.webContents.executeJavaScript('1+1');
      result = value === 2 ? 'ELECTRON OK ' + process.versions.electron + ' (chromium ' + process.versions.chrome + ', ' + process.arch + ')' : 'ELECTRON FAIL unexpected result';
    } catch (e) { result = 'ELECTRON FAIL ' + e.message; }
    const out = argValue('out');
    if (out) { try { fs.writeFileSync(out, result); } catch (e) { /* ignore */ } }
    app.exit(result.indexOf('ELECTRON OK') === 0 ? 0 : 1);
  });
  return;
}

const ROOT = process.env.PROMEDPARA_ROOT || path.resolve(path.dirname(process.execPath), '..');
const PORT = Number(process.env.PROMEDPARA_PORT || 4173);
const ORIGIN = 'http://localhost:' + PORT;
const DATA_DIR = process.env.PROMEDPARA_DATA_DIR || path.join(ROOT, 'data');
const LOG_DIR = path.join(ROOT, 'logs');
const START_PAGE = argValue('page') || '/';
const ICON = [path.join(__dirname, 'icon.png')].filter(p => fs.existsSync(p))[0];

function log(message) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(path.join(LOG_DIR, 'electron.log'), new Date().toISOString() + '  ' + message + '\n'); } catch (e) { /* ignore */ }
}
process.on('uncaughtException', e => log('uncaughtException: ' + (e && e.stack || e)));

// Weak machine (2 GB, no GPU acceleration): software rendering, no extras.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
// the shop PC is a low-end machine (2 GB RAM, Celeron): fewer processes, a smaller script heap, no background work
app.commandLine.appendSwitch('enable-low-end-device-mode');
app.commandLine.appendSwitch('renderer-process-limit', '1');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=192');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,MediaRouter,Translate,OptimizationHints,AutofillServerCommunication');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('overscroll-history-navigation', '0');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null;

function serverIsUp(callback) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/status', timeout: 1500 }, res => {
    let body = ''; res.on('data', d => { body += d; }); res.on('end', () => callback(/PromedPara/.test(body)));
  });
  req.on('error', () => callback(false));
  req.on('timeout', () => { req.destroy(); callback(false); });
}

function ensureServer() {
  return new Promise(resolve => {
    serverIsUp(up => {
      if (up) { log('serveur deja actif'); return resolve(true); }
      const node = path.join(ROOT, 'runtime', 'node.exe');
      if (!fs.existsSync(node)) { log('node.exe introuvable: ' + node); return resolve(false); }
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const out = fs.openSync(path.join(LOG_DIR, 'serveur.log'), 'a');
      const err = fs.openSync(path.join(LOG_DIR, 'serveur-erreurs.log'), 'a');
      const env = Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA_DIR, PORT: String(PORT), HOST: '0.0.0.0', PROMEDPARA_EXE: process.execPath });
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(node, ['main.js'], { cwd: path.join(ROOT, 'app'), env, detached: true, stdio: ['ignore', out, err], windowsHide: true });
      child.on('error', e => log('erreur de lancement du serveur: ' + e.message));
      child.unref();
      log('serveur lance, pid ' + child.pid);
      let tries = 0;
      const timer = setInterval(() => {
        serverIsUp(ok => {
          if (ok) { clearInterval(timer); resolve(true); }
          else if (++tries > 90) { clearInterval(timer); resolve(false); }
        });
      }, 500);
    });
  });
}

// Splash screen with the Promed Parapharmacie logo (white version on the brand green); falls back to text if the file is missing.
function splash(message) {
  let logo = '';
  try { logo = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'app', 'public', 'img', 'logo-full-light.png')).toString('base64'); } catch (e) { /* text only */ }
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="margin:0;font-family:Segoe UI,Arial;background:#1b4d33;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh">' +
    '<div style="text-align:center">' + (logo ? '<img src="' + logo + '" alt="Promed Parapharmacie" style="width:300px;max-width:60vw;height:auto">' : '<div style="font-size:30px;font-weight:bold">PromedPara</div>') +
    '<div style="margin-top:22px;opacity:.85;font-size:17px">' + message + '</div></div></body>');
}
const LOADING = splash('D&eacute;marrage de la caisse&hellip;');

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1024, height: 768, show: false, backgroundColor: '#1b4d33', title: 'PromedPara — Caisse', icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !!process.env.PROMEDPARA_DEVTOOLS }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('will-navigate', (event, url) => {
    if (url.indexOf(ORIGIN) !== 0 && url.indexOf('data:') !== 0) { event.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.indexOf(ORIGIN) === 0) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, width: 1100, height: 760 } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('render-process-gone', (e, details) => { log('render-process-gone: ' + details.reason); setTimeout(() => { if (win) win.loadURL(ORIGIN + START_PAGE); }, 1000); });
  win.on('closed', () => { win = null; });
  win.loadURL(LOADING);
}

const remember = require('./remember');
ipcMain.handle('remember:info', () => remember.info());
ipcMain.handle('remember:save', (event, name, code) => remember.save(name, code));
ipcMain.handle('remember:use', () => remember.use());
ipcMain.handle('remember:forget', () => remember.forget());
ipcMain.handle('print-receipt', event => new Promise(resolve => {
  // Silent print on the default printer (the Xprinter). If it fails the page falls back to the normal print dialog.
  event.sender.print({ silent: true, printBackground: true }, (ok, reason) => { log('impression ticket: ' + ok + ' ' + (reason || '')); resolve({ ok, reason }); });
}));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  if (process.env.PROMEDPARA_SELFTEST === 'remember') {
    // build check: the code survives a save/read round trip, is not readable on disk, and can be forgotten
    let out = {};
    try {
      const os = require('os');
      app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pp-remember-')));
      out = { available: remember.info().available, saved: remember.save('Test Owner', 'Mon-Code-482913').ok };
      const back = remember.use(); out.roundTrip = back.ok && back.code === 'Mon-Code-482913' && back.name === 'Test Owner';
      out.onDisk = !fs.readFileSync(path.join(app.getPath('userData'), 'remembered-login.json'), 'utf8').includes('482913');
      remember.forget(); out.forgotten = !remember.use().ok;
    } catch (error) { out.error = String(error && error.message || error); }
    if (process.env.PROMEDPARA_SELFTEST_OUT) fs.writeFileSync(process.env.PROMEDPARA_SELFTEST_OUT, JSON.stringify(out));
    app.exit(0); return;
  }
  log('--- demarrage Electron ' + process.versions.electron + ' racine=' + ROOT);
  createWindow();
  const ok = await ensureServer();
  if (!ok) {
    log('le serveur ne repond pas');
    dialog.showErrorBox('PromedPara', 'Le serveur de la caisse ne répond pas.\n\nJournaux : ' + LOG_DIR + '\nRelancez le PC, ou utilisez "PromedPara (mode secours Chrome)" dans C:\\PromedPara.');
    app.quit();
    return;
  }
  let updater = null;
  if (!process.env.PROMEDPARA_NO_UPDATER) {
    try {
      updater = require('./updater').create({ root: ROOT, dataDir: DATA_DIR, port: PORT, log, quit: () => app.exit(0) });
      // An update downloaded earlier is installed now, before the cashier opens.
      if (updater.applyAtStart()) { log('installation d une mise a jour au demarrage'); if (win) win.loadURL(splash('Mise &agrave; jour de PromedPara : installation en cours, la caisse red&eacute;marre dans un instant&hellip;')); setTimeout(() => app.exit(0), 1500); return; }
    } catch (e) { log('updater indisponible: ' + e.message); updater = null; }
  }
  if (win) win.loadURL(ORIGIN + START_PAGE);
  if (updater) updater.start();
  if (process.env.PROMEDPARA_SHOT) {
    // Test helper: save a screenshot then quit.
    setTimeout(async () => { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.PROMEDPARA_SHOT, img.toPNG()); app.exit(0); }, 4000);
  }
});
