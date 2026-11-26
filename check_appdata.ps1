Get-ChildItem 'C:\Users\bjo16\AppData\Local' -Directory | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB
    if ($size -gt 0.1) {
        [PSCustomObject]@{Name=$_.Name; SizeGB=[math]::Round($size,2)}
    }
} | Sort-Object SizeGB -Descending