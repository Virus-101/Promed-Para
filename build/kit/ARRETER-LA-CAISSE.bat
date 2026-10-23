@echo off
title PromedPara - Arret
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"
echo.
pause
