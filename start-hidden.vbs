' CustomFreebuff — launches the themer with NO visible window.
' start.bat checks Node.js first, then delegates here so double-clicking the
' bat does not leave a console open: only the launcher window stays visible.
Option Explicit

Dim shell, fso, dir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir

' Window style 0 = hidden; bWaitOnReturn = False (do not block).
shell.Run "node themer.mjs", 0, False
