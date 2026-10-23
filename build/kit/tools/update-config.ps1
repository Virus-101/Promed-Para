# PromedPara - choisit le depot GitHub des mises a jour. Compatible PowerShell 2.0 (Windows 7). Lance par CONFIGURER-LES-MISES-A-JOUR.bat (droits admin).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$cfg = Join-Path $root 'config\update.json'
if (-not (Test-Path -LiteralPath $cfg)) { Write-Host ('Fichier introuvable : ' + $cfg) -ForegroundColor Red; exit 1 }

$text = [System.IO.File]::ReadAllText($cfg)
$current = ''
if ($text -match '"repo"\s*:\s*"([^"]*)"') { $current = $Matches[1] }
Write-Host ''
Write-Host '=== Mises a jour automatiques de PromedPara ===' -ForegroundColor Cyan
if ($current) { Write-Host ('Depot actuel : ' + $current) } else { Write-Host 'Depot actuel : (aucun, mises a jour desactivees)' }
Write-Host ''
Write-Host 'Entrez le nom du depot GitHub sous la forme  compte/depot'
Write-Host 'Exemple : alphateam/promedpara-updates'
Write-Host '(laissez vide puis Entree pour DESACTIVER les mises a jour)'
$repo = (Read-Host 'Depot').Trim()
if ($repo -and ($repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')) { Write-Host 'Nom invalide. Il doit ressembler a  compte/depot  (sans espaces, sans https://).' -ForegroundColor Red; exit 1 }

$new = [regex]::Replace($text, '"repo"\s*:\s*"[^"]*"', ('"repo": "' + $repo + '"'))
[System.IO.File]::WriteAllText($cfg, $new, (New-Object System.Text.UTF8Encoding($false)))
if ($repo) {
    Write-Host ''
    Write-Host ('OK : la caisse cherchera les mises a jour sur https://github.com/' + $repo + '/releases') -ForegroundColor Green
    Write-Host 'Dans PromedPara : Materiel > Mises a jour > "Verifier maintenant" pour tester.' -ForegroundColor Green
} else { Write-Host 'Mises a jour desactivees.' -ForegroundColor Yellow }
