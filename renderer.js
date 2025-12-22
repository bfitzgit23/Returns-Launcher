const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

let installDir = null;
let scanMode = 'quick';
let paused = false;
let requiredFiles = [];
let totalFiles = 0;
let completedFiles = 0;

// Initialize
window.onload = async function() {
    try {
        installDir = await ipcRenderer.invoke('get-install-dir');
        scanMode = await ipcRenderer.invoke('get-scan-mode');
        
        if (installDir) {
            document.getElementById('current-directory').textContent = installDir;
        }
        
        document.getElementById('status').textContent = 'Ready';
        document.getElementById('total-status').textContent = '0/0 files';
    } catch (error) {
        console.error('Init error:', error);
        document.getElementById('status').textContent = 'Error: ' + error.message;
    }
};

// Global functions for HTML buttons
window.launchGame = async function() {
    if (!installDir) {
        alert('Please select an install directory first!');
        await selectInstallLocation();
        return;
    }
    
    const exePath = path.join(installDir, 'SWGEmu.exe');
    if (fs.existsSync(exePath)) {
        try {
            await ipcRenderer.invoke('launch-game', exePath);
            document.getElementById('status').textContent = 'Game launched!';
        } catch (error) {
            alert('Failed to launch game: ' + error.message);
        }
    } else {
        alert('SWGEmu.exe not found in the selected directory!');
    }
};

window.setScanMode = function(mode) {
    scanMode = mode;
    ipcRenderer.invoke('save-scan-mode', mode);
    document.getElementById('status').textContent = `Scan mode set to ${mode} scan`;
};

window.togglePause = function() {
    paused = !paused;
    const pauseButton = document.querySelector('.side-button:nth-child(4)');
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    document.getElementById('status').textContent = paused ? 'Downloads paused' : 'Downloads resumed';
};

window.selectInstallLocation = async function() {
    try {
        const dir = await ipcRenderer.invoke('select-directory');
        if (dir) {
            installDir = dir;
            await ipcRenderer.invoke('save-install-dir', dir);
            document.getElementById('current-directory').textContent = dir;
            document.getElementById('status').textContent = 'Install directory updated';
        }
    } catch (error) {
        console.error('Directory selection error:', error);
        alert('Failed to select directory: ' + error.message);
    }
};

window.checkFiles = async function() {
    if (!installDir) {
        alert('Please select an install directory first!');
        await selectInstallLocation();
        if (!installDir) return;
    }
    
    if (!fs.existsSync(installDir)) {
        alert('Install directory does not exist!');
        return;
    }
    
    paused = false;
    document.getElementById('status').textContent = 'Loading file list...';
    document.getElementById('total-progress').style.width = '0%';
    document.getElementById('file-progress').style.width = '0%';
    document.getElementById('total-status').textContent = '0/0 files';
    
    try {
        // Load required files from server
        requiredFiles = await ipcRenderer.invoke('load-required-files');
        totalFiles = requiredFiles.length;
        completedFiles = 0;
        
        if (totalFiles === 0) {
            document.getElementById('status').textContent = 'No files in manifest';
            return;
        }
        
        document.getElementById('status').textContent = `Checking ${totalFiles} files...`;
        updateProgress();
        
        // Check existing files
        const filesToDownload = [];
        
        for (let i = 0; i < requiredFiles.length; i++) {
            if (paused) {
                document.getElementById('status').textContent = 'Scan paused';
                break;
            }
            
            const file = requiredFiles[i];
            const filePath = path.join(installDir, file.name);
            
            let needsDownload = true;
            
            if (fs.existsSync(filePath)) {
                if (scanMode === 'quick') {
                    // Quick scan: only check if file exists
                    needsDownload = false;
                    completedFiles++;
                } else {
                    // Full scan: check MD5
                    try {
                        const md5 = await ipcRenderer.invoke('check-md5', filePath);
                        needsDownload = md5 !== file.md5;
                        
                        if (!needsDownload) {
                            completedFiles++;
                        }
                    } catch (error) {
                        console.error(`Error checking MD5 for ${file.name}:`, error);
                    }
                }
            }
            
            if (needsDownload) {
                filesToDownload.push(file);
            }
            
            updateProgress();
        }
        
        document.getElementById('status').textContent = `Found ${filesToDownload.length} files to update`;
        
        // Download files
        for (let i = 0; i < filesToDownload.length; i++) {
            if (paused) {
                document.getElementById('status').textContent = 'Downloads paused';
                break;
            }
            
            const file = filesToDownload[i];
            const filePath = path.join(installDir, file.name);
            
            document.getElementById('status').textContent = `Downloading ${file.name}...`;
            document.getElementById('file-progress').style.width = '0%';
            
            try {
                await ipcRenderer.invoke('download-file', {
                    url: file.url,
                    destination: filePath,
                    expectedMd5: file.md5,
                    size: file.size
                });
                
                completedFiles++;
                updateProgress();
                
            } catch (error) {
                console.error(`Failed to download ${file.name}:`, error);
                document.getElementById('status').textContent = `Failed to download ${file.name}: ${error.message}`;
            }
        }
        
        if (!paused) {
            document.getElementById('status').textContent = 'All files are up to date!';
            document.getElementById('total-progress').style.width = '100%';
            document.getElementById('file-progress').style.width = '100%';
        }
        
    } catch (error) {
        console.error('Error in checkFiles:', error);
        document.getElementById('status').textContent = 'Error: ' + error.message;
    }
};

// Progress tracking
function updateProgress() {
    if (totalFiles > 0) {
        const totalPercent = (completedFiles / totalFiles) * 100;
        document.getElementById('total-progress').style.width = `${totalPercent}%`;
        document.getElementById('total-status').textContent = `${completedFiles}/${totalFiles} files`;
    }
}

// Listen for download progress
ipcRenderer.on('file-progress', (event, data) => {
    document.getElementById('file-progress').style.width = `${data.percent}%`;
    
    // Calculate and show progress
    const downloadedMB = (data.downloaded / (1024 * 1024)).toFixed(2);
    const totalMB = (data.total / (1024 * 1024)).toFixed(2);
    document.getElementById('status').textContent = 
        `Downloading: ${downloadedMB}MB / ${totalMB}MB (${data.percent.toFixed(1)}%)`;
});
