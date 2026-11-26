Get-ChildItem C:\Users -Directory | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB
    [PSCustomObject]@{Name=$_.Name; SizeGB=[math]::Round($size,2)}
} | Sort-Object SizeGB -Descending