const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

let mainWindow;

const BASE_URL = 'http://15.204.254.253/tre/carbonite/';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('load-required-files', async () => {
    return new Promise((resolve, reject) => {
        http.get(BASE_URL + 'required-files.json', res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
});

ipcMain.handle('check-sha256', async (_, filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(filePath)
            .on('data', d => hash.update(d))
            .on('end', () => resolve(hash.digest('hex')))
            .on('error', reject);
    });
});

ipcMain.handle('download-file', async (event, { url, destination, size }) => {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });

    let start = 0;
    if (fs.existsSync(destination)) {
        start = fs.statSync(destination).size;
    }

    return new Promise((resolve, reject) => {
        const options = {
            headers: start > 0 ? { Range: `bytes=${start}-` } : {}
        };

        const file = fs.createWriteStream(destination, { flags: start > 0 ? 'a' : 'w' });
        let downloaded = start;

        http.get(url, options, res => {
            if (![200, 206].includes(res.statusCode)) {
                reject(`HTTP ${res.statusCode}`);
                return;
            }

            res.on('data', chunk => {
                downloaded += chunk.length;
                file.write(chunk);

                event.sender.send('file-progress', {
                    downloaded,
                    total: size
                });
            });

            res.on('end', () => {
                file.close(resolve);
            });

        }).on('error', reject);
    });
});

ipcMain.handle('save-install-dir', (_, dir) => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'installDir.txt'), dir);
});

ipcMain.handle('get-install-dir', () => {
    const p = path.join(app.getPath('userData'), 'installDir.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
});

ipcMain.handle('save-scan-mode', (_, mode) => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'scanMode.txt'), mode);
});

ipcMain.handle('get-scan-mode', () => {
    const p = path.join(app.getPath('userData'), 'scanMode.txt');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'quick';
});

ipcMain.handle('launch-game', (_, exePath) => {
    require('child_process').spawn(exePath, { detached: true });
});
