'use strict';
// The old software's stock export: found automatically, decoys ignored, imported with the right prices and quantities (real Node 12 x86 runtime).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const KIT = path.resolve(__dirname, '..', '..', 'PromedPara-USB');
const DATA = path.resolve(__dirname, '..', '..', '_legacydata');
const PORT = 4198, BASE = 'http://127.0.0.1:' + PORT;
const SCAN = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-legacy-'));
const results = []; let proc;
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const lines = ['Article;Famille;PRIX_A;PRIX_V;Qté;Alert', 'Doliprane 1000mg;MEDICAMENTS;18,50;25,50;40;10', 'Crème solaire SPF50;SOLAIRE;95,00;149,00;12;4', 'Lait bébé 1er âge;BEBE;150,00;185,00;2;4', 'Article gratuit;DIVERS;0,00;0,00;5;1', 'Vitamine C 1000;COMPLEMENTS;50,25;78,00;15;5'];
fs.writeFileSync(path.join(SCAN, 'Articles_29-10-2026 03-00-00-touts-ar.csv'), Buffer.from(lines.join('\r\n'), 'latin1'));
fs.mkdirSync(path.join(SCAN, 'export'));
fs.writeFileSync(path.join(SCAN, 'export', 'stock-utf16.csv'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines.join('\r\n').replace(/;/g, '\t'), 'utf16le')]));
fs.writeFileSync(path.join(SCAN, 'README.txt'), 'Notes: cet article famille prix_v est un exemple\r\nsans colonnes.');
fs.writeFileSync(path.join(SCAN, 'clients.csv'), 'Nom;Telephone;Ville\r\nAhmed;0600000000;Errachidia\r\n');
fs.writeFileSync(path.join(SCAN, 'compta.csv'), 'Date;Libelle;Montant\r\n2026-10-01;Loyer;3000\r\n');

// an export with title lines before the columns, other column names, buried deep inside the old software's folder
fs.mkdirSync(path.join(SCAN, 'LOGICA', 'Export', '2026', 'Octobre'), { recursive: true });
fs.writeFileSync(path.join(SCAN, 'LOGICA', 'Export', '2026', 'Octobre', 'stock-du-jour.csv'), Buffer.from(['LOGICA - Etat du stock', 'Edite le 29/10/2026', 'Désignation;Code;PPV;PPH;Stock', 'Aspirine 500;611001;12,00;8,40;30', 'Bétadine 125ml;611002;34,50;27,00;7'].join('\r\n'), 'latin1'));
const start = async () => {
  proc = spawn(path.join(KIT, 'runtime', 'node.exe'), ['main.js'], { cwd: path.join(KIT, 'app'), env: Object.assign({}, process.env, { PROMEDPARA_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', PROMEDPARA_RELAY_URL: '', PROMEDPARA_LEGACY_DIRS: SCAN }) });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/status'); return; } catch (e) { await sleep(250); } }
  throw new Error('server did not start');
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  await start();
  let cookie = '';
  const api = async (method, url, body) => {
    const res = await fetch(BASE + url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await api('POST', '/api/setup', { name: 'Hicham Amini', pin: 'Legacy-Test-1' });

  // the till must keep answering while the scan runs
  const scanStart = Date.now();
  const scanning = api('GET', '/api/legacy-export/scan');
  const statusDuring = await fetch(BASE + '/api/status').then(r => r.status);
  const scan = await scanning;
  ok('scan answers and the till stays responsive meanwhile', scan.status === 200 && statusDuring === 200, { scan: scan.status, statusDuring });
  const found = scan.json.candidates.filter(c => c.folder.startsWith(SCAN));
  const names = found.map(c => c.fileName).sort();
  ok('both real exports are found (Latin-1 and UTF-16 tab-separated)', names.includes('Articles_29-10-2026 03-00-00-touts-ar.csv') && names.includes('stock-utf16.csv'), names);
  ok('README, clients and accounting files are not mistaken for it', !names.includes('README.txt') && !names.includes('clients.csv') && !names.includes('compta.csv'), names);
  ok('the file named Articles… comes first', scan.json.candidates[0].fileName.startsWith('Articles'), scan.json.candidates.slice(0, 3).map(c => c.fileName));

  ok('the deeply buried export is not in the quick search but the report says where it looked', !names.includes('stock-du-jour.csv') && Array.isArray(scan.json.searched) && scan.json.searched.length > 0 && Array.isArray(scan.json.oldApp), { names, searched: scan.json.searched });
  const deep = await api('GET', '/api/legacy-export/scan?deep=1');
  const deepFile = deep.json.candidates.find(c => c.fileName === 'stock-du-jour.csv');
  ok('the deep search finds it', deep.status === 200 && deep.json.deep === true && deepFile, deep.json.candidates.map(c => c.fileName));
  const titled = await api('GET', '/api/legacy-export?id=' + deepFile.id);
  const titledText = Buffer.from(titled.json.contentBase64, 'base64').toString('latin1');
  const titledPreview = await api('POST', '/api/products/import/preview', { fileName: titled.json.fileName, content: titledText });
  ok('title lines before the header are skipped, the real columns are read', titledPreview.status === 201 && titledPreview.json.headers[0] === 'Désignation' && titledPreview.json.rowCount === 2, titledPreview.json);
  const titledCommit = await api('POST', '/api/products/import/commit', { stageId: titledPreview.json.stageId, mapping: { name: 0, category: -1, cost: 3, price: 2, quantity: 4, threshold: -1, image: -1 }, duplicatePolicy: 'skip', allowZeroSalePrice: false });
  ok('PPV, PPH and Stock columns import with exact prices', titledCommit.status === 201 && titledCommit.json.added === 2, titledCommit.json);
  // the visible check: starts, reports progress while it runs, ends with the results
  const started = await api('POST', '/api/legacy-export/check', { deep: false });
  ok('the check starts and reports it is running', started.status === 200 && started.json.running === true && started.json.started === true, started.json);
  let snapshot = started.json, sawProgress = false, sawFolder = false;
  for (let i = 0; i < 120 && snapshot.running; i++) {
    await sleep(100);
    snapshot = (await api('GET', '/api/legacy-export/check')).json;
    if (snapshot.visited > 0 || snapshot.rootsDone > 0) sawProgress = true;
    if (snapshot.current) sawFolder = true;
  }
  // a fast PC can finish before the first poll, so the final snapshot must show the same counters
  ok('while running it shows counters and the folder being checked', (sawProgress || snapshot.visited > 0) && (sawFolder || snapshot.rootsTotal > 0), snapshot);
  ok('it ends with the final results and the list of places searched', !snapshot.running && snapshot.result && snapshot.result.candidates.some(c => c.fileName.startsWith('Articles')) && snapshot.result.searched.length > 0 && snapshot.rootsDone === snapshot.rootsTotal, { running: snapshot.running, done: snapshot.rootsDone, total: snapshot.rootsTotal });
  const articles = found.find(c => c.fileName.startsWith('Articles'));
  const file = await api('GET', '/api/legacy-export?id=' + articles.id);
  ok('the file content can be read back for the preview', file.status === 200 && file.json.size > 100, file.json && file.json.fileName);
  const text = Buffer.from(file.json.contentBase64, 'base64').toString('latin1');
  const preview = await api('POST', '/api/products/import/preview', { fileName: file.json.fileName, content: text });
  ok('the preview sees the six old-software columns', preview.status === 201 && preview.json.headers.length === 6 && preview.json.rowCount === 5, preview.json);
  const commit = await api('POST', '/api/products/import/commit', { stageId: preview.json.stageId, mapping: { name: 0, category: 1, cost: 2, price: 3, quantity: 4, threshold: 5, image: -1 }, duplicatePolicy: 'skip', allowZeroSalePrice: false });
  ok('four products imported, the zero-price line skipped', commit.status === 201 && commit.json.added === 4 && commit.json.skippedZeroPrice === 1, commit.json);
  const products = (await api('GET', '/api/products')).json.products;
  const doli = products.find(p => /Doliprane/.test(p.name)), lait = products.find(p => /Lait/.test(p.name));
  ok('decimal commas become exact prices and accents survive', doli && doli.price_cents === 2550 && doli.cost_cents === 1850 && doli.quantity === 40 && lait && /bébé/.test(lait.name) && lait.reorder_level === 4, { doli, lait });
  const again = await api('POST', '/api/products/import/preview', { fileName: file.json.fileName, content: text });
  const second = await api('POST', '/api/products/import/commit', { stageId: again.json.stageId, mapping: { name: 0, category: 1, cost: 2, price: 3, quantity: 4, threshold: 5, image: -1 }, duplicatePolicy: 'skip', allowZeroSalePrice: false });
  ok('importing the same file twice is refused', second.status === 409, second.json);

  proc.kill(); await sleep(800);
  fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(SCAN, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' old-stock import checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => { console.error(error); try { proc.kill(); } catch (e) { /* gone */ } process.exit(1); });
