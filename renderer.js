// In renderer.js, replace the entire checkFiles function:

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
        document.getElementById('status').textContent = 'Connecting to server...';
        requiredFiles = await ipcRenderer.invoke('load-required-files');
        
        if (!Array.isArray(requiredFiles)) {
            throw new Error('Invalid file list format from server');
        }
        
        console.log(`Server returned ${requiredFiles.length} files`);
        
        // Filter out invalid entries
        const validFiles = requiredFiles.filter(file => {
            return file && 
                   file.name && 
                   typeof file.name === 'string' && 
                   file.name.trim() !== '' &&
                   file.url &&
                   file.md5 &&
                   file.size > 0;
        });
        
        if (validFiles.length !== requiredFiles.length) {
            console.warn(`Filtered out ${requiredFiles.length - validFiles.length} invalid entries`);
        }
        
        requiredFiles = validFiles;
        totalFiles = requiredFiles.length;
        completedFiles = 0;
        
        if (totalFiles === 0) {
            document.getElementById('status').textContent = 'No valid files in manifest';
            return;
        }
        
        document.getElementById('status').textContent = `Checking ${totalFiles} files...`;
        updateProgress();
        
        // Check existing files
        const filesToDownload = [];
        const filesToVerify = [];
        
        for (let i = 0; i < requiredFiles.length; i++) {
            if (paused) {
                document.getElementById('status').textContent = 'Scan paused';
                break;
            }
            
            const file = requiredFiles[i];
            const filePath = path.join(installDir, file.name);
            
            // Check if file exists
            if (fs.existsSync(filePath)) {
                if (scanMode === 'quick') {
                    // Quick scan: just check if file exists
                    completedFiles++;
                } else {
                    // Full scan: check MD5
                    filesToVerify.push({file, filePath});
                }
            } else {
                // File doesn't exist, need to download
                filesToDownload.push(file);
            }
            
            // Update progress every 10 files
            if (i % 10 === 0) {
                updateProgress();
            }
        }
        
        // Verify MD5 for existing files (full scan only)
        if (scanMode === 'full' && filesToVerify.length > 0) {
            document.getElementById('status').textContent = `Verifying ${filesToVerify.length} existing files...`;
            
            for (const {file, filePath} of filesToVerify) {
                try {
                    const md5 = await ipcRenderer.invoke('check-md5', filePath);
                    if (md5 === file.md5) {
                        completedFiles++;
                    } else {
                        console.log(`MD5 mismatch for ${file.name}, adding to download list`);
                        filesToDownload.push(file);
                    }
                } catch (error) {
                    console.error(`Error verifying ${file.name}:`, error);
                    filesToDownload.push(file);
                }
                
                updateProgress();
            }
        }
        
        document.getElementById('status').textContent = `Found ${filesToDownload.length} files to download`;
        
        // Download missing or outdated files
        let failedDownloads = [];
        
        for (let i = 0; i < filesToDownload.length; i++) {
            if (paused) {
                document.getElementById('status').textContent = 'Downloads paused';
                break;
            }
            
            const file = filesToDownload[i];
            const filePath = path.join(installDir, file.name);
            
            document.getElementById('status').textContent = `Downloading ${file.name} (${i+1}/${filesToDownload.length})...`;
            document.getElementById('file-progress').style.width = '0%';
            
            // Create directory if it doesn't exist
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            let retries = 3;
            let success = false;
            
            while (retries > 0 && !success && !paused) {
                try {
                    await ipcRenderer.invoke('download-file', {
                        url: file.url,
                        destination: filePath,
                        expectedMd5: file.md5,
                        size: file.size
                    });
                    
                    success = true;
                    completedFiles++;
                    updateProgress();
                    
                } catch (error) {
                    retries--;
                    if (retries === 0) {
                        console.error(`Failed to download ${file.name}:`, error);
                        failedDownloads.push(file.name);
                        document.getElementById('status').textContent = `Failed: ${file.name}`;
                    } else {
                        console.log(`Retrying ${file.name} (${3 - retries}/3)...`);
                        document.getElementById('status').textContent = `Retrying ${file.name}...`;
                    }
                }
            }
        }
        
        // Final status
        if (!paused) {
            if (failedDownloads.length === 0 && completedFiles === totalFiles) {
                document.getElementById('status').textContent = 'All files are up to date!';
                document.getElementById('total-progress').style.width = '100%';
                document.getElementById('file-progress').style.width = '100%';
            } else if (failedDownloads.length > 0) {
                document.getElementById('status').textContent = 
                    `Completed ${completedFiles}/${totalFiles} files. Failed: ${failedDownloads.length}`;
            } else {
                document.getElementById('status').textContent = 
                    `Updated ${completedFiles}/${totalFiles} files.`;
            }
        }
        
    } catch (error) {
        console.error('Error in checkFiles:', error);
        document.getElementById('status').textContent = 'Error: ' + error.message;
    }
};
