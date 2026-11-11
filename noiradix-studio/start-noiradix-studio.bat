@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
title NOIRADIX Studio
cd /d "%~dp0"
set "STUDIO_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "STUDIO_ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "STUDIO_ARCH=arm64"
set "STUDIO_NODE=%~dp0runtime\win-%STUDIO_ARCH%\node.exe"
if exist "%STUDIO_NODE%" goto check_node
set "STUDIO_NODE=node"
where node >nul 2>&1
if errorlevel 1 goto missing_node
:check_node
"%STUDIO_NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto missing_node
"%STUDIO_NODE%" "%~dp0tools\launch-studio.mjs" %*
set "STUDIO_RESULT=%ERRORLEVEL%"
if "%STUDIO_RESULT%"=="0" exit /b 0
echo Khong mo duoc Studio. Xem thong bao phia tren hoac doc BAT-DAU.txt.
pause
exit /b %STUDIO_RESULT%
:missing_node
echo May chua co bo chay phu hop.
echo Ban ZIP portable: giai nen toan bo va giu nguyen thu muc runtime.
echo Ban ma nguon: cai Node.js LTS tu trang dang mo, roi mo lai file nay.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

