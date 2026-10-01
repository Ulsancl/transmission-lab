const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback is required');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('transmissionDesktop', {
  isDesktop: true,
  platform: process.platform,
  openProject: () => ipcRenderer.invoke('transmission:open-project'),
  saveProject: payload => ipcRenderer.invoke('transmission:save-project', payload),
  setBusy: busy => ipcRenderer.send('transmission:busy', busy === true),
  onCommand: callback => subscribe('transmission:command', callback),
  onSaveResult: callback => subscribe('transmission:save-result', callback),
});
