@echo off
rem CustomFreebuff — launcher (source). Starts the themer with no visible
rem console: only the little launcher window appears.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found.
    echo Install it from https://nodejs.org and run this file again.
    pause
    exit /b 1
)

wscript //nologo "%~dp0start-hidden.vbs"
exit /b 0
