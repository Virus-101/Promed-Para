'use strict';
// Finds how the old pharmacy software ("Logica") keeps its products: desktop shortcut -> install folder -> database files, running
// database services and listening ports. Read-only. The PowerShell part is PowerShell 2.0 safe (Windows 7) and ASCII only.
// SQLite files are opened right here and their tables are listed; an Access .mdb is opened through Jet when the PC allows it.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$kw = $env:PP_KEYWORD",
  "$sh = New-Object -ComObject WScript.Shell",
  "$desk = @([Environment]::GetFolderPath('Desktop'), 'C:\\Users\\Public\\Desktop')",
  "foreach ($u in (Get-ChildItem 'C:\\Users' | Where-Object { $_.PSIsContainer })) { $desk += ($u.FullName + '\\Desktop') }",
  "$dirs = @{}",
  "$mdbs = @()",
  "foreach ($d in $desk) { if (Test-Path -LiteralPath $d) { foreach ($f in (Get-ChildItem -LiteralPath $d -Filter '*.lnk')) {",
  "  $l = $sh.CreateShortcut($f.FullName); $t = [string]$l.TargetPath; $w = [string]$l.WorkingDirectory",
  "  Write-Output ('LNK|' + $f.Name + '|' + $t + '|' + $w)",
  "  if (($f.Name + $t + $w) -like ('*' + $kw + '*')) { if ($w) { $dirs[$w] = 1 } if ($t) { $p = Split-Path -Parent $t; if ($p) { $dirs[$p] = 1 } } } } } }",
  "$roots = @('C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData', 'C:\\', 'D:\\', 'E:\\', 'C:\\Users')",
  "if ($env:PP_ROOTS) { $roots += $env:PP_ROOTS.Split(';') }",
  "foreach ($r in $roots) { if (Test-Path -LiteralPath $r) { foreach ($f in (Get-ChildItem -LiteralPath $r | Where-Object { $_.PSIsContainer -and $_.Name -like ('*' + $kw + '*') })) { $dirs[$f.FullName] = 1 } } }",
  "foreach ($k in $dirs.Keys) { Write-Output ('DIR|' + $k) }",
  "$ext = @('.mdb','.accdb','.db','.sqlite','.sqlite3','.fdb','.gdb','.mdf','.ndf','.dbf','.sdf','.bak','.sql','.csv','.xls','.xlsx','.xml','.fp7','.gdbs')",
  "foreach ($k in $dirs.Keys) { foreach ($f in (Get-ChildItem -LiteralPath $k -Recurse -Force | Where-Object { -not $_.PSIsContainer })) { if ($ext -contains $f.Extension.ToLower()) { if ($f.Extension -match '(?i)^\\.(mdb|accdb)$') { $mdbs += $f.FullName } Write-Output ('FILE|' + $f.FullName + '|' + $f.Length + '|' + $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm')) } } }",
  "foreach ($m in ($mdbs | Select-Object -First 6)) { foreach ($prov in @('Microsoft.Jet.OLEDB.4.0','Microsoft.ACE.OLEDB.12.0')) { try { $c = New-Object System.Data.OleDb.OleDbConnection('Provider=' + $prov + ';Data Source=' + $m + ';Mode=Read'); $c.Open(); $t = $c.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables, $null); foreach ($row in $t.Rows) { if ($row['TABLE_TYPE'] -eq 'TABLE') { $n = [string]$row['TABLE_NAME']; $cnt = ''; try { $cmd = $c.CreateCommand(); $cmd.CommandText = 'SELECT COUNT(*) FROM [' + $n + ']'; $cnt = [string]$cmd.ExecuteScalar() } catch {} Write-Output ('MDB|' + $m + '|' + $n + '|' + $cnt) } } $c.Close(); break } catch { Write-Output ('MDBERR|' + $m + '|' + $prov + '|' + $_.Exception.Message) } } }",
  "foreach ($s in (Get-Service)) { if (($s.Name + ' ' + $s.DisplayName) -match 'sql|mysql|maria|firebird|interbase|postgres|oracle|' + $kw) { Write-Output ('SVC|' + $s.Name + '|' + $s.DisplayName + '|' + $s.Status) } }",
  "foreach ($key in @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) { foreach ($e in (Get-ChildItem $key)) { $p = Get-ItemProperty $e.PSPath; if (($p.DisplayName + ' ' + $p.InstallLocation) -match ($kw + '|pharma|sql|firebird|mysql')) { Write-Output ('APP|' + $p.DisplayName + '|' + $p.DisplayVersion + '|' + $p.InstallLocation) } } }",
  "foreach ($line in (netstat -ano | Select-String 'LISTENING')) { if ([string]$line -match ':(1433|1434|3306|3050|5432|1521|3307)\\s') { Write-Output ('PORT|' + ([string]$line).Trim()) } }"
].join('\r\n');

const run = (keyword, timeoutMs, extraRoots) => new Promise(resolve => {
  const file = path.join(os.tmpdir(), 'promedpara-legacy-scan.ps1');
  fs.writeFileSync(file, SCRIPT);
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: Object.assign({}, process.env, { PP_KEYWORD: keyword, PP_ROOTS: (extraRoots || []).join(';') }) }, (error, stdout) => {
    resolve({ ok: !error, text: String(stdout || '').replace(/\r/g, '') });
  });
});

function sqliteSummary(file, SQL) {
  try {
    const head = Buffer.alloc(16); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
    if (head.toString('latin1') !== 'SQLite format 3\u0000') return null;
    if (fs.statSync(file).size > 120 * 1024 * 1024) return { file: file, tables: [], note: 'fichier trop gros pour être lu ici' };
    const db = new SQL.Database(fs.readFileSync(file)), tables = [];
    for (const row of (db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0] || { values: [] }).values) {
      const name = String(row[0]);
      let count = -1, columns = [];
      try { count = db.exec('SELECT COUNT(*) FROM "' + name.replace(/"/g, '""') + '"')[0].values[0][0]; } catch (error) { count = -1; }
      try { columns = db.exec('PRAGMA table_info("' + name.replace(/"/g, '""') + '")')[0].values.map(r => String(r[1])); } catch (error) { columns = []; }
      tables.push({ name: name, rows: count, columns: columns.slice(0, 40) });
    }
    db.close();
    return { file: file, tables: tables };
  } catch (error) { return { file: file, tables: [], note: String(error.message || error).slice(0, 120) }; }
}

async function scan(options) {
  options = options || {};
  const keyword = String(options.keyword || 'logica').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 30) || 'logica';
  const out = await run(keyword, options.timeoutMs || 90000, options.extraRoots);
  const report = { keyword: keyword, at: new Date().toISOString(), ran: out.ok, shortcuts: [], folders: [], files: [], services: [], apps: [], ports: [], sqlite: [], mdb: [], mdbErrors: [] };
  for (const line of out.text.split('\n')) {
    const part = line.trim().split('|'), kind = part.shift();
    if (kind === 'LNK') report.shortcuts.push({ name: part[0], target: part[1], dir: part[2] });
    else if (kind === 'DIR') report.folders.push(part.join('|'));
    else if (kind === 'FILE') report.files.push({ path: part[0], size: Number(part[1]) || 0, date: part[2] || '' });
    else if (kind === 'SVC') report.services.push({ name: part[0], title: part[1], state: part[2] });
    else if (kind === 'APP') report.apps.push({ name: part[0], version: part[1], where: part[2] });
    else if (kind === 'PORT') report.ports.push(part.join('|'));
    else if (kind === 'MDB') report.mdb.push({ file: part[0], table: part[1], rows: part[2] });
    else if (kind === 'MDBERR') report.mdbErrors.push(part[0] + ' (' + part[1] + ') : ' + part.slice(2).join('|').slice(0, 140));
  }
  if (report.files.length > 300) report.files = report.files.slice(0, 300);
  try {
    const SQL = options.SQL;
    if (SQL) for (const f of report.files) if (/\.(db|sqlite3?|sdf)$/i.test(f.path) && f.size < 120 * 1024 * 1024) { const s = sqliteSummary(f.path, SQL); if (s) report.sqlite.push(s); }
  } catch (error) { /* the report is still useful without it */ }
  return report;
}

function text(report) {
  const lines = ['Recherche de « ' + report.keyword + ' » : ' + report.at, ''];
  lines.push('Dossiers du logiciel :'); for (const d of report.folders) lines.push('  ' + d);
  lines.push('', 'Fichiers de données trouvés :'); for (const f of report.files) lines.push('  ' + f.path + '  ' + Math.round(f.size / 1024) + ' Ko  ' + f.date);
  if (report.mdb.length || report.mdbErrors.length) {
    lines.push('', 'Tables lues dans les bases Access :'); for (const t of report.mdb) lines.push('  ' + t.file + ' : ' + t.table + ' (' + t.rows + ' lignes)');
    for (const e of report.mdbErrors) lines.push('  lecture impossible : ' + e);
  }
  lines.push('', 'Services de base de données :'); for (const s of report.services) lines.push('  ' + s.name + ' (' + s.title + ') ' + s.state);
  lines.push('', 'Ports de bases ouverts :'); for (const p of report.ports) lines.push('  ' + p);
  lines.push('', 'Programmes installés :'); for (const a of report.apps) lines.push('  ' + a.name + ' ' + (a.version || '') + '  ' + (a.where || ''));
  lines.push('', 'Bases SQLite lisibles :'); for (const s of report.sqlite) { lines.push('  ' + s.file + (s.note ? ' (' + s.note + ')' : '')); for (const t of s.tables) lines.push('    ' + t.name + ' : ' + t.rows + ' lignes : ' + t.columns.join(', ')); }
  const seen = new Set();
  lines.push('', 'Raccourcis du bureau :');
  for (const s of report.shortcuts) { const key = (s.name + '|' + s.target).toLowerCase(); if (seen.has(key)) continue; seen.add(key); lines.push('  ' + s.name + ' -> ' + (s.target || '?')); }
  return lines.join('\n');
}

module.exports = { scan: scan, text: text };
