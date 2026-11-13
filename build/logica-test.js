'use strict';
// The "find the old software's database" scan runs through the till (real Node 12 x86 runtime) and returns a readable report.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_logicadata');
const FAKE = path.resolve(__dirname, '..', '..', '_fake-logica');
const PORT = 4197, BASE = 'http://127.0.0.1:' + PORT;
const results = []; let proc;
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(FAKE, { recursive: true, force: true });
  // a fake install folder named like the old software, with a data file in it
  fs.mkdirSync(path.join(FAKE, 'Logica-Test', 'Data'), { recursive: true });
  fs.writeFileSync(path.join(FAKE, 'Logica-Test', 'Data', 'stock.mdb'), Buffer.alloc(2048));
  fs.writeFileSync(path.join(FAKE, 'Logica-Test', 'Data', 'notes.txt'), 'not a data file');
  proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: '' }) });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/status'); break; } catch (e) { await sleep(250); } }
  let cookie = '';
  const api = async (method, url, body) => {
    const res = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  let r = await api('GET', '/api/legacy-db/scan');
  ok('the scan needs a signed-in owner', r.status === 401, r);
  await api('POST', '/api/setup', { name: 'Test Owner', pin: 'Logica-Test-1' });
  r = await api('GET', '/api/legacy-db/scan');
  ok('nothing has run yet', r.status === 200 && r.json.started === false, r);
  r = await api('POST', '/api/legacy-db/scan', { keyword: 'logica-test' });
  ok('the scan starts', r.status === 200 && r.json.running === true, r);
  for (let i = 0; i < 60; i++) { await sleep(2000); r = await api('GET', '/api/legacy-db/scan'); if (r.json && !r.json.running) break; }
  ok('the scan finishes without error', r.json && r.json.running === false && !r.json.error && r.json.report && r.json.report.ran, r.json && { running: r.json.running, error: r.json.error });
  // the keyword also matches folders in the roots it knows; our fake folder lives elsewhere, so scan it directly with the module
  const direct = await require('../legacy-db').scan({ keyword: 'logica-test', timeoutMs: 80000, extraRoots: [FAKE] });
  ok('the report text is produced', typeof r.json.text === 'string' && r.json.text.includes('Raccourcis du bureau'), r.json.text && r.json.text.slice(0, 80));
  ok('a data file inside a folder named like the software is listed (and a note file is not)', direct.files.some(f => /stock\.mdb$/i.test(f.path)) && !direct.files.some(f => /notes\.txt$/i.test(f.path)), direct.files);
  ok('the report file is saved in the data folder', fs.existsSync(path.join(DATA, 'rapport-ancien-logiciel.txt')));
  try { proc.kill(); } catch (e) { /* gone */ }
  await sleep(800);
  fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(FAKE, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' old-software scan checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); try { proc.kill(); } catch (e) { /* gone */ } process.exit(1); });
