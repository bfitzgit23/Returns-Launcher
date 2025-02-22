const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater'); // Added electron-updater
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

let mainWindow;
let settings;

const VALID_EXE_NAME = 'SWGEmu.exe';
const VALID_EXE_MD5 = '47436739d9adf27a7aca283f0f1b3e86'; // Replace with actual MD5

// Auto-updater events
autoUpdater.on('update-available', () => {
  mainWindow.webContents.send('update_available');
});

autoUpdater.on('update-downloaded', () => {
  mainWindow.webContents.send('update_downloaded');
});

ipcMain.on('restart_app', () => {
  autoUpdater.quitAndInstall();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    frame: false,
    transparent: true,
    resizable: false,  // Disable window resizing
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#00000000',  // Fully transparent
    hasShadow: false,  // Disable default window shadow
    roundedCorners: true
  });

  mainWindow.loadFile('index.html');

  // Check for updates after the window is created
  autoUpdater.checkForUpdatesAndNotify();
}

// File system operations
ipcMain.handle('check-files', async (event, requiredFiles) => {
  const missingFiles = [];
  for (const file of requiredFiles) {
    const exists = await fs.pathExists(file);
    if (!exists) {
      missingFiles.push(file);
    }
  }
  return missingFiles;
});

// Load the required files list
ipcMain.handle('load-required-files', async () => {
  const data = fs.readFileSync(path.join(__dirname, 'server.json'), 'utf8');
  return JSON.parse(data);
});

// Check MD5 of a file
ipcMain.handle('check-md5', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
});

// Download a file
ipcMain.handle('download-file', async (event, { url, destination, expectedMd5, skipChecks }) => {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    function downloadWithRedirects(url) {
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          console.log(`Following redirect to: ${response.headers.location}`);
          downloadWithRedirects(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Server returned status code: ${response.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(destination);
        let downloadedBytes = 0;
        let startTime = Date.now();

        const totalBytes = parseInt(response.headers['content-length'], 10);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percent = (downloadedBytes / totalBytes) * 100;
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const speed = downloadedBytes / elapsedSeconds;

          mainWindow.webContents.send('download-progress', {
            percent: percent,
            speed: speed
          });
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();

          if (skipChecks) {
            resolve('success');
            return;
          }

          const hash = crypto.createHash('md5');
          const readStream = fs.createReadStream(destination);

          readStream.on('data', data => hash.update(data));
          readStream.on('end', async () => {
            const downloadedMd5 = hash.digest('hex');
            if (downloadedMd5 !== expectedMd5) {
              const response = await dialog.showMessageBox({
                type: 'warning',
                title: 'MD5 Mismatch',
                message: `MD5 mismatch detected for ${path.basename(destination)}`,
                detail: `Expected: ${expectedMd5}\nReceived: ${downloadedMd5}\n\nDo you want to keep this file anyway?`,
                buttons: ['Keep File', 'Delete and Retry'],
                defaultId: 1,
                cancelId: 1
              });

              if (response.response === 0) {
                resolve('kept-with-mismatch');
              } else {
                fs.unlinkSync(destination);
                reject(new Error(`MD5_MISMATCH:${path.basename(destination)}`));
              }
            } else {
              resolve('success');
            }
          });
          readStream.on('error', reject);
        });
      }).on('error', (err) => {
        fs.unlink(destination, () => {});
        reject(err);
      });
    }

    downloadWithRedirects(url);
  });
});

// Launch executable
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Regular launch for SWGEmu.exe
ipcMain.handle('launch-game', async (event, exePath) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Verify filename
      const basename = path.basename(exePath);
      if (basename !== VALID_EXE_NAME) {
        throw new Error('Invalid executable name detected');
      }

      // Verify MD5 one final time
      const fileHash = await new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(exePath);

        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      });

      if (fileHash !== VALID_EXE_MD5) {
        throw new Error('Executable file hash verification failed');
      }

      // If verification passes, launch the game
      const workingDir = path.dirname(exePath);
      const process = spawn(exePath, [], {
        cwd: workingDir,
        detached: true,
        stdio: 'ignore'
      });

      process.unref();
      resolve();
    } catch (error) {
      reject(`Security check failed: ${error.message}`);
    }
  });
});

// Admin launch for SWGEmu_Setup.exe
ipcMain.handle('launch-admin', async (event, exePath) => {
  try {
    await shell.openPath(exePath);
    return true;
  } catch (error) {
    throw error;
  }
});

// Handle config file updates
ipcMain.handle('update-config', async (event, { directory, content }) => {
  const configPath = path.join(directory, 'swgemu_login.cfg');
  try {
    await fs.writeFile(configPath, content, 'utf8');
    return true;
  } catch (error) {
    throw error;
  }
});

// Add this function to handle settings
function loadSettings() {
  const userDataPath = app.getPath('userData');
  const settingsPath = path.join(userDataPath, 'settings.json');

  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } else {
      settings = { installDir: null };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    settings = { installDir: null };
  }
}

function saveSettings() {
  const userDataPath = app.getPath('userData');
  const settingsPath = path.join(userDataPath, 'settings.json');

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Load settings when app starts
app.whenReady().then(() => {
  loadSettings();
  createWindow();
});

// Add these IPC handlers
ipcMain.handle('get-install-dir', () => {
  return settings.installDir;
});

ipcMain.handle('save-install-dir', (event, dir) => {
  settings.installDir = dir;
  saveSettings();
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});