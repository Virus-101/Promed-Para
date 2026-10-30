'use strict';
// Builds the black-and-white till icon (white Promed mark on a black rounded square): assets\icon.png + assets\icon.ico (16..256 px).
// Small sizes are stored as classic BMP entries (what Windows 7 draws best), 64 px and up as PNG.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MARK = path.resolve(__dirname, '..', 'owner-android', 'res', 'drawable-nodpi', 'logo_mark_light.png');
const OUT = path.join(__dirname, 'assets');

async function render(size) {
  const radius = Math.round(size * 0.22);
  const background = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '"><rect width="' + size + '" height="' + size + '" rx="' + radius + '" fill="#000000"/></svg>');
  const markSize = Math.round(size * 0.68);
  const mark = await sharp(MARK).resize(markSize, markSize, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp(background).composite([{ input: mark, gravity: 'center' }]).png().toBuffer();
}

async function bmpEntry(png, size) {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8); header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const from = ((size - 1 - y) * size + x) * 4, to = (y * size + x) * 4;   // bottom-up rows, BGRA
    pixels[to] = data[from + 2]; pixels[to + 1] = data[from + 1]; pixels[to + 2] = data[from]; pixels[to + 3] = data[from + 3];
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

(async () => {
  const sizes = [16, 24, 32, 48, 64, 128, 256], entries = [];
  for (const size of sizes) {
    const png = await render(size);
    entries.push({ size, data: size >= 64 ? png : await bmpEntry(png, size) });
    if (size === 256) fs.writeFileSync(path.join(OUT, 'icon.png'), png);
  }
  const head = Buffer.alloc(6 + entries.length * 16);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((entry, i) => {
    const at = 6 + i * 16;
    head[at] = entry.size >= 256 ? 0 : entry.size; head[at + 1] = entry.size >= 256 ? 0 : entry.size;
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6); head.writeUInt32LE(entry.data.length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head].concat(entries.map(e => e.data))));
  console.log('icon.ico and icon.png written (' + entries.length + ' sizes)');
})().catch(error => { console.error(error); process.exit(1); });
