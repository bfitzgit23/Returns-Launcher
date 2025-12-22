const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

let mainWindow;

const BASE_URL = 'http://15.204.254.253/tre/carbonite/';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('download-file', async (event, { url, destination, expectedSha256 }) => {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destination);
        const hash = crypto.createHash('sha256');

        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, response => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            response.on('data', chunk => hash.update(chunk));
            response.pipe(file);

            file.on('finish', () => {
                file.close(async () => {
                    const actualHash = hash.digest('hex');
                    if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
                        resolve('kept-with-mismatch');
                    } else {
                        resolve('ok');
                    }
                });
            });
        }).on('error', err => {
            fs.unlink(destination, () => {});
            reject(err);
        });
    });
});

ipcMain.handle('load-required-files', async () => {
    const manifestUrl = BASE_URL + 'required-files.json';

    return new Promise((resolve, reject) => {
        http.get(manifestUrl, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
});

ipcMain.handle('check-sha256', async (event, filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
});

ipcMain.handle('launch-game', async (event, exePath) => {
    require('child_process').spawn(exePath, {
        cwd: path.dirname(exePath),
        detached: true
    });
});

ipcMain.handle('launch-admin', async (event, exePath) => {
    require('child_process').spawn(exePath, {
        cwd: path.dirname(exePath),
        detached: true,
        shell: true
    });
});

ipcMain.handle('save-install-dir', async (event, dir) => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'installDir.txt'), dir);
});

ipcMain.handle('get-install-dir', async () => {
    const file = path.join(app.getPath('userData'), 'installDir.txt');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
});

ipcMain.handle('update-config', async (event, { directory, content }) => {
    const cfgPath = path.join(directory, 'client.cfg');
    fs.writeFileSync(cfgPath, content);
});
