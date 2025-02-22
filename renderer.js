const { ipcRenderer } = require('electron');
const fs = require('fs').promises;
const path = require('path');

let selectedDirectory = null;  // Store the selected directory

// Add auto-update event listeners
ipcRenderer.on('update_available', () => {
  document.getElementById('status').textContent = 'Update available. Downloading...';
});

ipcRenderer.on('update_downloaded', () => {
  document.getElementById('status').textContent = 'Update downloaded. Restart to apply the update.';
  const restartButton = document.createElement('button');
  restartButton.textContent = 'Restart';
  restartButton.onclick = () => ipcRenderer.send('restart_app');
  document.body.appendChild(restartButton);
});

// Existing code below...

function updateProgress(fileIndex, totalFiles) {
  const percent = (fileIndex / totalFiles) * 100;
  document.getElementById('total-progress').style.width = `${percent}%`;
  document.getElementById('total-status').textContent = `${fileIndex}/${totalFiles} files`;
}

function formatSpeed(bytesPerSecond) {
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

// Update the document ready listener
document.addEventListener('DOMContentLoaded', async () => {
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

    const requiredFiles = await ipcRenderer.invoke('load-required-files');
    let completedFiles = 0;

    document.getElementById('total-status').textContent = `0/${requiredFiles.length} files`;

    for (const fileInfo of requiredFiles) {
      const filePath = path.join(selectedDirectory, fileInfo.name);

      try {
        const stats = await fs.stat(filePath);
        if (fileInfo.size === 0 && fileInfo.md5 === "") {
          document.getElementById('status').textContent = `Skipping check for ${fileInfo.name}`;
        } else if (stats.size !== fileInfo.size) {
          await downloadFile(fileInfo, filePath);
        } else {
          const fileMd5 = await ipcRenderer.invoke('check-md5', filePath);
          if (fileMd5 !== fileInfo.md5) {
            await downloadFile(fileInfo, filePath);
          }
        }
      } catch (error) {
        await downloadFile(fileInfo, filePath);
      }

      completedFiles++;
      updateProgress(completedFiles, requiredFiles.length);
    }

    document.getElementById('status').textContent = 'All files are up to date!';
    document.getElementById('download-speed').textContent = '';

  } catch (error) {
    document.getElementById('status').textContent = `Error: ${error.message}`;
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
    document.getElementById('status').textContent = `Error launching game: ${error.message}`;
  }
}

async function downloadFile(fileInfo, destination) {
  document.getElementById('status').textContent = `Downloading ${fileInfo.name}...`;
  document.getElementById('file-progress').style.width = '0%';

  try {
    // Skip MD5 check if size is 0 and MD5 is empty
    const skipChecks = fileInfo.size === 0 && fileInfo.md5 === "";
    const result = await ipcRenderer.invoke('download-file', {
      url: fileInfo.url,
      destination: destination,
      expectedMd5: fileInfo.md5,
      skipChecks: skipChecks
    });

    if (result === 'kept-with-mismatch') {
      document.getElementById('status').textContent = `Kept ${fileInfo.name} despite MD5 mismatch`;
    }
  } catch (error) {
    if (error.message.startsWith('MD5_MISMATCH:')) {
      return downloadFile(fileInfo, destination);
    }
    throw error;
  }

  ipcRenderer.on('download-progress', (event, { percent, speed }) => {
    const progressBar = document.getElementById('file-progress');
    progressBar.style.width = `${percent}%`;
    progressBar.classList.add('active');
    document.getElementById('download-speed').textContent = formatSpeed(speed);
  });
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
    // Get input elements and ensure they exist
    const ipInput = document.getElementById('serverIp');
    const portInput = document.getElementById('serverPort');

    if (!ipInput || !portInput) {
      throw new Error('Server configuration inputs not found');
    }

    // Get values with fallbacks
    const ip = ipInput.value?.trim() || '192.168.50.156';
    const port = portInput.value?.trim() || '44453';

    const config = `[ClientGame]\nloginServerAddress0=${ip}\nloginServerPort0=${port}`;

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