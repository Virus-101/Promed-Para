'use strict';
// PromedPara - lit (en lecture seule) une base sqlite avec le meme moteur que l'application (sql.js).
// Ne modifie jamais le fichier lu : sert a diagnostiquer un fichier corrompu ou a verifier une base restauree.
// Usage : runtime\node.exe tools\inspect-db.js "chemin\vers\fichier.sqlite"
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.log('erreur: chemin du fichier manquant'); process.exit(2); }
if (!fs.existsSync(file)) { console.log('erreur: fichier introuvable: ' + file); process.exit(2); }

const vendorDir = path.join(__dirname, '..', 'app', 'vendor');
let initSqlJs;
try { initSqlJs = require(path.join(vendorDir, 'sql-wasm.js')); }
catch (e) { console.log('erreur: moteur sql.js introuvable (' + e.message + ')'); process.exit(2); }

const bytes = fs.readFileSync(file);
console.log('fichier: ' + file);
console.log('taille_octets: ' + bytes.length);
const head = bytes.slice(0, 15).toString('latin1');
console.log('entete_sqlite_valide: ' + (head === 'SQLite format 3' ? 'oui' : 'non'));

initSqlJs({ wasmBinary: fs.readFileSync(path.join(vendorDir, 'sql-wasm.wasm')) }).then(function (SQL) {
  let db;
  try { db = new SQL.Database(bytes); }
  catch (e) { console.log('ouverture: echec (' + e.message + ')'); process.exit(1); return; }
  console.log('ouverture: ok');

  function one(sql, label) {
    try {
      const stmt = db.prepare(sql);
      let value = null;
      if (stmt.step()) value = stmt.getAsObject();
      stmt.free();
      const keys = value ? Object.keys(value) : [];
      console.log(label + ': ' + (keys.length ? String(value[keys[0]]) : 'aucune_ligne'));
    } catch (e) { console.log(label + ': erreur (' + e.message + ')'); }
  }

  one('SELECT COUNT(*) AS n FROM sqlite_master WHERE type=\'table\'', 'tables_total');
  one('SELECT COUNT(*) AS n FROM sales', 'ventes_total');
  one('SELECT MAX(created_at) AS t FROM sales', 'derniere_vente');
  one('SELECT COUNT(*) AS n FROM sale_lines', 'lignes_vente_total');
  one('SELECT COUNT(*) AS n FROM stock_movements', 'mouvements_stock_total');
  one('SELECT MAX(created_at) AS t FROM stock_movements', 'dernier_mouvement_stock');
  one('SELECT COUNT(*) AS n FROM products', 'produits_total');
  try { db.close(); } catch (e2) { /* ignore */ }
}).catch(function (e) {
  console.log('erreur_moteur: ' + e.message);
  process.exit(2);
});
