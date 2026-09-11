@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "CHECK_ONLY="
if /i "%~1"=="--check" set "CHECK_ONLY=1"
if /i "%~1"=="--help" goto help
if not "%~1"=="" if not defined CHECK_ONLY goto help

pushd "%~dp0" || goto failed
set "LAUNCHER_PUSHD=1"
if not defined MULTIAGENTS_PORT set "MULTIAGENTS_PORT=7899"
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

rem Read untrusted port values from the environment, never as command text.
"%PS_EXE%" -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; foreach ($name in @('MULTIAGENTS_PORT','MULTIAGENTS_WEB_PORT','WEB_PORT')) { $v=[Environment]::GetEnvironmentVariable($name); if (-not $v) { continue }; if ($v -cnotmatch '\A[0-9]{1,5}\z' -or [int]$v -lt 1 -or [int]$v -gt 65535) { Write-Host ('ERROR: '+$name+' must be an integer from 1 to 65535.'); exit 1 } }; $web=7900; if ($env:MULTIAGENTS_WEB_PORT) { $web=[int]$env:MULTIAGENTS_WEB_PORT } elseif ($env:WEB_PORT) { $web=[int]$env:WEB_PORT }; if ([int]$env:MULTIAGENTS_PORT -eq $web) { Write-Host 'ERROR: Broker and dashboard ports must differ.'; exit 1 }"
if errorlevel 1 goto failed
rem Use the server's native variable first; WEB_PORT is a convenience alias.
if not defined MULTIAGENTS_WEB_PORT if defined WEB_PORT set "MULTIAGENTS_WEB_PORT=%WEB_PORT%"
if not defined MULTIAGENTS_WEB_PORT set "MULTIAGENTS_WEB_PORT=7900"

set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN_EXE%" goto bun_found
set "BUN_EXE="
for /f "delims=" %%B in ('where.exe bun.exe 2^>nul') do if not defined BUN_EXE set "BUN_EXE=%%B"
if defined BUN_EXE goto bun_found
if defined CHECK_ONLY (
    echo ERROR: Bun was not found. Run start-dashboard.bat once to install prerequisites.
    goto failed
)
echo Bun was not found. Installing Bun with the official installer...
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression"
if errorlevel 1 goto failed
set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN_EXE%" (
    echo ERROR: Bun installation completed but bun.exe was not found.
    goto failed
)

:bun_found
"%BUN_EXE%" --version
if errorlevel 1 goto failed
if not exist "broker.ts" goto missing_files
if not exist "dashboard\server.ts" goto missing_files
if not exist "dashboard\index.html" goto missing_files
echo Bun: "%BUN_EXE%"
echo Broker port: %MULTIAGENTS_PORT%; dashboard port: %MULTIAGENTS_WEB_PORT%
if defined CHECK_ONLY (
    if not exist "node_modules" (
        echo ERROR: Dependencies are missing. Run start-dashboard.bat once to install them.
        goto failed
    )
    call :find_command claude
    if not defined FOUND_COMMAND echo WARNING: Claude Code is not installed.
    call :find_command codex
    if not defined FOUND_COMMAND echo WARNING: Codex CLI is not installed.
    call :find_command gemini
    if not defined FOUND_COMMAND echo WARNING: Gemini CLI is not installed.
    echo Check passed. No installation, services, or browser launched.
    popd
    exit /b 0
)

if not exist "node_modules" (
    echo Installing project dependencies...
    "%BUN_EXE%" install --frozen-lockfile
    if errorlevel 1 goto failed
)
call :ensure_agent claude "Claude Code" native
if errorlevel 1 goto failed
call :ensure_node
if errorlevel 1 goto failed
call :ensure_agent codex "Codex CLI" "@openai/codex"
if errorlevel 1 goto failed
call :ensure_agent gemini "Gemini CLI" "@google/gemini-cli"
if errorlevel 1 goto failed

set "MULTIAGENTS_NO_OPEN=1"
call :ensure_service %MULTIAGENTS_PORT% broker.ts broker
if errorlevel 1 goto failed
call :ensure_service %MULTIAGENTS_WEB_PORT% dashboard\server.ts dashboard
if errorlevel 1 goto failed
start "" "http://127.0.0.1:%MULTIAGENTS_WEB_PORT%"
if errorlevel 1 goto failed
echo Dashboard ready. This launcher never stops services, including reused listeners.
popd
exit /b 0

:ensure_service
set "PROBE_PORT=%~1"
set "PROBE_KIND=%~3"
"%PS_EXE%" -NoLogo -NoProfile -NonInteractive -Command "try { $ports=[Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners(); if ($ports.Port -contains [int]$env:PROBE_PORT) { exit 0 }; exit 1 } catch { Write-Host 'ERROR: Could not inspect TCP listeners.'; exit 2 }"
if errorlevel 2 exit /b 1
if errorlevel 1 (
    echo Starting %~3 on port %~1...
    rem START preserves ERRORLEVEL on success; clear the probe's expected exit 1.
    ver >nul
    start "multiagents %~3" "%ComSpec%" /d /s /k ""%BUN_EXE%" "%~2""
    if errorlevel 1 exit /b 1
) else (
    echo Reusing listener on port %~1; checking %~3 readiness...
)
rem Check service identity, not just an open port; bound each request and total wait.
"%BUN_EXE%" -e "const broker=process.env.PROBE_KIND==='broker'; const url='http://127.0.0.1:'+process.env.PROBE_PORT+(broker?'/health':'/'); const deadline=Date.now()+15000; while(Date.now()<deadline){try{const r=await fetch(url,{signal:AbortSignal.timeout(750),redirect:'error'}); if(r.ok){if(broker){const j=await r.json(); if(j.status==='ok'&&typeof j.peers==='number')process.exit(0)}else if((await r.text()).includes('<title>multiagents dashboard</title>'))process.exit(0)}}catch{} await Bun.sleep(250)} console.error('ERROR: '+process.env.PROBE_KIND+' did not become ready at '+url+'. Inspect its console; an existing listener may belong to another app. Nothing was stopped.'); process.exit(1);"
exit /b %errorlevel%

:find_command
set "FOUND_COMMAND="
for /f "delims=" %%C in ('where.exe %~1.exe 2^>nul') do if not defined FOUND_COMMAND set "FOUND_COMMAND=%%C"
for /f "delims=" %%C in ('where.exe %~1.cmd 2^>nul') do if not defined FOUND_COMMAND set "FOUND_COMMAND=%%C"
if not defined FOUND_COMMAND if /i "%~1"=="claude" if exist "%USERPROFILE%\.local\bin\claude.exe" set "FOUND_COMMAND=%USERPROFILE%\.local\bin\claude.exe"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\.bun\bin\%~1.exe" set "FOUND_COMMAND=%USERPROFILE%\.bun\bin\%~1.exe"
if not defined FOUND_COMMAND if exist "%USERPROFILE%\.bun\bin\%~1.cmd" set "FOUND_COMMAND=%USERPROFILE%\.bun\bin\%~1.cmd"
exit /b 0

:ensure_node
call :find_command node
if not defined FOUND_COMMAND goto install_node
"%FOUND_COMMAND%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if not errorlevel 1 exit /b 0
echo Installed Node.js is too old. Installing current Node.js LTS...
goto run_node_install

:install_node
echo Node.js was not found. Installing current Node.js LTS...

:run_node_install
where.exe winget.exe >nul 2>&1
if errorlevel 1 (
    echo ERROR: WinGet is required to install Node.js 20 or newer for Gemini CLI.
    exit /b 1
)
winget.exe install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 exit /b 1
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :find_command node
if not defined FOUND_COMMAND (
    echo ERROR: Node.js installation completed but node.exe was not found.
    exit /b 1
)
"%FOUND_COMMAND%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
    echo ERROR: Gemini CLI requires Node.js 20 or newer.
    exit /b 1
)
exit /b 0

:ensure_agent
call :find_command %~1
if defined FOUND_COMMAND (
    echo %~2: "%FOUND_COMMAND%"
    exit /b 0
)
echo Installing %~2...
if /i "%~3"=="native" goto install_native_agent
call :find_command npm
if not defined FOUND_COMMAND (
    echo ERROR: npm is required to install %~2.
    exit /b 1
)
call "%FOUND_COMMAND%" install --global %~3
goto agent_installed

:install_native_agent
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression"

:agent_installed
if errorlevel 1 (
    echo ERROR: Failed to install %~2.
    exit /b 1
)
call :find_command %~1
if not defined FOUND_COMMAND (
    echo ERROR: %~2 installation completed but its command was not found.
    exit /b 1
)
"%FOUND_COMMAND%" --version
if errorlevel 1 exit /b 1
echo %~2 installed. Sign in separately before using it.
exit /b 0

:missing_files
echo ERROR: Keep start-dashboard.bat in the multiagents repository root beside broker.ts and dashboard.
:failed
echo Launcher failed. Correct the error above and try again. No services were stopped.
if defined LAUNCHER_PUSHD popd
if not defined CHECK_ONLY pause
exit /b 1

:help
echo Usage: start-dashboard.bat [--check ^| --help]
echo Double-click to install missing prerequisites, start or reuse services, then open the browser.
echo Missing Bun, dependencies, Claude Code, Codex CLI, and Gemini CLI are installed automatically.
echo --check validates prerequisites without installing, launching services, or opening a browser.
echo Ports: MULTIAGENTS_PORT=7899; MULTIAGENTS_WEB_PORT=7900; WEB_PORT is a fallback alias.
echo Existing listeners are never killed. Closing this launcher does not stop services.
exit /b 0