# Trust the OpenRCX Workbench's self-signed certificate on this Windows PC, so Edge
# and Chrome open https://openrcx.vp (or the IP) with a normal padlock and no warning.
#
#   Run as Administrator (whole machine, no prompts):
#     powershell -ExecutionPolicy Bypass -File .\trust-cert.ps1
#   Run as a normal user (current user only; Windows asks once to confirm):
#     same command - it falls back automatically.
#
# Re-run after the certificate is regenerated (new IP or names in the app YAML);
# the old entry is replaced.  Restart the browser afterwards.

param([string]$CertPath = '\\TRUENAS\openrcx\certs\server.crt')

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $CertPath)) { throw "Certificate not found at $CertPath - start the openrcx app once first." }

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertPath)
Write-Host "Certificate: $($cert.Subject)  thumbprint $($cert.Thumbprint)"
Write-Host "Valid for  : $($cert.Extensions | Where-Object { $_.Oid.FriendlyName -eq 'Subject Alternative Name' } | ForEach-Object { $_.Format($false) })"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$store = if ($isAdmin) { 'Cert:\LocalMachine\Root' } else { 'Cert:\CurrentUser\Root' }

# remove older OpenRCX certificates so only the current one is trusted
Get-ChildItem $store | Where-Object { $_.Subject -eq $cert.Subject -and $_.Thumbprint -ne $cert.Thumbprint } | ForEach-Object {
    Write-Host "Removing old certificate $($_.Thumbprint)"
    Remove-Item -Path (Join-Path $store $_.Thumbprint)
}

if (Get-ChildItem $store | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }) {
    Write-Host "Already trusted in $store"
} else {
    Import-Certificate -FilePath $CertPath -CertStoreLocation $store | Out-Null
    Write-Host "Trusted in $store"
}
Write-Host 'Restart Edge/Chrome, then open https://openrcx.vp'
