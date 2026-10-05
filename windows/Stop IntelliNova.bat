@echo off
setlocal
title IntelliNova - stopping
cd /d "%~dp0.."

docker info >nul 2>&1
if errorlevel 1 (
  echo  Docker isn't running, so IntelliNova is already stopped.
  timeout /t 5 >nul
  exit /b 0
)
echo  Stopping IntelliNova (your data is kept)...
docker compose --profile dev stop
echo.
choice /c YN /n /t 15 /d N /m "  Also shut down Docker and WSL to give all memory back to Windows? [Y/N] "
if errorlevel 2 goto done
echo  Shutting down Docker Desktop and WSL...
taskkill /im "Docker Desktop.exe" /f >nul 2>&1
wsl --shutdown
:done
echo  Stopped.
timeout /t 4 >nul
