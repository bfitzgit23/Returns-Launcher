
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('huntedAPI', {
  setAlignment: (path) => localStorage.setItem('alignmentPath', path),
  getAlignment: () => localStorage.getItem('alignmentPath'),
  skipIntro: () => localStorage.setItem('skipIntro', 'true'),
  shouldSkipIntro: () => localStorage.getItem('skipIntro') === 'true'
});
