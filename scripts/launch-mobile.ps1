# launch-mobile.ps1 — open this app in a phone-emulated Chrome, no DevTools needed.
#
# WHY THIS EXISTS (read me):
# Apps like this usually decide "mobile" from the USER-AGENT / touch support, NOT
# the window width. So making a desktop Chrome window skinny just squeezes the
# desktop layout — you don't get the real mobile build. And Chrome DevTools Device
# Mode needs sighted clicks to toggle. This script sidesteps both: it launches a
# SEPARATE, isolated Chrome instance with an Android user-agent + touch + a
# phone-sized window, which flips the app's mobile check to true and shows the
# genuine mobile build with zero DevTools fiddling.
#
# WHAT IT DOES:
#   1. Kills stray node procs (they keep grabbing the dev port).
#   2. Starts `npm run dev -- --host` in the background.
#   3. Auto-detects the Vite port from its output (works on 5173, 3000, whatever).
#   4. Opens Chrome (isolated profile) at the app with an Android UA + touch + a
#      Pixel-sized window. Prints a LAN URL too, for testing on a real phone.
#
# ADAPT FOR THIS PROJECT:
#   -AppPath : if your mobile view lives behind a router route, pass it, e.g.
#              `-AppPath '/#/app'`. Default '' opens the site root.
#   Also confirm HOW your app detects mobile (grep: isMobile, navigator.userAgent,
#   matchMedia, maxTouchPoints). If it keys off a WIDTH media query instead of UA,
#   the Android UA won't switch layout — but the phone-sized window still will.
#
# USAGE:  powershell -ExecutionPolicy Bypass -File scripts\launch-mobile.ps1 [-AppPath '/#/route']

param(
    [string]$AppPath = '',
    [string]$Ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$leaf = Split-Path $projectRoot -Leaf

Write-Host '==> Clearing stray node processes...'
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$log    = Join-Path $env:TEMP "vite-$leaf.out.log"
$errLog = Join-Path $env:TEMP "vite-$leaf.err.log"
Remove-Item $log, $errLog -Force -ErrorAction SilentlyContinue

Write-Host '==> Starting Vite dev server (npm run dev -- --host)...'
Push-Location $projectRoot
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--host' `
    -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog
Pop-Location

Write-Host '==> Waiting for Vite to report its port...'
$port = $null
for ($i = 0; $i -lt 80; $i++) {
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'localhost:(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $port = $m.Matches[0].Groups[1].Value; break }
    }
    Start-Sleep -Milliseconds 500
}
if (-not $port) { Write-Host 'Could not detect the Vite port — check the dev output.' -ForegroundColor Red; exit 1 }

$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -First 1 -ExpandProperty IPAddress)
$localUrl = "http://localhost:$port$AppPath"
Write-Host ''
Write-Host "==> Dev server ready." -ForegroundColor Green
Write-Host "    Emulated (this machine): $localUrl"
if ($lan) { Write-Host "    Real phone (same Wi-Fi):  http://${lan}:$port$AppPath" }
Write-Host ''

$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" }
if (-not (Test-Path $chrome)) { Write-Host "Chrome not found; open $localUrl in your browser's device mode." -ForegroundColor Yellow; exit 0 }

$profileDir = Join-Path $env:TEMP "$leaf-mobile-profile"   # isolated profile so the UA flag actually applies
Write-Host '==> Opening Chrome in mobile mode (Android UA + touch + phone window)...'
Start-Process -FilePath $chrome -ArgumentList @(
    "--user-data-dir=$profileDir", "--user-agent=$Ua",
    '--window-size=412,915', '--window-position=60,40', '--touch-events=enabled',
    '--no-first-run', '--no-default-browser-check', "--app=$localUrl"
)
Write-Host 'Done. Close that Chrome window when finished; the dev server keeps running.'
