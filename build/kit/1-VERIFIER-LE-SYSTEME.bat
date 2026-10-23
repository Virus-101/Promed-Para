@echo off
title PromedPara - Verification du systeme
cd /d "%~dp0"
echo.
echo  Verification du poste de caisse... (30 secondes environ, ne touchez a rien)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\check.ps1"
echo.
echo  En cas d erreur : double-cliquez sur 3-COLLECTER-LES-ERREURS.bat
echo  et envoyez le fichier ERREURS-PromedPara-... qui apparait sur le bureau et sur la cle USB.
echo.
pause
