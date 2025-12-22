const { ipcRenderer } = require('electron');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'http://15.204.254.253/tre/carbonite/';
let selectedDirectory = null;
let scanMode = 'quick'; // quick | full

function setScanMode(mode) {
    scanMode = mode;
}

async function selectInstallLocation() {
    selectedDirectory = await ipcRenderer.invoke('select-directory');
    if (!selectedDirectory) return;
    await ipcRenderer.invoke('save-install-dir', selectedDirectory);
    await checkFiles();
}

async function checkFiles() {
    const files = await ipcRenderer.invoke('load-required-files');
    let done = 0;

    for (const f of files) {
        const dest = path.join(selectedDirectory, f.path);

        let needsDownload = false;

        try {
            const stat = await fs.stat(dest);
            if (stat.size !== f.size) needsDownload = true;

            if (!needsDownload && scanMode === 'full') {
                const hash = await ipcRenderer.invoke('check-sha256', dest);
                if (hash !== f.sha256) needsDownload = true;
            }
        } catch {
            needsDownload = true;
        }

        if (needsDownload) {
            await ipcRenderer.invoke('download-file', {
                url: BASE_URL + f.path.replace(/\\/g, '/'),
                destination: dest,
                expectedSha256: f.sha256
            });
        }

        done++;
        document.getElementById('total-status').textContent = `${done}/${files.length}`;
    }
}

async function launchGame() {
    await ipcRenderer.invoke('launch-game', path.join(selectedDirectory, 'SWGEmu.exe'));
}

window.selectInstallLocation = selectInstallLocation;
window.launchGame = launchGame;
window.setScanMode = setScanMode;
