@echo off
setlocal
cd /d "%~dp0"
title Gomoku AI Arena

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [Gomoku AI Arena] Node.js 22 or newer is required.
  echo Install Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

if /I "%~1"=="--check" (
  if not exist "node_modules\vinext" exit /b 1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/' -TimeoutSec 1; if($response.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
  if errorlevel 1 (
    echo [Gomoku AI Arena] Ready to launch.
  ) else (
    echo [Gomoku AI Arena] Running at http://localhost:3000/
  )
  exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/' -TimeoutSec 1; if($response.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
if not errorlevel 1 (
  start "" "http://localhost:3000/"
  exit /b 0
)

if not exist "node_modules\vinext" (
  echo [Gomoku AI Arena] Preparing the first launch. Please wait.
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Setup failed. Check your internet connection and Node.js version.
    pause
    exit /b 1
  )
)

start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$arenaUrl='http://localhost:3000/'; for($i=0; $i -lt 120; $i++){ try { $response = Invoke-WebRequest -UseBasicParsing $arenaUrl -TimeoutSec 1; if($response.StatusCode -eq 200){Start-Process $arenaUrl; exit} } catch { Start-Sleep -Milliseconds 500 } }"

echo [Gomoku AI Arena] Running.
echo Close this window to stop the Arena.
echo.
call npm.cmd run arena

if errorlevel 1 (
  echo.
  echo The Arena stopped unexpectedly.
  pause
)
