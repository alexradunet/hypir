const { contextBridge, ipcRenderer } = require('electron');

// Main independently verifies the sender frame and validates the entire payload.
// Never expose ipcRenderer, event objects, arbitrary channel names or Node APIs.
contextBridge.exposeInMainWorld(
  'hypir',
  Object.freeze({
    connect: (connection) => ipcRenderer.invoke('hypir:connect', connection),
    connectRecovery: (connection) => ipcRenderer.invoke('hypir:connect-recovery', connection),
  }),
);
