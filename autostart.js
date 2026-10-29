'use strict';
// "Does the till start by itself when the PC is switched on?"  Looks for a Startup-folder shortcut or a Run entry that points at this
// install's PromedPara.exe, and can create the shortcut (current user's Startup folder: no administrator rights needed).
// The PowerShell snippets stay PowerShell 2.0 safe (Windows 7) and ASCII only.
const { execFile } = require('child_process');
const path = require('path');

const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
const powershell = script => new Promise(resolve => {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 20000 }, (error, stdout) => {
    resolve({ ok: !error, out: String(stdout || '').replace(/\r/g, '').trim() });
  });
});
const supported = exe => process.platform === 'win32' && Boolean(exe);

async function status(exe, options) {
  options = options || {};
  if (!supported(exe)) return { supported: false, enabled: false, via: '', exe: exe || '' };
  const script = [
    '$exe = ' + quote(exe),
    '$sh = New-Object -ComObject WScript.Shell',
    '$dirs = @()',
    options.dirs ? options.dirs.map(dir => '$dirs += ' + quote(dir)).join('\n') : "$dirs += [Environment]::GetFolderPath('Startup')\ntry { $common = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders' -ErrorAction Stop).'Common Startup'; if ($common) { $dirs += $common } } catch { }",
    "$found = ''",
    "foreach ($d in $dirs) { if ($d -and (Test-Path -LiteralPath $d)) { foreach ($f in (Get-ChildItem -LiteralPath $d -Filter '*.lnk')) { $t = ''; try { $t = $sh.CreateShortcut($f.FullName).TargetPath } catch { }; if ($t -and ($t -ieq $exe)) { $found = $f.FullName } } } }",
    "$run = ''",
    options.dirs ? '' : "foreach ($k in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')) { try { $p = Get-ItemProperty -Path $k -ErrorAction Stop; foreach ($n in $p.PSObject.Properties) { if (($n.Value -is [string]) -and ($n.Value -like ('*' + $exe + '*'))) { $run = $k + ' ' + $n.Name } } } catch { } }",
    "Write-Output ('SHORTCUT=' + $found)",
    "Write-Output ('RUN=' + $run)"
  ].filter(Boolean).join('\n');
  const result = await powershell(script);
  const shortcut = (/^SHORTCUT=(.*)$/m.exec(result.out) || [])[1] || '', run = (/^RUN=(.*)$/m.exec(result.out) || [])[1] || '';
  return { supported: true, checked: result.ok, enabled: Boolean(shortcut || run), via: shortcut || run, exe };
}

async function enable(exe, options) {
  options = options || {};
  if (!supported(exe)) throw new Error('Le démarrage automatique ne peut être vérifié que depuis l’application installée sous Windows.');
  const script = [
    '$exe = ' + quote(exe),
    '$sh = New-Object -ComObject WScript.Shell',
    options.dir ? '$dir = ' + quote(options.dir) : "$dir = [Environment]::GetFolderPath('Startup')",
    'if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }',
    '$l = $sh.CreateShortcut((Join-Path $dir ' + quote(options.name || 'PromedPara Caisse.lnk') + '))',
    '$l.TargetPath = $exe',
    '$l.WorkingDirectory = (Split-Path -Parent $exe)',
    "$l.Description = 'PromedPara Caisse'",
    '$l.Save()',
    "Write-Output 'DONE'"
  ].join('\n');
  const result = await powershell(script);
  if (!/DONE/.test(result.out)) throw new Error('Impossible de créer le raccourci de démarrage automatique.');
  return true;
}

module.exports = { status, enable, folderOf: file => path.dirname(file) };
