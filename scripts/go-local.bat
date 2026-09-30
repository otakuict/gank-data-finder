@echo off
setlocal

set "GO_EXE="
where go.exe >nul 2>nul
if not errorlevel 1 set "GO_EXE=go.exe"
if exist "%~dp0..\.tools\go\bin\go.exe" set "GO_EXE=%~dp0..\.tools\go\bin\go.exe"

if not defined GO_EXE (
  echo Go was not found. Install Go 1.24 or newer from https://go.dev/dl/
  exit /b 1
)

"%GO_EXE%" %*
exit /b %errorlevel%
