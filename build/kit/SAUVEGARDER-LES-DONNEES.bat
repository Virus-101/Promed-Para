@echo off
title PromedPara - Sauvegarde
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\backup.ps1"
echo.
pause
