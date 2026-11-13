@echo off
title PromedPara - Restauration d'une sauvegarde
cd /d "%~dp0"
echo.
echo  A utiliser seulement si la caisse affiche "Le serveur de la caisse ne repond pas"
echo  ou une erreur de base de donnees. La base actuelle sera gardee de cote, jamais supprimee.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\restore-backup.ps1"
echo.
pause
