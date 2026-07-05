import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // 鼠标穿透控制
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },

  // 窗口控制
  windowControl: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),
  },

  // 调整控制面板窗口大小
  resizeControlWindow: (width: number, height: number) => {
    ipcRenderer.send('resize-control-window', width, height);
  },

  // 转发弹幕到其他窗口
  forwardDanmakuToWindow: (danmakuData: any) => {
    ipcRenderer.send('forward-danmaku-to-window', danmakuData);
  },

  // 接收来自其他窗口的弹幕
  onReceiveDanmakuFromControl: (callback: (danmakuData: any) => void) => {
    ipcRenderer.on('receive-danmaku-from-control', (_event, data) => callback(data));
  },

  // 获取窗口信息
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),

  // 日志
  log: (message: string) => ipcRenderer.send('renderer-log', message),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
});