'use strict';
// PromedPara relay. The till and the owner phones both connect OUT to this service; nothing connects inbound to the shop.
// Everything that passes through is AES-256-GCM ciphertext made by the till and the phones: this service cannot read it.
// State is in memory only: a restart loses nothing important because the till simply registers again.
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 512 * 1024, WAIT_PHONE_MS = 27_000, WAIT_TILL_MS = 25_000, OFFLINE_AFTER_MS = 45_000;
const ID = /^[a-f0-9]{16}$/, TOKEN = /^[a-f0-9]{32,64}$/;
const tills = new Map();
const hits = new Map();

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const send = (res, status, body, headers) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(text);
};
const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(chunk); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});
const limited = (ip, max) => {
  const minute = Math.floor(Date.now() / 60_000), key = ip + ':' + minute, count = (hits.get(key) || 0) + 1;
  hits.set(key, count);
  return count > max;
};
setInterval(() => { const minute = Math.floor(Date.now() / 60_000); for (const key of hits.keys()) if (Number(key.split(':').pop()) < minute - 1) hits.delete(key); }, 60_000).unref();

const tillAuth = (req, till) => till && typeof req.headers['x-token'] === 'string' && sha256(req.headers['x-token']) === till.tokenHash;
const online = till => till.parked || Date.now() - till.lastSeen < OFFLINE_AFTER_MS;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://relay');
    const parts = url.pathname.split('/').filter(Boolean);
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (req.method === 'GET' && parts.length === 0) return send(res, 200, { ok: true, service: 'promedpara-relay', tills: tills.size });

    // ---- till side
    if (parts[0] === 't' && ID.test(parts[1] || '')) {
      const id = parts[1];
      if (parts.length === 2 && req.method === 'PUT') {          // register (idempotent)
        const token = req.headers['x-token'];
        if (typeof token !== 'string' || !TOKEN.test(token)) return send(res, 400, { error: 'bad token' });
        const existing = tills.get(id);
        if (existing && !tillAuth(req, existing)) return send(res, 403, { error: 'forbidden' });
        if (!existing) {
          if (tills.size >= 500) return send(res, 503, { error: 'full' });
          tills.set(id, { tokenHash: sha256(token), queue: [], parked: null, pending: new Map(), lastSeen: Date.now() });
        }
        return send(res, 200, { ok: true });
      }
      const till = tills.get(id);
      if (!tillAuth(req, till)) return send(res, 403, { error: 'forbidden' });
      till.lastSeen = Date.now();
      if (parts[2] === 'next' && req.method === 'GET') {          // long-poll for the next phone request
        if (till.queue.length) return send(res, 200, till.queue.shift());
        if (till.parked) { clearTimeout(till.parked.timer); send(till.parked.res, 204, ''); }
        const parked = { res, timer: setTimeout(() => { if (till.parked === parked) till.parked = null; till.lastSeen = Date.now(); send(res, 204, ''); }, WAIT_TILL_MS) };
        till.parked = parked;
        req.on('close', () => { if (till.parked === parked) { clearTimeout(parked.timer); till.parked = null; till.lastSeen = Date.now(); } });
        return;
      }
      if (parts[2] === 'res' && parts[3] && req.method === 'POST') { // the till answers a phone request
        const entry = till.pending.get(parts[3]);
        const body = await readBody(req);
        if (entry) { till.pending.delete(parts[3]); clearTimeout(entry.timer); send(entry.res, 200, body); }
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    }

    // ---- phone side
    if (parts[0] === 'p' && ID.test(parts[1] || '') && req.method === 'POST') {
      if (limited(ip, 300)) return send(res, 429, { error: 'too many requests' });
      const till = tills.get(parts[1]);
      if (!till || !online(till)) return send(res, 503, { error: 'offline' });
      if (till.queue.length + till.pending.size > 60) return send(res, 429, { error: 'busy' });
      const body = await readBody(req);
      const requestId = crypto.randomBytes(8).toString('hex');
      const item = { id: requestId, body };
      const timer = setTimeout(() => { till.pending.delete(requestId); send(res, 504, { error: 'timeout' }); }, WAIT_PHONE_MS);
      till.pending.set(requestId, { res, timer });
      req.on('close', () => { const entry = till.pending.get(requestId); if (entry && !res.writableEnded) { clearTimeout(entry.timer); till.pending.delete(requestId); } });
      if (till.parked) { const parked = till.parked; till.parked = null; clearTimeout(parked.timer); send(parked.res, 200, item); } else till.queue.push(item);
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (error) {
    try { send(res, 400, { error: 'bad request' }); } catch (ignored) { /* socket already closed */ }
  }
});
server.keepAliveTimeout = 65_000; server.headersTimeout = 70_000;
server.listen(PORT, () => console.log('PromedPara relay listening on ' + PORT));
