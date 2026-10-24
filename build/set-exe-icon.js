'use strict';
// Puts the Promed logo and product information into PromedPara.exe (taskbar, Explorer, task manager).
// Usage: node set-exe-icon.js <exe> <icon.ico> <version>
const { rcedit } = require('rcedit');
const [exe, icon, version] = process.argv.slice(2);
if (!exe || !icon || !version) { console.error('usage: set-exe-icon.js <exe> <icon.ico> <version>'); process.exit(1); }
rcedit(exe, {
  icon,
  'file-version': version + '.0',
  'product-version': version + '.0',
  'version-string': {
    ProductName: 'PromedPara', FileDescription: 'PromedPara - Caisse', CompanyName: 'Promed Parapharmacie',
    LegalCopyright: 'Promed Parapharmacie', OriginalFilename: 'PromedPara.exe', InternalName: 'PromedPara'
  }
}).then(() => console.log('exe icon and version set'), e => { console.error('rcedit failed:', e.message); process.exit(1); });
