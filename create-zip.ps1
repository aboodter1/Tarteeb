$ErrorActionPreference = "Stop"
$projectRoot = "C:\Users\pc\.gemini\antigravity\scratch\nashmi-ops"
Set-Location $projectRoot

if (-not (Test-Path "public")) {
    New-Item -ItemType Directory -Force -Path "public" | Out-Null
}

$excludeNames = @('node_modules', '.next', 'project.zip', 'public')

$items = Get-ChildItem -Path $projectRoot -Force | Where-Object { $_.Name -notin $excludeNames }
Write-Host "Compressing items:"
$items | ForEach-Object { Write-Host " - $($_.Name)" }

$destZip = Join-Path $projectRoot "project.zip"
if (Test-Path $destZip) {
    Remove-Item $destZip -Force
}

Compress-Archive -Path $items.FullName -DestinationPath $destZip -Force

Copy-Item $destZip -Destination (Join-Path $projectRoot "public\project.zip") -Force

$zipInfo = Get-Item $destZip
Write-Host "SUCCESS: Created $($zipInfo.FullName) ($([math]::Round($zipInfo.Length / 1MB, 2)) MB)"
