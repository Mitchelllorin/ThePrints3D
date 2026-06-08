# BluePrint3D autosave — commits and pushes any changes every 15 minutes.
# Run this in a separate PowerShell window: .\autosave.ps1
# Press Ctrl+C to stop.

$repo = "C:\Users\mitch\Documents\BluePrint3D-fresh"
$interval = 900  # seconds (15 min)

Write-Host "BluePrint3D autosave running — saving every $($interval/60) minutes. Ctrl+C to stop." -ForegroundColor Cyan

while ($true) {
    Start-Sleep -Seconds $interval

    Set-Location $repo
    $changes = git status --porcelain 2>$null
    if ($changes) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
        git add -A
        git commit -m "autosave: $timestamp" --quiet
        git push origin main --quiet
        Write-Host "[$timestamp] Saved and pushed." -ForegroundColor Green
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm')] No changes." -ForegroundColor DarkGray
    }
}
