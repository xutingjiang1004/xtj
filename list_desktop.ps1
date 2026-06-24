Get-ChildItem -Path $env:USERPROFILE\Desktop | Where-Object { -not $_.PSIsContainer } | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
