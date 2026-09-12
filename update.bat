@echo off
setlocal EnableExtensions DisableDelayedExpansion

pushd "%~dp0" || goto failed
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

echo ===================================================
echo   multiagents - Update Script (Windows)
echo ===================================================
echo.

rem 1. Pull latest repository changes if git exists
if exist ".git" (
    echo [1/4] Pulling latest changes from git...
    where.exe git.exe >nul 2>&1
    if not errorlevel 1 (
        git pull
    ) else (
        echo Git not found, skipping git pull.
    )
) else (
    echo [1/4] No .git directory found, skipping git pull.
)
echo.

rem 2. Update dependencies
echo [2/4] Updating project dependencies with pnpm...
call :find_command pnpm
if defined FOUND_COMMAND (
    cmd /c "%FOUND_COMMAND%" install
) else (
    echo WARNING: pnpm not found. Run setup.bat to configure prerequisites.
)
echo.

rem 3. Update agent CLIs
echo [3/4] Updating Agent CLIs...
if defined FOUND_COMMAND (
    cmd /c "%FOUND_COMMAND%" add --global @openai/codex@latest @google/gemini-cli@latest
)
call :find_command claude
if defined FOUND_COMMAND (
    cmd /c "%FOUND_COMMAND%" update 2>nul || (
        "%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression"
    )
)
echo.

rem 4. Update Bun
echo [4/4] Updating Bun...
set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN_EXE%" (
    "%BUN_EXE%" upgrade
) else (
    for /f "delims=" %%B in ('where.exe bun.exe 2^>nul') do %%B upgrade
)

echo.
echo ===================================================
echo   Update completed successfully!
echo   Run start.bat to launch multiagents.
echo ===================================================
popd
pause
exit /b 0

:find_command
set "FOUND_COMMAND="
for /f "delims=" %%C in ('where.exe %~1.exe 2^>nul') do if not defined FOUND_COMMAND set "FOUND_COMMAND=%%C"
for /f "delims=" %%C in ('where.exe %~1.cmd 2^>nul') do if not defined FOUND_COMMAND set "FOUND_COMMAND=%%C"
if not defined FOUND_COMMAND if /i "%~1"=="claude" if exist "%USERPROFILE%\.local\bin\claude.exe" set "FOUND_COMMAND=%USERPROFILE%\.local\bin\claude.exe"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\.bun\bin\%~1.exe" set "FOUND_COMMAND=%USERPROFILE%\.bun\bin\%~1.exe"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\.bun\bin\%~1.cmd" set "FOUND_COMMAND=%USERPROFILE%\.bun\bin\%~1.cmd"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\AppData\Local\pnpm\%~1.exe" set "FOUND_COMMAND=%USERPROFILE%\AppData\Local\pnpm\%~1.exe"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\AppData\Local\pnpm\%~1.cmd" set "FOUND_COMMAND=%USERPROFILE%\AppData\Local\pnpm\%~1.cmd"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\AppData\Local\pnpm\bin\%~1.exe" set "FOUND_COMMAND=%USERPROFILE%\AppData\Local\pnpm\bin\%~1.exe"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\AppData\Local\pnpm\bin\%~1.cmd" set "FOUND_COMMAND=%USERPROFILE%\AppData\Local\pnpm\bin\%~1.cmd"
exit /b 0

:failed
echo Update failed.
popd
pause
exit /b 1
