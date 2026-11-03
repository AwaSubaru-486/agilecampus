const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petDesktop', {
  ready: () => ipcRenderer.invoke('pet:ready'),
  action: action => ipcRenderer.invoke('pet:action', action),
  drag: (dx, dy) => ipcRenderer.send('pet:drag', { dx, dy }),
  onState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  },
});
