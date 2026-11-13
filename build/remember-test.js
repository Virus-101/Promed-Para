'use strict';
// "Remember my code on this PC": runs the real Electron of the kit and checks Windows' protection (DPAPI) round trip,
// and that every shell file the app needs was copied into the kit (a missing file would stop the till window from opening).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const results = [];
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };

(async () => {
  const shell = path.join(KIT, 'electron', 'resources', 'app');
  const required = fs.readdirSync(path.join(__dirname, 'electron')).filter(name => /\.(js|json)$/.test(name));
  ok('every shell file is in the kit', required.every(name => fs.existsSync(path.join(shell, name))), required.filter(name => !fs.existsSync(path.join(shell, name))));
  if (process.platform !== 'win32') { console.log('skipped: Windows only'); process.exit(0); }
  const out = path.join(os.tmpdir(), 'pp-remember-selftest-' + process.pid + '.json');
  const child = spawn(path.join(KIT, 'electron', 'PromedPara.exe'), [], { env: Object.assign({}, process.env, { PROMEDPARA_SELFTEST: 'remember', PROMEDPARA_SELFTEST_OUT: out }), stdio: 'ignore' });
  for (let i = 0; i < 80 && !fs.existsSync(out); i++) await new Promise(resolve => setTimeout(resolve, 250));
  let result = null; try { result = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (error) { result = null; }
  try { child.kill(); } catch (error) { /* already gone */ }
  try { fs.unlinkSync(out); } catch (error) { /* none */ }
  ok('Windows protection is available', result && result.available === true, result);
  ok('a code can be saved and read back', result && result.saved === true && result.roundTrip === true, result);
  ok('the code is not readable in the file on disk', result && result.onDisk === true, result);
  ok('forgetting it removes it', result && result.forgotten === true, result);
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' remember-on-this-PC checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
