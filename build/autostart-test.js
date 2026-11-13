'use strict';
// "Does the till start with the PC?": the check and the repair, on a throwaway Startup folder (never the real one).
const fs = require('fs');
const os = require('os');
const path = require('path');
const autostart = require('../autostart.js');

const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };

(async () => {
  if (process.platform !== 'win32') { console.log('skipped: Windows only'); process.exit(0); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-startup-'));
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');   // any real program stands in for PromedPara.exe
  const other = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'calc.exe');

  let s = await autostart.status('', {});
  ok('without a known program path the check says it cannot tell', s.supported === false && s.enabled === false, s);
  s = await autostart.status(exe, { dirs: [dir] });
  ok('an empty Startup folder means: not started automatically', s.supported === true && s.enabled === false, s);
  await autostart.enable(exe, { dir, name: 'PromedPara Caisse.lnk' });
  ok('the repair creates the shortcut', fs.existsSync(path.join(dir, 'PromedPara Caisse.lnk')), fs.readdirSync(dir));
  s = await autostart.status(exe, { dirs: [dir] });
  ok('the check then sees it and says where', s.enabled === true && /PromedPara Caisse\.lnk$/.test(s.via), s);
  s = await autostart.status(other, { dirs: [dir] });
  ok('a shortcut to a different program does not count', s.enabled === false, s);
  await autostart.enable(exe, { dir, name: 'PromedPara Caisse.lnk' });
  ok('repairing twice leaves a single shortcut', fs.readdirSync(dir).length === 1, fs.readdirSync(dir));

  for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
  fs.rmdirSync(dir);
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' autostart checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
