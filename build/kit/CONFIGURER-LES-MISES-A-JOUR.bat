@echo off
title PromedPara - Mises a jour
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Demande des droits administrateur... Cliquez sur OUI.
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-config.ps1"
echo.
pause
