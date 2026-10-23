@echo off
title PromedPara - Reinitialiser le code administrateur
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Demande des droits administrateur... Cliquez sur OUI.
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
if not exist "%~dp0data\promedpara.sqlite" (
  echo.
  echo  Ce programme doit etre lance depuis C:\PromedPara sur la caisse ^(la base de donnees est introuvable ici^).
  echo.
  pause
  exit /b 1
)
echo.
echo  ATTENTION : ce programme remplace le code de l'administrateur par un code temporaire.
echo  A utiliser seulement si le code ET la cle de recuperation sont perdus.
echo  Les ventes et les produits ne sont pas touches. Une copie de la base est faite avant.
echo.
set /p CONFIRM=Tapez OUI pour continuer :
if /i not "%CONFIRM%"=="OUI" ( echo Annule. & pause & exit /b )
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"
"%~dp0runtime\node.exe" "%~dp0app\reset-admin.js" "%~dp0data"
echo.
echo  Relancez ensuite PromedPara avec le raccourci du bureau.
pause
