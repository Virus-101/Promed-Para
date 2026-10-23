# PromedPara - fonctions communes. Compatible PowerShell 2.0 (Windows 7).
# Interdit ici : Get-FileHash, $PSScriptRoot, Invoke-WebRequest, ConvertFrom-Json, [PSCustomObject], -in, Where-Object sans accolades.

$script:InstallDir = 'C:\PromedPara'
$script:Port = 4173
$script:Results = New-Object System.Collections.ArrayList

function Get-KitRoot {
    # Dossier qui contient "tools" (cle USB ou C:\PromedPara)
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    return (Split-Path -Parent $here)
}

function Add-Result($status, $name, $detail, $fix) {
    $o = New-Object PSObject
    Add-Member -InputObject $o -MemberType NoteProperty -Name Status -Value $status
    Add-Member -InputObject $o -MemberType NoteProperty -Name Name -Value $name
    Add-Member -InputObject $o -MemberType NoteProperty -Name Detail -Value $detail
    Add-Member -InputObject $o -MemberType NoteProperty -Name Fix -Value $fix
    [void]$script:Results.Add($o)
    Write-Result $o
}

function Write-Result($o) {
    $tag = '[ info ]'; $color = 'Gray'
    if ($o.Status -eq 'OK')   { $tag = '[  OK  ]'; $color = 'Green' }
    if ($o.Status -eq 'WARN') { $tag = '[ATTENTION]'; $color = 'Yellow' }
    if ($o.Status -eq 'FAIL') { $tag = '[ ERREUR ]'; $color = 'Red' }
    Write-Host ($tag + ' ' + $o.Name + ' : ' + $o.Detail) -ForegroundColor $color
    if ($o.Fix -and ($o.Status -eq 'WARN' -or $o.Status -eq 'FAIL')) {
        Write-Host ('           -> ' + $o.Fix) -ForegroundColor White
    }
}

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Show-MessageBox($text, $title) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($text, $title)
    } catch { Write-Host $text }
}

function Get-ChromePath {
    $candidates = New-Object System.Collections.ArrayList
    $keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
              'HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
              'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')
    foreach ($k in $keys) {
        try { $v = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)'; if ($v) { [void]$candidates.Add($v) } } catch { }
    }
    [void]$candidates.Add((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'))
    if (${env:ProgramFiles(x86)}) { [void]$candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')) }
    [void]$candidates.Add((Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
    foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    return $null
}

function Get-FirefoxPath {
    $c = @((Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe'))
    if (${env:ProgramFiles(x86)}) { $c += (Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox\firefox.exe') }
    foreach ($p in $c) { if (Test-Path -LiteralPath $p) { return $p } }
    return $null
}

function Get-ListeningPid($port) {
    $lines = @(netstat -ano -p tcp | Select-String (':' + $port + '\s'))
    foreach ($l in $lines) {
        $t = ($l.ToString().Trim() -split '\s+')
        if ($t.Length -ge 5 -and $t[3] -eq 'LISTENING') { return [int]$t[4] }
    }
    return 0
}

function Get-StatusText($port, $timeoutMs) {
    # Retourne le JSON de /api/status ou $null. (HttpWebRequest : seule methode avec delai d'attente en PS 2.0)
    try {
        $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:' + $port + '/api/status')
        $req.Timeout = $timeoutMs; $req.ReadWriteTimeout = $timeoutMs
        $res = $req.GetResponse()
        $sr = New-Object System.IO.StreamReader($res.GetResponseStream())
        $text = $sr.ReadToEnd(); $sr.Close(); $res.Close()
        return $text
    } catch { return $null }
}

function Get-AppProcesses {
    # Les node.exe qui viennent du dossier runtime de PromedPara (pas les autres programmes Node).
    $list = @()
    $all = @(Get-WmiObject Win32_Process -Filter "Name='node.exe'")
    foreach ($p in $all) {
        if ($p.ExecutablePath -and ($p.ExecutablePath -like '*\runtime\node.exe') -and ($p.ExecutablePath -like '*PromedPara*')) { $list += $p }
    }
    return $list
}

function Stop-App {
    foreach ($p in (Get-AppProcesses)) { try { [void]$p.Terminate() } catch { } }
    Start-Sleep -Milliseconds 700
}

function Get-FileSha256($path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fs = [System.IO.File]::OpenRead($path)
    try { $bytes = $sha.ComputeHash($fs) } finally { $fs.Close() }
    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
}

function Get-CommonDesktop {
    try { $v = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders' -ErrorAction Stop).'Common Desktop'; if ($v) { return $v } } catch { }
    return (Join-Path $env:PUBLIC 'Desktop')
}
function Get-CommonStartup {
    try { $v = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders' -ErrorAction Stop).'Common Startup'; if ($v) { return $v } } catch { }
    return (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup')
}
