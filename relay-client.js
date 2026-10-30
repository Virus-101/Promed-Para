'use strict';
// Lets the owner phones reach this till from anywhere: the till connects OUT to the relay and answers encrypted requests.
// Only a short allow-list of owner-app routes is ever forwarded, and only for devices that hold the shared key.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const handleOf = name => crypto.createHash('sha256').update('promed-handle:' + String(name || '').trim().toLowerCase()).digest('hex');
const WORKER_ALLOWED = [['POST', '/api/qr-login/approve']];
const ALLOWED = [['POST', '/api/owner/device-login'], ['POST', '/api/owner/unlock'], ['POST', '/api/owner/device-logout'], ['GET', '/api/login-approvals'], ['POST', '/api/login-approvals/respond'], ['GET', '/api/mobile/products'], ['GET', '/api/overview'], ['GET', '/api/notifications'], ['GET', '/api/me'], ['POST', '/api/logout']];
const MAX_SKEW_MS = 5 * 60000;

function seal(key, text) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}
function open(key, b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64');
  if (raw.length < 29) throw new Error('short');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.slice(0, 12));
  decipher.setAuthTag(raw.slice(raw.length - 16));
  return Buffer.concat([decipher.update(raw.slice(12, raw.length - 16)), decipher.final()]).toString('utf8');
}
const enrollKey = (code, tillId) => crypto.pbkdf2Sync(code, 'promed-enroll:' + tillId, 60000, 32, 'sha256');

function start(options) {
  const file = path.join(options.dataDir, 'relay.json');
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { cfg = null; }
  if (!cfg || !/^[a-f0-9]{16}$/.test(cfg.tillId || '')) {
    cfg = { enabled: true, url: options.defaultUrl, tillId: crypto.randomBytes(8).toString('hex'), token: crypto.randomBytes(24).toString('hex'), key: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  }
  if (options.defaultUrl && !cfg.url) { cfg.url = options.defaultUrl; fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); }
  if (!/^[a-f0-9]{64}$/.test(cfg.wkey || '')) { cfg.wkey = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); }
  if (!/^[a-f0-9]{64}$/.test(cfg.ecPriv || '')) { const made = crypto.createECDH('prime256v1'); made.generateKeys(); cfg.ecPriv = made.getPrivateKey('hex').padStart(64, '0'); fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); }
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(cfg.ecPriv, 'hex'));
  const key = Buffer.from(cfg.key, 'hex'), workerKey = Buffer.from(cfg.wkey, 'hex');
  const state = { enabled: cfg.enabled !== false && Boolean(cfg.url), connected: false, lastOk: 0, lastAttempt: null, url: cfg.url || '', tillId: cfg.tillId, workerKey: cfg.wkey, address: '', stop: function () {} };
  const seen = new Map(), secret = crypto.randomBytes(16).toString('hex');
  let stopped = false;
  if (!state.enabled) return state;

  const target = new URL(cfg.url), transport = target.protocol === 'http:' ? http : https;
  const agent = new transport.Agent({ keepAlive: true, maxSockets: 6 });
  const basePath = target.pathname.replace(/\/$/, '');
  const call = (method, pathname, body, timeoutMs) => new Promise((resolve, reject) => {
    const headers = { 'X-Token': cfg.token };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const request = transport.request({ agent: agent, method: method, hostname: target.hostname, port: target.port || undefined, path: basePath + pathname, headers: headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });

  const forward = (method, requestPath, cookie, body) => new Promise(resolve => {
    const headers = { 'x-promed-relay': secret, 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const request = http.request({ host: '127.0.0.1', port: options.port, method: method, path: requestPath, headers: headers }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size < 1500000) chunks.push(chunk); });
      response.on('end', () => {
        const cookies = response.headers['set-cookie'] || [];
        resolve({ s: response.statusCode, c: cookies.length ? String(cookies[0]).split(';')[0] : '', b: Buffer.concat(chunks).toString('utf8') });
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve({ s: 502, c: '', b: JSON.stringify({ error: 'Caisse indisponible.' }) }));
    if (body) request.write(body);
    request.end();
  });

  const handle = async item => {
    let message = null, usedKey = null, plain = null;
    try { message = JSON.parse(item.body); } catch (error) { message = null; }
    if (message && message.m === 'k') {
      try { plain = open(key, message.d); usedKey = key; } catch (error) { plain = null; }
    } else if (message && message.m === 'w') {
      try { plain = open(workerKey, message.d); usedKey = workerKey; } catch (error) { plain = null; }
    } else if (message && message.m === 'n') {
      // name + personal code pairing: the key is agreed with the phone by ECDH (the till's public key is published through the relay)
      try { usedKey = crypto.createHash('sha256').update(ecdh.computeSecret(Buffer.from(String(message.k || ''), 'hex'))).digest(); plain = open(usedKey, message.d); } catch (error) { plain = null; usedKey = null; }
    } else if (message && message.m === 'e') {
      for (const code of options.activeCodes()) {
        try { const k = enrollKey(code, cfg.tillId); plain = open(k, message.d); usedKey = k; break; } catch (error) { plain = null; }
      }
    }
    if (message && message.m === 'r') {
      // "ring the administrator": needs no key (the phone has none yet), only this single route
      let ask = {};
      try { ask = { name: String(message.name || '').slice(0, 60) }; } catch (error) { ask = {}; }
      const reply = await forward('POST', '/api/ring', '', JSON.stringify(ask));
      try { await call('POST', '/t/' + cfg.tillId + '/res/' + item.id, JSON.stringify({ r: { s: reply.s, b: reply.b } }), 15000); } catch (error) { /* the phone will retry */ }
      return;
    }
    let answer;
    if (!plain) {
      answer = JSON.stringify({ e: 'auth' });
      if (message && (message.m === 'e' || message.m === 'n')) state.lastAttempt = { at: Date.now(), ok: false, reason: 'code d’association incorrect ou expiré' };
    }
    else {
      let request = null;
      try { request = JSON.parse(plain); } catch (error) { request = null; }
      const now = Date.now();
      for (const entry of Array.from(seen.entries())) if (now - entry[1] > MAX_SKEW_MS * 2) seen.delete(entry[0]);
      const fresh = Boolean(request) && typeof request.n === 'string' && request.n.length >= 8 && !seen.has(request.n) && Math.abs(now - Number(request.t)) < MAX_SKEW_MS;
      const method = request ? String(request.x || '').toUpperCase() : '', requestPath = request ? String(request.p || '').split('?')[0] : '';
      const enrollingWorker = message.m === 'e' && method === 'POST' && requestPath === '/api/worker/enroll';
      const enrollingDirect = message.m === 'n' && method === 'POST' && requestPath === '/api/owner/enroll-direct';
      const enrolling = enrollingWorker || enrollingDirect || (message.m === 'e' && method === 'POST' && requestPath === '/api/owner/enroll');
      const allowed = enrolling || (message.m === 'k' && ALLOWED.some(rule => rule[0] === method && rule[1] === requestPath)) || (message.m === 'w' && WORKER_ALLOWED.some(rule => rule[0] === method && rule[1] === requestPath));
      let reply;
      if (!fresh) reply = { s: 400, c: '', b: JSON.stringify({ error: 'Requête expirée ou rejouée.' }) };
      else if (!allowed) reply = { s: 403, c: '', b: JSON.stringify({ error: 'Non autorisé à distance.' }) };
      else {
        seen.set(request.n, now);
        reply = await forward(method, String(request.p), String(request.c || ''), request.b ? String(request.b) : '');
        if (enrolling && (reply.s === 200 || reply.s === 201)) {
          try { const data = JSON.parse(reply.b); data.key = enrollingWorker ? cfg.wkey : cfg.key; data.tillId = cfg.tillId; reply.b = JSON.stringify(data); } catch (error) { /* keep as is */ }
        }
      }
      if (message.m === 'e' || message.m === 'n') { let why = ''; try { why = JSON.parse(reply.b).error || ''; } catch (error) { why = ''; } state.lastAttempt = { at: Date.now(), ok: reply.s >= 200 && reply.s < 300, reason: why || (reply.s >= 200 && reply.s < 300 ? '' : 'refusé (' + reply.s + ')') }; }
      answer = JSON.stringify({ d: seal(usedKey, JSON.stringify({ n: request ? request.n : '', s: reply.s, c: reply.c, b: reply.b })) });
    }
    try { await call('POST', '/t/' + cfg.tillId + '/res/' + item.id, answer, 15000); } catch (error) { /* the phone will retry */ }
  };

  const loop = async () => {
    let delay = 2000;
    while (!stopped) {
      try {
        const register = () => { let handles = []; try { handles = Array.from(new Set((options.ownerNames ? options.ownerNames() : []).filter(Boolean).map(handleOf))).slice(0, 40); } catch (error) { handles = []; } return call('PUT', '/t/' + cfg.tillId, JSON.stringify({ pub: ecdh.getPublicKey('hex'), handles: handles }), 20000); };
        const registered = await register(); let registeredAt = Date.now();
        if (registered.status !== 200) throw new Error('register ' + registered.status);
        state.connected = true; state.lastOk = Date.now();
        for (;;) {
          if (stopped) return;
          if (Date.now() - registeredAt > 60000) { try { await register(); registeredAt = Date.now(); } catch (error) { /* retried next round */ } }
          const next = await call('GET', '/t/' + cfg.tillId + '/next', '', 40000);
          if (next.status === 403) break;
          if (next.status === 200) { state.connected = true; state.lastOk = Date.now(); delay = 2000; handle(JSON.parse(next.text)).catch(() => {}); }
          else if (next.status === 204) { state.connected = true; state.lastOk = Date.now(); delay = 2000; }
          else throw new Error('next ' + next.status);
        }
      } catch (error) {
        state.connected = false;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 60000);
      }
    }
  };
  loop();
  state.address = cfg.url.replace(/\/$/, '') + '/' + cfg.tillId;
  state.stop = function () { stopped = true; };
  return state;
}

module.exports = { handleOf: handleOf, start: start, seal: seal, open: open, enrollKey: enrollKey };
