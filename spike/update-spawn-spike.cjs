// Repro for "in-app update does nothing on Windows": start a detached child the way the app
// does, quit right away, and see which variants survive and finish their work.
const { app } = require('electron')
const { spawn } = require('child_process')
const os = require('os')
const path = require('path')

const variant = process.env.VARIANT
const marker = path.join(os.tmpdir(), `marker-${variant}.txt`)
// Like install.ps1: console output, a download with progress, then a file written at the end.
const ps = `$ProgressPreference='SilentlyContinue'; Write-Host 'starting'; Start-Sleep 3; Invoke-WebRequest https://github.com/InfernoPC/Miaozhu/releases/latest/download/latest.json -UseBasicParsing -OutFile $env:TEMP\\latest-${variant}.json; Write-Host 'done'; 'ok' | Out-File '${marker}'`

app.whenReady().then(() => {
  let child
  if (variant === 'current') {
    // Exactly what launchInstaller does today.
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true })
  } else if (variant === 'hidden-window') {
    // A real (hidden) console instead of none.
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: false })
  } else if (variant === 'cmd-start') {
    child = spawn('cmd.exe', ['/d', '/c', 'start', '""', '/min', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true })
  }
  child.unref()
  console.log(`spawned ${variant} pid=${child.pid}`)
  setTimeout(() => app.quit(), 500)
})
