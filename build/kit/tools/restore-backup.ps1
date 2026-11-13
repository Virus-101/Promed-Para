# PromedPara - restaure une copie de securite apres une base de donnees corrompue. Compatible PowerShell 2.0 (Windows 7).
# Interdit ici (comme les autres scripts du kit) : Get-FileHash, $PSScriptRoot, Invoke-WebRequest, ConvertFrom-Json, [PSCustomObject], -in, Where-Object sans accolades.
param([switch]$Silencieux)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
$root = Split-Path -Parent $here
if (-not (Test-Path -LiteralPath (Join-Path $root 'data'))) { $root = $script:InstallDir }
$dataDir = Join-Path $root 'data'
$backupsDir = Join-Path $dataDir 'backups'
$liveDb = Join-Path $dataDir 'promedpara.sqlite'
$logDir = Join-Path $root 'logs'
$restoreLog = Join-Path $logDir 'restauration.log'

function Log($text) {
    try { New-Item -ItemType Directory -Path $logDir -Force | Out-Null; Add-Content -LiteralPath $restoreLog -Value ((Get-Date).ToString('dd/MM HH:mm:ss') + '  ' + $text) } catch { }
}

function Test-SqliteHeader($path) {
    try {
        $fs = [System.IO.File]::OpenRead($path)
        try {
            $buf = New-Object byte[] 16
            $read = $fs.Read($buf, 0, 16)
        } finally { $fs.Close() }
        if ($read -lt 15) { return $false }
        $text = [System.Text.Encoding]::ASCII.GetString($buf, 0, 15)
        return ($text -eq 'SQLite format 3')
    } catch { return $false }
}

# Demarre le serveur et attend qu'il reponde. Retourne $true si la caisse repond avec la base en place.
function Start-AndCheck($openBrowser) {
    $node = Join-Path $root 'runtime\node.exe'
    if (-not (Test-Path -LiteralPath $node)) { Log 'runtime\node.exe introuvable'; return $false }
    $out = Join-Path $logDir 'serveur.log'; $err = Join-Path $logDir 'serveur-erreurs.log'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $psi.Arguments = '/c ""' + $node + '" main.js >>"' + $out + '" 2>>"' + $err + '""'
    $psi.WorkingDirectory = Join-Path $root 'app'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['PROMEDPARA_DATA_DIR'] = $dataDir
    $psi.EnvironmentVariables['PORT'] = [string]$script:Port
    $psi.EnvironmentVariables['HOST'] = '0.0.0.0'
    $proc = [System.Diagnostics.Process]::Start($psi)
    Log ('tentative de demarrage, PID ' + $proc.Id)

    $ok = $false
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 500
        $status = Get-StatusText $script:Port 1500
        if ($status -and $status -match 'PromedPara') { $ok = $true; break }
        if ($proc.HasExited) { break }
    }
    if ($ok -and $openBrowser) {
        $url = 'http://localhost:' + $script:Port
        $chrome = Get-ChromePath
        if ($chrome) { Start-Process -FilePath $chrome -ArgumentList ('--app=' + $url + ' --start-maximized --disable-gpu') }
        else { Start-Process $url }
    }
    if (-not $ok) { Stop-App }
    return $ok
}

Write-Host ''
Write-Host '=== PromedPara - restauration d une sauvegarde ===' -ForegroundColor Cyan
Write-Host ''
Log '=== debut restauration ==='

if (-not (Test-Path -LiteralPath $backupsDir)) {
    Write-Host ('Aucun dossier de sauvegardes trouve : ' + $backupsDir) -ForegroundColor Red
    Log 'dossier backups absent'; if (-not $Silencieux) { pause }; exit 1
}

# Les deux types de sauvegarde automatique : avant chaque mise a jour, et une fois par jour a l'ouverture.
$all = @(Get-ChildItem -LiteralPath $backupsDir -File -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -match '^avant-mise-a-jour-.*\.sqlite$') -or ($_.Name -match '^promedpara-\d{8}\.sqlite$')
})
if ($all.Count -eq 0) {
    Write-Host ('Aucune sauvegarde trouvee dans ' + $backupsDir) -ForegroundColor Red
    Log 'aucune sauvegarde candidate'; if (-not $Silencieux) { pause }; exit 1
}
$sorted = @($all | Sort-Object LastWriteTime -Descending)

$crashTime = $null
if (Test-Path -LiteralPath $liveDb) { $crashTime = (Get-Item -LiteralPath $liveDb).LastWriteTime }

Write-Host 'Sauvegardes trouvees (de la plus recente a la plus ancienne) :' -ForegroundColor White
$idx = 0
foreach ($f in $sorted) {
    $idx++
    $flag = ''
    if ($crashTime -and ([Math]::Abs(($crashTime - $f.LastWriteTime).TotalMinutes) -lt 10)) { $flag = '   <-- ATTENTION : proche de l heure du probleme, peut-etre deja abimee' }
    $kb = [Math]::Round($f.Length / 1KB)
    Write-Host ('  ' + $idx + ') ' + $f.Name + '   (' + $f.LastWriteTime.ToString('dd/MM/yyyy HH:mm') + ', ' + $kb + ' Ko)' + $flag)
    Log ('candidat ' + $idx + ': ' + $f.Name + ' - ' + $f.LastWriteTime)
}
Write-Host ''

if (-not (Test-Path -LiteralPath (Join-Path $root 'runtime\node.exe'))) {
    Write-Host 'runtime\node.exe introuvable : ce dossier n est pas une installation PromedPara complete.' -ForegroundColor Red
    Log 'runtime introuvable'; if (-not $Silencieux) { pause }; exit 1
}

Write-Host 'Arret de la caisse si elle tourne encore...' -ForegroundColor Gray
Stop-App
Start-Sleep -Milliseconds 500

# La base abimee est gardee, jamais supprimee : elle peut contenir des ventes recentes a recuperer a la main.
if (Test-Path -LiteralPath $liveDb) {
    $brokenName = 'promedpara-corrompue-' + (Get-Date).ToString('yyyyMMdd-HHmm') + '.sqlite'
    $brokenPath = Join-Path $dataDir $brokenName
    $n = 1
    while (Test-Path -LiteralPath $brokenPath) { $brokenPath = Join-Path $dataDir ($brokenName -replace '\.sqlite$', ('-' + $n + '.sqlite')); $n++ }
    Rename-Item -LiteralPath $liveDb -NewName (Split-Path -Leaf $brokenPath)
    Write-Host ('Base abimee conservee sous : ' + $brokenPath) -ForegroundColor Yellow
    Log ('base abimee renommee en ' + $brokenPath)
} else {
    Write-Host 'Aucune base en place (deja retiree ou premiere installation).' -ForegroundColor Gray
}

$success = $false
$usedFile = $null
foreach ($f in $sorted) {
    if (-not (Test-SqliteHeader $f.FullName)) {
        Write-Host ('Ignoree (entete sqlite invalide) : ' + $f.Name) -ForegroundColor Yellow
        Log ('entete invalide, ignoree: ' + $f.Name)
        continue
    }
    Write-Host ('Essai avec : ' + $f.Name + ' ...') -ForegroundColor Cyan
    Log ('essai: ' + $f.Name)
    Copy-Item -LiteralPath $f.FullName -Destination $liveDb -Force
    if (Start-AndCheck $true) {
        Write-Host ('OK : la caisse repond avec cette sauvegarde.') -ForegroundColor Green
        Log ('succes avec ' + $f.Name)
        $success = $true; $usedFile = $f
        break
    }
    Write-Host ('Echec avec cette sauvegarde, on essaie la suivante...') -ForegroundColor Yellow
    Log ('echec avec ' + $f.Name)
    Remove-Item -LiteralPath $liveDb -Force -ErrorAction SilentlyContinue
}

if (-not $success) {
    Write-Host ''
    Write-Host 'Aucune des sauvegardes trouvees n a permis de redemarrer la caisse.' -ForegroundColor Red
    Write-Host 'Envoyez le contenu de logs\serveur-erreurs.log pour verifier la cause (ou passez par 3-COLLECTER-LES-ERREURS.bat).' -ForegroundColor Red
    Log 'ECHEC: aucune sauvegarde valide n a demarre'
    if (-not $Silencieux) { pause }
    exit 1
}

Write-Host ''
Write-Host '=== Ecart de donnees (ce qui manque depuis cette sauvegarde) ===' -ForegroundColor Cyan
$node = Join-Path $root 'runtime\node.exe'
$inspect = Join-Path $here 'inspect-db.js'
if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $inspect)) {
    & $node $inspect $liveDb
} else {
    Write-Host '(outil de diagnostic indisponible)' -ForegroundColor Gray
}
Write-Host ''
Write-Host ('Sauvegarde utilisee : ' + $usedFile.Name + ' du ' + $usedFile.LastWriteTime.ToString('dd/MM/yyyy HH:mm')) -ForegroundColor White
Write-Host 'Toute vente ou mouvement de stock fait APRES cette date/heure et avant la panne doit etre resaisi a la main.' -ForegroundColor White
Log ('fin restauration, sauvegarde retenue: ' + $usedFile.Name)

if (-not $Silencieux) { pause }
