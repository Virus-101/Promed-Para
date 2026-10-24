// Part 2: shop.js, services.html, owner-app.html, worker.html, scanner-test.html
const fs = require('fs'); const path = require('path');
process.chdir(path.resolve(__dirname, '..', 'public'));
const files = {};
const get = f => files[f] || (files[f] = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
function rep(f, a, b, n = 1) { const t = get(f), c = t.split(a).length - 1; if (c !== n) throw new Error(f + ': expected ' + n + ' got ' + c + ' for: ' + a.slice(0, 80)); files[f] = t.split(a).join(b); }
const ic = (n, s) => '<i data-ico="' + n + '" data-size="' + s + '"></i>';

// ---- shop.js (plain script; ico() is global from icons.js)
const J = 'shop.js';
rep(J, "?'⌂':", "?'baby':"); rep(J, "?'❋':", "?'sparkles':"); rep(J, "?'☼':", "?'sun':"); rep(J, "(category)?'＋':", "(category)?'stethoscope':"); rep(J, "?'◌':'✳';", "?'droplets':'leaf';");
rep(J, '<span>${index?iconFor(category):\'✳\'}</span>', '<span>${ico(index?iconFor(category):\'leaf\',20)}</span>');
rep(J, '<div class="shop-empty-products"><span>✳</span>', '<div class="shop-empty-products"><span>\'+ico(\'leaf\',24)+\'</span>');
rep(J, '<div class="shop-empty-products"><span>⌕</span>', '<div class="shop-empty-products"><span>\'+ico(\'search-x\',26)+\'</span>');
rep(J, '<div class="shop-empty-products"><span>⌁</span>', '<div class="shop-empty-products"><span>\'+ico(\'store\',26)+\'</span>');
rep(J, '<div class="cart-empty-shop"><span>♧</span>', '<div class="cart-empty-shop"><span>\'+ico(\'shopping-bag\',26)+\'</span>');
rep(J, '<span aria-hidden="true">✳</span>', '<span aria-hidden="true">\'+ico(\'leaf\',28)+\'</span>');
rep(J, 'au panier">＋</button>', 'au panier">${ico(\'plus\',18)}</button>');
rep(J, 'aria-label="Augmenter la quantité">＋</button>', 'aria-label="Augmenter la quantité">${ico(\'plus\',14)}</button>');
rep(J, 'aria-label="Retirer du panier">×</button>', 'aria-label="Retirer du panier">${ico(\'x\',14)}</button>');

// ---- services.html
const V = 'services.html';
rep(V, '<span class="brand-icon">✳</span>', '<span class="brand-icon"><img class="brand-img" src="/img/mark-light.png" alt="" width="31" height="26"></span>');
rep(V, 'Découvrir nos univers ↓</a>', 'Découvrir nos univers ' + ic('arrow-down', 16) + '</a>');
rep(V, '<span>✳</span><h3>Soins de la peau', '<span>' + ic('sparkles', 26) + '</span><h3>Soins de la peau');
rep(V, '<span>⌂</span><h3>Maman', '<span>' + ic('baby', 26) + '</span><h3>Maman');
rep(V, '<span>◈</span><h3>Hygiène', '<span>' + ic('droplets', 26) + '</span><h3>Hygiène');
rep(V, '<span>☼</span><h3>Protection', '<span>' + ic('sun', 26) + '</span><h3>Protection');
rep(V, '<span>＋</span><h3>Compléments', '<span>' + ic('pill', 26) + '</span><h3>Compléments');
rep(V, '<span>⌁</span><h3>Conseil', '<span>' + ic('heart-handshake', 26) + '</span><h3>Conseil');

// ---- owner-app.html, worker.html
rep('owner-app.html', '<div class="brand">＋ PromedPara · Errachidia</div>', '<div class="brand"><img src="/img/mark.png" alt="" width="38" height="31" style="vertical-align:middle;margin-right:10px">PromedPara · Errachidia</div>');
rep('worker.html', '<span class="brand-mark">✚</span>', '<span class="brand-mark"><img src="/img/mark-light.png" alt="" width="26" height="21"></span>');

// ---- scanner-test.html
rep('scanner-test.html', '<span class="good">✔ ', '<span class="good">\' + ico(\'circle-check\', 18) + \' ', 2);
rep('scanner-test.html', '<span class="bad">✘ ', '<span class="bad">\' + ico(\'circle-x\', 18) + \' ', 2);

for (const f of Object.keys(files)) fs.writeFileSync(f, files[f]);
console.log('patched ' + Object.keys(files).join(', '));
