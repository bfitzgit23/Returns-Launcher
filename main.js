// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

let mainWindow;
let settings;

const VALID_EXE_NAME = 'SWGEmu.exe';
// SHA-256 for SWGEmu.exe from your manifest:
const VALID_EXE_SHA256 = '58012e57cebc499454812ba7ed96b1289db01e520963b4fc364edb41c322b2a8';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: true
  });

  mainWindow.loadFile('index.html');
}

/* ----------------------------- Utilities ----------------------------- */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/* ----------------------------- IPC: Files ----------------------------- */

// Load the required files list from a remote server
ipcMain.handle('load-required-files', async () => {
  const url = 'http://15.204.254.253/tre/required-files.json';
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (error) {
          reject(new Error('Failed to parse JSON data'));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Failed to fetch required files list: ${error.message}`));
    });
  });
});

// Check SHA-256 of a file
ipcMain.handle('check-sha256', async (event, filePath) => {
  try {
    const digest = await sha256File(filePath);
    return digest;
  } catch (e) {
    return null;
  }
});

// Preserve player profiles when downloading .tre files
async function preservePlayerProfiles(directory) {
  const profilesPath = path.join(directory, 'profiles');
  const backupPath = path.join(directory, 'profiles_backup');

  try {
    if (await fs.pathExists(profilesPath)) {
      // If backup exists, restore it first (your original intent)
      if (await fs.pathExists(backupPath)) {
        await fs.remove(profilesPath);
        await fs.move(backupPath, profilesPath);
      }
    }
  } catch (error) {
    console.error('Error preserving player profiles:', error);
  }
}

// Download + verify SHA-256
ipcMain.handle('download-file', async (event, { url, destination, expectedSha256 }) => {
  return new Promise(async (resolve, reject) => {
    try {
      const isTreFile = destination.toLowerCase().endsWith('.tre');
      const gameDir = path.dirname(destination);
      if (isTreFile) {
        await preservePlayerProfiles(gameDir);
      }

      await fs.mkdirp(path.dirname(destination));

      const downloadWithRedirects = (currentUrl, redirectCount = 0) => {
        const maxRedirects = 5;
        if (redirectCount > maxRedirects) {
          reject(new Error('Too many redirects'));
          return;
        }

        const protocol = currentUrl.startsWith('https') ? https : http;
        const req = protocol.get(currentUrl, (response) => {
          // Follow redirects
          if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
            const loc = response.headers.location;
            if (!loc) {
              reject(new Error('Redirect with no Location header'));
              return;
            }
            downloadWithRedirects(loc, redirectCount + 1);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Server returned status code: ${response.statusCode}`));
            return;
          }

          const file = fs.createWriteStream(destination);
          let downloadedBytes = 0;
          const startTime = Date.now();

          const totalBytes = parseInt(response.headers['content-length'] || '0', 10);

          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;

            let percent = 0;
            if (totalBytes > 0) {
              percent = (downloadedBytes / totalBytes) * 100;
            }
            const elapsedSeconds = Math.max(0.001, (Date.now() - startTime) / 1000);
            const speed = downloadedBytes / elapsedSeconds;

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download-progress', {
                percent,
                speed
              });
            }
          });

          response.pipe(file);

          file.on('finish', async () => {
            try {
              await new Promise(res => file.close(res));
              // Verify SHA-256
              const downloadedSha = await sha256File(destination);
              if (expectedSha256 && downloadedSha.toLowerCase() !== expectedSha256.toLowerCase()) {
                const result = await dialog.showMessageBox({
                  type: 'warning',
                  title: 'SHA-256 Mismatch',
                  message: `SHA-256 mismatch detected for ${path.basename(destination)}`,
                  detail: `Expected: ${expectedSha256}\nReceived: ${downloadedSha}\n\nDo you want to keep this file anyway?`,
                  buttons: ['Keep File', 'Delete and Retry'],
                  defaultId: 1,
                  cancelId: 1
                });

                if (result.response === 0) {
                  resolve('kept-with-mismatch');
                } else {
                  await fs.remove(destination);
                  reject(new Error(`SHA256_MISMATCH:${path.basename(destination)}`));
                }
              } else {
                resolve('success');
              }
            } catch (verifyErr) {
              reject(verifyErr);
            }
          });

          file.on('error', async (err) => {
            try { await fs.remove(destination); } catch {}
            reject(err);
          });
        });

        req.on('error', async (err) => {
          try { await fs.remove(destination); } catch {}
          reject(err);
        });
      };

      downloadWithRedirects(url);
    } catch (outerErr) {
      reject(outerErr);
    }
  });
});

/* ----------------------------- IPC: Launching ----------------------------- */

// User picks a directory
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Launch SWGEmu.exe with SHA-256 verification
ipcMain.handle('launch-game', async (event, exePath) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Verify filename
      const basename = path.basename(exePath);
      if (basename !== VALID_EXE_NAME) {
        throw new Error('Invalid executable name detected');
      }

      // Verify SHA-256
      const fileSha = await sha256File(exePath);
      if (fileSha.toLowerCase() !== VALID_EXE_SHA256.toLowerCase()) {
        throw new Error('Executable file hash (SHA-256) verification failed');
      }

      // Launch
      const workingDir = path.dirname(exePath);
      const child = spawn(exePath, [], {
        cwd: workingDir,
        detached: true,
        stdio: 'ignore'
      });

      child.unref();
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

/* ----------------------------- IPC: Config & Settings ----------------------------- */

ipcMain.handle('update-config', async (event, { directory, content }) => {
  const configPath = path.join(directory, 'swgemu_login.cfg');
  try {
    await fs.writeFile(configPath, content, 'utf8');
    return true;
  } catch (error) {
    throw error;
  }
});

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

app.whenReady().then(() => {
  loadSettings();
  createWindow();
});

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
