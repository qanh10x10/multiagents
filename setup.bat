@echo off
setlocal EnableExtensions DisableDelayedExpansion

pushd "%~dp0" || goto failed
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

echo ===================================================
echo   multiagents - Environment & Prerequisites Setup
echo ===================================================
echo.

rem 1. Check or install Bun
echo [1/5] Checking Bun...
set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN_EXE%" goto bun_ok
for /f "delims=" %%B in ('where.exe bun.exe 2^>nul') do if not defined BUN_EXE set "BUN_EXE=%%B"
if defined BUN_EXE goto bun_ok

echo Bun was not found. Installing Bun...
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression"
if errorlevel 1 (
    echo ERROR: Failed to install Bun.
    goto failed
)
set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN_EXE%" (
    echo ERROR: Bun installation completed but bun.exe not found at %BUN_EXE%.
    goto failed
)

:bun_ok
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
"%BUN_EXE%" --version
echo Bun OK.
echo.

rem 2. Check or install Node.js (>=20)
echo [2/5] Checking Node.js...
call :find_command node
if not defined FOUND_COMMAND goto install_node
"%FOUND_COMMAND%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if not errorlevel 1 goto node_ok

:install_node
echo Node.js 20+ required. Installing Node.js LTS via winget...
where.exe winget.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: winget is required to install Node.js. Please install Node.js 20+ manually.
    goto failed
)
winget.exe install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 (
    echo ERROR: Failed to install Node.js.
    goto failed
)
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :find_command node
if not defined FOUND_COMMAND (
    echo ERROR: Node.js installed but node.exe not found.
    goto failed
)

:node_ok
echo Node.js OK.
echo.

rem 3. Check or install pnpm
echo [3/5] Checking pnpm...
call :find_command pnpm
if defined FOUND_COMMAND goto pnpm_ok

echo pnpm not found. Installing pnpm...
call :find_command npm
if defined FOUND_COMMAND (
    cmd /c "%FOUND_COMMAND%" install --global pnpm
) else (
    where.exe winget.exe >nul 2>&1
    if not errorlevel 1 winget.exe install --id pnpm.pnpm --exact --accept-package-agreements --accept-source-agreements --silent
)
set "PATH=%USERPROFILE%\AppData\Local\pnpm;%USERPROFILE%\AppData\Local\pnpm\bin;%PATH%"
call :find_command pnpm
if not defined FOUND_COMMAND (
    echo ERROR: pnpm installation failed.
    goto failed
)

:pnpm_ok
echo pnpm OK.
echo.

rem 4. Install project dependencies
echo [4/5] Installing project dependencies with pnpm...
cmd /c "%FOUND_COMMAND%" install
if errorlevel 1 (
    echo ERROR: pnpm install failed.
    goto failed
)
echo Dependencies OK.
echo.

rem 5. Check or install Agent CLIs (Claude Code, Codex CLI, Gemini CLI)
echo [5/5] Checking and installing Agent CLIs...

call :ensure_agent claude "Claude Code" native
call :ensure_agent codex "Codex CLI" "@openai/codex"
call :ensure_agent gemini "Gemini CLI" "@google/gemini-cli"

echo.
echo ===================================================
echo   Setup completed successfully!
echo   Run start.bat to launch multiagents.
echo ===================================================
popd
pause
exit /b 0

:ensure_agent
call :find_command %~1
if defined FOUND_COMMAND (
    echo [OK] %~2: "%FOUND_COMMAND%"
    exit /b 0
)
echo Installing %~2 with pnpm...
if /i "%~3"=="native" goto install_native_agent
call :find_command pnpm
if defined FOUND_COMMAND (
    cmd /c "%FOUND_COMMAND%" add --global %~3
    goto agent_installed
)
call :find_command npm
if defined FOUND_COMMAND (
    cmd /c "%FOUND_COMMAND%" install --global %~3
    goto agent_installed
)
echo ERROR: pnpm is required to install %~2.
exit /b 1

:install_native_agent
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression"

:agent_installed
if errorlevel 1 (
    echo WARNING: Failed to install %~2. You can install it manually later.
    exit /b 0
)
call :find_command %~1
if defined FOUND_COMMAND (
    echo [OK] %~2 installed: "%FOUND_COMMAND%"
) else (
    echo [NOTE] %~2 installed. Please restart your terminal if command is not yet in PATH.
)
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
echo.
echo Setup failed. Correct the error above and rerun setup.bat.
popd
pause
exit /b 1
