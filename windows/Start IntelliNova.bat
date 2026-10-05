@echo off
setlocal EnableDelayedExpansion
title IntelliNova - starting
cd /d "%~dp0.."

echo.
echo  IntelliNova
echo  -----------
echo.

if not exist ".env" (
  echo  No .env file found next to docker-compose.yml.
  echo  Copy .env.example to .env and fill it in first ^(see README^).
  pause
  exit /b 1
)

rem 1. Make sure Docker Desktop is running (it runs IntelliNova's containers).
docker info >nul 2>&1
if not errorlevel 1 goto dockerok
echo  Starting Docker Desktop...
set "DD="
if exist "D:\Docker\Program\Docker Desktop.exe" set "DD=D:\Docker\Program\Docker Desktop.exe"
if not defined DD if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "DD=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not defined DD if exist "%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe" set "DD=%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe"
if not defined DD (
  echo  Could not find Docker Desktop. Start it from the Start menu, then run this again.
  pause
  exit /b 1
)
start "" "%DD%"
set /a tries=0
:waitdocker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto dockerok
set /a tries+=1
if !tries! lss 80 goto waitdocker
echo  Docker Desktop did not become ready. Open it, wait for "Engine running", then run this again.
pause
exit /b 1

:dockerok
echo  Docker is running.

rem 2. Start (or build, the first time) every IntelliNova container.
echo  Starting IntelliNova. The first run builds everything and can take 10-20 minutes...
docker compose --profile dev up -d
if errorlevel 1 (
  echo  Something went wrong starting the containers. The messages above say what.
  pause
  exit /b 1
)

rem 3. Download the AI models once (they are kept in the "ollama" volume).
for %%M in (llama3.1:8b qwen2.5:7b llava:7b) do (
  docker compose exec -T ollama ollama list 2>nul | findstr /b /c:"%%M" >nul
  if errorlevel 1 (
    echo  Downloading AI model %%M, one time only, a few GB...
    docker compose exec -T ollama ollama pull %%M
  )
)

rem 4. Wait for the app to answer, then open it in the browser.
echo  Waiting for the app...
set /a tries=0
:waitweb
curl -s -o nul -m 5 -f http://localhost/api/health
if not errorlevel 1 goto ready
set /a tries+=1
if !tries! geq 60 goto ready
timeout /t 3 /nobreak >nul
goto waitweb

:ready
start "" http://localhost
echo.
echo  IntelliNova is running at http://localhost   (emails: http://localhost:8025)
echo  You can close this window. It keeps running until you use "Stop IntelliNova".
timeout /t 8 >nul
