' PromedPara - ouvre la page de test du lecteur code-barres.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "	oolsstart.ps1"" -Page /scanner-test.html", 0, False
