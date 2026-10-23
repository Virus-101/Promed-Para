'use strict';
// Publishes an update:  node make-release.js 2.1.1 "What changed"
// Builds the kit at that version, packs only the replaceable parts, signs the manifest and writes
//   release\v2.1.1\latest.json  latest.json.sig  update-2.1.1.ppk     <- these 3 files go on the GitHub Release
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const core = require('./updater-core');

const DEFAULT_KEY = path.join(os.homedir(), 'PromedPara-keys', 'update-private.pem');

function collectFiles(kitDir) {
  const files = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const a = path.join(abs, name), r = rel ? rel + '/' + name : name;
      if (fs.lstatSync(a).isDirectory()) walk(a, r); else files.push({ rel: r, abs: a });
    }
  };
  for (const dir of core.REPLACED_DIRS) { const abs = path.join(kitDir, dir.split('/').join(path.sep)); if (fs.existsSync(abs)) walk(abs, dir); }
  for (const f of core.ALLOWED_ROOT_FILES) { const abs = path.join(kitDir, f); if (fs.existsSync(abs)) files.push({ rel: f, abs }); }
  return files;
}

// kitDir: a built kit (PromedPara-USB layout). tweak(files) lets tests alter the content.
function createRelease(opts) {
  const files = collectFiles(opts.kitDir);
  const bad = files.filter(f => !core.isAllowedPath(f.rel));
  if (bad.length) throw new Error('fichier non autorise dans le paquet: ' + bad[0].rel);
  const pkg = core.buildPackage(files);
  const fileName = 'update-' + opts.version + '.ppk';
  const manifest = { product: 'promedpara', version: opts.version, date: new Date().toISOString(), notes: opts.notes || '', file: fileName, size: pkg.length, sha256: core.sha256(pkg) };
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const privateKey = fs.readFileSync(opts.privateKeyPath || process.env.PROMEDPARA_SIGNING_KEY || DEFAULT_KEY);
  const signature = crypto.sign('sha256', manifestBuf, privateKey).toString('base64');
  core.mkdirp(opts.outDir);
  fs.writeFileSync(path.join(opts.outDir, fileName), pkg);
  fs.writeFileSync(path.join(opts.outDir, 'latest.json'), manifestBuf);
  fs.writeFileSync(path.join(opts.outDir, 'latest.json.sig'), signature + '\n');
  return { manifest, files: files.length };
}

module.exports = { createRelease, collectFiles };

if (require.main === module) {
  const version = process.argv[2], notes = process.argv[3] || '';
  if (!core.isVersion(version)) { console.error('Usage: node make-release.js <version e.g. 2.1.1> "notes"'); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppk-build-'));
  const kit = path.join(tmp, 'PromedPara-USB');
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit', env: Object.assign({}, process.env, { PROMEDPARA_BUILD_VERSION: version, PROMEDPARA_OUT: kit }) });
  if (r.status !== 0) process.exit(r.status || 1);
  const outDir = path.resolve(__dirname, '..', '..', 'release', 'v' + version);
  const { manifest, files } = createRelease({ kitDir: kit, version, notes, outDir });
  // Self-check exactly as a till would do it.
  const pub = fs.readFileSync(path.join(__dirname, 'update-public.pem'), 'utf8');
  const manifestBuf = fs.readFileSync(path.join(outDir, 'latest.json')), sig = fs.readFileSync(path.join(outDir, 'latest.json.sig'), 'utf8');
  if (!core.verifySignature(manifestBuf, sig, pub)) throw new Error('self-check: signature does not verify with build/update-public.pem');
  core.extractPackage(fs.readFileSync(path.join(outDir, manifest.file)), path.join(tmp, 'selfcheck'));
  core.rimraf(tmp);
  console.log('\nRelease ' + version + ' ready (' + files + ' files, ' + Math.round(manifest.size / 1024) + ' KB, signature verified):\n  ' + outDir);
}
