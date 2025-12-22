const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Global state
let installDir = null;
let scanMode = 'quick';
let paused = false;
let requiredFiles = [];
let totalFiles = 0;
let completedFiles = 0;

// DOM Elements
let playButton, quickScanButton, fullScanButton, installLocationButton;
let pauseButton, donateButton, closeButton;
let currentDirectoryElement, statusElement, totalStatusElement;
let totalProgressElement, fileProgressElement;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeDOM();
    initializeApp();
});

function initializeDOM() {
    // Get all DOM elements
    playButton = document.getElementById('play-button');
    quickScanButton = document.getElementById('quick-scan');
    fullScanButton = document.getElementById('full-scan');
    installLocationButton = document.getElementById('install-location');
    pauseButton = document.getElementById('pause-button');
    donateButton = document.getElementById('donate-button');
    closeButton = document.getElementById('close-button');
    
    currentDirectoryElement = document.getElementById('current-directory');
    statusElement = document.getElementById('status');
    totalStatusElement = document.getElementById('total-status');
    totalProgressElement = document.getElementById('total-progress');
    fileProgressElement = document.getElementById('file-progress');
    
    // Add event listeners
    playButton.addEventListener('click', launchGame);
    quickScanButton.addEventListener('click', () => {
        setScanMode('quick');
        checkFiles();
    });
    fullScanButton.addEventListener('click', () => {
        setScanMode('full');
        checkFiles();
    });
    installLocationButton.addEventListener('click', selectInstallLocation);
    pauseButton.addEventListener('click', togglePause);
    donateButton.addEventListener('click', () => {
        require('electron').shell.openExternal('https://paypal.me/fitzpatrick251');
    });
    closeButton.addEventListener('click', () => {
        window.close();
    });
}

async function initializeApp() {
    try {
        // Load saved settings
        installDir = await ipcRenderer.invoke('get-install-dir');
        scanMode = await ipcRenderer.invoke('get-scan-mode');
        
        if (installDir) {
            currentDirectoryElement.textContent = installDir;
        }
        
        statusElement.textContent = 'Ready';
        totalStatusElement.textContent = '0/0 files';
        
        console.log('Launcher initialized successfully');
        console.log(`Install directory: ${installDir || 'Not set'}`);
        console.log(`Scan mode: ${scanMode}`);
    } catch (error) {
        console.error('Initialization error:', error);
        statusElement.textContent = 'Error: ' + error.message;
    }
}

// Button Functions
async function launchGame() {
    if (!installDir) {
        alert('Please select an install directory first!');
        await selectInstallLocation();
        return;
    }
    
    const exePath = path.join(installDir, 'SWGEmu.exe');
    if (fs.existsSync(exePath)) {
        try {
            statusElement.textContent = 'Launching game...';
            await ipcRenderer.invoke('launch-game', exePath);
            statusElement.textContent = 'Game launched!';
        } catch (error) {
            console.error('Game launch failed:', error);
            alert('Failed to launch game: ' + error.message);
            statusElement.textContent = 'Launch failed';
        }
    } else {
        alert('SWGEmu.exe not found in the selected directory!');
        statusElement.textContent = 'Game executable not found';
    }
}

function setScanMode(mode) {
    scanMode = mode;
    ipcRenderer.invoke('save-scan-mode', mode);
    statusElement.textContent = `Scan mode set to ${mode} scan`;
    console.log(`Scan mode changed to: ${mode}`);
}

function togglePause() {
    paused = !paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    statusElement.textContent = paused ? 'Downloads paused' : 'Downloads resumed';
    console.log(`Downloads ${paused ? 'paused' : 'resumed'}`);
}

async function selectInstallLocation() {
    try {
        statusElement.textContent = 'Selecting install location...';
        const dir = await ipcRenderer.invoke('select-directory');
        
        if (dir) {
            installDir = dir;
            await ipcRenderer.invoke('save-install-dir', dir);
            currentDirectoryElement.textContent = dir;
            statusElement.textContent = 'Install directory updated';
            console.log(`Install directory set to: ${dir}`);
        } else {
            statusElement.textContent = 'Directory selection cancelled';
        }
    } catch (error) {
        console.error('Directory selection error:', error);
        alert('Failed to select directory: ' + error.message);
        statusElement.textContent = 'Directory selection failed';
    }
}

// Main file checking function
async function checkFiles() {
    if (!installDir) {
        alert('Please select an install directory first!');
        await selectInstallLocation();
        if (!installDir) return;
    }
    
    if (!fs.existsSync(installDir)) {
        alert('Install directory does not exist!');
        statusElement.textContent = 'Install directory not found';
        return;
    }
    
    // Reset state
    paused = false;
    requiredFiles = [];
    totalFiles = 0;
    completedFiles = 0;
    
    totalProgressElement.style.width = '0%';
    fileProgressElement.style.width = '0%';
    statusElement.textContent = 'Loading file list...';
    totalStatusElement.textContent = '0/0 files';
    
    try {
        // Load required files from server
        requiredFiles = await ipcRenderer.invoke('load-required-files');
        
        if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) {
            throw new Error('No files found in manifest or invalid format');
        }
        
        // Filter out invalid entries
        requiredFiles = requiredFiles.filter(file => 
            file && 
            file.name && 
            typeof file.name === 'string' && 
            file.name.trim() !== '' &&
            file.url &&
            file.md5 &&
            file.size > 0
        );
        
        totalFiles = requiredFiles.length;
        completedFiles = 0;
        
        console.log(`Loaded ${totalFiles} valid files from server`);
        statusElement.textContent = `Checking ${totalFiles} files...`;
        updateProgress();
        
        // Check existing files
        const filesToDownload = [];
        
        for (let i = 0; i < requiredFiles.length; i++) {
            if (paused) {
                statusElement.textContent = 'Scan paused';
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
            
            // Update progress every 10 files
            if (i % 10 === 0) {
                updateProgress();
            }
        }
        
        console.log(`Found ${filesToDownload.length} files to download`);
        statusElement.textContent = `Found ${filesToDownload.length} files to update`;
        
        // Download files
        for (let i = 0; i < filesToDownload.length; i++) {
            if (paused) {
                statusElement.textContent = 'Downloads paused';
                break;
            }
            
            const file = filesToDownload[i];
            const filePath = path.join(installDir, file.name);
            
            // Create directory if needed
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            statusElement.textContent = `Downloading ${file.name} (${i+1}/${filesToDownload.length})...`;
            fileProgressElement.style.width = '0%';
            
            try {
                await ipcRenderer.invoke('download-file', {
                    url: file.url,
                    destination: filePath,
                    expectedMd5: file.md5,
                    size: file.size
                });
                
                completedFiles++;
                updateProgress();
                
                console.log(`✅ Downloaded: ${file.name}`);
                
            } catch (error) {
                console.error(`❌ Failed to download ${file.name}:`, error);
                statusElement.textContent = `Failed: ${file.name}`;
                // Continue with next file instead of stopping
            }
        }
        
        if (!paused) {
            statusElement.textContent = 'All files are up to date!';
            totalProgressElement.style.width = '100%';
            fileProgressElement.style.width = '100%';
            console.log('✅ All files processed');
        }
        
    } catch (error) {
        console.error('Error in checkFiles:', error);
        statusElement.textContent = 'Error: ' + error.message;
        alert('Error: ' + error.message);
    }
}

// Progress tracking
function updateProgress() {
    if (totalFiles > 0) {
        const totalPercent = (completedFiles / totalFiles) * 100;
        totalProgressElement.style.width = `${totalPercent}%`;
        totalStatusElement.textContent = `${completedFiles}/${totalFiles} files`;
    }
}

// Listen for download progress
ipcRenderer.on('file-progress', (event, data) => {
    if (data && data.percent !== undefined) {
        fileProgressElement.style.width = `${data.percent}%`;
        
        // Show download progress
        if (data.downloaded && data.total) {
            const downloadedMB = (data.downloaded / (1024 * 1024)).toFixed(2);
            const totalMB = (data.total / (1024 * 1024)).toFixed(2);
            statusElement.textContent = `Downloading: ${downloadedMB}MB / ${totalMB}MB (${data.percent.toFixed(1)}%)`;
        }
    }
});

// Handle window closing
window.addEventListener('beforeunload', () => {
    // Cleanup if needed
    console.log('Launcher closing...');
});

// Export functions to window for debugging
window.launchGame = launchGame;
window.checkFiles = checkFiles;
window.selectInstallLocation = selectInstallLocation;
window.togglePause = togglePause;
