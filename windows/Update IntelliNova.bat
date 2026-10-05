@echo off
setlocal
title IntelliNova - updating
cd /d "%~dp0.."

echo  Use this after extracting a new IntelliNova zip over this folder.
echo  It rebuilds the app and applies database changes; your data is kept.
echo.
docker info >nul 2>&1
if errorlevel 1 (
  echo  Start Docker Desktop first ^(or run "Start IntelliNova"^), then run this again.
  pause
  exit /b 1
)
docker compose --profile dev up -d --build
if errorlevel 1 (
  echo  The update failed. The messages above say why.
  pause
  exit /b 1
)
echo.
echo  Updated. Database migrations ran automatically when the API started.
start "" http://localhost
timeout /t 8 >nul
