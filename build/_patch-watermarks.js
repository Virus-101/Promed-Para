const fs = require('fs'); const path = require('path');
process.chdir(path.resolve(__dirname, '..', 'public'));
function swap(file, a, b) { let t = fs.readFileSync(file, 'utf8'); const c = t.split(a).length - 1; if (c !== 1) throw new Error(file + ': expected 1 got ' + c + ' for ' + a.slice(0, 70)); fs.writeFileSync(file, t.replace(a, () => b)); }
swap('app.css', ".auth-brand:after{content:'✳';position:absolute;font-size:390px;color:#ffffff0c;right:-50px;bottom:-140px}",
  ".auth-brand:after{content:'';position:absolute;width:420px;height:350px;right:-70px;bottom:-60px;background:url(/img/mark-light.png) no-repeat center/contain;opacity:.07;pointer-events:none}");
swap('console.css', ".owner-welcome:after{content:'✳';position:absolute;right:27%;top:-65px;font-size:215px;color:#ffffff09;pointer-events:none}",
  ".owner-welcome:after{content:'';position:absolute;right:18%;top:-28px;width:250px;height:208px;background:url(/img/mark-light.png) no-repeat center/contain;opacity:.07;pointer-events:none}");
swap('app.css', "content:'✳';width:200px;height:200px;border-radius:50%;display:grid;place-items:center;background:#236e4f;color:#fff;font-size:113px;",
  "content:'';width:200px;height:200px;border-radius:50%;display:grid;place-items:center;background:#236e4f url(/img/mark-light.png) no-repeat center/58%;");
swap('shop.css', "content:'✳';position:relative;z-index:1;width:62px;height:62px;border-radius:50%;display:grid;place-items:center;background:#fff9;color:#658166;font-size:29px}",
  "content:'';position:relative;z-index:1;width:62px;height:62px;border-radius:50%;display:grid;place-items:center;background:#fff9 url(/img/mark.png) no-repeat center/60%}");
swap('app.js', '<span class="brand-name">PromedPara</span><span class="brand-sub">ERRACHIDIA · MAROC</span>', '<span class="brand-name">Promed</span><span class="brand-sub">PARAPHARMACIE</span>');
let g = fs.readFileSync('../build/make-icons.js', 'utf8');
if (!g.includes('.brand-name,.brand-sub{display:block')) { g = g.replace("'[data-ico]{display:inline-flex;align-items:center;justify-content:center}'", "'.brand-compact .brand-name,.brand-compact .brand-sub{display:block;line-height:1.2;white-space:nowrap}',\n  '[data-ico]{display:inline-flex;align-items:center;justify-content:center}'"); fs.writeFileSync('../build/make-icons.js', g); }
console.log('watermarks, brand text and css updated');
