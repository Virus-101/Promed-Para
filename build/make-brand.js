'use strict';
// Builds every logo variant from brand/logo-original.webp (pure black background):
//   public/img/   logo-full.png, logo-full-light.png (white, for dark backgrounds), mark.png, mark-light.png, mark-black.png (receipts), favicon-32.png
//   build/assets/ icon.png (256), icon.ico (16-256), icon-256.png
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, 'brand', 'logo-original.webp');
const IMG = path.resolve(__dirname, '..', 'public', 'img');
const ASSETS = path.join(__dirname, 'assets');
fs.mkdirSync(IMG, { recursive: true }); fs.mkdirSync(ASSETS, { recursive: true });

// Regions measured on the original (1024x1024)
const REGION = { mark: [299, 233, 718, 566], full: [210, 233, 813, 797] };
const PAD = 28;

async function load() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, C: info.channels };
}

// Alpha from brightness against the black background, relative to the local plateau so anti-aliased edges
// become partly transparent instead of dark fringes; colours are un-blended from black.
function cutout(img, box, mode) {
  const { data, W, H, C } = img;
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0 + 1 + PAD * 2, h = y1 - y0 + 1 + PAD * 2;
  const value = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) value[i] = Math.max(data[i * C], data[i * C + 1], data[i * C + 2]);
  const R = 3, tmp = new Uint8Array(W * H), local = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let k = Math.max(0, x - R); k <= Math.min(W - 1, x + R); k++) m = Math.max(m, value[y * W + k]); tmp[y * W + x] = m; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let k = Math.max(0, y - R); k <= Math.min(H - 1, y + R); k++) m = Math.max(m, tmp[k * W + x]); local[y * W + x] = m; }
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 - PAD + x, sy = y0 - PAD + y, o = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const i = sy * W + sx, v = value[i], peak = local[i];
    if (v <= 3 || peak < 20) continue;
    const alpha = Math.min(1, v / peak);
    if (mode === 'white') { out[o] = out[o + 1] = out[o + 2] = 255; }
    else if (mode === 'black') { out[o] = out[o + 1] = out[o + 2] = 0; }
    else for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, Math.round(data[i * C + c] / alpha));
    out[o + 3] = Math.round(alpha * 255);
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } });
}

const png = (s, file, width) => (width ? s.resize({ width, kernel: 'lanczos3' }) : s).png({ compressionLevel: 9 }).toFile(file);

// ICO with BMP entries for small sizes (best compatibility on Windows 7) and PNG for large ones.
function bmpEntry(rgba, size) {
  const header = Buffer.alloc(40); header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8); header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(size * size * 4 + Math.ceil(size / 32) * 4 * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const s = ((size - 1 - y) * size + x) * 4, d = (y * size + x) * 4; pixels[d] = rgba[s + 2]; pixels[d + 1] = rgba[s + 1]; pixels[d + 2] = rgba[s]; pixels[d + 3] = rgba[s + 3]; }
  return Buffer.concat([header, pixels, Buffer.alloc(Math.ceil(size / 32) * 4 * size)]);
}
async function writeIco(file, tile) {
  const sizes = [16, 24, 32, 48, 64, 128, 256], entries = [];
  for (const size of sizes) {
    const resized = sharp(await tile.clone().png().toBuffer()).resize(size, size, { kernel: 'lanczos3' });
    const data = size >= 64 ? await resized.png().toBuffer() : bmpEntry(await resized.ensureAlpha().raw().toBuffer(), size);
    entries.push({ size, data });
  }
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16; const dir = [];
  for (const e of entries) { const d = Buffer.alloc(16); d[0] = e.size >= 256 ? 0 : e.size; d[1] = e.size >= 256 ? 0 : e.size; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(e.data.length, 8); d.writeUInt32LE(offset, 12); offset += e.data.length; dir.push(d); }
  fs.writeFileSync(file, Buffer.concat([head].concat(dir, entries.map(e => e.data))));
}

(async () => {
  const img = await load();
  await png(cutout(img, REGION.full, 'color'), path.join(IMG, 'logo-full.png'), 560);
  await png(cutout(img, REGION.full, 'white'), path.join(IMG, 'logo-full-light.png'), 560);
  await png(cutout(img, REGION.mark, 'color'), path.join(IMG, 'mark.png'), 360);
  await png(cutout(img, REGION.full, 'color'), path.join(ASSETS, 'guide-logo.png'), 260);
  await png(cutout(img, REGION.mark, 'white'), path.join(IMG, 'mark-light.png'), 360);
  await png(cutout(img, REGION.mark, 'black'), path.join(IMG, 'mark-black.png'), 300);

  // App icon: the coloured mark on a white rounded tile
  const S = 512, markBuf = await cutout(img, REGION.mark, 'color').png().toBuffer();
  const inner = await sharp(markBuf).resize({ width: Math.round(S * 0.8) }).png().toBuffer();
  const innerMeta = await sharp(inner).metadata();
  const tileSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + S + '" height="' + S + '"><rect width="' + S + '" height="' + S + '" rx="' + Math.round(S * 0.22) + '" fill="#ffffff"/></svg>');
  const tile = sharp(tileSvg).composite([{ input: inner, left: Math.round((S - innerMeta.width) / 2), top: Math.round((S - innerMeta.height) / 2) }]).png();
  const tileBuf = await tile.toBuffer();
  await sharp(tileBuf).resize(256, 256, { kernel: 'lanczos3' }).png().toFile(path.join(ASSETS, 'icon.png'));
  await sharp(tileBuf).resize(32, 32, { kernel: 'lanczos3' }).png().toFile(path.join(IMG, 'favicon-32.png'));
  await sharp(tileBuf).resize(180, 180, { kernel: 'lanczos3' }).png().toFile(path.join(IMG, 'app-icon-180.png'));
  await writeIco(path.join(ASSETS, 'icon.ico'), sharp(tileBuf));
  fs.copyFileSync(path.join(ASSETS, 'icon.ico'), path.join(IMG, 'favicon.ico'));
  console.log('brand assets written to', IMG, 'and', ASSETS);
})().catch(e => { console.error(e); process.exit(1); });
