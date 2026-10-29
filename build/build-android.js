'use strict';
// Builds the owner and worker Android apps:  node build-android.js [owner|worker|both] <versionName> <versionCode>
// Uses the Android SDK on this PC (build-tools 35.0.1, platform android-35) and the JDK. Output: public/PromedPara-Owner.apk, public/PromedPara-Worker.apk
// The signing keys live OUTSIDE the project (never committed, never on the till): C:\Users\<you>\PromedPara-keys\android\
// The same key must be used for every future build, otherwise phones refuse to update the app in place.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const which = process.argv[2] || 'owner', versionName = process.argv[3] || '2.4.0', versionCode = process.argv[4] || '240';
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const buildTools = path.join(sdk, 'build-tools', '35.0.1'), androidJar = path.join(sdk, 'platforms', 'android-35', 'android.jar');
const javaHome = process.env.JAVA_HOME || '';
const jbin = n => (javaHome ? path.join(javaHome, 'bin', n) : n);
const keyDir = path.join(os.homedir(), 'PromedPara-keys', 'android');
const root = path.resolve(__dirname, '..');

function run(cmd, args, label) {
  const r = cp.spawnSync(cmd, args, { encoding: 'utf8', shell: /\.bat$/i.test(cmd), windowsHide: true });
  if (r.status !== 0) throw new Error((label || cmd) + ' failed:\n' + (r.stdout || '') + (r.stderr || ''));
  return r.stdout;
}
function walk(dir, ext, out = []) { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p, ext, out); else if (p.endsWith(ext)) out.push(p); } return out; }
const rimraf = p => fs.rmSync(p, { recursive: true, force: true });

function signingPassword() {
  fs.mkdirSync(keyDir, { recursive: true });
  const file = path.join(keyDir, 'signing-password.txt');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, 'A'));
  return fs.readFileSync(file, 'utf8').trim();
}

function build(app) {
  const project = path.join(root, app + '-android'), work = path.join(__dirname, 'android-work', app);
  const outName = app === 'owner' ? 'PromedPara-Owner.apk' : 'PromedPara-Worker.apk';
  for (const need of [androidJar, path.join(buildTools, 'aapt2.exe'), path.join(buildTools, 'd8.bat'), path.join(buildTools, 'zipalign.exe'), path.join(buildTools, 'apksigner.bat')]) if (!fs.existsSync(need)) throw new Error('Missing Android build tool: ' + need);
  rimraf(work); fs.mkdirSync(path.join(work, 'classes'), { recursive: true }); fs.mkdirSync(path.join(work, 'dex'), { recursive: true });
  const password = signingPassword(), keystore = path.join(keyDir, 'promedpara-' + app + '-release.jks'), alias = 'promedpara-' + app;
  if (!fs.existsSync(keystore)) run(jbin('keytool.exe'), ['-genkeypair', '-keystore', keystore, '-storepass', password, '-keypass', password, '-alias', alias, '-dname', 'CN=PromedPara ' + app + ',O=Promed Parapharmacie,C=MA', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-noprompt'], 'keytool');

  run(jbin('javac.exe'), ['-encoding', 'UTF-8', '--release', '8', '-classpath', androidJar, '-d', path.join(work, 'classes')].concat(walk(path.join(project, 'src'), '.java')), 'javac');
  run(path.join(buildTools, 'aapt2.exe'), ['compile', '--dir', path.join(project, 'res'), '-o', path.join(work, 'resources.zip')], 'aapt2 compile');
  run(path.join(buildTools, 'aapt2.exe'), ['link', '-I', androidJar, '--manifest', path.join(project, 'AndroidManifest.xml'), '--min-sdk-version', '26', '--target-sdk-version', '35', '--version-code', versionCode, '--version-name', versionName, '-o', path.join(work, 'base.apk'), path.join(work, 'resources.zip')], 'aapt2 link');
  run(path.join(buildTools, 'd8.bat'), ['--min-api', '26', '--lib', androidJar, '--output', path.join(work, 'dex')].concat(walk(path.join(work, 'classes'), '.class')), 'd8');
  fs.copyFileSync(path.join(work, 'base.apk'), path.join(work, 'unsigned.apk'));
  run(jbin('jar.exe'), ['uf', path.join(work, 'unsigned.apk'), '-C', path.join(work, 'dex'), 'classes.dex'], 'jar');
  run(path.join(buildTools, 'zipalign.exe'), ['-f', '4', path.join(work, 'unsigned.apk'), path.join(work, 'aligned.apk')], 'zipalign');
  const apk = path.join(root, 'public', outName); rimraf(apk); rimraf(apk + '.idsig');
  run(path.join(buildTools, 'apksigner.bat'), ['sign', '--v4-signing-enabled', 'false', '--ks', keystore, '--ks-key-alias', alias, '--ks-pass', 'pass:' + password, '--key-pass', 'pass:' + password, '--out', apk, path.join(work, 'aligned.apk')], 'apksigner sign');
  run(path.join(buildTools, 'apksigner.bat'), ['verify', '--verbose', apk], 'apksigner verify');
  console.log(app + ': built ' + apk + ' (' + Math.round(fs.statSync(apk).size / 1024) + ' KB, version ' + versionName + ' / ' + versionCode + ')');
}

fs.writeFileSync(path.join(root, 'public', 'android-version.json'), JSON.stringify({ versionCode: Number(versionCode), versionName }));
for (const app of which === 'both' ? ['owner', 'worker'] : [which]) build(app);
