
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/splash.png'),
    show: false,
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
