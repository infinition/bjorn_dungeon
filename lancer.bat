@echo off
rem Lance le serveur Bjorn Dungeon (en-tetes no-cache) et ouvre le navigateur.
rem Port passable en argument : lancer.bat 8200 (defaut 8100)
setlocal
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8100
start "" "http://localhost:%PORT%"
node server.js %PORT%
endlocal
