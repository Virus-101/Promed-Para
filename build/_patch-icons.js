// One-off patch: real icons + logo everywhere. Each swap declares how many occurrences it expects and aborts otherwise.
const fs = require('fs'); const path = require('path');
process.chdir(path.resolve(__dirname, '..', 'public'));
const files = {};
const get = f => files[f] || (files[f] = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
function rep(f, a, b, n = 1) { const t = get(f), c = t.split(a).length - 1; if (c !== n) throw new Error(f + ': expected ' + n + ' got ' + c + ' for: ' + a.slice(0, 80)); files[f] = t.split(a).join(b); }
function repRe(f, re, b, n = 1) { const t = get(f), c = (t.match(re) || []).length; if (c !== n) throw new Error(f + ': regex expected ' + n + ' got ' + c + ' for ' + re); files[f] = t.replace(re, b); }

// ---------- app.js ----------
const A = 'app.js';
rep(A, 'const logo = `<span class="brand-icon">✳</span>', 'const logo = `<span class="brand-icon"><img class="brand-img" src="/img/mark-light.png" alt="" width="31" height="26"></span>');
rep(A, '<div class="brand-lockup">${logo}</div>', '<div class="brand-lockup"><img class="auth-logo" src="/img/logo-full-light.png" alt="Promed Parapharmacie" width="250" height="234"></div>', 3);
rep(A, '<div class="scan-login-frame"><span>⌗</span>', '<div class="scan-login-frame"><span>${ico(\'scan-barcode\',40)}</span>');
rep(A, 'aria-label="Effacer le dernier chiffre">⌫</button>', 'aria-label="Effacer le dernier chiffre">${ico(\'delete\',22)}</button>', 2);
rep(A, "['dashboard','▦',", "['dashboard','layout-dashboard',");
rep(A, "['stock','▤',", "['stock','package',");
rep(A, "['suppliers','↗',", "['suppliers','truck',");
rep(A, "['sales','▧',", "['sales','receipt',");
rep(A, "['team','♙',", "['team','users',");
rep(A, "['devices','⌘',", "['devices','printer',");
rep(A, "['shop-settings','⚙',", "['shop-settings','store',");
rep(A, "['pos','▣',", "['pos','shopping-cart',");
rep(A, "['receive','↦',", "['receive','package-check',");
rep(A, "['add-products','＋',", "['add-products','package-plus',");
rep(A, '<span class="nav-icon">${icon}</span>', '<span class="nav-icon">${ico(icon,20)}</span>');
rep(A, '<span class="nav-icon">◎</span><span class="nav-label">Boutique publique ↗</span>', '<span class="nav-icon">${ico(\'globe\',20)}</span><span class="nav-label">Boutique publique ${ico(\'external-link\',12)}</span>');
rep(A, 'data-action="logout" title="Déconnexion">↪</button>', 'data-action="logout" title="Déconnexion" aria-label="Déconnexion">${ico(\'log-out\',18)}</button>');
rep(A, '● Service local actif', '<i class="status-dot"></i>Service local actif');
rep(A, "button('Écran client ↗','customer','secondary')", "button(ico('monitor',16)+' Écran client','customer','secondary')");
rep(A, '<span class="product-add">＋ Ajouter au ticket</span>', '<span class="product-add">${ico(\'plus\',16)} Ajouter au ticket</span>');
rep(A, '<span class="scan-symbol">⌗</span>', '<span class="scan-symbol">${ico(\'scan-barcode\',22)}</span>');
rep(A, '<span>＋</span>Importer le catalogue', '<span>${ico(\'upload\',17)}</span>Importer le catalogue');
rep(A, '<span>↗</span>Configurer la boutique', '<span>${ico(\'settings\',17)}</span>Configurer la boutique');
rep(A, '<i class="metric-mark">↗</i>', '<i class="metric-mark">${ico(\'trending-up\',18)}</i>');
rep(A, '<i class="metric-mark">▤</i>', '<i class="metric-mark">${ico(\'package\',18)}</i>');
rep(A, '<i class="metric-mark">●</i>', '<i class="metric-mark">${ico(\'circle-check\',18)}</i>');
rep(A, '<i class="metric-mark">!</i>', '<i class="metric-mark">${ico(\'triangle-alert\',18)}</i>');
rep(A, '<span class="owner-alert-icon">!</span>', '<span class="owner-alert-icon">${ico(\'triangle-alert\',14)}</span>');
rep(A, 'Tout voir ↗</button>', 'Tout voir ${ico(\'arrow-right\',14)}</button>');
rep(A, 'Journal complet ↗</button>', 'Journal complet ${ico(\'arrow-right\',14)}</button>');
rep(A, 'Ouvrir le stock complet <span>→</span>', 'Ouvrir le stock complet ${ico(\'arrow-right\',16)}');
rep(A, 'Application propriétaire Android ↗</a>', '${ico(\'smartphone\',14)} Application propriétaire Android</a>');
rep(A, 'Voir le catalogue ↗</a>', 'Voir le catalogue ${ico(\'external-link\',14)}</a>');
rep(A, '<span class="shop-preview-icon">✳</span>', '<span class="shop-preview-icon">${ico(\'store\',26)}</span>');
rep(A, "button('Ouvrir la boutique ↗','open-shop','secondary')", "button(ico('external-link',16)+' Ouvrir la boutique','open-shop','secondary')");
rep(A, '<div class="owner-no-alert"><span>✓</span>', '<div class="owner-no-alert"><span>${ico(\'circle-check\',16)}</span>');
rep(A, '<span class="success-mark">✓</span>', '<span class="success-mark">${ico(\'check\',22)}</span>');
rep(A, '<span>✔</span><div><b>Liste de l’ancien', '<span>${ico(\'file-check\',20)}</span><div><b>Liste de l’ancien');
rep(A, '↑ Choisir un CSV à réviser', '${ico(\'upload\',16)} Choisir un CSV à réviser');
rep(A, "button('＋ Ajouter un produit','add-product'", "button(ico('plus',16)+' Ajouter un produit','add-product'", 2);
rep(A, 'data-action="receive-stock">＋ Réception fournisseur</button>', 'data-action="receive-stock">${ico(\'package-plus\',16)} Réception fournisseur</button>');
rep(A, "button('＋ Ajouter un employé','add-worker','primary')", "button(ico('user-plus',16)+' Ajouter un employé','add-worker','primary')");
rep(A, "button('＋ Propriétaire','add-user','secondary')", "button(ico('shield-user',16)+' Propriétaire','add-user','secondary')");
rep(A, '>⌗ Associer un téléphone</button>', '>${ico(\'smartphone\',16)} Associer un téléphone</button>');
rep(A, '>↯ Code de secours</button>', '>${ico(\'life-buoy\',16)} Code de secours</button>');
rep(A, "${u.has_pin?'✎ Changer le code PIN':'＋ Code PIN'}", "${u.has_pin?ico('pencil',16)+' Changer le code PIN':ico('key-round',16)+' Code PIN'}");
rep(A, `\${volunteer?'<button class="modal-x" data-action="close-modal">×</button>':''}`, `\${volunteer?'<button class="modal-x" data-action="close-modal">'+ico('x',20)+'</button>':''}`);
repRe(A, /(class="modal-x"[^>]*>)×<\/button>/g, "$1${ico('x',20)}</button>", 6);
rep(A, '<strong>✳ PromedPara</strong>', '<img class="receipt-logo" src="/img/mark-black.png" alt=""><strong>PromedPara</strong>');

// ---------- shared <head> additions ----------
const HEAD = '<link rel="icon" href="/img/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/img/app-icon-180.png"><script src="/icons.js"></script>';
for (const page of ['index.html', 'shop.html', 'services.html', 'owner-app.html', 'worker.html', 'scanner-test.html']) rep(page, '</head>', HEAD + '\n</head>');

// ---------- shop.html ----------
const S = 'shop.html', ic = (n, s) => '<i data-ico="' + n + '" data-size="' + s + '"></i>';
rep(S, '<span class="shop-mark">✳</span>', '<span class="shop-mark"><img src="/img/mark-light.png" alt="" width="26" height="21"></span>', 2);
rep(S, '<span>⌕</span><input id="shop-search"', '<span>' + ic('search', 18) + '</span><input id="shop-search"');
rep(S, 'Découvrir la sélection <span>↓</span>', 'Découvrir la sélection <span>' + ic('arrow-down', 16) + '</span>');
rep(S, '<span>✳ Sélection en boutique</span><span>⌖ Errachidia, Maroc</span>', '<span>' + ic('sparkles', 14) + ' Sélection en boutique</span><span>' + ic('map-pin', 14) + ' Errachidia, Maroc</span>');
rep(S, 'data-category="Tous"><span>✳</span>', 'data-category="Tous"><span>' + ic('leaf', 20) + '</span>');
rep(S, '<div class="shop-loading"><span>✳</span>', '<div class="shop-loading"><span>' + ic('leaf', 22) + '</span>');
rep(S, '<div class="cart-empty-shop"><span>♧</span>', '<div class="cart-empty-shop"><span>' + ic('shopping-bag', 26) + '</span>');
rep(S, 'Continuer sur WhatsApp <span>↗</span>', 'Continuer sur WhatsApp <span>' + ic('message-circle', 16) + '</span>');
rep(S, '<div><span>✳</span><b>Un conseil pour', '<div><span>' + ic('heart-handshake', 22) + '</span><b>Un conseil pour');
rep(S, '<div><span>⌖</span><b>À Errachidia', '<div><span>' + ic('map-pin', 22) + '</span><b>À Errachidia');
rep(S, 'Découvrir nos services <span>→</span>', 'Découvrir nos services <span>' + ic('arrow-right', 16) + '</span>');

for (const f of Object.keys(files)) fs.writeFileSync(f, files[f]);
console.log('patched ' + Object.keys(files).join(', '));
