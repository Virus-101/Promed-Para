@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-PromedPara.ps1"
if errorlevel 1 (
  echo PromedPara did not start. Check the message above and the logs under %LOCALAPPDATA%\PromedPara\logs.
  pause
)
endlocal
