# PromedPara - verification complete du poste. Compatible PowerShell 2.0 (Windows 7).
# Usage : double-clic sur 1-VERIFIER-LE-SYSTEME.bat. Ne modifie rien sur le poste.
param([switch]$ForInstall)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
$kit = Split-Path -Parent $here

function Invoke-Checks {
    $script:Results.Clear()

    Write-Host ''
    Write-Host '--- Systeme ---' -ForegroundColor Cyan
    $os = Get-WmiObject Win32_OperatingSystem
    $ver = [string]$os.Version
    $sp = [int]$os.ServicePackMajorVersion
    $is64 = ([IntPtr]::Size -eq 8) -or [bool]$env:PROCESSOR_ARCHITEW6432
    $archText = 'Windows 32 bits'; if ($is64) { $archText = 'Windows 64 bits' }
    if ($ver -like '6.1.*') {
        if ($sp -ge 1) { Add-Result 'OK' 'Windows' ($os.Caption.Trim() + ' SP' + $sp + ' (' + $ver + '), ' + $archText) '' }
        else { Add-Result 'FAIL' 'Windows' ('Windows 7 sans Service Pack 1 (' + $ver + ')') 'Installez le Service Pack 1 de Windows 7 (Windows Update).' }
    } elseif ([version]$ver -ge [version]'6.2') {
        Add-Result 'INFO' 'Windows' ($os.Caption.Trim() + ' (' + $ver + '), ' + $archText + ' - plus recent que Windows 7, tout fonctionne aussi.') ''
    } else {
        Add-Result 'FAIL' 'Windows' ('Version trop ancienne (' + $ver + ')') 'Windows 7 SP1 minimum est necessaire.'
    }

    $cs = Get-WmiObject Win32_ComputerSystem
    $ramMb = [math]::Round($cs.TotalPhysicalMemory / 1MB)
    if ($ramMb -ge 1500) { Add-Result 'OK' 'Memoire (RAM)' ($ramMb.ToString() + ' Mo') '' }
    elseif ($ramMb -ge 1000) { Add-Result 'WARN' 'Memoire (RAM)' ($ramMb.ToString() + ' Mo : juste suffisant') 'Fermez les autres programmes pendant la vente.' }
    else { Add-Result 'FAIL' 'Memoire (RAM)' ($ramMb.ToString() + ' Mo : insuffisant') 'Il faut au moins 1 Go de RAM.' }

    $cpu = @(Get-WmiObject Win32_Processor)[0]
    Add-Result 'INFO' 'Processeur' ($cpu.Name.Trim() + ' (' + $cs.NumberOfLogicalProcessors + ' coeurs)') ''

    $sysDrive = $env:SystemDrive
    $disk = Get-WmiObject Win32_LogicalDisk -Filter ("DeviceID='" + $sysDrive + "'")
    $freeMb = [math]::Round($disk.FreeSpace / 1MB)
    if ($freeMb -ge 1000) { Add-Result 'OK' ('Espace disque ' + $sysDrive) ($freeMb.ToString() + ' Mo libres') '' }
    elseif ($freeMb -ge 300) { Add-Result 'WARN' ('Espace disque ' + $sysDrive) ($freeMb.ToString() + ' Mo libres : peu') 'Liberez de la place (photos, telechargements).' }
    else { Add-Result 'FAIL' ('Espace disque ' + $sysDrive) ($freeMb.ToString() + ' Mo libres : insuffisant') 'Il faut au moins 300 Mo libres.' }

    $now = Get-Date
    if ($now.Year -lt 2024) { Add-Result 'FAIL' 'Date et heure' ($now.ToString('dd/MM/yyyy HH:mm:ss') + ' : la date est fausse') 'Corrigez la date et l''heure de Windows (pile de la carte mere ?). Les badges telephone en dependent.' }
    else { Add-Result 'OK' 'Date et heure' ($now.ToString('dd/MM/yyyy HH:mm:ss') + ' (fuseau : ' + [System.TimeZone]::CurrentTimeZone.StandardName + ')') '' }
    try {
        $req = [System.Net.HttpWebRequest]::Create('http://www.google.com'); $req.Method = 'HEAD'; $req.Timeout = 4000
        $res = $req.GetResponse(); $dateHeader = $res.Headers['Date']; $res.Close()
        if ($dateHeader) {
            $remote = [DateTime]::Parse($dateHeader).ToUniversalTime(); $diff = [math]::Abs(($remote - $now.ToUniversalTime()).TotalSeconds)
            if ($diff -le 20) { Add-Result 'OK' 'Horloge vs internet' ('ecart de ' + [math]::Round($diff) + ' s') '' }
            else { Add-Result 'WARN' 'Horloge vs internet' ('ecart de ' + [math]::Round($diff) + ' s') 'Synchronisez l''heure (clic sur l''horloge > Parametres de date et d''heure > Heure Internet). Ecart max pour les badges : 30 s.' }
        }
    } catch { Add-Result 'INFO' 'Horloge vs internet' 'pas d''internet ou test impossible (sans importance)' '' }

    $admin = Test-IsAdmin
    if ($admin) { Add-Result 'OK' 'Droits administrateur' 'oui' '' }
    elseif ($ForInstall) { Add-Result 'FAIL' 'Droits administrateur' 'non' 'Lancez 2-INSTALLER.bat (il demande les droits automatiquement).' }
    else { Add-Result 'INFO' 'Droits administrateur' 'non (necessaires seulement pour l''installation)' '' }

    Write-Host ''
    Write-Host '--- Fichiers du kit ---' -ForegroundColor Cyan
    $manifest = Join-Path $kit 'MANIFEST.sha256'
    if (Test-Path -LiteralPath $manifest) {
        $lines = @(Get-Content -LiteralPath $manifest | Where-Object { $_ -match '^[0-9a-f]{64}  ' })
        $bad = New-Object System.Collections.ArrayList
        foreach ($l in $lines) {
            $hash = $l.Substring(0, 64); $rel = $l.Substring(66)
            $file = Join-Path $kit $rel
            if (-not (Test-Path -LiteralPath $file)) { [void]$bad.Add($rel + ' (absent)'); continue }
            if ((Get-FileSha256 $file) -ne $hash) { [void]$bad.Add($rel + ' (abime)') }
        }
        if ($bad.Count -eq 0) { Add-Result 'OK' 'Integrite de la copie' ($lines.Count.ToString() + ' fichiers verifies') '' }
        else { Add-Result 'FAIL' 'Integrite de la copie' ($bad.Count.ToString() + ' fichier(s) manquant(s) ou abime(s) : ' + (($bad | Select-Object -First 3) -join ', ')) 'Recopiez le dossier depuis le PC d''origine (la cle USB est peut-etre defectueuse).' }
    } else { Add-Result 'WARN' 'Integrite de la copie' 'MANIFEST.sha256 introuvable' 'Recopiez le dossier complet depuis le PC d''origine.' }

    Write-Host ''
    Write-Host '--- Programme (Node 12 / SQLite) ---' -ForegroundColor Cyan
    $node = Join-Path $kit 'runtime\node.exe'
    $selftest = Join-Path $kit 'app\selftest.js'
    if (-not (Test-Path -LiteralPath $node)) { Add-Result 'FAIL' 'Moteur Node.js' 'runtime\node.exe introuvable' 'Recopiez le dossier complet.' }
    else {
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $node; $psi.Arguments = '"' + $selftest + '"'; $psi.WorkingDirectory = (Join-Path $kit 'app')
            $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            if (-not $proc.WaitForExit(30000)) { try { $proc.Kill() } catch { }; throw 'delai depasse (30 s)' }
            $out = $proc.StandardOutput.ReadToEnd().Trim(); $err = $proc.StandardError.ReadToEnd().Trim()
            if ($out -like 'SELFTEST OK*') { Add-Result 'OK' 'Moteur Node.js + base SQLite' $out '' }
            else { Add-Result 'FAIL' 'Moteur Node.js + base SQLite' ('echec : ' + $out + ' ' + $err) 'Envoyez le fichier RAPPORT-VERIFICATION.txt au support.' }
        } catch { Add-Result 'FAIL' 'Moteur Node.js + base SQLite' ('impossible de lancer : ' + $_.Exception.Message) 'Antivirus ? Autorisez le dossier de la cle USB, sinon envoyez le rapport au support.' }
    }

    $elec = Join-Path $kit 'electron\PromedPara.exe'
    if (Test-Path -LiteralPath $elec) {
        $elOut = Join-Path $env:TEMP 'promedpara-electron-test.txt'
        Remove-Item -LiteralPath $elOut -Force -ErrorAction SilentlyContinue
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $elec; $psi.Arguments = '--selftest "--out=' + $elOut + '"'; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
            $ep = [System.Diagnostics.Process]::Start($psi)
            if (-not $ep.WaitForExit(120000)) { try { $ep.Kill() } catch { }; throw 'delai depasse (120 s)' }
            $line = ''; if (Test-Path -LiteralPath $elOut) { $line = [string](Get-Content -LiteralPath $elOut | Select-Object -First 1) }
            if ($line -like 'ELECTRON OK*') { Add-Result 'OK' 'Application Electron (fenetre de la caisse)' $line '' }
            else { Add-Result 'WARN' 'Application Electron (fenetre de la caisse)' ('ne demarre pas : ' + $line + ' (code ' + $ep.ExitCode + ')') 'Le mode secours Chrome fonctionnera quand meme. Envoyez le rapport au support.' }
        } catch { Add-Result 'WARN' 'Application Electron (fenetre de la caisse)' $_.Exception.Message 'Le mode secours Chrome fonctionnera quand meme.' }
    } else { Add-Result 'WARN' 'Application Electron (fenetre de la caisse)' 'electron\PromedPara.exe absent' 'Recopiez le dossier complet depuis le PC d''origine.' }

    $testPort = 4190
    if ((Test-Path -LiteralPath $node)) {
        $tmpData = Join-Path $env:TEMP ('promedpara-check-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmpData -Force | Out-Null
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $node; $psi.Arguments = 'main.js'; $psi.WorkingDirectory = (Join-Path $kit 'app')
            $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
            $psi.EnvironmentVariables['PORT'] = [string]$testPort; $psi.EnvironmentVariables['HOST'] = '127.0.0.1'; $psi.EnvironmentVariables['PROMEDPARA_DATA_DIR'] = $tmpData
            $srv = [System.Diagnostics.Process]::Start($psi)
            $ok = $false; $t0 = Get-Date
            while (((Get-Date) - $t0).TotalSeconds -lt 25) {
                Start-Sleep -Milliseconds 500
                $txt = Get-StatusText $testPort 1500
                if ($txt -and $txt -match 'PromedPara') { $ok = $true; break }
                if ($srv.HasExited) { break }
            }
            $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
            if ($ok) { Add-Result 'OK' 'Demarrage reel du serveur (test)' ('repond apres ' + $secs + ' s, base de donnees creee') '' }
            else { Add-Result 'FAIL' 'Demarrage reel du serveur (test)' 'le serveur ne repond pas' 'Envoyez RAPPORT-VERIFICATION.txt au support.' }
            try { if (-not $srv.HasExited) { $srv.Kill() } } catch { }
        } catch { Add-Result 'FAIL' 'Demarrage reel du serveur (test)' $_.Exception.Message '' }
        Start-Sleep -Milliseconds 400
        try { Remove-Item -LiteralPath $tmpData -Recurse -Force -ErrorAction SilentlyContinue } catch { }
    }

    $pid4173 = Get-ListeningPid $script:Port
    if ($pid4173 -eq 0) { Add-Result 'OK' ('Port ' + $script:Port) 'libre' '' }
    else {
        $txt = Get-StatusText $script:Port 1500
        if ($txt -and $txt -match 'PromedPara') { Add-Result 'INFO' ('Port ' + $script:Port) 'PromedPara tourne deja sur ce poste' '' }
        else { Add-Result 'FAIL' ('Port ' + $script:Port) ('utilise par un autre programme (PID ' + $pid4173 + ')') 'Fermez ce programme ou redemarrez le poste.' }
    }

    Write-Host ''
    Write-Host '--- Ecran de caisse (navigateur) ---' -ForegroundColor Cyan
    $chrome = Get-ChromePath
    if ($chrome) {
        $cv = (Get-Item -LiteralPath $chrome).VersionInfo.FileVersion; $major = 0
        try { $major = [int]($cv.Split('.')[0]) } catch { }
        if ($major -ge 90) { Add-Result 'OK' 'Google Chrome' ($cv + ' (' + $chrome + ')') '' }
        else { Add-Result 'WARN' 'Google Chrome' ($cv + ' : version ancienne') 'Mettez Chrome a jour (la derniere version pour Windows 7 est la 109).' }
    } else {
        $ff = Get-FirefoxPath
        if ($ff) { Add-Result 'WARN' 'Navigateur' 'Chrome absent, Firefox trouve (sera utilise)' 'Chrome 109 est recommande pour Windows 7.' }
        else { Add-Result 'FAIL' 'Navigateur' 'ni Chrome ni Firefox trouves' 'Installez Google Chrome (version 109, la derniere compatible Windows 7).' }
    }
    $vid = @(Get-WmiObject Win32_VideoController)[0]
    if ($vid) {
        $resText = ([string]$vid.CurrentHorizontalResolution) + 'x' + ([string]$vid.CurrentVerticalResolution)
        if ($resText -eq 'x') { $resText = 'resolution inconnue' }
        if ($vid.Name -match 'VGA|Standard|Basic') { Add-Result 'INFO' 'Carte graphique' ($vid.Name + ', ' + $resText + ' : sans acceleration, Chrome sera lance avec --disable-gpu (deja prevu)') '' }
        else { Add-Result 'INFO' 'Carte graphique' ($vid.Name + ', ' + $resText) '' }
    }

    Write-Host ''
    Write-Host '--- Materiel ---' -ForegroundColor Cyan
    $printers = @(Get-WmiObject Win32_Printer)
    $xp = @($printers | Where-Object { $_.Name -match 'xprinter|xp-|pos|receipt|ticket' -or $_.DriverName -match 'xprinter|xp-|pos' })
    if ($xp.Count -gt 0) { Add-Result 'OK' 'Imprimante de tickets' ($xp[0].Name + ' (pilote : ' + $xp[0].DriverName + ')') '' }
    elseif ($printers.Count -gt 0) {
        $names = ($printers | ForEach-Object { $_.Name }) -join ' | '
        Add-Result 'WARN' 'Imprimante de tickets' ('aucune Xprinter reconnue. Imprimantes : ' + $names) 'Installez le pilote Xprinter, ou choisissez la bonne imprimante au premier ticket.'
    } else { Add-Result 'WARN' 'Imprimante de tickets' 'aucune imprimante installee' 'Installez le pilote de l''Xprinter (cle ou site du fabricant).' }

    $kb = @(Get-WmiObject Win32_Keyboard)
    Add-Result 'INFO' 'Lecteur code-barres SUNLUX' ('mode clavier USB attendu (' + $kb.Count + ' clavier(s) detecte(s)). Le vrai test se fait avec la page /scanner-test.html') ''

    Write-Host ''
    Write-Host '--- Reseau (telephones) ---' -ForegroundColor Cyan
    $nics = @(Get-WmiObject Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=true')
    $ips = New-Object System.Collections.ArrayList
    foreach ($n in $nics) { foreach ($ip in $n.IPAddress) { if ($ip -match '^\d+\.\d+\.\d+\.\d+$' -and $ip -notlike '169.254.*') { [void]$ips.Add($ip) } } }
    if ($ips.Count -gt 0) {
        $urls = ($ips | ForEach-Object { 'http://' + $_ + ':' + $script:Port }) -join '  ou  '
        Add-Result 'OK' 'Adresse de la caisse pour les telephones' $urls ''
    } else { Add-Result 'WARN' 'Adresse de la caisse pour les telephones' 'aucune adresse reseau' 'Connectez la caisse au Wi-Fi/au routeur de la boutique. La caisse marche sans reseau, mais pas les telephones.' }

    Write-Host ''
    Write-Host '--- Donnees existantes ---' -ForegroundColor Cyan
    $dbFile = Join-Path $script:InstallDir 'data\promedpara.sqlite'
    if (Test-Path -LiteralPath $dbFile) {
        $fi = Get-Item -LiteralPath $dbFile
        Add-Result 'INFO' 'Base de donnees' ('existe deja : ' + [math]::Round($fi.Length / 1KB) + ' Ko, modifiee le ' + $fi.LastWriteTime.ToString('dd/MM/yyyy HH:mm') + ' (elle sera conservee)') ''
    } else { Add-Result 'INFO' 'Base de donnees' ('aucune : une base vide sera creee dans ' + (Join-Path $script:InstallDir 'data')) '' }
}

function Save-Report {
    $fails = @($script:Results | Where-Object { $_.Status -eq 'FAIL' })
    $warns = @($script:Results | Where-Object { $_.Status -eq 'WARN' })
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('PromedPara - rapport de verification')
    [void]$sb.AppendLine('Date : ' + (Get-Date).ToString('dd/MM/yyyy HH:mm:ss') + '   Poste : ' + $env:COMPUTERNAME)
    [void]$sb.AppendLine('------------------------------------------------------------')
    foreach ($r in $script:Results) {
        [void]$sb.AppendLine(('[' + $r.Status + '] ' + $r.Name + ' : ' + $r.Detail))
        if ($r.Fix -and ($r.Status -eq 'WARN' -or $r.Status -eq 'FAIL')) { [void]$sb.AppendLine('        -> ' + $r.Fix) }
    }
    [void]$sb.AppendLine('------------------------------------------------------------')
    [void]$sb.AppendLine('Erreurs : ' + $fails.Count + '   Attentions : ' + $warns.Count)
    $target = Join-Path $kit 'RAPPORT-VERIFICATION.txt'
    try { [System.IO.File]::WriteAllText($target, $sb.ToString(), [System.Text.Encoding]::UTF8) }
    catch { $target = Join-Path $env:TEMP 'RAPPORT-VERIFICATION.txt'; [System.IO.File]::WriteAllText($target, $sb.ToString(), [System.Text.Encoding]::UTF8) }
    return $target
}

Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host '  PromedPara - verification du poste de caisse' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Invoke-Checks
$report = Save-Report
if (-not $env:PROMEDPARA_NOCOPY) { foreach ($dst in @([Environment]::GetFolderPath('Desktop')) + @(Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 } | ForEach-Object { $_.DeviceID + [string][char]92 })) { try { Copy-Item -LiteralPath $report -Destination (Join-Path $dst 'RAPPORT-VERIFICATION.txt') -Force } catch { } } }
$fails = @($script:Results | Where-Object { $_.Status -eq 'FAIL' })
$warns = @($script:Results | Where-Object { $_.Status -eq 'WARN' })
Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
if ($fails.Count -eq 0) {
    Write-Host ('  RESULTAT : PRET A INSTALLER  (' + $warns.Count + ' attention(s))') -ForegroundColor Green
    Write-Host '  Etape suivante : double-clic sur 2-INSTALLER.bat' -ForegroundColor Green
} else {
    Write-Host ('  RESULTAT : ' + $fails.Count + ' PROBLEME(S) A CORRIGER AVANT D''INSTALLER') -ForegroundColor Red
    Write-Host '  Lisez les lignes [ ERREUR ] ci-dessus, corrigez, puis relancez cette verification.' -ForegroundColor Red
}
Write-Host ('  Rapport enregistre : ' + $report) -ForegroundColor Gray
Write-Host '==============================================================' -ForegroundColor Cyan
if ($fails.Count -gt 0) { exit 1 } else { exit 0 }
