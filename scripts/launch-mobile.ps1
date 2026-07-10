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
#   1. REUSES a dev server for this project if one is already serving. It does NOT
#      kill node — killing every node process also killed unrelated dev servers
#      (and yanked the rug out from under an already-open mobile window). Pass
#      -Fresh if you actually want a clean restart of THIS project's server.
#   2. Otherwise starts `npm run dev -- --host` in the background.
#   3. Auto-detects the Vite port from its output, falling back to a port scan.
#   4. Opens Chrome (isolated profile) at the app with an Android UA + touch + a
#      Pixel-sized window. Prints a LAN URL too, for testing on a real phone.
#
# ADAPT FOR THIS PROJECT:
#   -AppPath : if your mobile view lives behind a router route, pass it, e.g.
#              `-AppPath '/#/app'`. Default '' opens the site root.
#   Also confirm HOW your app detects mobile (grep: isMobile, navigator.userAgent,
#   matchMedia, maxTouchPoints). If it keys off a WIDTH media query instead of UA,
#   the Android UA won't switch layout — but the phone-sized window still will.
#   NOTE: this app keys off `window.innerWidth < 768`, so the phone-sized window
#   is what flips the layout; the Android UA just keeps touch emulation honest.
#
# USAGE:  powershell -ExecutionPolicy Bypass -File scripts\launch-mobile.ps1 [-AppPath '/#/route'] [-Fresh]

param(
    [string]$AppPath = '',
    [string]$Ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    # Restart THIS project's dev server even if one is already up. Never touches
    # node processes belonging to other projects.
    [switch]$Fresh,
    # Cold `vite` starts on this repo have taken ~35s; the old 40s ceiling made
    # the script cry wolf and bail while the server was still coming up.
    [int]$TimeoutSec = 150
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$leaf = Split-Path $projectRoot -Leaf

# The served HTML must contain this for a port to count as "our" dev server —
# otherwise we'd happily attach to a sibling project squatting on 5173.
$appSignature = '<title>ThePrints3D</title>'
$scanPorts = 5173..5190

function Get-ProjectServerPort {
    param([int[]]$Ports, [string]$Signature)
    foreach ($p in $Ports) {
        $tcp = New-Object System.Net.Sockets.TcpClient
        try {
            $iar = $tcp.BeginConnect('127.0.0.1', $p, $null, $null)
            if (-not $iar.AsyncWaitHandle.WaitOne(120)) { continue }
            $tcp.EndConnect($iar)
        } catch { continue } finally { $tcp.Close() }

        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$p/" -UseBasicParsing -TimeoutSec 4
            if ($r.Content -like "*$Signature*") { return $p }
        } catch { continue }
    }
    return $null
}

# ── Reuse or restart, but never a blanket node kill ──────────────────────────
$existing = Get-ProjectServerPort -Ports $scanPorts -Signature $appSignature

if ($existing -and -not $Fresh) {
    Write-Host "==> Reusing the dev server already serving this project on port $existing." -ForegroundColor Green
    Write-Host '    (Pass -Fresh to restart it instead. Other projects'' servers are left alone.)'
    $port = $existing
} else {
    if ($Fresh -and $existing) {
        # Kill ONLY the process listening on this project's port — not every node.
        Write-Host "==> -Fresh: stopping this project's dev server on port $existing..."
        $owner = (Get-NetTCPConnection -State Listen -LocalPort $existing -ErrorAction SilentlyContinue |
                  Select-Object -First 1 -ExpandProperty OwningProcess)
        if ($owner) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800 }
    }
    $port = $null
}

if (-not $port) {
    $log    = Join-Path $env:TEMP "vite-$leaf.out.log"
    $errLog = Join-Path $env:TEMP "vite-$leaf.err.log"
    Remove-Item $log, $errLog -Force -ErrorAction SilentlyContinue

    Write-Host '==> Starting Vite dev server (npm run dev -- --host)...'
    Push-Location $projectRoot
    Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--host' `
        -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog
    Pop-Location

    Write-Host "==> Waiting up to ${TimeoutSec}s for Vite to report its port..."
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $log) {
            $m = Select-String -Path $log -Pattern 'localhost:(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($m) { $port = $m.Matches[0].Groups[1].Value; break }
        }
        Start-Sleep -Milliseconds 500
    }
    # The log parse is the fast path, not the only path: if Vite buffered its
    # banner we can still find the server by scanning for our own app signature.
    if (-not $port) {
        Write-Host '    Log had no port banner; scanning ports for this app...' -ForegroundColor Yellow
        $port = Get-ProjectServerPort -Ports $scanPorts -Signature $appSignature
    }
    if (-not $port) {
        Write-Host "Could not detect the Vite port after ${TimeoutSec}s." -ForegroundColor Red
        Write-Host "  stdout: $log"
        Write-Host "  stderr: $errLog"
        exit 1
    }
}

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
