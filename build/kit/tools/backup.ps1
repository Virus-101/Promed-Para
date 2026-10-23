# PromedPara - copie de securite de la base de donnees. Compatible PowerShell 2.0 (Windows 7).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
$root = Split-Path -Parent $here
$db = Join-Path $root 'data\promedpara.sqlite'
if (-not (Test-Path -LiteralPath $db)) { Write-Host 'Aucune base de donnees a sauvegarder.' -ForegroundColor Yellow; exit 1 }

# La base est ecrite de facon atomique : on peut la copier meme si la caisse tourne.
$stamp = (Get-Date).ToString('yyyyMMdd-HHmm')
$name = 'promedpara-' + $stamp + '.sqlite'
$targets = New-Object System.Collections.ArrayList
$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sauvegardes-PromedPara'
[void]$targets.Add($desk)
foreach ($d in @(Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 })) { [void]$targets.Add((Join-Path ($d.DeviceID + '\') 'Sauvegardes-PromedPara')) }

$done = 0
foreach ($t in $targets) {
    try {
        New-Item -ItemType Directory -Path $t -Force | Out-Null
        Copy-Item -LiteralPath $db -Destination (Join-Path $t $name) -Force
        Write-Host ('OK : ' + (Join-Path $t $name)) -ForegroundColor Green; $done++
    } catch { Write-Host ('Echec pour ' + $t + ' : ' + $_.Exception.Message) -ForegroundColor Yellow }
}
if ($done -eq 0) { exit 1 }
Write-Host ''
Write-Host 'Gardez une copie sur une cle USB rangee a part (pas sur la caisse).' -ForegroundColor Gray
