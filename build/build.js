'use strict';
// Assembles the USB kit: node build.js  ->  ../../PromedPara-USB
// Needs: npm install (in this folder) and the Node 12 x86 runtime in ./runtime-cache/node.exe
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SRC = path.resolve(__dirname, '..');
const OUT = process.env.PROMEDPARA_OUT ? path.resolve(process.env.PROMEDPARA_OUT) : path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const VERSION = process.env.PROMEDPARA_BUILD_VERSION || fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
const APP = path.join(OUT, 'app');
const KIT = path.join(__dirname, 'kit');

const BANNER = fs.readFileSync(path.join(__dirname, 'compat.js'), 'utf8');

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  for (const name of fs.readdirSync(p)) {
    const full = path.join(p, name);
    if (fs.lstatSync(full).isDirectory()) rimraf(full); else fs.unlinkSync(full);
  }
  // another program may keep the folder itself open (a shell, an indexer): the files are gone, so rebuilding inside it is fine
  for (let attempt = 0; ; attempt++) {
    try { fs.rmdirSync(p); return; } catch (error) {
      const busy = /EBUSY|ENOTEMPTY|EPERM/.test(String(error.code));
      if (!busy) throw error;
      if (attempt >= 4) return;
      const until = Date.now() + 400; while (Date.now() < until) { /* short wait */ }
    }
  }
}
function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (skip && skip(name)) continue;
    const a = path.join(from, name), b = path.join(to, name);
    if (fs.lstatSync(a).isDirectory()) copyDir(a, b, skip); else fs.copyFileSync(a, b);
  }
}

// the shop data (data) and logs live inside the kit folder: a rebuild must never delete them
if (fs.existsSync(OUT)) { for (const name of fs.readdirSync(OUT)) if (name !== 'data' && name !== 'logs') { const full = path.join(OUT, name); if (fs.lstatSync(full).isDirectory()) rimraf(full); else fs.unlinkSync(full); } }
fs.mkdirSync(path.join(APP, 'vendor'), { recursive: true });

// 1. Server: transpile modern syntax down to Node 12 and swap better-sqlite3 for the sql.js shim.
esbuild.buildSync({
  entryPoints: [path.join(SRC, 'server.js')],
  outfile: path.join(APP, 'server.bundle.js'),
  bundle: true, platform: 'node', target: 'node12', format: 'cjs',
  alias: { 'better-sqlite3': path.join(__dirname, 'sqlite-shim.js') },
  banner: { js: BANNER },
  logLevel: 'warning'
});

// 2. sql.js glue code (also transpiled, so it is safe on Node 12) + wasm.
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js')],
  outfile: path.join(APP, 'vendor', 'sql-wasm.js'),
  bundle: false, platform: 'node', target: 'node12', format: 'cjs', logLevel: 'warning'
});
fs.copyFileSync(path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'), path.join(APP, 'vendor', 'sql-wasm.wasm'));
fs.copyFileSync(path.join(__dirname, 'main.js'), path.join(APP, 'main.js'));
fs.copyFileSync(path.join(__dirname, 'selftest.js'), path.join(APP, 'selftest.js'));
fs.copyFileSync(path.join(__dirname, 'reset-admin.js'), path.join(APP, 'reset-admin.js'));
fs.writeFileSync(path.join(APP, 'version.json'), JSON.stringify({ version: VERSION, builtAt: new Date().toISOString() }));

// Update settings live in config\update.json (never replaced by an update): public key + GitHub repo ("owner/name").
const releaseConfigFile = path.join(__dirname, 'release-config.json');
const releaseConfig = fs.existsSync(releaseConfigFile) ? JSON.parse(fs.readFileSync(releaseConfigFile, 'utf8')) : {};
fs.mkdirSync(path.join(OUT, 'config'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'config', 'update.json'), JSON.stringify({
  repo: releaseConfig.repo || '', checkEveryHours: 6, nightWindow: '03:00-05:00',
  publicKey: fs.readFileSync(path.join(__dirname, 'update-public.pem'), 'utf8')
}, null, 2) + '\n');

// 3. Web UI (no database, logs or Android build output).
copyDir(path.join(SRC, 'public'), path.join(APP, 'public'));

// 4. Node 12 (32-bit) runtime.
const node = path.join(__dirname, 'runtime-cache', 'node.exe');
if (!fs.existsSync(node)) throw new Error('Missing ' + node);
fs.mkdirSync(path.join(OUT, 'runtime'), { recursive: true });
fs.copyFileSync(node, path.join(OUT, 'runtime', 'node.exe'));

// 4b. Electron 22 shell (last Electron that runs on Windows 7), renamed PromedPara.exe, with only French/English locales.
const electronCache = path.join(__dirname, 'runtime-cache', 'electron');
if (!fs.existsSync(path.join(electronCache, 'electron.exe'))) throw new Error('Missing Electron runtime in ' + electronCache);
copyDir(electronCache, path.join(OUT, 'electron'), n => n === 'default_app.asar');
const localeDir = path.join(OUT, 'electron', 'locales');
for (const name of fs.readdirSync(localeDir)) if (!['en-US.pak', 'fr.pak'].includes(name)) fs.unlinkSync(path.join(localeDir, name));
fs.renameSync(path.join(OUT, 'electron', 'electron.exe'), path.join(OUT, 'electron', 'PromedPara.exe'));
// Logo + product info inside the .exe itself (taskbar, Explorer)
require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'set-exe-icon.js'), path.join(OUT, 'electron', 'PromedPara.exe'), path.join(__dirname, 'assets', 'icon.ico'), VERSION], { stdio: 'inherit' });
const shellDir = path.join(OUT, 'electron', 'resources', 'app');
fs.mkdirSync(shellDir, { recursive: true });
for (const f of ['main.js', 'preload.js', 'package.json', 'updater.js', 'remember.js']) fs.copyFileSync(path.join(__dirname, 'electron', f), path.join(shellDir, f));
for (const f of ['updater-core.js', 'apply-update.js']) fs.copyFileSync(path.join(__dirname, f), path.join(shellDir, f));
fs.copyFileSync(path.join(__dirname, 'assets', 'icon.png'), path.join(shellDir, 'icon.png'));
copyDir(path.join(__dirname, 'assets'), path.join(OUT, 'assets'));

// 5. Scripts, guides and Android sources.
if (fs.existsSync(KIT)) copyDir(KIT, OUT);
// Logo at the top of the guide (embedded, so it also prints/opens offline)
try { const guide = path.join(OUT, 'GUIDE.html'); const logoB64 = fs.readFileSync(path.join(__dirname, 'assets', 'guide-logo.png')).toString('base64'); fs.writeFileSync(guide, fs.readFileSync(guide, 'utf8').replace('<!--LOGO-->', '<img src="data:image/png;base64,' + logoB64 + '" alt="Promed Parapharmacie" style="width:200px;height:auto;display:block;margin:0 0 6px">')); } catch (e) { console.warn('guide logo skipped:', e.message); }
copyDir(path.join(SRC, 'owner-android'), path.join(OUT, 'android-source', 'owner-android'), n => n === 'build');
fs.mkdirSync(path.join(OUT, 'android'), { recursive: true });
for (const apk of ['PromedPara-Owner.apk']) fs.copyFileSync(path.join(SRC, 'public', apk), path.join(OUT, 'android', apk));

// 6. Windows-friendly text files: CRLF line endings; UTF-8 BOM on .ps1 (PowerShell 2.0 reads BOM-less files as ANSI and garbles accents).
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.lstatSync(full).isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
for (const file of walk(OUT, [])) {
  const ext = path.extname(file).toLowerCase();
  if (!['.bat', '.vbs', '.ps1', '.txt'].includes(ext)) continue;
  let text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r?\n/g, '\r\n');
  if (ext === '.ps1') text = '﻿' + text;
  else if (/[^\x00-\x7F]/.test(text)) throw new Error('Non-ASCII character in ' + file + ' (cmd/vbs files must be ASCII)');
  fs.writeFileSync(file, text, 'utf8');
}

// 7. Integrity manifest, verified by the checker on the till (catches a bad USB copy).
const lines = [];
for (const file of walk(OUT, []).sort()) {
  const rel = path.relative(OUT, file);
  if (rel === 'MANIFEST.sha256' || /^(data|logs)([-\/]|$)/.test(rel) || rel.startsWith('RAPPORT-') || rel.startsWith('config' + path.sep)) continue;
  lines.push(require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + rel);
}
fs.writeFileSync(path.join(OUT, 'MANIFEST.sha256'), lines.join('\r\n') + '\r\n');

console.log('Built', OUT, '(' + lines.length + ' files)');
