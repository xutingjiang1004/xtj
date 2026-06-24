# Cleanup debug files - Execute
$cutoff = Get-Date "2026-06-24 14:00:00"
$debugPatterns = '^(diff_|ls_|main_|hotfix_|home_|dir_|users_|c_dirs|root_|server_|log_|feature|compare_|porcelain|reflog|desktop_|core_|backup_reflog|doc_search|backup_tree|^log_)'

$files = Get-ChildItem -Path $env:USERPROFILE\Desktop | Where-Object {
    -not $_.PSIsContainer -and
    $_.LastWriteTime -gt $cutoff -and
    $_.Name -match $debugPatterns
}

Write-Host "Will delete $($files.Count) files:" -ForegroundColor Yellow
$files | ForEach-Object { Write-Host "  - $($_.Name)" }

Write-Host ""
Write-Host "Starting delete in 3 seconds..." -ForegroundColor Red
Start-Sleep -Seconds 3

$files | Remove-Item -Force
Write-Host "Done! Deleted $($files.Count) files" -ForegroundColor Green
