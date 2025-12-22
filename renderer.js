// renderer.js
const { ipcRenderer } = require('electron');
const fs = require('fs').promises;
const path = require('path');

const BASE_URL = 'http://15.204.254.253/tre/carbonite';

let selectedDirectory = null;  // Store the selected directory

function updateProgress(fileIndex, totalFiles) {
    const percent = totalFiles > 0 ? (fileIndex / totalFiles) * 100 : 0;
    document.getElementById('total-progress').style.width = `${percent}%`;
    document.getElementById('total-status').textContent = `${fileIndex}/${totalFiles} files`;
}

function formatSpeed(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond)) return '';
    if (bytesPerSecond > 1024 * 1024) {
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
    } else if (bytesPerSecond > 1024) {
        return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
    }
    return `${bytesPerSecond.toFixed(2)} B/s`;
}

function updateDirectoryDisplay() {
    const dirElement = document.getElementById('current-directory');
    dirElement.textContent = selectedDirectory || 'Not selected';
}

function updateReadyStatus() {
    const statusElement = document.getElementById('status');
    if (!selectedDirectory) {
        statusElement.textContent = 'Please select installation directory';
        return false;
    }
    statusElement.textContent = 'Ready to launch';
    return true;
}

// Attach one-time listeners and try to restore directory
document.addEventListener('DOMContentLoaded', async () => {
    // One-time progress listener (don’t attach this inside downloadFile)
    ipcRenderer.on('download-progress', (event, { percent, speed }) => {
        const progressBar = document.getElementById('file-progress');
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
        progressBar.style.width = `${clamped}%`;
        progressBar.classList.add('active');
        document.getElementById('download-speed').textContent = formatSpeed(speed);
    });

    await loadSavedDirectory();
    updateReadyStatus();
    updateDirectoryDisplay();
});

async function selectInstallLocation() {
    try {
        const result = await ipcRenderer.invoke('select-directory');
        if (result) {
            selectedDirectory = result;
            await ipcRenderer.invoke('save-install-dir', result);
            updateReadyStatus();
            updateDirectoryDisplay();
            await updateConfig(); // Automatically update config when directory is selected
            await checkFiles(); // Automatically check and download files
        }
    } catch (error) {
        document.getElementById('status').textContent = `Error selecting directory: ${error.message}`;
    }
}

async function loadSavedDirectory() {
    try {
        const savedDir = await ipcRenderer.invoke('get-install-dir');
        if (savedDir && await fs.access(savedDir).then(() => true).catch(() => false)) {
            selectedDirectory = savedDir;
            updateReadyStatus();
            updateDirectoryDisplay();
        }
    } catch (error) {
        console.error('Error loading saved directory:', error);
    }
}

async function checkFiles() {
    if (!selectedDirectory) {
        document.getElementById('status').textContent = 'Please select an installation directory first';
        return;
    }

    try {
        document.getElementById('status').textContent = 'Checking files...';
        document.getElementById('file-progress').style.width = '0%';
        document.getElementById('total-progress').style.width = '0%';

        /** Manifest is an array of { path, size, sha256 } */
        const requiredFiles = await ipcRenderer.invoke('load-required-files');
        const safeFiles = Array.isArray(requiredFiles)
            ? requiredFiles.filter(f =>
                f && typeof f.path === 'string' &&
                typeof f.size === 'number' &&
                typeof f.sha256 === 'string' && f.sha256.length === 64
              )
            : [];

        let completedFiles = 0;
        document.getElementById('total-status').textContent = `0/${safeFiles.length} files`;

        for (const fileInfo of safeFiles) {
            const filePath = path.join(selectedDirectory, fileInfo.path);

            try {
                const stats = await fs.stat(filePath);
                if (stats.size !== fileInfo.size) {
                    await downloadFile(fileInfo, filePath);
                } else {
                    const fileSha256 = await ipcRenderer.invoke('check-sha256', filePath);
                    if (!fileSha256 || fileSha256.toLowerCase() !== fileInfo.sha256.toLowerCase()) {
                        await downloadFile(fileInfo, filePath);
                    }
                }
            } catch {
                // stat failed -> file missing -> download
                await downloadFile(fileInfo, filePath);
            }

            completedFiles++;
            updateProgress(completedFiles, safeFiles.length);
        }

        document.getElementById('status').textContent = 'All files are up to date!';
        document.getElementById('download-speed').textContent = '';
    } catch (error) {
        document.getElementById('status').textContent = `Error: ${error.message}`;
    }
}

async function downloadFile(fileInfo, destination) {
    const fileName = fileInfo.path;
    const fileUrl = BASE_URL + encodeURIComponent(fileName);

    document.getElementById('status').textContent = `Downloading ${fileName}...`;
    document.getElementById('file-progress').style.width = '0%';

    const result = await ipcRenderer.invoke('download-file', {
        url: fileUrl,
        destination: destination,
        expectedSha256: fileInfo.sha256,
    });

    if (result === 'kept-with-mismatch') {
        document.getElementById('status').textContent = `Kept ${fileName} despite SHA-256 mismatch`;
    }
}

async function launchGame() {
    if (!selectedDirectory) {
        document.getElementById('status').textContent = 'Please select an installation directory first';
        return;
    }

    try {
        const exePath = path.join(selectedDirectory, 'SWGEmu.exe');
        document.getElementById('status').textContent = 'Launching game...';
        await ipcRenderer.invoke('launch-game', exePath);
        document.getElementById('status').textContent = 'Game launched!';
    } catch (error) {
        document.getElementById('status').textContent = `Error launching game: ${error}`;
    }
}

async function launchSettings() {
    if (!selectedDirectory) {
        document.getElementById('status').textContent = 'Please select an installation directory first';
        return;
    }

    try {
        const setupPath = path.join(selectedDirectory, 'SWGEmu_Setup.exe');
        document.getElementById('status').textContent = 'Launching settings...';
        await ipcRenderer.invoke('launch-admin', setupPath);
        document.getElementById('status').textContent = 'Settings launched!';
    } catch (error) {
        document.getElementById('status').textContent = `Error launching settings: ${error.message}`;
    }
}

async function updateConfig() {
    if (!selectedDirectory) {
        document.getElementById('status').textContent = 'Please select an installation directory first';
        return;
    }

    try {
        const config = `[ClientGame]\nloginServerAddress0=144.217.255.58\nloginServerPort0=44453`;
        await ipcRenderer.invoke('update-config', {
            directory: selectedDirectory,
            content: config
        });
        document.getElementById('status').textContent = 'Server configuration updated successfully!';
    } catch (error) {
        document.getElementById('status').textContent = `Error updating config: ${error.message}`;
    }
}

function removeActiveProgress() {
    document.getElementById('file-progress').classList.remove('active');
}

function toggleConfig() {
    const configPanel = document.getElementById('config-panel');
    if (!configPanel) {
        console.error('Config panel element not found');
        return;
    }
    configPanel.classList.toggle('visible');

    // Ensure input fields are enabled when panel is visible
    const ipInput = document.getElementById('serverIp');
    const portInput = document.getElementById('serverPort');
    if (configPanel.classList.contains('visible')) {
        if (ipInput) ipInput.removeAttribute('disabled');
        if (portInput) portInput.removeAttribute('disabled');
    }
}

// Expose functions if needed by your HTML
window.selectInstallLocation = selectInstallLocation;
window.checkFiles = checkFiles;
window.launchGame = launchGame;
window.launchSettings = launchSettings;
window.toggleConfig = toggleConfig;
window.removeActiveProgress = removeActiveProgress;
