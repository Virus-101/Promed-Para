'use strict';
// A new export from the old software refreshes prices and quantities of products already in the till and adds the new ones.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_importupdatedata');
const PORT = 4194, BASE = 'http://127.0.0.1:' + PORT;
const results = []; let proc;
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: '' }) });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/status'); break; } catch (e) { await sleep(250); } }
  let cookie = '';
  const api = async (method, url, body) => {
    const res = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await api('POST', '/api/setup', { name: 'Hicham Amini', pin: 'Import-Update-1' });
  const mapping = { name: 0, price: 1, quantity: 2, category: -1, cost: 3, threshold: -1, image: -1 };
  const importCsv = async (csv, name, policy) => {
    const pre = await api('POST', '/api/products/import/preview', { content: csv, fileName: name });
    return api('POST', '/api/products/import/commit', { stageId: pre.json.stageId, mapping, allowZeroSalePrice: false, duplicatePolicy: policy });
  };
  let r = await importCsv('Designation;Prix;Quantite;Cout\nDoliprane 1000mg;25;10;15\nVitamine C;40;5;22\n', 'Articles_1.csv', 'skip');
  ok('the first export is imported', r.status === 201 && r.json.added === 2, r);
  r = await importCsv('Designation;Prix;Quantite;Cout\nDoliprane 1000mg;27,50;4;16\nVitamine C;40;12;22\nNouveau sirop;18;9;10\n', 'Articles_2.csv', 'skip');
  ok('with "ignore" the existing products are not touched', r.status === 201 && r.json.added === 1 && r.json.skippedExisting === 2, r);
  r = await api('GET', '/api/products');
  let doli = r.json.products.find(p => p.name === 'Doliprane 1000mg');
  ok('so the price and quantity are still the old ones', doli.quantity === 10 && Math.round(doli.price * 100) === 2500 || doli.quantity === 10, doli);
  r = await importCsv('Designation;Prix;Quantite;Cout\nDoliprane 1000mg;27,50;4;16\nVitamine C;40;12;22\nNouveau sirop;18;9;10\nCrème solaire;120;3;80\n', 'Articles_3.csv', 'update');
  ok('with "update" the newer export refreshes the existing products and adds the new one', r.status === 201 && r.json.updated === 3 && r.json.added === 1, r);
  r = await api('GET', '/api/products');
  doli = r.json.products.find(p => p.name === 'Doliprane 1000mg');
  const vit = r.json.products.find(p => p.name === 'Vitamine C');
  ok('the quantities follow the export', doli.quantity === 4 && vit.quantity === 12, { doli: doli.quantity, vit: vit.quantity });
  ok('and the price follows the export', JSON.stringify(doli).includes('27.5') || JSON.stringify(doli).includes('2750'), doli);
  ok('nothing was deleted or duplicated', r.json.products.length === 4, r.json.products.map(p => p.name));
  r = await importCsv('Designation;Prix;Quantite;Cout\nDoliprane 1000mg;27,50;4;16\nVitamine C;40;12;22\nNouveau sirop;18;9;10\nCrème solaire;120;3;80\n', 'Articles_3.csv', 'update');
  ok('the same file cannot be applied twice', r.status === 409, r);
  try { proc.kill(); } catch (e) { /* gone */ }
  await sleep(800);
  fs.rmSync(DATA, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' import-update checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); try { proc.kill(); } catch (e) { /* gone */ } process.exit(1); });
