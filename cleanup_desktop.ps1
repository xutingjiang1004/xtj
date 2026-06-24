# 调试临时文件清理 - Dry Run
$cutoff = Get-Date "2026-06-24 14:00:00"
$debugPatterns = '^(diff_|ls_|main_|hotfix_|home_|dir_|users_|c_dirs|root_|server_|log_|feature|compare_|porcelain|reflog|desktop_|core_|backup_reflog|doc_search|backup_tree|^log_)'

Get-ChildItem -Path $env:USERPROFILE\Desktop | Where-Object {
    -not $_.PSIsContainer -and
    $_.LastWriteTime -gt $cutoff -and
    $_.Name -match $debugPatterns
} | Select-Object Name, Length, LastWriteTime | Sort-Object Name | Format-Table -AutoSize

Write-Host ""
Write-Host "总文件数: $((Get-ChildItem -Path $env:USERPROFILE\Desktop | Where-Object { -not $_.PSIsContainer -and $_.LastWriteTime -gt $cutoff -and $_.Name -match $debugPatterns }).Count)" -ForegroundColor Yellow
Write-Host ""
Write-Host "如果上面列表 OK，运行 'cleanup_desktop.ps1 -Execute' 真正删除" -ForegroundColor Green
