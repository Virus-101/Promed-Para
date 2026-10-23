@echo off
REM =============================================
REM PromedPara Bootstrap Script for Windows 7
REM Checks Node.js version and dependencies before launching
REM =============================================

cd /d "%~dp0"

:: Check if Node.js is available
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found in PATH.
    echo Please install Node.js 12.22.7 LTS from:
    echo   https://nodejs.org/dist/latest-v12.x/node-v12.22.7-x64.msi
    pause
    exit /b 1
)

:: Get Node.js version
for /f "tokens=*" %%v in ('node --version') do set "NODE_VERSION=%%v"
rem Remove 'v' prefix
set "NODE_VERSION=%NODE_VERSION:v=%"
echo Detected Node.js version: %NODE_VERSION%

:: Check major version is at least 12
for /f "tokens=1 delims=." %%a in ("%NODE_VERSION%") do set "MAJOR=%%a"
if %MAJOR% LSS 12 (
    echo ERROR: Node.js version must be 12 or higher.
    echo Please upgrade Node.js from:
    echo   https://nodejs.org/dist/latest-v12.x/node-v12.22.7-x64.msi
    pause
    exit /b 1
)

:: Check if dependencies are installed
if not exist node_modules (
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
) else (
    :: Optional: check if package.json is newer than node_modules (simplistic)
    :: For robustness, we could compare timestamps, but skip for simplicity
    echo Dependencies already installed.
)

echo.
echo Starting PromedPara...
echo.
node server.js
