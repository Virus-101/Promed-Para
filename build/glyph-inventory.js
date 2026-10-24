'use strict';
// Lists every symbol-like character used in the UI files, with a little context, so each can be replaced by a real icon.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', 'public');
const isSymbol = cp => (cp >= 0x2190 && cp <= 0x21FF) || (cp >= 0x2300 && cp <= 0x23FF) || (cp >= 0x25A0 && cp <= 0x25FF) || (cp >= 0x2600 && cp <= 0x27BF) || (cp >= 0x2B00 && cp <= 0x2BFF) || cp === 0xFF0B || cp === 0xD7 || (cp >= 0x1F300 && cp <= 0x1FAFF) || cp === 0x2022 || cp === 0x2713 || cp === 0x2715;
for (const file of fs.readdirSync(root).filter(f => /\.(js|html)$/.test(f))) {
  const text = fs.readFileSync(path.join(root, file), 'utf8'); const found = new Map();
  for (const m of text.matchAll(/[←-⇿⌀-⏿■-◿☀-➿⬀-⯿＋×•]|[\u{1F300}-\u{1FAFF}]/gu)) {
    const ch = m[0]; const i = m.index; const ctx = text.slice(Math.max(0, i - 22), i + 26).replace(/\s+/g, ' ');
    const e = found.get(ch) || { n: 0, ctx: ctx }; e.n++; found.set(ch, e);
  }
  if (found.size) { console.log('\n== ' + file); for (const [ch, e] of found) console.log('  ' + ch + '  U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '  x' + e.n + '   ...' + e.ctx.replace(/\$\{[^}]*\}/g, '${}') + '...'); }
}
