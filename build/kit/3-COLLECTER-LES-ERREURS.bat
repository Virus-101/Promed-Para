@echo off
title PromedPara - Collecter les erreurs
cd /d "%~dp0"
echo.
echo  Branchez la cle USB si possible, puis laissez travailler le programme.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\collect.ps1"
echo.
pause
