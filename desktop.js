'use strict';
// Keeps ONE "PromedPara Caisse" shortcut on the desktop: removes the extra copies (shared desktop + user desktop, "(2)" copies, old install
// paths) and the "Test lecteur code-barres" shortcuts. Only .lnk files that point at a PromedPara.exe are touched, nothing else.
// The PowerShell part is PowerShell 2.0 safe (Windows 7) and ASCII only.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$exe = [string]$env:PP_EXE",
  "$sh = New-Object -ComObject WScript.Shell",
  "$dirs = @([Environment]::GetFolderPath('Desktop'))",
  "$extra = [string]$env:PP_DIRS",
  "if ($extra) { $dirs = $extra.Split(';') } else { try { $c = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders').'Common Desktop'; if ($c) { $dirs += $c } } catch { } }",
  "$main = @(); $tests = @()",
  "foreach ($d in $dirs) { if ($d -and (Test-Path -LiteralPath $d)) { foreach ($f in (Get-ChildItem -LiteralPath $d -Filter '*.lnk')) {",
  "  $t = [string]$sh.CreateShortcut($f.FullName).TargetPath",
  "  if ($t -like '*PromedPara.exe') {",
  "    if ($f.Name -like 'Test lecteur code-barres*') { $tests += $f.FullName }",
  "    elseif ($f.Name -like 'PromedPara Caisse*') { $main += (New-Object PSObject -Property @{ Path = $f.FullName; Target = $t; Exact = ($f.Name -eq 'PromedPara Caisse.lnk') }) } } } } }",
  "$keep = $null",
  "foreach ($m in $main) { if ($exe -and ($m.Target -ieq $exe) -and $m.Exact) { $keep = $m; break } }",
  "if (-not $keep) { foreach ($m in $main) { if ($exe -and ($m.Target -ieq $exe)) { $keep = $m; break } } }",
  "if (-not $keep -and $main.Count -gt 0) { $keep = $main[0] }",
  "if ($keep) { Write-Output ('KEPT|' + $keep.Path) }",
  "foreach ($m in $main) { if ((-not $keep) -or ($m.Path -ne $keep.Path)) { Remove-Item -LiteralPath $m.Path -Force; if (Test-Path -LiteralPath $m.Path) { Write-Output ('FAILED|' + $m.Path) } else { Write-Output ('REMOVED|' + $m.Path) } } }",
  "foreach ($p in $tests) { Remove-Item -LiteralPath $p -Force; if (Test-Path -LiteralPath $p) { Write-Output ('FAILED|' + $p) } else { Write-Output ('REMOVED|' + $p) } }"
].join('\r\n');

function tidy(exe, dirs) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ ok: false, kept: '', removed: [], failed: [] });
    const file = path.join(os.tmpdir(), 'promedpara-tidy-desktop.ps1');
    fs.writeFileSync(file, SCRIPT);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout: 30000, env: Object.assign({}, process.env, { PP_EXE: exe || '', PP_DIRS: (dirs || []).join(';') }) }, (error, stdout) => {
      const result = { ok: !error, kept: '', removed: [], failed: [] };
      for (const line of String(stdout || '').replace(/\r/g, '').split('\n')) {
        const at = line.indexOf('|'), kind = line.slice(0, at), value = line.slice(at + 1).trim();
        if (kind === 'KEPT') result.kept = value; else if (kind === 'REMOVED') result.removed.push(value); else if (kind === 'FAILED') result.failed.push(value);
      }
      resolve(result);
    });
  });
}

module.exports = { tidy: tidy };
