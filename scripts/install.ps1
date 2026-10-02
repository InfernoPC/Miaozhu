# Install or update Miaozhu on Windows (per user, no admin rights):
#   irm https://github.com/InfernoPC/Miaozhu/releases/latest/download/install.ps1 | iex
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

# The installer records where it put the app; a one-click per-user install names the folder
# after the package name, not the product name, so don't guess from the product name alone.
$candidates = @()
$keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty $keys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like 'Miaozhu*' -and $_.InstallLocation } |
  ForEach-Object { $candidates += (Join-Path $_.InstallLocation 'Miaozhu.exe') }
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\desktop-agent\Miaozhu.exe')
$candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Miaozhu\Miaozhu.exe')
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { throw "Installed, but Miaozhu.exe was not found. Looked in: $($candidates -join ', ')" }
Write-Host "Miaozhu is installed: $exe"
if ($env:MIAOZHU_NO_LAUNCH -ne '1') { Start-Process $exe }
