' Lanza el vigilante sin mostrar ninguna ventana (ni siquiera un parpadeo).
Dim sh, ruta
Set sh = CreateObject("WScript.Shell")
ruta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ruta & "\vigilante-erp.ps1""", 0, False
