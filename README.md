# PromedPara Workstation

Local-first point of sale and owner dashboard for PromedPara in Errachidia, Morocco. The cashier app runs on the Windows touchscreen; the SQLite database stays on the workstation. Owners use a native Android app on the shop Wi-Fi. It connects directly to the workstation and receives local sale and stock notifications without a cloud service.

## Install on the workstation

1. Copy this package to the till, then double-click `Install-PromedPara.bat`.
2. Choose **Y** to launch PromedPara after installation.
3. On first launch, create the owner login and password on the till. Add cashier and other owner accounts afterward in **Comptes équipe**.

The installer copies the app to `%LOCALAPPDATA%\PromedPara\app` and creates a desktop shortcut. The package includes a portable Node runtime, so a separate Node installation is not needed. Microsoft Edge is used for the app window. The till should have the Xprinter Windows driver installed. After installation, the USB drive can be removed.

## Where the database lives

The live SQLite database is stored on this workstation at:

`%LOCALAPPDATA%\PromedPara\data\promedpara.sqlite`

The phone never hosts or opens the database. It connects to the local workstation API. For a manual backup, close PromedPara first, then copy the full `data` folder to a second local drive. Keep backups secure because it contains sales and staff-account records.

## Work with the product list in Excel

In the owner **Stock & produits** screen:

- **Choisir un CSV à réviser** opens a file picker. UTF-8, UTF-16, and Windows-1252 CSV files with comma, semicolon, or tab separators are supported.
- **Trouver le fichier ancien sur ce poste** reads the known old-program export path when it exists.
- The review screen shows the original columns, lets the owner map name, category, purchase price, sale price, quantity, and alert threshold, and displays flagged rows before any change.
- **Exporter CSV** downloads the current catalogue; **Modèle CSV** downloads a blank template. Direct `.xlsx` upload is not enabled.

The import is staged on the local service for 30 minutes. It writes nothing until the signed-in owner checks the review confirmation and presses **Confirmer l’ajout**. The old export has no usable product codes, so new products receive generated internal references and no barcode is invented. The owner chooses whether matching or repeated names should be skipped (recommended) or added as separate references; existing rows are never overwritten. Negative quantities and invalid rows are skipped. Zero sale prices are skipped unless the owner separately acknowledges them. A source file that was already imported cannot be added a second time. Imported lines are recorded in the stock movement history and create an owner notification.

The review starts with suggested mappings for the old export (`Article`, `Famille`, `PRIX_A`, `PRIX_V`, `Qté`, `Alert`), but the owner can change every mapping before approval. For a different export format, choose the matching columns manually. Inspect the row count, mapping, and skipped-row warnings before confirming.

The shop supports optional product images. Add an `Image URL` / `image_url` column containing an HTTPS image link, then map it in the preview. The cashier database stores the link and the public shop displays the photo; the image file itself remains hosted at that HTTPS address. The manual owner product form also accepts an image URL. Do not map a photo until you have checked it belongs to the exact product and category.

## Cashier and connected equipment

- The SUNLUX scanner works as a USB keyboard scanner: focus the barcode field and scan.
- Touch controls have large targets. The cashier account is restricted to sales.
- Checkout updates the ticket and stock together in the local database.
- The Xprinter uses its installed Windows driver and the receipt print dialog. Select the correct printer and roll size.
- The rear red numeric display shows `0.00` in the supplied photo, but its model, cable, and protocol are not known yet. This version does not send commands to it. The cash drawer also needs its exact connection before automatic opening can be configured.

## Employee phone badge and delivery permission

1. Create an employee in **Comptes équipe**. Leave the password blank for a badge-only account; owner accounts still require a password.
2. Choose **Associer un téléphone**. PromedPara shows a one-use pairing code that expires after five minutes, plus the download link and workstation address.
3. Install **PromedPara Worker** on Android, enter the workstation address and pairing code once, then keep the phone secure. The app protects the badge key with Android Keystore.
4. On the till login screen choose **Employé · badge**, focus the scan field, and scan the employee's changing Code 39 screen badge with SUNLUX.
5. To allow a worker to receive deliveries, the owner checks **Peut réceptionner les livraisons** on that employee's team card. This grants stock receipts only; product setup, prices, imports, supplier editing, reports, and accounts remain owner-only.
6. If badge scanning fails, the owner can choose **Code de secours** on the worker's card and tell the employee the displayed 8-digit code. On the till, choose **Code de secours** on the employee login screen and enter it using the large touch keypad. It works once, expires after 10 minutes, and a newer code replaces it.
7. Revoke a phone from the employee card if it is lost. Sign out of the till at the end of each shift.

The badge rotates every 30 seconds and each time period can be accepted once. The phone generates it locally, and the workstation verifies it against SQLite. Pairing and APK download require the shop network. The SUNLUX model number is not visible in the supplied photo, so confirm it reads Code 39 from an Android screen during setup.

## Owner Android app, local download link, and notifications

1. Start PromedPara on the till and connect the owner phone to the same shop Wi-Fi.
2. On the till, open the owner dashboard and choose **Application Android**. Alternatively, enter `http://<till-Wi-Fi-IP>:4173/owner-app` in the phone browser. The page shows the exact address to enter in the app.
3. Download and install the APK. Android may ask you to allow installation from that browser.
4. Open **PromedPara Owner**, enter the displayed workstation address, and sign in with an owner account.
5. Allow Android notifications and tap **Démarrer la surveillance**. Keep the app monitoring and the till running on the shop network.

The Android app keeps a visible foreground notification while it monitors the workstation's local event stream. Sales, supplier stock receipts, product additions, and low-stock-threshold crossings create saved SQLite alerts; the phone can fetch missed alerts after a brief disconnect. Android battery settings can pause background activity, so allow the app background operation for the best chance of timely delivery. The download link and live connection work only on shop Wi-Fi while the till is running; there is no internet link, cloud account, or third-party push service. Use a trusted, password-protected shop Wi-Fi because this local connection uses HTTP.

## Owner platform and online shop preview

- Sign in at `http://localhost:4173/` for the owner dashboard. It shows the seven-day sales trend, recent sales, low-stock alerts, team, and local notifications.
- Open **Boutique en ligne** in the owner navigation to set a WhatsApp number and delivery note. The public-style catalogue is at `http://localhost:4173/shop` and reads active products from the workstation database. It reveals sale prices and only a general availability flag, not purchase costs or exact stock quantities.
- Customer checkout opens a prefilled WhatsApp message. Payment processing and automatic stock reservation are not included; the sale is recorded when completed at the till.
- The services page remains at `http://localhost:4173/services`. The `/owner-app` page is a local installer page.

These URLs are local preview links. A shop accessible to customers over the public internet needs secure public hosting and a domain. Do not expose the workstation by forwarding its router ports.

## Package contents and setup notes

The complete Windows package includes a portable Node runtime, the server, the cashier and owner interfaces, the customer shop, the Android APKs, Android source, and this setup guide. It excludes the live SQLite database, product files, logs, and Android signing keys. Extract the ZIP and run `Install-PromedPara.bat`; see `README.txt` for the workstation steps and first launch.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the local data and equipment integration details.
