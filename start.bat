@echo off
setlocal
title CustomFreebuff
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found.
    echo Install it from https://nodejs.org and run this file again.
    pause
    exit /b 1
)

echo Starting CustomFreebuff...
echo Your browser will open the theme studio.
echo Close this window to stop the studio.
echo.
node themer.mjs
echo.
echo The studio stopped.
pause
