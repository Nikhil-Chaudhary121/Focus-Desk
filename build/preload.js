const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),
  save: (d) => ipcRenderer.invoke('save', d),
  launch: (items) => ipcRenderer.send('launch', items),
  collapse: (c) => ipcRenderer.send('widget-collapse', c),
  openMain: () => ipcRenderer.send('open-main'),
  testWater: () => ipcRenderer.send('test-water'),
  pomo: (action) => ipcRenderer.send('pomo', action),
  pomoGet: () => ipcRenderer.invoke('pomo-get'),
  onPomo: (cb) => ipcRenderer.on('pomo', (_, p) => cb(p)),
  onChange: (cb) => ipcRenderer.on('data-changed', (_, d) => cb(d)),
  onWater: (cb) => ipcRenderer.on('water', () => cb())
});
