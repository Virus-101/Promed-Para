'use strict';
// Downloads the latest release exactly like a till does (anonymous, redirects, signature, checksum, unpack). Node 12 compatible.
const fs = require('fs');
const os = require('os');
const path = require('path');
const kit = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const core = require(path.join(kit, 'electron', 'resources', 'app', 'updater-core'));
const cfg = JSON.parse(fs.readFileSync(path.join(kit, 'config', 'update.json'), 'utf8'));
const base = 'https://github.com/' + cfg.repo + '/releases/latest/download/';
(async () => {
  console.log('node ' + process.version + ' ' + process.arch + '  ->  ' + base);
  const manifestBuf = await core.fetchBuffer(base + 'latest.json', { maxBytes: 100000 });
  const sig = (await core.fetchBuffer(base + 'latest.json.sig', { maxBytes: 4000 })).toString('utf8');
  console.log('signature valid :', core.verifySignature(manifestBuf, sig, cfg.publicKey));
  const m = JSON.parse(manifestBuf.toString('utf8'));
  const pkg = await core.fetchBuffer(base + m.file, { maxBytes: m.size + 1024, timeout: 120000 });
  console.log('package         :', m.file, pkg.length + ' bytes, size matches:', pkg.length === m.size, ', sha256 matches:', core.sha256(pkg) === m.sha256);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
  const files = core.extractPackage(pkg, dest);
  const v = JSON.parse(fs.readFileSync(path.join(dest, 'app', 'version.json'), 'utf8')).version;
  console.log('unpacked        :', files.length + ' files, version inside =', v, v === m.version ? '(matches manifest)' : '(MISMATCH)');
  core.rimraf(dest);
})().catch(e => { console.log('FAILED:', e.message); process.exit(1); });
