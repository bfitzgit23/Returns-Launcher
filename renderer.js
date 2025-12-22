const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://15.204.254.253/tre/carbonite/';
const MIN_PARALLEL = 2;
const MAX_PARALLEL = 6;

let installDir = null;
let scanMode = 'quick';
let paused = false;

let requiredFiles = [];
let queue = [];

let activeWorkers = 0;
let parallelLimit = 3;

let totalFiles = 0;
let completedFiles = 0;

/* =========================
   SPEED / ETA TRACKING
========================= */

let totalBytesDownloaded = 0;
let speedSamples = [];
let lastSpeedTime = Date.now();

/* =========================
   INIT
========================= */

(async () => {
    installDir = await ipcRenderer.invoke('get-install-dir');
    scanMode = await ipcRenderer.invoke('get-scan-mode');

    if (installDir) {
        document.getElementById('current-directory').textContent = installDir;
    }

    document.getElementById('status').textContent =
        scanMode === 'full' ? 'Full Scan ready' : 'Quick Scan ready';
})();

/* =========================
   UI ACTIONS
========================= */

function togglePause() {
    paused = !paused;
    document.getElementById('status').textContent =
        paused ? 'Paused' : 'Resuming downloads...';

    if (!paused) pumpQueue();
}

function launchSettings() {
    scanMode = scanMode === 'full' ? 'quick' : 'full';
    ipcRenderer.invoke('save-scan-mode', scanMode);
    document.getElementById('status').textContent =
        scanMode === 'full' ? 'Full Scan enabled' : 'Quick Scan enabled';
}

async function selectInstallLocation() {
    const dir = await ipcRenderer.invoke('select-directory');
    if (!dir) return;
    installDir = dir;
    await ipcRenderer.invoke('save-install-dir', dir);
    document.getElementById('current-directory').textContent = dir;
}

/* =========================
   MAIN ENTRY
========================= */

async function checkFiles() {
    if (!installDir) {
        alert('Select install directory first');
        return;
    }

    paused = false;
    document.getElementById('status').textContent = 'Scanning files...';

    requiredFiles = await ipcRenderer.invoke('load-required-files');
    queue = [];

    for (const file of requiredFiles) {
        const dest = path.join(installDir, file.path);
        let needsDownload = true;

        if (fs.existsSync(dest)) {
            if (scanMode === 'quick') {
                needsDownload = false;
            } else {
                const hash = await ipcRenderer.invoke('check-sha256', dest);
                needsDownload = hash !== file.sha256;
            }
        }

        if (needsDownload) queue.push(file);
        else completedFiles++;
    }

    totalFiles = requiredFiles.length;
    updateTotalProgress();

    pumpQueue();
}

/* =========================
   DYNAMIC WORKER ENGINE
========================= */

function pumpQueue() {
    if (paused) return;

    while (activeWorkers < parallelLimit && queue.length > 0) {
        const file = queue.shift();
        activeWorkers++;
        processFile(file).finally(() => {
            activeWorkers--;
            adjustParallelism();
            pumpQueue();
        });
    }

    if (completedFiles === totalFiles) {
        document.getElementById('status').textContent = 'All files up to date';
        document.getElementById('total-progress').style.width = '100%';
    }
}

async function processFile(file) {
    const dest = path.join(installDir, file.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    let existingSize = fs.existsSync(dest) ? fs.statSync(dest).size : 0;

    await ipcRenderer.invoke('download-file', {
        url: BASE_URL + file.path.replace(/\\/g, '/'),
        destination: dest,
        expectedSize: file.size,
        resumeFrom: existingSize
    });

    const finalHash = await ipcRenderer.invoke('check-sha256', dest);
    if (finalHash !== file.sha256) {
        fs.unlinkSync(dest);
        queue.push(file); // smart retry
        return;
    }

    completedFiles++;
    updateTotalProgress();
}

/* =========================
   DYNAMIC SCALING
========================= */

function adjustParallelism() {
    const avgSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length || 0;

    if (avgSpeed > 1.5 * 1024 * 1024 && parallelLimit < MAX_PARALLEL) {
        parallelLimit++;
    } else if (avgSpeed < 300 * 1024 && parallelLimit > MIN_PARALLEL) {
        parallelLimit--;
    }
}

/* =========================
   PROGRESS EVENTS
========================= */

ipcRenderer.on('file-progress', (_, data) => {
    const pct = Math.floor((data.downloaded / data.total) * 100);
    document.getElementById('file-progress').style.width = pct + '%';

    totalBytesDownloaded += data.delta;
    updateSpeedAndETA(data);
});

function updateTotalProgress() {
    const pct = Math.floor((completedFiles / totalFiles) * 100);
    document.getElementById('total-progress').style.width = pct + '%';
    document.getElementById('total-status').textContent =
        `${completedFiles}/${totalFiles} files`;
}

/* =========================
   SPEED + ETA
========================= */

function updateSpeedAndETA(data) {
    const now = Date.now();
    const deltaTime = (now - lastSpeedTime) / 1000;
    if (deltaTime <= 0) return;

    const speed = data.delta / deltaTime;
    speedSamples.push(speed);
    if (speedSamples.length > 6) speedSamples.shift();

    const avgSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
    document.getElementById('download-speed').textContent =
        `${formatSpeed(avgSpeed)} | ETA ${formatETA(data.total - data.downloaded, avgSpeed)}`;

    lastSpeedTime = now;
}

function formatSpeed(bytes) {
    if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB/s';
    return (bytes / 1024).toFixed(1) + ' KB/s';
}

function formatETA(remainingBytes, speed) {
    if (!speed || speed <= 0) return '--:--';
    const sec = Math.floor(remainingBytes / speed);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
