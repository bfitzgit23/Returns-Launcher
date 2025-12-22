const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

// File selection (for finding SWGEmu.exe)
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Select SWGEmu.exe',
        filters: [
            { name: 'Executable Files', extensions: ['exe'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Launch game - FIXED FOR SWGEmu.exe
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
            console.log(`Launching game: ${exePath}`);
            
            // Get the directory of the executable
            const exeDir = path.dirname(exePath);
            const exeName = path.basename(exePath);
            
            // Use spawn instead of exec for better control
            const { spawn } = require('child_process');
            
            // Launch the executable
            const gameProcess = spawn(exePath, [], {
                detached: true,
                stdio: 'ignore',
                cwd: exeDir,
                shell: false
            });

            // Unreference the process so it can run independently
            gameProcess.unref();
            
            console.log(`Game launched with PID: ${gameProcess.pid}`);
            
            // Check if process started successfully
            if (gameProcess.pid) {
                resolve({ 
                    success: true, 
                    pid: gameProcess.pid,
                    message: `${exeName} launched successfully`
                });
            } else {
                reject(new Error('Failed to launch process'));
            }
            
        } catch (error) {
            console.error('Launch error:', error);
            reject(new Error(`Failed to launch game: ${error.message}`));
        }
    });
});

// Settings management
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

ipcMain.handle('save-settings', (event, settings) => {
    try {
        const settingsPath = getSettingsPath();
        const existingSettings = fs.existsSync(settingsPath) 
            ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
            : {};
        
        const mergedSettings = { ...existingSettings, ...settings };
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
        console.log('Settings saved:', mergedSettings);
        return { success: true };
    } catch (error) {
        console.error('Error saving settings:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-settings', () => {
    const settingsPath = getSettingsPath();
    
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return settings;
        } catch (error) {
            console.error('Error reading settings:', error);
            return {};
        }
    }
    return {};
});

ipcMain.handle('save-install-dir', (event, dir) => {
    const settingsPath = getSettingsPath();
    const settings = fs.existsSync(settingsPath) 
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        : {};
    
    settings.installDir = dir;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`Saved install directory: ${dir}`);
});

ipcMain.handle('get-install-dir', () => {
    const settingsPath = getSettingsPath();
    
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return settings.installDir || null;
        } catch (error) {
            console.error('Error reading install directory:', error);
            return null;
        }
    }
    return null;
});

ipcMain.handle('save-scan-mode', (event, mode) => {
    const settingsPath = getSettingsPath();
    const settings = fs.existsSync(settingsPath) 
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        : {};
    
    settings.scanMode = mode;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`Saved scan mode: ${mode}`);
});

ipcMain.handle('get-scan-mode', () => {
    const settingsPath = getSettingsPath();
    
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return settings.scanMode || 'quick';
        } catch (error) {
            console.error('Error reading scan mode:', error);
            return 'quick';
        }
    }
    return 'quick';
});

// Clear cache
ipcMain.handle('clear-cache', async () => {
    try {
        // Clear various cache directories
        const cachePaths = [
            path.join(app.getPath('userData'), 'Cache'),
            path.join(app.getPath('userData'), 'cache'),
            path.join(app.getPath('userData'), 'GPUCache')
        ];
        
        let cleared = false;
        for (const cachePath of cachePaths) {
            if (fs.existsSync(cachePath)) {
                fs.rmSync(cachePath, { recursive: true, force: true });
                cleared = true;
                console.log(`Cleared cache: ${cachePath}`);
            }
        }
        
        if (cleared) {
            return { success: true, message: 'Cache cleared successfully' };
        } else {
            return { success: true, message: 'Cache was already empty' };
        }
    } catch (error) {
        console.error('Error clearing cache:', error);
        return { success: false, error: `Failed to clear cache: ${error.message}` };
    }
});

// Open logs
ipcMain.handle('open-logs', async () => {
    const logPath = path.join(app.getPath('userData'), 'logs');
    try {
        // Create logs directory if it doesn't exist
        if (!fs.existsSync(logPath)) {
            fs.mkdirSync(logPath, { recursive: true });
        }
        
        // Create a log file if none exists
        const logFile = path.join(logPath, 'launcher.log');
        if (!fs.existsSync(logFile)) {
            const initialLog = `SWG Epic Launcher Log\nCreated: ${new Date().toISOString()}\n\n`;
            fs.writeFileSync(logFile, initialLog);
        }
        
        // Open the log file
        shell.openPath(logFile);
        return { success: true, message: 'Logs opened' };
    } catch (error) {
        console.error('Error opening logs:', error);
        return { success: false, error: `Failed to open logs: ${error.message}` };
    }
});

// Send scan progress
function sendScanProgress(current, total) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-progress', {
            current: current,
            total: total,
            percentage: total > 0 ? (current / total) * 100 : 0
        });
    }
}

// App lifecycle
app.whenReady().then(() => {
    createWindow();
    
    // Create logs directory on startup
    const logPath = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logPath)) {
        fs.mkdirSync(logPath, { recursive: true });
    }
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
    
    // Log error to file
    try {
        const logPath = path.join(app.getPath('userData'), 'logs', 'error.log');
        const timestamp = new Date().toISOString();
        const errorMessage = `${timestamp} - Uncaught Exception: ${error.stack || error.message}\n`;
        fs.appendFileSync(logPath, errorMessage);
    } catch (logError) {
        console.error('Failed to write error log:', logError);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    // Log error to file
    try {
        const logPath = path.join(app.getPath('userData'), 'logs', 'error.log');
        const timestamp = new Date().toISOString();
        const errorMessage = `${timestamp} - Unhandled Rejection: ${reason}\n`;
        fs.appendFileSync(logPath, errorMessage);
    } catch (logError) {
        console.error('Failed to write error log:', logError);
    }
});
