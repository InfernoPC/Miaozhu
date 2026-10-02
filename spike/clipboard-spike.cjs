// Feasibility spike (not app code): can Electron 44's clipboard API put a *file* on the
// clipboard, so an animated GIF pastes into LINE / Teams / Slack as a file that still moves?
// Each attempt writes one format, then the OS's own tool reads the clipboard back.
const { app, clipboard, ClipboardItem, nativeImage } = require('electron')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const GIF = Buffer.from('R0lGODlhAgACAPAAAP8AAAAAACH5BAAKAAAALAAAAAACAAIAAAIChFEAOw==', 'base64') // 2x2 red GIF
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-spike-'))
const file = path.join(dir, '測試 貼圖.gif')
fs.writeFileSync(file, GIF)
const fileUrl = require('url').pathToFileURL(file).href
const raw = (name) => `electron application/osclipboard;format="${name}"`

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000 }).trim()
  } catch (e) {
    return `ERR ${(e.stderr || e.message).toString().trim().split('\n').pop()}`
  }
}

/** What the OS sees on the clipboard: its file list, if any. */
function osFiles() {
  if (process.platform === 'darwin') return sh('osascript', ['-e', 'try', '-e', 'POSIX path of (the clipboard as «class furl»)', '-e', 'on error e', '-e', 'return "none: " & e', '-e', 'end try'])
  return sh('powershell', ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $f = [Windows.Forms.Clipboard]::GetFileDropList(); if ($f.Count) { $f -join "|" } else { "none" }'])
}
function osTypes() {
  if (process.platform === 'darwin') return sh('osascript', ['-e', 'clipboard info'])
  return sh('powershell', ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::GetDataObject().GetFormats() -join ","'])
}

/** DROPFILES header + UTF-16 paths: the CF_HDROP payload Explorer puts on the clipboard. */
function dropFiles(paths) {
  const header = Buffer.alloc(20)
  header.writeUInt32LE(20, 0) // pFiles: list starts after the header
  header.writeUInt32LE(1, 16) // fWide: UTF-16
  return Buffer.concat([header, Buffer.from(paths.join('\0') + '\0\0', 'utf16le')])
}

const attempts = {
  darwin: {
    'public.file-url (string)': () => new ClipboardItem({ [raw('public.file-url')]: fileUrl }),
    'public.file-url (blob)': () => new ClipboardItem({ [raw('public.file-url')]: new Blob([fileUrl]) }),
    'NSFilenamesPboardType (plist)': () =>
      new ClipboardItem({
        [raw('NSFilenamesPboardType')]: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array><string>${file}</string></array></plist>`
      })
  },
  win32: {
    'CF_HDROP (blob)': () => new ClipboardItem({ [raw('CF_HDROP')]: new Blob([dropFiles([file])]) }),
    'FileNameW (blob)': () => new ClipboardItem({ [raw('FileNameW')]: new Blob([Buffer.from(file + '\0', 'utf16le')]) }),
    'FileDrop (blob)': () => new ClipboardItem({ [raw('FileDrop')]: new Blob([dropFiles([file])]) })
  }
}
// A real 2x2 PNG (nativeImage can't decode GIF, so it stands in for the first frame).
const PNG = nativeImage.createFromBitmap(Buffer.alloc(16, 0xff), { width: 2, height: 2 }).toPNG()
const common = {
  'text/uri-list': () => new ClipboardItem({ 'text/uri-list': fileUrl }),
  'image/png': () => new ClipboardItem({ 'image/png': new Blob([PNG], { type: 'image/png' }) }),
  'image/gif': () => new ClipboardItem({ 'image/gif': new Blob([GIF], { type: 'image/gif' }) }),
  // Best of both: apps that take files get the GIF, apps that only take images get a frame.
  'uri-list + image/png': () => new ClipboardItem({ 'text/uri-list': fileUrl, 'image/png': new Blob([PNG], { type: 'image/png' }) })
}

app.whenReady().then(async () => {
  const report = {
    platform: process.platform,
    electron: process.versions.electron,
    file,
    legacy: { writeBuffer: typeof clipboard.writeBuffer, writeImage: typeof clipboard.writeImage, readImage: typeof clipboard.readImage },
    results: {}
  }
  for (const [name, make] of Object.entries({ ...(attempts[process.platform] ?? {}), ...common })) {
    const r = {}
    try {
      await clipboard.clear()
      await clipboard.write([make()])
      r.written = true
    } catch (e) {
      r.written = false
      r.error = e.message
    }
    try {
      r.electronSees = (await clipboard.read()).flatMap((i) => i.types)
    } catch (e) {
      r.electronSees = `ERR ${e.message}`
    }
    r.osFiles = osFiles()
    r.osTypes = osTypes().slice(0, 300)
    report.results[name] = r
  }
  await clipboard.clear()
  console.log('SPIKE_REPORT ' + JSON.stringify(report, null, 2))
  app.quit()
})
