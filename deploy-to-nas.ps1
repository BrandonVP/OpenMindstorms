# Copies the committed source (HEAD) to the NAS share that TrueNAS builds OpenRCX from.
#   powershell -ExecutionPolicy Bypass -File .\deploy-to-nas.ps1
# Then in TrueNAS: Apps > openrcx > Stop, Start  (the app rebuilds from src on start).
# First time: Apps > Discover Apps > ⋮ > Install via YAML, paste truenas\openrcx-app.yaml.

param([string]$Share = '\\TRUENAS\openrcx')

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$dest = Join-Path $Share 'src'
$zip  = Join-Path $env:TEMP 'openrcx-src.zip'

$dirty = git -C $repo status --porcelain
if ($dirty) { Write-Warning 'Uncommitted changes are NOT copied; only the last commit is deployed.' }

git -C $repo archive --format=zip -o $zip HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $dest
Remove-Item $zip

New-Item -ItemType Directory -Force (Join-Path $Share 'certs') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Share 'stats') | Out-Null   # usage counters database
Copy-Item (Join-Path $repo 'truenas\openrcx-app.yaml') (Join-Path $Share 'openrcx-app.yaml') -Force

$commit = git -C $repo log -1 --format='%h %s'
Set-Content -Path (Join-Path $dest 'DEPLOYED.txt') -Value "$commit`r`n$(Get-Date -Format s)" -Encoding utf8
Write-Host "Deployed $commit to $dest"
Write-Host "YAML for the TrueNAS installer: $(Join-Path $Share 'openrcx-app.yaml')"
