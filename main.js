const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

let mainWindow;

const BASE_URL = 'http://15.204.254.253/tre/carbonite/';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false,
        transparent: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: false
        },
        backgroundColor: '#00000000',
        hasShadow: false
    });

    mainWindow.loadFile('index.html');
    
    // Open DevTools for debugging (remove in production)
    // mainWindow.webContents.openDevTools();
}

// Load required files from server
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
            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    
                    // Validate and filter data
                    if (!Array.isArray(jsonData)) {
                        throw new Error('File list is not an array');
                    }
                    
                    const validData = jsonData.filter(item => {
                        return item && 
                               item.name && 
                               typeof item.name === 'string' && 
                               item.name.trim() !== '' &&
                               item.url &&
                               item.md5 &&
                               item.size > 0;
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

// Check MD5 of a file
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

// Download file with progress
ipcMain.handle('download-file', async (event, { url, destination, expectedMd5, size }) => {
    return new Promise((resolve, reject) => {
        if (!url || !destination) {
            reject(new Error('URL and destination are required'));
            return;
        }

        // Ensure destination directory exists
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
                
                // Send progress to renderer
                mainWindow.webContents.send('file-progress', {
                    downloaded: downloadedBytes,
                    total: totalBytes,
                    percent: percent,
                    delta: chunk.length
                });
            });

            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                const elapsedTime = (Date.now() - startTime) / 1000;
                console.log(`Download completed in ${elapsedTime.toFixed(2)}s: ${destination}`);
                
                // Verify MD5 if expectedMd5 is provided
                if (expectedMd5) {
                    const hash = crypto.createHash('md5');
                    const readStream = fs.createReadStream(destination);
                    
                    readStream.on('data', (data) => hash.update(data));
                    readStream.on('end', () => {
                        const downloadedMd5 = hash.digest('hex');
                        
                        if (downloadedMd5 !== expectedMd5) {
                            fs.unlinkSync(destination);
                            reject(new Error(`MD5 mismatch: expected ${expectedMd5}, got ${downloadedMd5}`));
                        } else {
                            resolve({ path: destination, md5: downloadedMd5 });
                        }
                    });
                    readStream.on('error', reject);
                } else {
                    resolve({ path: destination });
                }
            });
        });

        req.on('error', (error) => {
            console.error(`Download error for ${url}:`, error);
            if (fs.existsSync(destination)) {
                fs.unlink(destination, () => {});
            }
            reject(error);
        });
        
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Download timeout after 30 seconds'));
        });
    });
});

// Directory selection
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select SWG Installation Directory'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Launch game
ipcMain.handle('launch-game', async (event, exePath) => {
    return new Promise((resolve, reject) => {
        if (!exePath || typeof exePath !== 'string') {
            reject(new Error('Invalid executable path'));
            return;
        }
        
        if (!fs.existsSync(exePath)) {
            reject(new Error('Executable not found: ' + exePath));
            return;
        }

        try {
            const process = require('child_process').spawn(exePath, [], {
                detached: true,
                stdio: 'ignore'
            });

            process.unref();
            resolve();
        } catch (error) {
            reject(error);
        }
    });
});

// Settings management
ipcMain.handle('save-install-dir', (event, dir) => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const settings = fs.existsSync(settingsPath) 
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        : {};
    
    settings.installDir = dir;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    console.log(`Saved install directory: ${dir}`);
});

ipcMain.handle('get-install-dir', () => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    
    if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return settings.installDir || null;
    }
    return null;
});

ipcMain.handle('save-scan-mode', (event, mode) => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const settings = fs.existsSync(settingsPath) 
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        : {};
    
    settings.scanMode = mode;
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    console.log(`Saved scan mode: ${mode}`);
});

ipcMain.handle('get-scan-mode', () => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    
    if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return settings.scanMode || 'quick';
    }
    return 'quick';
});

// App lifecycle
app.whenReady().then(() => {
    createWindow();
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

// Handle errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
