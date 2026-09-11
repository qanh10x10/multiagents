@echo off
setlocal DisableDelayedExpansion
set "SETUP_PAUSE=1"
for %%A in (%*) do if /I "%%~A"=="--no-pause" set "SETUP_PAUSE=0"
echo multiagents Copilot workspace setup
set "BUN_EXE="
if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if defined BUN_EXE goto run
for %%B in (bun.exe) do set "BUN_EXE=%%~$PATH:B"
if defined BUN_EXE goto run
echo ERROR: Bun not found. Install Bun manually, then reopen this setup.
echo Expected Bun on PATH or at %%USERPROFILE%%\.bun\bin\bun.exe
set "SETUP_EXIT=1"
goto finish
:run
"%BUN_EXE%" "%~dp0cli\setup-copilot.ts" %*
set "SETUP_EXIT=%ERRORLEVEL%"
if not "%SETUP_EXIT%"=="0" echo Setup failed. Resolve the message above and rerun; never enter API keys here.
:finish
if "%SETUP_PAUSE%"=="1" pause
exit /b %SETUP_EXIT%