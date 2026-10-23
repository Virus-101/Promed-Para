PROMEDPARA — COMPLETE WORKSTATION PROJECT
Errachidia, Morocco

WHAT THIS PACKAGE CONTAINS
PromedPara's Windows workstation app, local SQLite service, touchscreen cashier, owner platform, customer shop, services website, Android APKs and Android source code. A portable Node runtime is included, so you do not need to install Node.js.

QUICK SETUP ON THE WORKSTATION
1. Extract PromedPara-Complete-Project.zip in File Explorer.
2. Open the extracted PromedPara-Complete-Project folder.
3. Double-click Install-PromedPara.bat and choose Y when asked to start the app.
4. On first launch, create the owner account on the workstation. Use a private password of at least 10 characters.
5. In Comptes équipe, create a separate account for each cashier. Keep owner access for owners only.
6. The cashier app opens at http://localhost:4173. If it does not open, double-click the PromedPara shortcut on the desktop or run Lancer-Caisse.bat from the installed app folder.
7. After installation, the app runs from the workstation. You can remove the USB drive.

WHERE YOUR DATA IS STORED
Application: %LOCALAPPDATA%\PromedPara\app
Business database: %LOCALAPPDATA%\PromedPara\data\promedpara.sqlite
Startup logs: %LOCALAPPDATA%\PromedPara\logs

The live database stays on the workstation. No cloud account is required. The package does not include your product CSV, business database, sales, staff accounts, logs, or Android signing keys.

CONNECT THE CASHIER EQUIPMENT
- SUNLUX barcode reader: connect it by USB. Tap the barcode input on the cashier screen and scan; it acts like a keyboard.
- Touchscreen: the cashier screen uses large touch controls. Start a sale by scanning or searching for an item, adjust quantities, then choose the payment method and finish the sale.
- Xprinter: install its Windows printer driver first. Print a receipt and choose the Xprinter and roll size in the print dialog.
- Rear red display: the exact model, cable and protocol are not identified yet. This build does not control its digits.
- Cash drawer: automatic opening is not enabled until its connection and command are identified.

REVIEW AND IMPORT THE PRODUCT CSV
1. Sign in with the owner account.
2. Open Stock & produits, then choose “Choisir un CSV à réviser”. If the old export is on F:\para\Articles_15-10-2026 22-35-00-touts-ar.csv, you can choose “Trouver le fichier ancien sur ce poste”.
3. Check the row count, headers and preview. The suggested old-export mapping is:
   Article  -> product name
   Famille  -> category
   PRIX_A   -> purchase cost
   PRIX_V   -> sale price
   Qté      -> quantity
   Alert    -> reorder threshold
4. Check duplicate names, invalid rows, negative quantities, and zero sale prices. No product code or barcode is invented. The app does not automatically merge by product name; you choose whether repeated names are skipped or added separately.
5. To include photos, add an Image URL column with verified HTTPS links to exact product images, then map that column in the review. Images are loaded from those links and are not copied into the workstation package.
6. The preview does not alter stock. To preserve your review process, stop before the final “Confirmer l’ajout” button until you have agreed on the mappings and exceptions. Only that final owner action writes admissible rows to the local database.

The old export may contain zero prices or negative quantities. These are excluded by default or skipped as shown in the preview. Direct .xlsx upload is not enabled; export an Excel sheet as CSV first. The product CSV is not bundled here because the complete 944-row file was not available in the current laptop session.

OWNER ANDROID APP — SAME SHOP WI-FI
1. Keep the workstation app running and connect the Android phone to the same shop Wi-Fi.
2. On the workstation, open the owner dashboard and choose Application Android, or open http://<WORKSTATION-WIFI-IP>:4173/owner-app in the phone browser.
3. Download and install PromedPara Owner. Android may ask you to allow installation from that browser.
4. Open the app, enter the workstation address shown on the download page, sign in as an owner, allow notifications, and tap Démarrer la surveillance.

The SQLite database remains on the workstation. The Android app connects to it through the workstation service and can retrieve saved local alerts after reconnecting. This package does not provide internet or cross-country access; the phone and workstation must be on the same shop network. Android battery settings can pause background monitoring. Do not forward router ports to the workstation.

WORKER PHONE BADGE AND STOCK ACCESS
1. Create a cashier in Comptes équipe and choose Associer un téléphone.
2. On the Android device, install PromedPara Worker from the workstation page and enter the workstation address and one-time pairing code.
3. At the cashier login screen, choose badge login. The phone shows a changing barcode for the SUNLUX reader to scan.
4. A worker can receive stock only when an owner enables Peut réceptionner les livraisons for that account. This permission does not give access to prices, imports, reports, owner settings, or other accounts.
5. If the badge cannot be scanned, an owner can issue a one-time recovery code from the employee card. It expires after 10 minutes. Revoke a lost phone in Comptes équipe.

OWNER PLATFORM, SHOP AND SERVICES PAGE
Owner dashboard: http://localhost:4173/
Customer shop preview: http://localhost:4173/shop
Services page: http://localhost:4173/services

Use Boutique en ligne in owner settings to add the shop WhatsApp number and delivery note. The customer shop shows active products, categories, sale prices, product photos and general availability; it does not show purchase costs or exact quantities. Its cart opens a WhatsApp message. It does not take payment or reserve stock. These are local preview pages, not a public internet store. Public hosting requires separate secure hosting and a domain.

BACKUP
Close PromedPara before copying the full folder %LOCALAPPDATA%\PromedPara\data to a secure backup drive. Do not share database backups; they contain sales and staff-account records.

TROUBLESHOOTING
- If the app says port 4173 is already used, close the other app that is using that port and launch PromedPara again.
- If the app does not start, check %LOCALAPPDATA%\PromedPara\logs\server-error.log.
- If a phone cannot connect, make sure both devices are on the shop Wi-Fi and Windows allows PromedPara on the private network.
- If receipt printing fails, confirm the Xprinter driver and default paper size in Windows.

See README.md for the extended product notes and ARCHITECTURE.md for technical details.
