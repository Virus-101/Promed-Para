@echo off
REM ============================================================
REM PromedPara Complete Setup for Windows 7
REM This script will:
REM   1. Check if Node.js 12.22.7 is installed
REM   2. If not, download and install it automatically
REM   3. Install dependencies (better-sqlite3)
REM   4. Launch the application
REM ============================================================

setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo ============================================
echo   PromedPara - Complete Setup for Windows 7
echo ============================================
echo.

:: ---------------------------------------------------------------------
:: Step 1: Check if Node.js is already installed
:: ---------------------------------------------------------------------
echo [1/4] Checking for Node.js...
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node --version') do set "NODE_VERSION=%%v"
    set "NODE_VERSION=%NODE_VERSION:v=%"
    echo Found Node.js version: !NODE_VERSION!
    
    for /f "tokens=1 delims=." %%a in ("!NODE_VERSION!") do set "MAJOR=%%a"
    if !MAJOR! geq 12 (
        echo Node.js version is compatible (>=12.0.0).
    ) else (
        echo WARNING: Node.js version is too old (need 12+). Will upgrade.
        goto :INSTALL_NODE
    )
) else (
    echo Node.js not found. Will install it now.
    goto :INSTALL_NODE
)

goto :CHECK_DEPENDENCIES

:: ---------------------------------------------------------------------
:: Step 2: Install Node.js 12.22.7 LTS
:: ---------------------------------------------------------------------
:INSTALL_NODE
echo.
echo [2/4] Downloading and installing Node.js 12.22.7 LTS...
echo This is the last version that supports Windows 7.
echo.

set "NODE_INSTALLER=%TEMP%\node-v12.22.7-x64.msi"
set "NODE_URL=https://nodejs.org/dist/latest-v12.x/node-v12.22.7-x64.msi"

echo Downloading from: !NODE_URL!
echo This may take a few minutes depending on your internet connection...
echo.

:: Try to download using PowerShell
powershell -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
     (New-Object Net.WebClient).DownloadFile('!NODE_URL!', '!NODE_INSTALLER!')"

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to download Node.js installer.
    echo.
    echo Please download it manually from:
    echo   !NODE_URL!
    echo.
    echo Then run the installer and double-click this script again.
    pause
    exit /b 1
)

echo.
echo Installing Node.js... Please follow the installer prompts.
echo.

:: Run the installer silently
msiexec /i "!NODE_INSTALLER!" /qn /norestart

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js installation failed.
    echo Please try installing manually from: !NODE_URL!
    pause
    exit /b 1
)

echo.
echo Node.js installed successfully!
echo.

:: Refresh environment variables for this session
for /f "skip=2 tokens=*" %%x in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "PATH=%%x;%%PATH"

:: Verify installation
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo WARNING: Node.js was installed but not found in PATH.
    echo Please restart your computer and run this script again.
    pause
    exit /b 1
)

:: ---------------------------------------------------------------------
:: Step 3: Install dependencies
:: ---------------------------------------------------------------------
:CHECK_DEPENDENCIES
echo [3/4] Checking and installing dependencies...
echo.

if not exist node_modules (
    echo Installing npm packages (better-sqlite3)...
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: Failed to install dependencies.
        echo Please check your internet connection and try again.
        pause
        exit /b 1
    )
) else (
    echo Dependencies already installed.
)

:: ---------------------------------------------------------------------
:: Step 4: Launch the application
:: ---------------------------------------------------------------------
echo.
echo [4/4] Starting PromedPara...
echo.

:: Create a simple batch to launch the server in background
echo Starting server in background...
start "" /b node server.js

:: Wait a moment for the server to start
timeout /t 3 /nobreak >nul

:: Check if server is running
tasklist /FI "IMAGENAME eq node.exe" | findstr /I "server.js" >nul
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo   SUCCESS! PromedPara is now running.
    echo.
    echo   Access the application at:
    echo     http://localhost:4173
    echo.
    echo   (Or use one of the other URLs shown below)
    echo ============================================
    echo.
) else (
    echo.
    echo WARNING: Server may not have started correctly.
    echo Please check for error messages above.
    echo.
)

:: Show server output for a few seconds
timeout /t 5 /nobreak >nul

:: Keep the script window open
echo.
echo Press any key to exit (the server will continue running in background)...
pause >nul