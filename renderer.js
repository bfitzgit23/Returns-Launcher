const { ipcRenderer } = require('electron');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'http://15.204.254.253/tre/carbonite/';

let selectedDirectory = null;

function updateProgress(fileIndex, totalFiles) {
    const percent = totalFiles > 0 ? (fileIndex / totalFiles) * 100 : 0;
    document.getElementById('total-progress').style.width = `${percent}%`;
    document.getElementById('total-status').textContent = `${fileIndex}/${totalFiles} files`;
}

function formatSpeed(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond)) return '';
    if (bytesPerSecond > 1024 * 1024) return `${(bytesPerSecond / 1048576).toFixed(2)} MB/s`;
    if (bytesPerSecond > 1024) return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
    return `${bytesPerSecond.toFixed(2)} B/s`;
}

async function selectInstallLocation() {
    const dir = await ipcRenderer.invoke('select-directory');
    if (!dir) return;

    selectedDirectory = dir;
    await ipcRenderer.invoke('save-install-dir', dir);
    await updateConfig();
    await checkFiles();
}

async function checkFiles() {
    const files = await ipcRenderer.invoke('load-required-files');
    let completed = 0;

    for (const file of files) {
        const dest = path.join(selectedDirectory, file.path);
        try {
            const stat = await fs.stat(dest);
            if (stat.size !== file.size) throw 'size';
            const hash = await ipcRenderer.invoke('check-sha256', dest);
            if (hash !== file.sha256) throw 'hash';
        } catch {
            await downloadFile(file, dest);
        }
        completed++;
        updateProgress(completed, files.length);
    }
}

async function downloadFile(fileInfo, destination) {
    const url = BASE_URL + fileInfo.path.replace(/\\/g, '/');
    await ipcRenderer.invoke('download-file', {
        url,
        destination,
        expectedSha256: fileInfo.sha256
    });
}

async function launchGame() {
    const exe = path.join(selectedDirectory, 'SWGEmu.exe');
    await ipcRenderer.invoke('launch-game', exe);
}

async function launchSettings() {
    const exe = path.join(selectedDirectory, 'SWGEmu_Setup.exe');
    await ipcRenderer.invoke('launch-admin', exe);
}

async function updateConfig() {
    const cfg = `[ClientGame]
loginServerAddress0=15.204.254.253
loginServerPort0=44453`;
    await ipcRenderer.invoke('update-config', { directory: selectedDirectory, content: cfg });
}

window.selectInstallLocation = selectInstallLocation;
window.launchGame = launchGame;
window.launchSettings = launchSettings;
