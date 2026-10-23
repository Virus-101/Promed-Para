# PromedPara - demarre le serveur local puis ouvre l'ecran de caisse. Compatible PowerShell 2.0 (Windows 7).
# -Page : page a ouvrir (ex. /scanner-test.html).  -NoBrowser : demarre seulement le serveur (tests).
param([string]$Page = '', [switch]$NoBrowser)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here 'common.ps1')
$root = Split-Path -Parent $here
$dataDir = Join-Path $root 'data'
$logDir = Join-Path $root 'logs'
$url = 'http://localhost:' + $script:Port + $Page
$launchLog = Join-Path $logDir 'lancement.log'

function Log($text) {
    try { Add-Content -LiteralPath $launchLog -Value ((Get-Date).ToString('dd/MM HH:mm:ss') + '  ' + $text) } catch { }
}

try {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    if ((Test-Path $launchLog) -and ((Get-Item $launchLog).Length -gt 200KB)) { Remove-Item $launchLog -Force }
    Log ('--- lancement (PowerShell ' + $PSVersionTable.PSVersion + ', utilisateur ' + $env:USERNAME + ', dossier ' + $root + ')')

    $status = Get-StatusText $script:Port 2000
    if ($status -and $status -match 'PromedPara') { Log 'serveur deja demarre' }
    else {
        $other = Get-ListeningPid $script:Port
        if ($other -ne 0) { throw ('Le port ' + $script:Port + ' est utilise par un autre programme (PID ' + $other + '). Redemarrez le PC.') }

        $node = Join-Path $root 'runtime\node.exe'
        if (-not (Test-Path -LiteralPath $node)) { throw 'runtime\node.exe est introuvable. Relancez 2-INSTALLER.bat depuis la cle USB.' }
        $out = Join-Path $logDir 'serveur.log'; $err = Join-Path $logDir 'serveur-erreurs.log'
        foreach ($f in @($out, $err)) { if ((Test-Path $f) -and ((Get-Item $f).Length -gt 2MB)) { Remove-Item $f -Force } }

        # Meme methode que la verification du poste (testee sur ce PC) : un petit cmd.exe cache qui lance node et ecrit les journaux.
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $psi.Arguments = '/c ""' + $node + '" main.js >>"' + $out + '" 2>>"' + $err + '""'
        $psi.WorkingDirectory = Join-Path $root 'app'
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.EnvironmentVariables['PROMEDPARA_DATA_DIR'] = $dataDir
        $psi.EnvironmentVariables['PORT'] = [string]$script:Port
        $psi.EnvironmentVariables['HOST'] = '0.0.0.0'
        Log ('demarrage : ' + $psi.FileName + ' ' + $psi.Arguments)
        $proc = [System.Diagnostics.Process]::Start($psi)
        Log ('processus cree, PID ' + $proc.Id)

        $ok = $false
        for ($i = 0; $i -lt 80; $i++) {
            Start-Sleep -Milliseconds 500
            $status = Get-StatusText $script:Port 1500
            if ($status -and $status -match 'PromedPara') { $ok = $true; break }
            if ($proc.HasExited) { break }
        }
        if (-not $ok) {
            $detail = ''
            if (Test-Path $err) { $detail = (Get-Content $err -ErrorAction SilentlyContinue | Select-Object -Last 6) -join "`n" }
            throw ('PromedPara ne repond pas.' + "`n" + $detail + "`n`nJournal : " + $err)
        }
        Log 'serveur pret'
    }

    if ($NoBrowser) { Log 'NoBrowser : fin'; exit 0 }

    $chrome = Get-ChromePath
    if ($chrome) {
        $chromeProfile = Join-Path $root 'browser-profile'
        # --disable-gpu : la carte VGA standard n'a pas d'acceleration. --overscroll-history-navigation=0 : un glissement du doigt ne revient pas en arriere.
        # Si l'imprimante par defaut est une imprimante de tickets, le ticket s'imprime directement, sans fenetre.
        $printFlag = ''
        try { $def = @(Get-WmiObject Win32_Printer | Where-Object { $_.Default -eq $true })[0]; if ($def -and ($def.Name -match 'xprinter|xp-|pos|receipt|ticket')) { $printFlag = ' --kiosk-printing' } } catch { }
        $chromeArgs = '--app=' + $url + ' --start-maximized --disable-gpu --no-first-run --no-default-browser-check --disable-translate --disable-session-crashed-bubble --overscroll-history-navigation=0 --user-data-dir="' + $chromeProfile + '"' + $printFlag
        Log ('chrome : ' + $chrome + ' ' + $chromeArgs)
        Start-Process -FilePath $chrome -ArgumentList $chromeArgs
    } else {
        $ff = Get-FirefoxPath
        if ($ff) { Log 'firefox'; Start-Process -FilePath $ff -ArgumentList ('-new-window ' + $url) }
        else { Log 'navigateur par defaut'; Start-Process $url }
    }
    Log 'termine'
} catch {
    Log ('ERREUR : ' + $_.Exception.Message)
    Show-MessageBox ($_.Exception.Message) 'PromedPara - erreur au demarrage'
    exit 1
}
