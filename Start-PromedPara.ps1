$ErrorActionPreference = 'Stop'

try {
    $appDir = $PSScriptRoot
    $dataDir = Join-Path $env:LOCALAPPDATA 'PromedPara\data'
    $logDir = Join-Path $env:LOCALAPPDATA 'PromedPara\logs'
    $stdoutPath = Join-Path $logDir 'server-out.log'
    $stderrPath = Join-Path $logDir 'server-error.log'
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null

    # Keep the launcher and the service on the same known address and port.
    $env:PROMEDPARA_DATA_DIR = $dataDir
    $env:PORT = '4173'
    $env:HOST = '0.0.0.0'
    $statusUrl = 'http://127.0.0.1:4173/api/status'

    function Get-PromedParaStatus {
        try {
            $status = Invoke-RestMethod -Uri $statusUrl -Method Get -TimeoutSec 2
            if ($status.business -eq 'PromedPara') { return $status }
        } catch { }
        return $null
    }

    $status = Get-PromedParaStatus
    if (-not $status) {
        $listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            throw 'Port 4173 is already used by another application. Close that application, then launch PromedPara again.'
        }

        $nodePath = Join-Path $appDir 'runtime\node.exe'
        if (-not (Test-Path -LiteralPath $nodePath)) {
            $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
            if (-not $nodeCommand) { throw 'The bundled Node runtime is missing and Node.js is not installed. Re-extract the complete PromedPara package.' }
            $nodePath = $nodeCommand.Source
        }

        Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
        Start-Process -FilePath $nodePath -ArgumentList 'server.mjs' -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath | Out-Null

        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            Start-Sleep -Milliseconds 500
            $status = Get-PromedParaStatus
            if ($status) { break }
        }
        if (-not $status) {
            $detail = Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue | Select-Object -Last 8
            if ($detail) { throw "PromedPara did not answer on port 4173. Startup log: $stderrPath`n$($detail -join "`n")" }
            throw "PromedPara did not answer on port 4173. Check $stderrPath."
        }
    }

    $edge = Get-Command msedge.exe -ErrorAction SilentlyContinue
    if ($edge) {
        Start-Process -FilePath $edge.Source -ArgumentList '--app=http://localhost:4173'
    } else {
        Start-Process 'http://localhost:4173'
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
