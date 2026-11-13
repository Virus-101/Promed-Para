'use strict';
// Which version does the shop till run, and is it online?  node shop-status.js [owner name]   (default: hicham)
const crypto = require('crypto');
const { execSync } = require('child_process');
const RELAY = 'https://promedpara-relay.onrender.com';
(async () => {
  const name = (process.argv[2] || 'hicham').trim().toLowerCase();
  const handle = crypto.createHash('sha256').update('promed-handle:' + name).digest('hex');
  let latest = ''; try { latest = execSync('gh release view --repo Virus-101/Promed-Para --json tagName --jq .tagName', { encoding: 'utf8' }).trim().replace(/^v/, ''); } catch (e) { /* offline */ }
  const found = (await (await fetch(RELAY + '/h/' + handle)).json()).tills || [];
  if (!found.length) { console.log('Aucune caisse en ligne pour « ' + name + ' ». Dernière version publiée : ' + latest); return; }
  for (const till of found) {
    const s = await (await fetch(RELAY + '/s/' + till.id)).json();
    const state = !s.version ? 'version inconnue (la caisse n\'a pas encore la mise à jour qui la rapporte)' : s.version === latest ? 'à jour' : 'en retard sur ' + latest;
    console.log('caisse ' + till.id + ' · en ligne : ' + s.online + ' · version : ' + (s.version || '?') + ' · ' + state + ' · vue : ' + s.lastSeen);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
