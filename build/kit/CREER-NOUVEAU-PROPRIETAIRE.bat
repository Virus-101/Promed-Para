@echo off
title PromedPara - Creer un nouveau compte proprietaire
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
echo  Cree un compte proprietaire tout neuf, avec tous les droits ^(caisse et application Android^).
echo  Les anciens comptes proprietaire sont seulement desactives, jamais supprimes : les ventes et le stock restent intacts.
echo  Les comptes employes ne sont pas touches.
echo.
set /p OWNERNAME=Nom du proprietaire :
if "%OWNERNAME%"=="" ( echo Nom vide, annule. & pause & exit /b )
set /p OWNERPIN=Code personnel (4 a 32 caracteres) :
if "%OWNERPIN%"=="" ( echo Code vide, annule. & pause & exit /b )
echo.
set /p CONFIRM=Tapez OUI pour continuer :
if /i not "%CONFIRM%"=="OUI" ( echo Annule. & pause & exit /b )
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"
"%~dp0runtime\node.exe" "%~dp0app\create-owner.js" "%~dp0data" "%OWNERNAME%" "%OWNERPIN%"
echo.
echo  Relancez ensuite PromedPara avec le raccourci du bureau, puis ouvrez l'app Android avec ce nom et ce code.
pause
