# PromedPara - installation sur le poste de caisse. Compatible PowerShell 2.0 (Windows 7). Lance par 2-INSTALLER.bat (droits admin).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
$kit = Split-Path -Parent $here
$dest = $script:InstallDir
$logFile = Join-Path $env:TEMP 'promedpara-install.log'

function Say($text, $color) { if (-not $color) { $color = 'White' }; Write-Host $text -ForegroundColor $color; Add-Content -Path $logFile -Value ((Get-Date).ToString('HH:mm:ss') + ' ' + $text) }
function Ask($question) {
    $a = Read-Host ($question + ' [O/N]')
    return ($a -match '^(o|y)')
}

Say '==============================================================' 'Cyan'
Say '  PromedPara - installation' 'Cyan'
Say '==============================================================' 'Cyan'

if (-not (Test-IsAdmin)) { Say 'Ce programme doit etre lance avec 2-INSTALLER.bat (droits administrateur).' 'Red'; exit 1 }

# 1. Verification complete d'abord
Say ''
Say 'Etape 1/6 : verification du poste' 'Cyan'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'check.ps1') -ForInstall
if ($LASTEXITCODE -ne 0) {
    Say ''
    Say 'Installation arretee : corrigez les erreurs ci-dessus puis relancez.' 'Red'
    exit 1
}

# 2. Arreter une version en cours
Say ''
Say 'Etape 2/6 : arret de PromedPara s''il tourne' 'Cyan'
Stop-App
Say 'OK' 'Green'

# 3. Copie des fichiers (la base de donnees n'est JAMAIS touchee)
Say ''
Say ('Etape 3/6 : copie du programme vers ' + $dest) 'Cyan'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
foreach ($d in @('app', 'runtime', 'electron', 'assets', 'android', 'tools')) {
    $src = Join-Path $kit $d
    if (-not (Test-Path -LiteralPath $src)) { Say ('Dossier manquant : ' + $src) 'Red'; exit 1 }
    & robocopy.exe $src (Join-Path $dest $d) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Say ('Echec de la copie de ' + $d + ' (code ' + $LASTEXITCODE + ')') 'Red'; exit 1 }
}
foreach ($f in @('LANCER-CAISSE.vbs', 'TEST-LECTEUR.vbs', 'LIRE-MOI.txt', 'ARRETER-LA-CAISSE.bat', 'SAUVEGARDER-LES-DONNEES.bat', 'CONFIGURER-LES-MISES-A-JOUR.bat', 'RESET-CODE-ADMIN.bat', 'GUIDE.html', 'MANIFEST.sha256')) {
    $src = Join-Path $kit $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $dest $f) -Force }
}
# Reglages des mises a jour : copies une seule fois (une reinstallation ne remplace jamais le depot GitHub deja choisi)
New-Item -ItemType Directory -Path (Join-Path $dest 'config') -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $dest 'config\update.json'))) { Copy-Item -LiteralPath (Join-Path $kit 'config\update.json') -Destination (Join-Path $dest 'config\update.json') -Force }
New-Item -ItemType Directory -Path (Join-Path $dest 'data') -Force | Out-Null
# Les mises a jour automatiques tournent avec le compte Windows de la caisse (pas administrateur) : il doit pouvoir remplacer les dossiers du programme.
& icacls.exe $dest /grant '*S-1-5-32-545:(OI)(CI)M' /T /C /Q | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dest 'logs') -Force | Out-Null
# Tous les comptes Windows peuvent ecrire la base et les journaux (SID S-1-5-32-545 = groupe "Utilisateurs", valable dans toutes les langues)
& icacls.exe (Join-Path $dest 'data') /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
& icacls.exe (Join-Path $dest 'logs') /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
Say 'OK' 'Green'

# 4. Pare-feu : seulement le reseau local
Say ''
Say 'Etape 4/6 : pare-feu Windows (port 4173, reseau local uniquement)' 'Cyan'
& netsh.exe advfirewall firewall delete rule name="PromedPara" | Out-Null
& netsh.exe advfirewall firewall add rule name="PromedPara" dir=in action=allow protocol=TCP localport=4173 profile=any remoteip=localsubnet program="$dest\runtime\node.exe" | Out-Null
if ($LASTEXITCODE -eq 0) { Say 'OK : les telephones du meme Wi-Fi peuvent se connecter, internet non.' 'Green' } else { Say 'ATTENTION : regle du pare-feu non creee. Les telephones ne pourront pas se connecter.' 'Yellow' }

# 5. Raccourcis (Windows 7 / PowerShell 2.0 : on lit les dossiers communs dans le registre, pas via .NET 4)
Say ''
Say 'Etape 5/6 : raccourcis' 'Cyan'
$wsh = New-Object -ComObject WScript.Shell
$exe = Join-Path $dest 'electron\PromedPara.exe'
$ico = Join-Path $dest 'assets\icon.ico'
$secours = Join-Path $env:SystemRoot 'System32\wscript.exe'
$useElectron = Test-Path -LiteralPath $exe
if (-not $useElectron) { Say 'ATTENTION : l''application Electron est absente, le mode Chrome sera utilise.' 'Yellow' }

function New-Shortcut($folder, $name, $target, $arguments, $icon, $description) {
    try {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        $path = Join-Path $folder ($name + '.lnk')
        $l = $wsh.CreateShortcut($path)
        $l.TargetPath = $target; $l.Arguments = $arguments; $l.WorkingDirectory = $dest; $l.Description = $description
        if ($icon -and (Test-Path -LiteralPath $icon)) { $l.IconLocation = $icon + ',0' }
        $l.Save()
        if (Test-Path -LiteralPath $path) { return $true }
    } catch { Say ('   raccourci non cree dans ' + $folder + ' : ' + $_.Exception.Message) 'Yellow' }
    return $false
}
if ($useElectron) { $mainTarget = $exe; $mainArgs = '' } else { $mainTarget = $secours; $mainArgs = '"' + (Join-Path $dest 'LANCER-CAISSE.vbs') + '"' }
$mainIcon = $ico; if (-not (Test-Path -LiteralPath $ico)) { $mainIcon = $null }
$desktops = @((Get-CommonDesktop), [Environment]::GetFolderPath('Desktop'))
$made = 0
foreach ($d in $desktops) {
    if (-not $d) { continue }
    if (New-Shortcut $d 'PromedPara Caisse' $mainTarget $mainArgs $mainIcon 'Ouvrir la caisse PromedPara') { $made++ }
    if ($useElectron) { [void](New-Shortcut $d 'Test lecteur code-barres' $exe '--page=/scanner-test.html' $mainIcon 'Tester le lecteur SUNLUX') }
    else { [void](New-Shortcut $d 'Test lecteur code-barres' $secours ('"' + (Join-Path $dest 'TEST-LECTEUR.vbs') + '"') $null 'Tester le lecteur SUNLUX') }
}
[void](New-Shortcut $dest 'PromedPara (mode secours Chrome)' $secours ('"' + (Join-Path $dest 'LANCER-CAISSE.vbs') + '"') $null 'A utiliser seulement si l''application ne s''ouvre pas')
if ($made -gt 0) { Say 'OK : raccourcis "PromedPara Caisse" et "Test lecteur code-barres" sur le bureau' 'Green' } else { Say ('ATTENTION : aucun raccourci cree. Lancez directement : ' + $mainTarget) 'Yellow' }
if (Ask 'Demarrer PromedPara automatiquement a chaque allumage du PC (recommande apres une coupure de courant) ?') {
    if (New-Shortcut (Get-CommonStartup) 'PromedPara Caisse' $mainTarget $mainArgs $mainIcon 'Ouvrir la caisse PromedPara') { Say 'OK : demarrage automatique active' 'Green' }
    else { Say 'ATTENTION : demarrage automatique non active.' 'Yellow' }
}

# 6. Alimentation
Say ''
Say 'Etape 6/6 : mise en veille' 'Cyan'
if (Ask 'Empecher la mise en veille de la caisse (sur secteur) ? Recommande : la caisse doit repondre aux telephones.') {
    & powercfg.exe -change -standby-timeout-ac 0 | Out-Null
    & powercfg.exe -change -hibernate-timeout-ac 0 | Out-Null
    & powercfg.exe -change -monitor-timeout-ac 0 | Out-Null
    Say 'OK : plus de mise en veille sur secteur' 'Green'
}

Say ''
Say '==============================================================' 'Green'
Say '  INSTALLATION TERMINEE' 'Green'
Say ('  Programme : ' + $dest) 'Green'
Say ('  Base de donnees : ' + (Join-Path $dest 'data') + '  (a sauvegarder regulierement)') 'Green'
Say '==============================================================' 'Green'
if (Ask 'Lancer PromedPara maintenant ?') {
    if ($useElectron) { Start-Process -FilePath $exe } else { Start-Process -FilePath $secours -ArgumentList ('"' + (Join-Path $dest 'LANCER-CAISSE.vbs') + '"') }
    Say 'Lancement en cours... la fenetre de caisse s''ouvre dans quelques secondes.' 'Gray'
}
