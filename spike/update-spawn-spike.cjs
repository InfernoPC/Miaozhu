// End-to-end check of the in-app updater on Windows: run the app's own installCommand +
// launchInstaller (bundled from src/main/updates/updater.ts), quit right away like the app
// does, then see whether Miaozhu got installed.
const { app } = require('electron')
const { launchInstaller } = require('./updater.cjs')

app.whenReady().then(() => {
  process.env.MIAOZHU_NO_LAUNCH = '1'
  launchInstaller('win32', 'C:\\\\unused\\\\Miaozhu.exe')
  console.log('installer launched; quitting')
  setTimeout(() => app.quit(), 500)
})
