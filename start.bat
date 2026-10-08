@echo off
title EcoAlert Server
cd /d "%~dp0"
echo ===========================================
echo  Starting EcoAlert Local Server...
echo ===========================================
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node server.js
    goto end
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [Info] Running via Python http.server...
    echo URL: http://localhost:3000
    python -m http.server 3000
    goto end
)

echo [Error] Neither Node.js nor Python was found on PATH!
pause

:end
