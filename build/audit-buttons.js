'use strict';
// Static audit of the screens:
//  1. every button/action named in a screen has a handler
//  2. every menu view loads
//  3. every icon name used anywhere exists in public/icons.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', 'public');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const used = new Set(), handled = new Set(), views = new Set(), viewHandlers = new Set();
const collect = (re, set, group = 1) => { let m; while ((m = re.exec(app))) set.add(m[group]); };
collect(/data-action="([a-z0-9-]+)"/g, used);
collect(/button\((?:ico\('[a-z0-9-]+',\d+\)\+)?(?:'[^']*'|`[^`]*`|"[^"]*"),\s*'([a-z0-9-]+)'/g, used);
for (const lit of ['detect-legacy-export', 'legacy-load', 'update-check', 'update-apply', 'update-rollback']) used.add(lit);   // data-action="${...}" built at run time
{ let m; const re = /action==='([a-z0-9-]+)'/g; while ((m = re.exec(app))) handled.add(m[1]); }
collect(/closest\('\[data-action="([a-z0-9-]+)"\]'\)/g, handled);
for (const n of ['pin-digit', 'pin-back', 'pin-clear', 'update-check', 'update-apply', 'update-rollback', 'legacy-load']) if (app.includes("action==='" + n + "'") || app.includes("action==='" + n.split('-')[0] + "-")) handled.add(n);
collect(/data-view="([a-z-]+)"/g, views);
{ let m; const nav = (/const navItems[^\n]*/.exec(app) || [''])[0]; const re = /\['([a-z-]+)','[a-z0-9-]+','[^']+'\]/g; while ((m = re.exec(nav))) views.add(m[1]); }
collect(/view==='([a-z-]+)'/g, viewHandlers);

const dead = [...used].filter(n => !handled.has(n));
const orphan = [...handled].filter(n => !used.has(n) && !/^(login-mode|recovery-|pin-|toggle-|goto-setup|ack-|ask-|notice-)/.test(n));
const unknownViews = [...views].filter(v => !viewHandlers.has(v) && v !== 'pos');
console.log('actions used in screens :', used.size, ' | handled in code:', handled.size);
console.log('BUTTONS WITH NO HANDLER :', dead.length ? dead.join(', ') : 'none');
console.log('handlers with no button :', orphan.length ? orphan.join(', ') : 'none');
console.log('menu views without loader:', unknownViews.length ? unknownViews.join(', ') : 'none');

// icons
const iconsSource = fs.readFileSync(path.join(root, 'icons.js'), 'utf8');
const baked = new Set(Object.keys(JSON.parse(/var P=(\{[\s\S]*?\});\nwindow\.ICONS/.exec(iconsSource)[1])));
const missingIcons = [];
for (const file of fs.readdirSync(root).filter(x => /\.(js|html)$/.test(x) && x !== 'icons.js')) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const m of text.matchAll(/ico\('([a-z0-9-]+)'|data-ico="([a-z0-9-]+)"/g)) { const n = m[1] || m[2]; if (!baked.has(n)) missingIcons.push(file + ':' + n); }
  for (const m of text.matchAll(/\?'(baby|sparkles|sun|stethoscope|droplets|leaf)'/g)) if (!baked.has(m[1])) missingIcons.push(file + ':' + m[1]);
}
console.log('icons missing from icons.js:', missingIcons.length ? missingIcons.join(', ') : 'none (' + baked.size + ' icons baked)');
process.exit(dead.length || unknownViews.length || missingIcons.length ? 1 : 0);
