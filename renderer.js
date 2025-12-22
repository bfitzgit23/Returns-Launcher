// SWG Epic Launcher - Renderer Process
const { ipcRenderer } = require('electron');

// DOM Elements
const closeButton = document.getElementById('close-button');
const playButton = document.getElementById('play-button');
const quickScanButton = document.getElementById('quick-scan');
const fullScanButton = document.getElementById('full-scan');
const installLocationButton = document.getElementById('install-location');
const settingsButton = document.getElementById('settings-button');
const pauseButton = document.getElementById('pause-button');
const clearCacheButton = document.getElementById('clear-cache');
const viewLogsButton = document.getElementById('view-logs');
const donateButton = document.getElementById('donate-button');
const currentDirectoryElement = document.getElementById('current-directory');
const totalProgressBar = document.getElementById('total-progress');
const fileProgressBar = document.getElementById('file-progress');
const totalStatusElement = document.getElementById('total-status');
const statusElement = document.getElementById('status');
const downloadSpeedElement = document.getElementById('download-speed');

// Settings Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseButton = document.getElementById('settings-close');
const scanModeSelect = document.getElementById('scan-mode-select');
const autoLaunchCheckbox = document.getElementById('auto-launch-checkbox');
const autoUpdateCheckbox = document.getElementById('auto-update-checkbox');
const minimizeToTrayCheckbox = document.getElementById('minimize-to-tray-checkbox');
const timeoutInput = document.getElementById('timeout-input');
const saveSettingsButton = document.getElementById('save-settings');

// State
let isScanning = false;
let isPaused = false;
let installDir = null;
let downloadSpeed = 0;
let lastDownloadUpdate = Date.now();
let lastDownloadBytes = 0;

// Initialize
async function init() {
    // Load saved install directory
    installDir = await ipcRenderer.invoke('get-install-dir');
    if (installDir) {
        currentDirectoryElement.textContent = installDir;
        updateStatus(`Install directory: ${installDir}`);
    } else {
        currentDirectoryElement.textContent = 'No install directory set';
        updateStatus('Please set an install location');
    }
    
    // Load saved settings
    await loadSettings();
    
    updateStatus('Ready');
}

// Load settings from storage
async function loadSettings() {
    try {
        // Load scan mode
        const scanMode = await ipcRenderer.invoke('get-scan-mode');
        scanModeSelect.value = scanMode || 'quick';
        
        // Load other settings
        const settings = await ipcRenderer.invoke('get-settings');
        if (settings) {
            autoLaunchCheckbox.checked = settings.autoLaunch || false;
            autoUpdateCheckbox.checked = settings.autoUpdate || false;
            minimizeToTrayCheckbox.checked = settings.minimizeToTray || false;
            timeoutInput.value = settings.timeout || 30;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save settings to storage
async function saveSettings() {
    try {
        const settings = {
            scanMode: scanModeSelect.value,
            autoLaunch: autoLaunchCheckbox.checked,
            autoUpdate: autoUpdateCheckbox.checked,
            minimizeToTray: minimizeToTrayCheckbox.checked,
            timeout: parseInt(timeoutInput.value) || 30
        };
        
        await ipcRenderer.invoke('save-settings', settings);
        updateStatus('Settings saved successfully');
        closeSettingsModal();
    } catch (error) {
        updateStatus(`Failed to save settings: ${error.message}`);
    }
}

// Event Listeners

// Close window
closeButton.addEventListener('click', () => {
    window.close();
});

// Play button
playButton.addEventListener('click', async () => {
    if (!installDir) {
        updateStatus('Please set an install location first');
        showInstallLocationDialog();
        return;
    }
    
    const exePath = require('path').join(installDir, 'SWGEmu.exe');
    try {
        updateStatus('Launching game...');
        await ipcRenderer.invoke('launch-game', exePath);
        updateStatus('Game launched successfully');
    } catch (error) {
        updateStatus(`Launch failed: ${error.message}`);
    }
});

// Install location
installLocationButton.addEventListener('click', async () => {
    await showInstallLocationDialog();
});

async function showInstallLocationDialog() {
    const selectedDir = await ipcRenderer.invoke('select-directory');
    if (selectedDir) {
        installDir = selectedDir;
        currentDirectoryElement.textContent = installDir;
        await ipcRenderer.invoke('save-install-dir', installDir);
        updateStatus(`Install directory set: ${installDir}`);
    }
}

// Quick scan
quickScanButton.addEventListener('click', () => {
    if (!installDir) {
        updateStatus('Please set an install location first');
        showInstallLocationDialog();
        return;
    }
    
    startScan('quick');
});

// Full scan
fullScanButton.addEventListener('click', () => {
    if (!installDir) {
        updateStatus('Please set an install location first');
        showInstallLocationDialog();
        return;
    }
    
    startScan('full');
});

// Settings button
settingsButton.addEventListener('click', () => {
    openSettingsModal();
});

// Pause button
pauseButton.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseButton.textContent = isPaused ? 'Resume Scan' : 'Pause Scan';
    updateStatus(isPaused ? 'Scan paused' : 'Scan resumed');
});

// Clear cache
clearCacheButton.addEventListener('click', async () => {
    try {
        await ipcRenderer.invoke('clear-cache');
        updateStatus('Cache cleared successfully');
    } catch (error) {
        updateStatus(`Failed to clear cache: ${error.message}`);
    }
});

// View logs
viewLogsButton.addEventListener('click', async () => {
    try {
        await ipcRenderer.invoke('open-logs');
        updateStatus('Opening logs...');
    } catch (error) {
        updateStatus(`Failed to open logs: ${error.message}`);
    }
});

// Donate button - UPDATED TO USE PAYPAL LINK
donateButton.addEventListener('click', () => {
    require('electron').shell.openExternal('https://www.paypal.me/Fitzpatrick251');
    updateStatus('Opening PayPal donation page...');
});

// Settings modal functions
function openSettingsModal() {
    settingsModal.style.display = 'block';
    modalOverlay.style.display = 'block';
}

function closeSettingsModal() {
    settingsModal.style.display = 'none';
    modalOverlay.style.display = 'none';
}

settingsCloseButton.addEventListener('click', closeSettingsModal);
saveSettingsButton.addEventListener('click', saveSettings);
modalOverlay.addEventListener('click', closeSettingsModal);

// Update status display
function updateStatus(text) {
    statusElement.textContent = text;
    console.log(`[Status] ${text}`);
}

// Update progress bars
function updateProgress(current, total, type = 'total') {
    if (total === 0) return;
    
    const percentage = (current / total) * 100;
    
    if (type === 'total') {
        totalProgressBar.style.width = `${percentage}%`;
        totalStatusElement.textContent = `${current}/${total} files`;
    } else {
        fileProgressBar.style.width = `${percentage}%`;
    }
}

// Update download speed
function updateDownloadSpeed(bytes) {
    const now = Date.now();
    const timeDiff = (now - lastDownloadUpdate) / 1000; // in seconds
    
    if (timeDiff >= 1) {
        const bytesDiff = bytes - lastDownloadBytes;
        downloadSpeed = bytesDiff / timeDiff; // bytes per second
        
        let speedText;
        if (downloadSpeed >= 1048576) { // 1 MB
            speedText = `${(downloadSpeed / 1048576).toFixed(2)} MB/s`;
        } else if (downloadSpeed >= 1024) { // 1 KB
            speedText = `${(downloadSpeed / 1024).toFixed(2)} KB/s`;
        } else {
            speedText = `${downloadSpeed.toFixed(2)} B/s`;
        }
        
        downloadSpeedElement.textContent = `Download speed: ${speedText}`;
        
        lastDownloadUpdate = now;
        lastDownloadBytes = bytes;
    }
}

// Scan function
async function startScan(mode) {
    if (isScanning) {
        updateStatus('Scan already in progress');
        return;
    }
    
    isScanning = true;
    isPaused = false;
    pauseButton.textContent = 'Pause Scan';
    downloadSpeed = 0;
    lastDownloadUpdate = Date.now();
    lastDownloadBytes = 0;
    downloadSpeedElement.textContent = '';
    
    try {
        updateStatus(`Starting ${mode} scan...`);
        await ipcRenderer.invoke('save-scan-mode', mode);
        
        // Load required files from server
        updateStatus('Loading file list from server...');
        const files = await ipcRenderer.invoke('load-required-files');
        updateStatus(`Found ${files.length} files to check`);
        
        let verifiedCount = 0;
        let needDownloadCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < files.length; i++) {
            // Check if paused
            if (isPaused) {
                updateStatus('Scan paused. Click Resume to continue.');
                while (isPaused) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                updateStatus('Resuming scan...');
            }
            
            const file = files[i];
            const localPath = require('path').join(installDir, file.name);
            
            updateStatus(`Checking: ${file.name}`);
            updateProgress(i + 1, files.length, 'total');
            
            // Check if file exists
            const fs = require('fs');
            if (fs.existsSync(localPath)) {
                try {
                    // Check MD5
                    const localMd5 = await ipcRenderer.invoke('check-md5', localPath);
                    
                    if (localMd5 === file.md5) {
                        verifiedCount++;
                        updateProgress(100, 100, 'file');
                    } else {
                        needDownloadCount++;
                        updateStatus(`MD5 mismatch: ${file.name}`);
                        await downloadFile(file, localPath);
                    }
                } catch (error) {
                    errorCount++;
                    needDownloadCount++;
                    updateStatus(`Error checking ${file.name}: ${error.message}`);
                    await downloadFile(file, localPath);
                }
            } else {
                needDownloadCount++;
                updateStatus(`Missing: ${file.name}`);
                await downloadFile(file, localPath);
            }
        }
        
        updateStatus(`Scan complete. Verified: ${verifiedCount}, Downloaded: ${needDownloadCount}, Errors: ${errorCount}`);
        
        // Auto-launch if enabled
        const settings = await ipcRenderer.invoke('get-settings');
        if (settings && settings.autoLaunch && needDownloadCount === 0) {
            const exePath = require('path').join(installDir, 'SWGEmu.exe');
            await ipcRenderer.invoke('launch-game', exePath);
            updateStatus('Auto-launching game...');
        }
        
    } catch (error) {
        updateStatus(`Scan error: ${error.message}`);
    } finally {
        isScanning = false;
        downloadSpeedElement.textContent = '';
    }
}

// Download file with progress
async function downloadFile(file, destination) {
    updateStatus(`Downloading: ${file.name}`);
    
    try {
        const result = await ipcRenderer.invoke('download-file', {
            url: file.url.startsWith('http') ? file.url : `http://15.204.254.253/tre/carbonite/${file.name}`,
            destination: destination,
            expectedMd5: file.md5,
            size: file.size
        });
        
        updateStatus(`Downloaded: ${file.name}`);
        return true;
    } catch (error) {
        updateStatus(`Download failed for ${file.name}: ${error.message}`);
        return false;
    }
}

// Listen for progress updates from main process
ipcRenderer.on('file-progress', (event, data) => {
    updateProgress(data.downloaded, data.total, 'file');
    updateDownloadSpeed(data.downloaded);
});

// Listen for scan progress
ipcRenderer.on('scan-progress', (event, data) => {
    if (data.current && data.total) {
        updateProgress(data.current, data.total, 'total');
    }
});

// Initialize the app
init();
