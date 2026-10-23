@echo off
setlocal
set "PROMEDPARA_SOURCE=%~dp0"
set "PROMEDPARA_INSTALL_DIR=%LOCALAPPDATA%\PromedPara\app"
if not exist "%PROMEDPARA_INSTALL_DIR%" mkdir "%PROMEDPARA_INSTALL_DIR%"
robocopy "%PROMEDPARA_SOURCE%" "%PROMEDPARA_INSTALL_DIR%" /E /XD data owner-android\build worker-android\build /XF Install-PromedPara.bat
if errorlevel 8 (
  echo Installation failed while copying files. Try again or contact support.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$desktop=[Environment]::GetFolderPath('Desktop'); $shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut((Join-Path $desktop 'PromedPara.lnk')); $shortcut.TargetPath=Join-Path $env:PROMEDPARA_INSTALL_DIR 'Lancer-Caisse.bat'; $shortcut.WorkingDirectory=$env:PROMEDPARA_INSTALL_DIR; $shortcut.Save()"
if errorlevel 1 echo Desktop launch shortcut could not be created; start Lancer-Caisse.bat from the installed app folder.
echo PromedPara is installed at %PROMEDPARA_INSTALL_DIR%
echo Its database will be kept under %LOCALAPPDATA%\PromedPara\data
choice /C YN /M "Start PromedPara now"
if errorlevel 2 exit /b 0
call "%PROMEDPARA_INSTALL_DIR%\Lancer-Caisse.bat"
