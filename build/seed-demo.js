'use strict';
// Fills a RUNNING demo server (not the real till) with fake data, to preview the screens. node seed-demo.js http://127.0.0.1:4180
const BASE = process.argv[2] || 'http://127.0.0.1:4180';
let cookie = '';
const call = async (m, u, b) => {
  const r = await fetch(BASE + u, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: b ? JSON.stringify(b) : undefined });
  const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0];
  return r.json().catch(() => ({}));
};
(async () => {
  await call('POST', '/api/setup', { name: 'Demo Owner', username: 'demo', password: 'demo-password-1' });
  const items = [
    ['Doliprane 1000mg', '6111000000017', 25.5, 18, 40, 10, 'Médicaments'], ['Efferalgan 500mg', '6111000000024', 22, 15, 3, 5, 'Médicaments'],
    ['Crème solaire SPF50', '6111000000031', 149, 95, 12, 4, 'Solaire'], ['Shampooing doux 400ml', '6111000000048', 69, 45, 20, 6, 'Cheveux'],
    ['Lait bébé 1er âge', '6111000000055', 185, 150, 2, 4, 'Bébé'], ['Thermomètre digital', '6111000000062', 55, 30, 8, 2, 'Matériel'],
    ['Vitamine C 1000', '6111000000079', 78, 50, 15, 5, 'Compléments'], ['Gel hydroalcoolique 250ml', '6111000000086', 18, 9, 60, 10, 'Hygiène']
  ];
  const ids = [];
  for (const [name, barcode, price, cost, quantity, reorderLevel, category] of items) ids.push((await call('POST', '/api/products', { name, barcode, price, cost, quantity, reorderLevel, category })).product.id);
  await call('POST', '/api/suppliers', { name: 'Cooper Pharma', category: 'Médicaments', phone: '0600000000' });
  await call('POST', '/api/team', { name: 'Sara (employée)', username: 'sara', role: 'cashier' });
  for (const lines of [[[0, 2], [7, 1]], [[2, 1]], [[3, 1], [6, 2]], [[1, 1]]]) {
    await call('POST', '/api/sales', { lines: lines.map(([i, qty]) => ({ productId: ids[i], qty })), payment: 'Espèces', received: 500 });
  }
  console.log('demo ready: login demo / demo-password-1');
})();
