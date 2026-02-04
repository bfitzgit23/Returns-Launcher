const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

// ---- DPI / scaling hard-fix (must be set BEFORE app ready) ----
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

let mainWindow;

// Keep ONE source of truth for your patch base
const BASE_URL = 'http://144.217.255.58/tre/';

function createWindow() {
  mainWindow = new BrowserWindow({
    // Designed for 1920x1080 background/UI
    width: 1920,
    height: 1080,
    useContentSize: true,

    frame: false,
    transparent: true,
    resizable: false,

    backgroundColor: '#00000000',
    hasShadow: false,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile('index.html');

  // ---- Hard lock zoom to 100% and block zoom shortcuts ----
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      await mainWindow.webContents.setZoomFactor(1);
      await mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    } catch (_) {}
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Block ctrl zoom and also trackpad pinch (ctrl+wheel)
    if (input.control && (input.key === '+' || input.key === '-' || input.key === '=' || input.key === '0')) {
      event.preventDefault();
    }
  });

  // Optional: center the window
  mainWindow.center();

  // mainWindow.webContents.openDevTools();
}

// ------------------------------
// Load required files from server
// ------------------------------
ipcMain.handle('load-required-files', async () => {
  return new Promise((resolve, reject) => {
    const url = BASE_URL + 'required-files.json';
    console.log(`Loading files from: ${url}`);

    const req = http.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Server returned status code: ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => {
        try {
          const jsonData = JSON.parse(data);

          if (!Array.isArray(jsonData)) {
            throw new Error('File list is not an array');
          }

          const validData = jsonData.filter((item) => {
            return (
              item &&
              item.name &&
              typeof item.name === 'string' &&
              item.name.trim() !== '' &&
              item.url &&
              item.md5 &&
              item.size > 0
            );
          });

          console.log(`Loaded ${validData.length} valid files from server`);
          resolve(validData);
        } catch (error) {
          console.error('JSON parse error:', error);
          reject(new Error('Failed to parse JSON: ' + error.message));
        }
      });
    });

    req.on('error', (error) => {
      console.error('HTTP request error:', error);
      reject(new Error('Failed to fetch files list: ' + error.message));
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout after 15 seconds'));
    });
  });
});

// --------------
// Check MD5
// --------------
ipcMain.handle('check-md5', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    if (!filePath || typeof filePath !== 'string') {
      reject(new Error('Invalid file path'));
      return;
    }

    if (!fs.existsSync(filePath)) {
      reject(new Error('File does not exist: ' + filePath));
      return;
    }

    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
});

// ------------------------------
// Download file with progress
// ------------------------------
ipcMain.handle('download-file', async (event, { url, destination, expectedMd5, size }) => {
  return new Promise((resolve, reject) => {
    if (!url || !destination) {
      reject(new Error('URL and destination are required'));
      return;
    }

    const dir = path.dirname(destination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(destination);
    let downloadedBytes = 0;
    const startTime = Date.now();

    console.log(`Downloading: ${url} to ${destination}`);

    const req = http.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        http.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
        });
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'], 10) || size || 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-progress', {
            downloaded: downloadedBytes,
            total: totalBytes,
            percent: percent,
            delta: chunk.length
          });
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        const elapsedTime = (Date.now() - startTime) / 1000;
        consol
