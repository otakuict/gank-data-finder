@echo off
setlocal

cd /d "%~dp0"
title Gank Post Finder

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo Starting Gank Post Finder...
echo Frontend: http://127.0.0.1:5173
echo Backend:  http://127.0.0.1:3001
echo.
echo Press Ctrl+C to stop both services.
echo.

call npm run dev
if errorlevel 1 goto :error
goto :end

:error
echo.
echo The application could not be started.
pause
exit /b 1

:end
endlocal
