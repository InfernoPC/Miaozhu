// End-to-end check of the in-app updater on Windows: run the app's own installCommand +
// launchInstaller (bundled from src/main/updates/updater.ts), quit right away like the app
// does, then see whether Miaozhu got installed.
const { app } = require('electron')
const { launchInstaller } = require('./updater.cjs')

app.whenReady().then(() => {
  process.env.MIAOZHU_NO_LAUNCH = '1'
  // install.ps1 from this branch (it writes a log); the installer itself from the latest release.
  launchInstaller('win32', 'C:\\unused\\Miaozhu.exe', 'https://raw.githubusercontent.com/InfernoPC/Miaozhu/fix/windows-update/scripts')
  console.log('installer launched; quitting')
  setTimeout(() => app.quit(), 500)
})
