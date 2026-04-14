@echo off
title LOYAGO Provisionscontrolling
cd /d "%~dp0"

echo.
echo  LOYAGO Provisionscontrolling wird gestartet...
echo  Dieses Fenster bitte offen lassen.
echo.

:: Server in eigenem Fenster starten
start "LOYAGO Server" cmd /k "npm run dev"

:: Kurz warten bis Vite hochgefahren ist
timeout /t 4 /nobreak > nul

:: Browser öffnen
start "" "http://localhost:5174"

echo  Browser wurde geöffnet.
echo  Zum Beenden: das Fenster "LOYAGO Server" schließen.
echo.
