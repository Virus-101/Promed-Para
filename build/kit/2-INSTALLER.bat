@echo off
title PromedPara - Installation
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Demande des droits administrateur... Cliquez sur OUI dans la fenetre Windows.
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install.ps1"
echo.
echo  En cas d erreur : double-cliquez sur 3-COLLECTER-LES-ERREURS.bat
echo  et envoyez le fichier ERREURS-PromedPara-... qui apparait sur le bureau et sur la cle USB.
echo.
pause
