@echo off
chcp 65001 >nul
title screencast
cd /d "%~dp0"

echo.
echo   ███ SCREENCAST ███  iniciando...
echo.

if not exist node_modules (
  echo Instalando dependencias...
  call npm install || (echo Falha no npm install. & pause & exit /b 1)
)

rem --- servidor (pula se ja estiver rodando na porta 3000) ---
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if errorlevel 1 (
  start "screencast - servidor" cmd /k npm start
) else (
  echo Servidor ja estava rodando na porta 3000.
)

rem --- tunel publico do Cloudflare ---
set "CF=cloudflared"
where cloudflared >nul 2>nul || set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CF%" if not "%CF%"=="cloudflared" (
  echo cloudflared nao encontrado. Instale com:  winget install Cloudflare.cloudflared
  start "" http://localhost:3000
  pause & exit /b 1
)

set "LOG=%TEMP%\screencast-tunnel.log"
if exist "%LOG%" del "%LOG%"
start "screencast - tunel" /min "%CF%" tunnel --no-autoupdate --url http://localhost:3000 --logfile "%LOG%"

echo Abrindo o tunel publico (pode levar uns segundos)...
set "URL="
for /l %%i in (1,1,60) do (
  if not defined URL (
    timeout /t 1 /nobreak >nul
    for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "(Select-String -Path $env:LOG -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1).Matches.Value"`) do set "URL=%%u"
  )
)

if not defined URL (
  echo Nao consegui pegar o link publico. Veja a janela "screencast - tunel".
  start "" http://localhost:3000
  pause & exit /b 1
)

echo %URL%| clip
start "" %URL%
echo.
echo   Link publico:  %URL%
echo   (ja copiado - e so colar pros amigos)
echo.
echo   Para desligar: feche as janelas "screencast - servidor" e "screencast - tunel".
echo.
pause
