# Install or update Miaozhu on Windows (per user, no admin rights):
#   irm https://raw.githubusercontent.com/InfernoPC/Miaozhu/main/scripts/install.ps1 | iex
#
# Kept ASCII-only on purpose: Windows PowerShell 5.1 can mis-decode non-ASCII text in scripts
# piped from the web. Files downloaded by PowerShell don't get the Mark of the Web, so the
# unsigned installer doesn't trigger a SmartScreen prompt.
#
# Environment overrides: MIAOZHU_BASE_URL, MIAOZHU_NO_LAUNCH=1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest very slow

$repo = 'InfernoPC/Miaozhu'
$base = if ($env:MIAOZHU_BASE_URL) { $env:MIAOZHU_BASE_URL } else { "https://github.com/$repo/releases/latest/download" }
$file = 'Miaozhu-win-x64-setup.exe'
$setup = Join-Path $env:TEMP $file

Write-Host "Downloading Miaozhu..."
Invoke-WebRequest "$base/$file" -OutFile $setup -UseBasicParsing

try {
  $sums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
  if ($sums -is [byte[]]) { $sums = [System.Text.Encoding]::UTF8.GetString($sums) }
  $line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($file) + '\s*$' } | Select-Object -First 1
  if ($line) {
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { throw "Checksum mismatch; the download may be incomplete. Please try again." }
  }
} catch [System.Net.WebException] {
  # No checksum file published: skip verification.
}

Get-Process Miaozhu -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

Write-Host "Installing..."
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Remove-Item $setup -ErrorAction SilentlyContinue

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Miaozhu\Miaozhu.exe'
if (-not (Test-Path $exe)) { throw "Installed, but Miaozhu.exe was not found at $exe" }
Write-Host "Miaozhu is installed: $exe"
if ($env:MIAOZHU_NO_LAUNCH -ne '1') { Start-Process $exe }
