'use strict';
// The desktop ends up with ONE "PromedPara Caisse" shortcut; other files and other programs' shortcuts are never touched.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '_desktoptest');
const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };

const makeShortcuts = specs => {
  const lines = ['$sh = New-Object -ComObject WScript.Shell'];
  for (const s of specs) lines.push("$l = $sh.CreateShortcut('" + s.file + "'); $l.TargetPath = '" + s.target + "'; $l.Save()");
  fs.writeFileSync(path.join(ROOT, 'make.ps1'), lines.join('\r\n'));
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'make.ps1')]);
};

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  const user = path.join(ROOT, 'user'), common = path.join(ROOT, 'common');
  fs.mkdirSync(user, { recursive: true }); fs.mkdirSync(common, { recursive: true });
  const exe = 'C:\\PromedPara\\electron\\PromedPara.exe', oldExe = 'C:\\Old\\PromedPara\\electron\\PromedPara.exe';
  makeShortcuts([
    { file: path.join(user, 'PromedPara Caisse.lnk'), target: exe },
    { file: path.join(user, 'PromedPara Caisse (2).lnk'), target: oldExe },
    { file: path.join(user, 'Test lecteur code-barres.lnk'), target: exe },
    { file: path.join(user, 'AnyDesk.lnk'), target: 'C:\\Program Files\\AnyDesk\\AnyDesk.exe' },
    { file: path.join(common, 'PromedPara Caisse.lnk'), target: exe },
    { file: path.join(common, 'Test lecteur code-barres.lnk'), target: exe },
    { file: path.join(common, 'LOGICA.lnk'), target: 'C:\\Debug\\LOGICA.exe' }
  ]);
  fs.writeFileSync(path.join(user, 'Articles_15-10-2026.csv'), 'data');
  const result = await require('../desktop').tidy(exe, [user, common]);
  const left = dir => fs.readdirSync(dir).sort();
  ok('the tidy-up ran', result.ok, result);
  const caisse = left(user).concat(left(common)).filter(n => /^PromedPara Caisse/i.test(n));
  ok('only one "PromedPara Caisse" shortcut is left on the desktop', caisse.length === 1, caisse);
  ok('no "Test lecteur code-barres" shortcut is left', !left(user).concat(left(common)).some(n => /^Test lecteur/i.test(n)), left(user).concat(left(common)));
  ok('other programs and files are untouched', left(user).includes('AnyDesk.lnk') && left(user).includes('Articles_15-10-2026.csv') && left(common).includes('LOGICA.lnk'), { user: left(user), common: left(common) });
  ok('the shortcut of the current install is the one kept', /PromedPara Caisse\.lnk$/.test(result.kept), result);
  const again = await require('../desktop').tidy(exe, [user, common]);
  ok('running it again changes nothing', again.removed.length === 0 && caisse.length === 1, again);
  fs.rmSync(ROOT, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' desktop checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
