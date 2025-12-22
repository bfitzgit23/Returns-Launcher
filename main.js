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
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('download-file', async (event, { url, destination, expectedSha256 }) => {
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
        const hash = crypto.createHash('sha256');

        http.get(url, options, res => {
            if (![200, 206].includes(res.statusCode)) {
                reject(`HTTP ${res.statusCode}`);
                return;
            }

            res.on('data', d => {
                hash.update(d);
                file.write(d);
            });

            res.on('end', () => {
                file.close(() => resolve('ok'));
            });
        }).on('error', err => reject(err));
    });
});

ipcMain.handle('check-sha256', async (_, filePath) => {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(filePath)
            .on('data', d => h.update(d))
            .on('end', () => resolve(h.digest('hex')))
            .on('error', reject);
    });
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

ipcMain.handle('launch-game', (_, exe) => {
    require('child_process').spawn(exe, { detached: true });
});

ipcMain.handle('save-install-dir', (_, dir) => {
    fs.writeFileSync(path.join(app.getPath('userData'), 'installDir.txt'), dir);
});

ipcMain.handle('get-install-dir', () => {
    const f = path.join(app.get('userData'), 'installDir.txt');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
});
