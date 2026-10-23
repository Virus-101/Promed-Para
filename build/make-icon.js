'use strict';
// Draws the PromedPara icon (green rounded square, white 6-spoke star) and writes icon.png + icon.ico into ./assets.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 256, pixels = Buffer.alloc(N * N * 4);
const cx = N / 2, cy = N / 2, radius = 52, half = 11;
const dist = (x, y, a) => Math.abs(-(x - cx) * Math.sin(a) + (y - cy) * Math.cos(a));
const along = (x, y, a) => Math.abs((x - cx) * Math.cos(a) + (y - cy) * Math.sin(a));
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = (y * N + x) * 4;
  const dx = Math.max(Math.abs(x - cx) - (N / 2 - radius), 0), dy = Math.max(Math.abs(y - cy) - (N / 2 - radius), 0);
  const inside = Math.sqrt(dx * dx + dy * dy) <= radius ? 1 : Math.max(0, 1 - (Math.sqrt(dx * dx + dy * dy) - radius));
  let star = 0;
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3 + Math.PI / 2;
    if (along(x, y, a) < 84) star = Math.max(star, Math.min(1, Math.max(0, half + 0.5 - dist(x, y, a))));
  }
  const g = [29, 107, 70], w = [255, 255, 255];
  for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(g[c] * (1 - star) + w[c] * star);
  pixels[i + 3] = Math.round(255 * inside);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; pixels.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const dir = path.join(__dirname, 'assets'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), png);
const head = Buffer.alloc(22); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 0; head[7] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, png]));
console.log('icon written', png.length, 'bytes');
