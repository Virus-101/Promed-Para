# PromedPara - rassemble tous les rapports et erreurs dans UN fichier a renvoyer. Compatible PowerShell 2.0 (Windows 7). Ne modifie rien.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
$kit = Split-Path -Parent $here
$sb = New-Object System.Text.StringBuilder

function Section($title) { [void]$sb.AppendLine(''); [void]$sb.AppendLine('==== ' + $title + ' ===='); }
function Line($text) { [void]$sb.AppendLine([string]$text) }
function Tail($path, $n) {
    if (Test-Path -LiteralPath $path) { Line ('--- ' + $path + ' (' + (Get-Item -LiteralPath $path).LastWriteTime.ToString('dd/MM/yyyy HH:mm') + ')'); foreach ($l in @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue | Select-Object -Last $n)) { Line $l } }
    else { Line ('(absent) ' + $path) }
}

Write-Host 'Collecte des informations... (20 secondes)' -ForegroundColor Cyan
Line ('PromedPara - collecte d''erreurs du ' + (Get-Date).ToString('dd/MM/yyyy HH:mm:ss') + ' sur ' + $env:COMPUTERNAME)

Section 'SYSTEME'
try {
    $os = Get-WmiObject Win32_OperatingSystem; $cs = Get-WmiObject Win32_ComputerSystem
    Line ($os.Caption + ' ' + $os.Version + ' SP' + $os.ServicePackMajorVersion + ' ' + $os.OSArchitecture)
    Line ('RAM: ' + [math]::Round($cs.TotalPhysicalMemory / 1MB) + ' Mo   Utilisateur: ' + $env:USERNAME + '   Admin: ' + (Test-IsAdmin))
    Line ('PowerShell: ' + $PSVersionTable.PSVersion)
    $d = Get-WmiObject Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'"); Line ('Disque ' + $env:SystemDrive + ' libre: ' + [math]::Round($d.FreeSpace / 1MB) + ' Mo')
} catch { Line ('erreur: ' + $_.Exception.Message) }

Section 'DOSSIER DU KIT'
Line ('Emplacement: ' + $kit)
try { foreach ($f in @(Get-ChildItem -LiteralPath $kit -Force | Select-Object -First 40)) { Line ('  ' + $f.Name) } } catch { Line ('erreur: ' + $_.Exception.Message) }

Section 'RAPPORT DE VERIFICATION (derniere execution)'
Tail (Join-Path $kit 'RAPPORT-VERIFICATION.txt') 80
Tail (Join-Path $env:TEMP 'RAPPORT-VERIFICATION.txt') 80

Section 'JOURNAL D''INSTALLATION'
Tail (Join-Path $env:TEMP 'promedpara-install.log') 120

Section 'TEST DU MOTEUR (kit)'
try {
    $node = Join-Path $kit 'runtime\node.exe'
    Line ('node.exe present: ' + (Test-Path -LiteralPath $node))
    if (Test-Path -LiteralPath $node) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $node; $psi.Arguments = '"' + (Join-Path $kit 'app\selftest.js') + '"'; $psi.WorkingDirectory = (Join-Path $kit 'app')
        $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        if ($p.WaitForExit(30000)) { Line ('sortie: ' + $p.StandardOutput.ReadToEnd().Trim()); Line ('erreurs: ' + $p.StandardError.ReadToEnd().Trim()); Line ('code retour: ' + $p.ExitCode) } else { try { $p.Kill() } catch { }; Line 'delai depasse' }
    }
} catch { Line ('erreur: ' + $_.Exception.Message) }

Section 'INSTALLATION C:\PromedPara'
$inst = $script:InstallDir
Line ('Dossier present: ' + (Test-Path -LiteralPath $inst))
if (Test-Path -LiteralPath $inst) {
    foreach ($f in @(Get-ChildItem -LiteralPath $inst -Force | Select-Object -First 30)) { Line ('  ' + $f.Name) }
    Tail (Join-Path $inst 'logs\electron.log') 40
    Tail (Join-Path $inst 'logs\lancement.log') 60
    Tail (Join-Path $inst 'logs\serveur-erreurs.log') 60
    Tail (Join-Path $inst 'logs\serveur.log') 30
    $db = Join-Path $inst 'data\promedpara.sqlite'
    if (Test-Path -LiteralPath $db) { Line ('Base de donnees: ' + [math]::Round((Get-Item -LiteralPath $db).Length / 1KB) + ' Ko') } else { Line 'Base de donnees: absente' }
}

Section 'RESEAU / PORT / PARE-FEU'
try {
    Line ('Port 4173 (PID qui ecoute, 0 = personne): ' + (Get-ListeningPid $script:Port))
    $st = Get-StatusText $script:Port 2000; if ($st) { Line ('Reponse du serveur: ' + $st) } else { Line 'Le serveur ne repond pas sur 127.0.0.1:4173' }
    foreach ($l in @(& netsh.exe advfirewall firewall show rule name="PromedPara" 2>&1 | Select-Object -First 14)) { Line $l }
    foreach ($n in @(Get-WmiObject Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=true')) { Line ('IP: ' + ($n.IPAddress -join ', ')) }
} catch { Line ('erreur: ' + $_.Exception.Message) }

Section 'NAVIGATEUR ET IMPRIMANTES'
try {
    $c = Get-ChromePath; if ($c) { Line ('Chrome: ' + $c + ' v' + (Get-Item -LiteralPath $c).VersionInfo.FileVersion) } else { Line 'Chrome: introuvable' }
    $ff = Get-FirefoxPath; if ($ff) { Line ('Firefox: ' + $ff) }
    foreach ($p in @(Get-WmiObject Win32_Printer)) { Line ('Imprimante: ' + $p.Name + ' | pilote: ' + $p.DriverName + ' | defaut: ' + $p.Default) }
} catch { Line ('erreur: ' + $_.Exception.Message) }

Section 'ERREURS RECENTES DE WINDOWS (application)'
try {
    foreach ($e in @(Get-EventLog -LogName Application -EntryType Error -Newest 6 -ErrorAction SilentlyContinue)) { Line ($e.TimeGenerated.ToString('dd/MM HH:mm') + ' ' + $e.Source + ': ' + ($e.Message -replace '\s+', ' ').Substring(0, [math]::Min(200, $e.Message.Length))) }
} catch { Line 'journal Windows illisible' }

# Enregistrement : bureau + toutes les cles USB branchees + dossier du kit
$text = $sb.ToString()
$name = 'ERREURS-PromedPara-' + (Get-Date).ToString('yyyyMMdd-HHmm') + '.txt'
$targets = New-Object System.Collections.ArrayList
[void]$targets.Add([Environment]::GetFolderPath('Desktop'))
foreach ($d in @(Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 })) { [void]$targets.Add($d.DeviceID + '\') }
$saved = 0
foreach ($t in $targets) {
    try { [System.IO.File]::WriteAllText((Join-Path $t $name), $text, [System.Text.Encoding]::UTF8); Write-Host ('Enregistre : ' + (Join-Path $t $name)) -ForegroundColor Green; $saved++ } catch { }
}
Write-Host ''
if ($saved -eq 0) { Write-Host 'Impossible d''enregistrer le fichier.' -ForegroundColor Red }
else { Write-Host 'Rapportez ce fichier : branchez la cle USB sur votre PC (ou envoyez le fichier du bureau).' -ForegroundColor Cyan }
