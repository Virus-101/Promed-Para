'use strict';
// Generates the Android resources (launcher icon, notification icon, in-app logos, vector icons) for BOTH apps
// from the same logo variants and Lucide icons used by the till. Output is committed under owner-android/res and worker-android/res.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'public', 'img');
const LUCIDE = path.join(__dirname, 'node_modules', 'lucide-static', 'icons');
const APPS = { owner: path.join(ROOT, 'owner-android', 'res'), worker: path.join(ROOT, 'worker-android', 'res') };
const ICONS = ['refresh-cw', 'log-out', 'bell', 'bell-off', 'trending-up', 'package', 'triangle-alert', 'wifi', 'truck', 'activity', 'smartphone', 'scan-barcode', 'key-round', 'check', 'circle-check', 'shield-check', 'receipt', 'clock', 'lock-keyhole', 'refresh-cw'];
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// ---- Lucide SVG -> Android VectorDrawable (stroke icons: path, circle, rect, line, polyline, polygon, ellipse)
const num = v => Number(v);
// a path starting with a relative 'm' means absolute for a standalone SVG path, but not after another subpath in one pathData
function absFirstMove(d) { const m = d.trim().match(/^m\s*(-?[\d.]+)[\s,]*(-?[\d.]+)([\s\S]*)$/); if (!m) return d.trim(); return 'M' + m[1] + ',' + m[2] + (m[3].trim() ? ' l' + m[3] : ''); }
function elementToPath(tag, attrs) {
  const a = n => attrs[n];
  if (tag === 'path') return absFirstMove(a('d'));
  if (tag === 'circle') { const cx = num(a('cx')), cy = num(a('cy')), r = num(a('r')); return `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`; }
  if (tag === 'ellipse') { const cx = num(a('cx')), cy = num(a('cy')), rx = num(a('rx')), ry = num(a('ry')); return `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0`; }
  if (tag === 'line') return `M${a('x1')},${a('y1')} L${a('x2')},${a('y2')}`;
  if (tag === 'polyline' || tag === 'polygon') { const pts = a('points').trim().split(/[\s,]+/).map(Number); let d = `M${pts[0]},${pts[1]}`; for (let i = 2; i < pts.length; i += 2) d += ` L${pts[i]},${pts[i + 1]}`; return d + (tag === 'polygon' ? ' z' : ''); }
  if (tag === 'rect') {
    const x = num(a('x') || 0), y = num(a('y') || 0), w = num(a('width')), h = num(a('height')), rx = Math.min(num(a('rx') || a('ry') || 0), w / 2, h / 2);
    if (!rx) return `M${x},${y} h${w} v${h} h${-w} z`;
    return `M${x + rx},${y} h${w - 2 * rx} a${rx},${rx} 0 0,1 ${rx},${rx} v${h - 2 * rx} a${rx},${rx} 0 0,1 ${-rx},${rx} h${-(w - 2 * rx)} a${rx},${rx} 0 0,1 ${-rx},${-rx} v${-(h - 2 * rx)} a${rx},${rx} 0 0,1 ${rx},${-rx} z`;
  }
  throw new Error('unsupported svg element ' + tag);
}
function svgToVector(svg) {
  const parts = [];
  for (const m of svg.matchAll(/<(path|circle|ellipse|line|polyline|polygon|rect)\b([^>]*?)\/?>/g)) {
    const attrs = {}; for (const at of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[at[1]] = at[2];
    parts.push(elementToPath(m[1], attrs));
  }
  return '<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n' +
    '  <path android:pathData="' + parts.join(' ') + '" android:strokeColor="#FF000000" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" />\n</vector>\n';
}

const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };

(async () => {
  const markLight = await sharp(path.join(IMG, 'mark-light.png')).png().toBuffer();
  for (const [app, res] of Object.entries(APPS)) {
    fs.rmSync(res, { recursive: true, force: true });
    // adaptive launcher icon (Android 8+, and a themed monochrome layer on Android 13+)
    write(path.join(res, 'values', 'colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#1B4D33</color>\n</resources>\n');
    write(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/ic_launcher_background" />\n  <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n  <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>\n');
    for (const [name, scale] of Object.entries(DENSITIES)) {
      const canvas = Math.round(108 * scale), markWidth = Math.round(canvas * 0.56);
      const mark = await sharp(markLight).resize({ width: markWidth }).png().toBuffer();
      const meta = await sharp(mark).metadata();
      const layer = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: mark, left: Math.round((canvas - meta.width) / 2), top: Math.round((canvas - meta.height) / 2) }]).png().toBuffer();
      write(path.join(res, 'mipmap-' + name, 'ic_launcher_foreground.png'), layer);
      write(path.join(res, 'mipmap-' + name, 'ic_launcher_monochrome.png'), layer);
      // notification (status bar) icon: white mark on transparent, 24dp
      const stat = Math.round(24 * scale), sm = await sharp(markLight).resize({ width: Math.round(stat * 0.92) }).png().toBuffer(), smeta = await sharp(sm).metadata();
      write(path.join(res, 'drawable-' + name, 'ic_stat_promed.png'), await sharp({ create: { width: stat, height: stat, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: sm, left: Math.round((stat - smeta.width) / 2), top: Math.round((stat - smeta.height) / 2) }]).png().toBuffer());
    }
    // in-app logos (density independent, sized at about 2x of how they are shown)
    write(path.join(res, 'drawable-nodpi', 'logo_full_light.png'), await sharp(path.join(IMG, 'logo-full-light.png')).resize({ width: 420 }).png().toBuffer());
    write(path.join(res, 'drawable-nodpi', 'logo_mark_light.png'), await sharp(path.join(IMG, 'mark-light.png')).resize({ width: 160 }).png().toBuffer());
    write(path.join(res, 'drawable-nodpi', 'logo_mark_color.png'), await sharp(path.join(IMG, 'mark.png')).resize({ width: 160 }).png().toBuffer());
    for (const icon of new Set(ICONS)) write(path.join(res, 'drawable', 'ic_' + icon.replace(/-/g, '_') + '.xml'), svgToVector(fs.readFileSync(path.join(LUCIDE, icon + '.svg'), 'utf8')));
    console.log(app + ': resources written to ' + res);
  }
})().catch(e => { console.error(e); process.exit(1); });
