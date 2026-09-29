const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),
  save: (d) => ipcRenderer.invoke('save', d),
  launch: (items) => ipcRenderer.send('launch', items),
  collapse: (c) => ipcRenderer.send('widget-collapse', c),
  openMain: () => ipcRenderer.send('open-main'),
  testWater: () => ipcRenderer.send('test-water'),
  pomo: (action) => ipcRenderer.send('pomo', action),
  pomoTask: (id) => ipcRenderer.send('pomo-task', id),
  pomoGet: () => ipcRenderer.invoke('pomo-get'),
  exportData: () => ipcRenderer.invoke('export'),
  importData: () => ipcRenderer.invoke('import'),
  onPomo: (cb) => ipcRenderer.on('pomo', (_, p) => cb(p)),
  onPomoEnd: (cb) => ipcRenderer.on('pomo-end', (_, k) => cb(k)),
  onChange: (cb) => ipcRenderer.on('data-changed', (_, d) => cb(d)),
  onWater: (cb) => ipcRenderer.on('water', () => cb())
});
