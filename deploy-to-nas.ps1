# Copies the committed source (HEAD) to the NAS share that TrueNAS builds OpenMindstorms from
# (the app, share and dataset are still called openrcx from the first deployment).
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
New-Item -ItemType Directory -Force (Join-Path $Share 'accounts') | Out-Null   # accounts + program library database
# The YAML on the share holds Brandon's secrets (OAuth ids, stats key): never overwrite it.
# The repo copy goes next to it as openrcx-app.yaml.new for comparing when services change.
$shareYaml = Join-Path $Share 'openrcx-app.yaml'
if (Test-Path $shareYaml) {
    Copy-Item (Join-Path $repo 'truenas\openrcx-app.yaml') "$shareYaml.new" -Force
    $yamlNote = "YAML: kept $shareYaml (has your secrets); repo version written to $shareYaml.new"
} else {
    Copy-Item (Join-Path $repo 'truenas\openrcx-app.yaml') $shareYaml -Force
    $yamlNote = "YAML for the TrueNAS installer: $shareYaml"
}

$commit = git -C $repo log -1 --format='%h %s'
Set-Content -Path (Join-Path $dest 'DEPLOYED.txt') -Value "$commit`r`n$(Get-Date -Format s)" -Encoding utf8
Write-Host "Deployed $commit to $dest"
Write-Host $yamlNote
