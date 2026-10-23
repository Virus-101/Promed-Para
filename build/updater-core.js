'use strict';
// Shared updater code. Runs on Node 12 (the till's server runtime and the apply helper) and on Electron 22's Node 16.
// Plain ES2018 on purpose: no optional chaining, no ??.
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const urlLib = require('url');

// What an update may touch. Everything else (runtime, electron binaries, data, logs, config, android) is never replaced.
const ALLOWED_DIRS = ['app/', 'electron/resources/app/', 'tools/'];
const ALLOWED_ROOT_FILES = ['GUIDE.html', 'LIRE-MOI.txt', 'MANIFEST.sha256', 'LANCER-CAISSE.vbs', 'TEST-LECTEUR.vbs', '1-VERIFIER-LE-SYSTEME.bat',
  '2-INSTALLER.bat', '3-COLLECTER-LES-ERREURS.bat', 'ARRETER-LA-CAISSE.bat', 'SAUVEGARDER-LES-DONNEES.bat', 'CONFIGURER-LES-MISES-A-JOUR.bat', 'RESET-CODE-ADMIN.bat'];
const REPLACED_DIRS = ['app', 'electron/resources/app', 'tools'];
const MAGIC = 'PPK1';
const MAX_PACKAGE_BYTES = 60 * 1024 * 1024;

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
const isVersion = v => typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v);
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function fetchBuffer(url, options) {
  const opts = options || {};
  const timeout = opts.timeout || 25000, maxBytes = opts.maxBytes || MAX_PACKAGE_BYTES;
  return new Promise((resolve, reject) => {
    const go = (target, redirectsLeft) => {
      const lib = target.indexOf('https:') === 0 ? https : http;
      const req = lib.get(target, { headers: { 'User-Agent': 'PromedPara-Updater', 'Accept': '*/*' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('trop de redirections'));
          return go(urlLib.resolve(target, res.headers.location), redirectsLeft - 1);
        }
        if (res.statusCode !== 200) { res.resume(); const e = new Error('HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e); }
        const chunks = []; let size = 0;
        res.on('data', c => { size += c.length; if (size > maxBytes) { req.destroy(); reject(new Error('fichier trop gros')); } else chunks.push(c); });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error('delai depasse')); });
      req.on('error', reject);
    };
    go(url, 6);
  });
}

// Signature = ECDSA P-256 / SHA-256 over the exact bytes of latest.json.
function verifySignature(dataBuf, signatureB64, publicKeyPem) {
  try {
    const verifier = crypto.createVerify('sha256');
    verifier.update(dataBuf);
    return verifier.verify(publicKeyPem, Buffer.from(String(signatureB64).trim(), 'base64'));
  } catch (e) { return false; }
}

function isAllowedPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 240) return false;
  if (rel.indexOf('\\') >= 0 || rel.indexOf(':') >= 0 || rel.charAt(0) === '/' || /(^|\/)\.\.?(\/|$)/.test(rel) || /[\u0000-\u001f]/.test(rel)) return false;
  if (ALLOWED_ROOT_FILES.indexOf(rel) >= 0) return true;
  return ALLOWED_DIRS.some(prefix => rel.indexOf(prefix) === 0 && rel.length > prefix.length);
}

// Package format: "PPK1" | uint32 index length | JSON index | gzip blobs. Index = [{path, size, sha256, offset, length}]
function buildPackage(files) {
  const blobs = [], index = []; let offset = 0;
  for (const f of files) {
    const raw = fs.readFileSync(f.abs), gz = zlib.gzipSync(raw, { level: 9 });
    index.push({ path: f.rel, size: raw.length, sha256: sha256(raw), offset, length: gz.length });
    blobs.push(gz); offset += gz.length;
  }
  const indexBuf = Buffer.from(JSON.stringify(index), 'utf8'), head = Buffer.alloc(8);
  head.write(MAGIC, 0, 'ascii'); head.writeUInt32LE(indexBuf.length, 4);
  return Buffer.concat([head, indexBuf].concat(blobs));
}

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function rimraf(target) {
  if (!fs.existsSync(target)) return;
  const st = fs.lstatSync(target);
  if (st.isDirectory()) { for (const n of fs.readdirSync(target)) rimraf(path.join(target, n)); fs.rmdirSync(target); }
  else fs.unlinkSync(target);
}

// Validates every path and checksum before writing anything.
function extractPackage(buf, destDir) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('paquet invalide');
  const indexLength = buf.readUInt32LE(4);
  if (indexLength <= 0 || 8 + indexLength > buf.length) throw new Error('paquet invalide (index)');
  const index = JSON.parse(buf.toString('utf8', 8, 8 + indexLength));
  if (!Array.isArray(index) || index.length === 0 || index.length > 5000) throw new Error('paquet invalide (liste)');
  const base = 8 + indexLength, seen = {}, out = [];
  for (const e of index) {
    if (!isAllowedPath(e.path)) throw new Error('chemin refuse: ' + e.path);
    if (seen[e.path]) throw new Error('doublon: ' + e.path);
    seen[e.path] = true;
    if (!(e.offset >= 0) || !(e.length > 0) || base + e.offset + e.length > buf.length) throw new Error('paquet tronque');
    const raw = zlib.gunzipSync(buf.slice(base + e.offset, base + e.offset + e.length));
    if (raw.length !== e.size || sha256(raw) !== e.sha256) throw new Error('somme de controle fausse: ' + e.path);
    out.push({ path: e.path, data: raw });
  }
  rimraf(destDir); mkdirp(destDir);
  for (const f of out) { const target = path.join(destDir, f.path.split('/').join(path.sep)); mkdirp(path.dirname(target)); fs.writeFileSync(target, f.data); }
  return out.map(f => f.path);
}

module.exports = { ALLOWED_DIRS, ALLOWED_ROOT_FILES, REPLACED_DIRS, compareVersions, isVersion, sha256, fetchBuffer, verifySignature, isAllowedPath, buildPackage, extractPackage, mkdirp, rimraf };
