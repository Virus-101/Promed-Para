# PromedPara - arrete le serveur local. Compatible PowerShell 2.0 (Windows 7).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
$n = @(Get-AppProcesses).Count
Start-Sleep -Milliseconds 400   # laisse le temps a la derniere ecriture d'etre enregistree sur le disque
Stop-App
Write-Host ('PromedPara arrete (' + $n + ' processus).') -ForegroundColor Green
