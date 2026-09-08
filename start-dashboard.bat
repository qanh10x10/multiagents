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
echo ERROR: Bun was not found. Install Bun from https://bun.sh, then reopen this launcher.
echo Expected bun.exe in your user profile's .bun\bin directory or on PATH.
goto failed

:bun_found
"%BUN_EXE%" --version
if errorlevel 1 goto failed
if not exist "broker.ts" goto missing_files
if not exist "dashboard\server.ts" goto missing_files
if not exist "dashboard\index.html" goto missing_files
echo Bun: "%BUN_EXE%"
echo Broker port: %MULTIAGENTS_PORT%; dashboard port: %MULTIAGENTS_WEB_PORT%
if defined CHECK_ONLY (
    echo Check passed. No services or browser launched.
    popd
    exit /b 0
)

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

:missing_files
echo ERROR: Keep start-dashboard.bat in the multiagents repository root beside broker.ts and dashboard.
:failed
echo Launcher failed. Correct the error above and try again. No services were stopped.
if defined LAUNCHER_PUSHD popd
if not defined CHECK_ONLY pause
exit /b 1

:help
echo Usage: start-dashboard.bat [--check ^| --help]
echo Double-click to start or reuse the broker and dashboard, then open the browser.
echo --check validates Bun, repository files, and ports without launching services or a browser.
echo Ports: MULTIAGENTS_PORT=7899; MULTIAGENTS_WEB_PORT=7900; WEB_PORT is a fallback alias.
echo Existing listeners are never killed. Closing this launcher does not stop services.
exit /b 0