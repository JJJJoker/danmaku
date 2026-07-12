import { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage } from 'electron';
import { setupAutoUpdater } from './updater';
import { setupLLM } from './llm';
const path = require('path');
const fs = require('fs');

// ========== 文件日志 ==========
const LOG_FILE = path.join(app.getPath('userData'), 'app.log');

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // 忽略写入失败
  }
}

// 启动时清空旧日志（保留最近一次运行的日志）
try {
  fs.writeFileSync(LOG_FILE, `=== 云弹一下启动 ${new Date().toISOString()} ===\n`);
} catch {
  // ignore
}

log(`Platform: ${process.platform}, Arch: ${process.arch}`);
log(`Electron: ${process.versions.electron}, Node: ${process.versions.node}`);
log(`AppPath: ${app.getAppPath()}`);
log(`UserData: ${app.getPath('userData')}`);

// 防止 EPIPE 错误导致应用崩溃（stdout/stderr 管道关闭时写入会抛异常）
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});
process.on('uncaughtException', (err) => {
  // 静默忽略 EPIPE 错误，不弹窗不崩溃
  if ((err as NodeJS.ErrnoException).code === 'EPIPE' || err.message?.includes('EPIPE')) return;
  // 记录其他未捕获异常
  log(`FATAL uncaughtException: ${err.message}\n${err.stack}`);
  app.exit(1);
});

// Windows: Squirrel 安装/更新/卸载事件处理（必须在最顶部）
if (process.platform === 'win32') {
  const squirrelCommand = process.argv[1];
  if (
    squirrelCommand === '--squirrel-install' ||
    squirrelCommand === '--squirrel-updated' ||
    squirrelCommand === '--squirrel-uninstall' ||
    squirrelCommand === '--squirrel-obsolete'
  ) {
    app.quit();
  }
}

let mainWindow: BrowserWindow | null = null;      // 弹幕窗口
let controlWindow: BrowserWindow | null = null;   // 控制面板窗口
let tray: Tray | null = null;
let isWindowVisible = true;
// 控制面板当前目标层级（macOS 输入框聚焦时降为 normal，让输入法候选框显示在上层）
let controlWindowLevel: 'screen-saver' | 'normal' = 'screen-saver';

function createDanmakuWindow() {
  // 获取主屏幕尺寸，全屏覆盖
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  log(`Screen workAreaSize: ${width}x${height}`);

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false, // 防止窗口获取焦点，避免干扰其他应用
    backgroundColor: '#00000000', // 显式透明背景（解决 macOS 打包后透明窗口不生效问题）
    // Windows 透明窗口需要禁用厚边框样式
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
    webPreferences: {
      preload: path.join(app.getAppPath(), '.vite', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 永远保持鼠标穿透
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // 设置弹幕窗口层级：floating（高于普通窗口，低于控制面板）
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  mainWindow.setAlwaysOnTop(true, 'floating');
  log(`[Z-ORDER] Danmaku window set to floating level`);

  // 监听弹幕窗口所有关键事件
  mainWindow.on('focus', () => {
    log(`[Z-ORDER] EVENT: danmaku FOCUS | alwaysOnTop=${mainWindow?.isAlwaysOnTop()}`);
    if (mainWindow) {
      mainWindow.blur();
      if (process.platform === 'win32') {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
            log(`[Z-ORDER] danmaku mouseEvents reset after blur`);
          }
        }, 10);
      }
    }
  });
  mainWindow.on('blur', () => {
    log(`[Z-ORDER] EVENT: danmaku BLUR | alwaysOnTop=${mainWindow?.isAlwaysOnTop()}`);
  });
  mainWindow.on('show', () => {
    log(`[Z-ORDER] EVENT: danmaku SHOW | alwaysOnTop=${mainWindow?.isAlwaysOnTop()}`);
  });
  mainWindow.on('hide', () => {
    log(`[Z-ORDER] EVENT: danmaku HIDE | alwaysOnTop=${mainWindow?.isAlwaysOnTop()}`);
  });

  // 加载渲染进程 - 只加载弹幕部分
  if (!app.isPackaged) {
    // 开发模式：使用开发服务器
    const devUrl = 'http://localhost:5173';
    log(`Loading danmaku window URL: ${devUrl}?window=danmaku`);
    mainWindow.loadURL(`${devUrl}?window=danmaku`);
  } else {
    // 生产模式：加载本地文件
    // 使用 app.getAppPath() 获取应用根目录
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, '.vite', 'renderer', 'index.html');
    log(`Loading danmaku window file: ${indexPath}`);
    log(`File exists: ${fs.existsSync(indexPath)}`);
    mainWindow.loadFile(indexPath, { query: { window: 'danmaku' } });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    log('Danmaku window content loaded successfully');
    log(`Window bounds: ${JSON.stringify(mainWindow?.getBounds())}`);
    log(`Window visible: ${mainWindow?.isVisible()}`);
    log(`Window URL: ${mainWindow?.webContents.getURL()}`);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    log(`FAILED to load danmaku window: code=${code}, desc=${desc}, url=${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`Danmaku window render process gone: ${JSON.stringify(details)}`);
  });

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levelName = level === 0 ? 'LOG' : level === 1 ? 'INFO' : level === 2 ? 'WARN' : 'ERROR';
    log(`[Danmaku Console ${levelName}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      log(`Danmaku window sub-resource failed to load: code=${errorCode}, desc=${errorDesc}, url=${validatedURL}`);
    }
  });

  // 监听 preload 脚本加载状态
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    log(`DANMAKU PRELOAD ERROR: path=${preloadPath}, error=${error.message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 400,
    height: 600, // 恢复为正常高度，能够显示完整设置内容
    x: 100,
    y: 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,  // 保持在最顶层，但使用 floating 级别
    hasShadow: true,
    resizable: true,
    minWidth: 200,
    minHeight: 40,
    skipTaskbar: false,  // 在任务栏显示
    focusable: true,     // 可以获取焦点
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(app.getAppPath(), '.vite', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 不需要鼠标穿透，正常接收事件
  controlWindow.setIgnoreMouseEvents(false);

  // macOS 上初始使用 normal 层级避免遮挡输入法候选框（输入框失焦后由 IPC 提升为 screen-saver）
  // Windows/Linux 使用 screen-saver 保持在最上层
  controlWindowLevel = process.platform === 'darwin' ? 'normal' : 'screen-saver';
  controlWindow.setAlwaysOnTop(true, controlWindowLevel);
  log(`[Z-ORDER] Control window set to ${controlWindowLevel} level (platform: ${process.platform})`);

  // 监听控制面板所有关键事件
  controlWindow.on('focus', () => {
    log(`[Z-ORDER] EVENT: control FOCUS | alwaysOnTop=${controlWindow?.isAlwaysOnTop()} | danmaku.alwaysOnTop=${mainWindow?.isAlwaysOnTop()}`);
  });
  controlWindow.on('blur', () => {
    log(`[Z-ORDER] EVENT: control BLUR | alwaysOnTop=${controlWindow?.isAlwaysOnTop()} | danmaku.alwaysOnTop=${mainWindow?.isAlwaysOnTop()}`);
  });
  controlWindow.on('show', () => {
    log(`[Z-ORDER] EVENT: control SHOW | alwaysOnTop=${controlWindow?.isAlwaysOnTop()}`);
  });
  controlWindow.on('hide', () => {
    log(`[Z-ORDER] EVENT: control HIDE | alwaysOnTop=${controlWindow?.isAlwaysOnTop()}`);
  });

  // 加载渲染进程 - 只加载控制面板部分
  if (!app.isPackaged) {
    // 开发模式：使用开发服务器
    const devUrl = 'http://localhost:5173';
    log(`Loading control window URL: ${devUrl}?window=control`);
    controlWindow.loadURL(`${devUrl}?window=control`);
  } else {
    // 生产模式：加载本地文件
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, '.vite', 'renderer', 'index.html');
    log(`Loading control window file: ${indexPath}`);
    controlWindow.loadFile(indexPath, { query: { window: 'control' } });
  }

  controlWindow.webContents.on('did-finish-load', () => {
    log('Control window content loaded successfully');
  });

  controlWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levelName = level === 0 ? 'LOG' : level === 1 ? 'INFO' : level === 2 ? 'WARN' : 'ERROR';
    log(`[Control Console ${levelName}] ${message} (${sourceId}:${line})`);
  });

  controlWindow.on('closed', () => {
    controlWindow = null;
  });
}

function setupIpcHandlers() {
  // 动态切换鼠标穿透——无论哪个窗口调用，始终作用于弹幕窗口（mainWindow）。
  // 控制面板窗口自身常驻接收鼠标事件，输入框聚焦无需（也不应）调用本 IPC：
  // ignore=false 会让全屏透明弹幕窗口吞掉整屏点击，导致背后应用点不动。
  ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean, options?: { forward: boolean }) => {
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
      log(`[Z-ORDER] IPC set-ignore-mouse-events: ignore=${ignore}`);
    }
  });

  // 窗口控制
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.on('window:toggle-always-on-top', () => {
    if (mainWindow) {
      const isOnTop = mainWindow.isAlwaysOnTop();
      mainWindow.setAlwaysOnTop(!isOnTop, 'floating');
      log(`[Z-ORDER] toggle-always-on-top: danmaku alwaysOnTop=${!isOnTop}`);
    }
  });

  // setTypingMode 已移除：窗口层级在创建时固定，不再运行时修改，避免 Windows 焦点跳动

  // macOS: 设置控制面板层级（用于输入法候选框显示）
  ipcMain.on('set-control-window-level', (_event, level: 'normal' | 'high') => {
    if (process.platform === 'darwin' && controlWindow && !controlWindow.isDestroyed()) {
      controlWindowLevel = level === 'high' ? 'screen-saver' : 'normal';
      controlWindow.setAlwaysOnTop(true, controlWindowLevel);
      log(`[Z-ORDER] Control window level changed to: ${controlWindowLevel}`);
    }
  });

  // 获取窗口信息
  ipcMain.handle('get-window-bounds', () => {
    return mainWindow?.getBounds();
  });

  // 渲染进程日志
  ipcMain.on('renderer-log', (_event, message: string) => {
    log(`[Renderer] ${message}`);
  });

  // 获取日志文件路径
  ipcMain.handle('get-log-path', () => {
    return LOG_FILE;
  });

  // 调整控制面板窗口大小
  ipcMain.on('resize-control-window', (_event, width: number, height: number) => {
    log(`[RESIZE] Received resize-control-window: ${width}x${height}`);
    if (controlWindow && !controlWindow.isDestroyed()) {
      try {
        const oldBounds = controlWindow.getBounds();
        controlWindow.setBounds({ width, height });
        const newBounds = controlWindow.getBounds();
        log(`[RESIZE] Control window: ${oldBounds.width}x${oldBounds.height} -> ${newBounds.width}x${newBounds.height} (requested: ${width}x${height})`);
      } catch (error) {
        log(`[RESIZE] Failed: ${error}`);
      }
    } else {
      log(`[RESIZE] Control window is null or destroyed`);
    }
  });

  // 弹幕消息转发：从控制面板窗口转发到弹幕窗口
  ipcMain.on('forward-danmaku-to-window', (_event, danmakuData) => {
    log(`Received forward-danmaku-to-window event`);
    log(`  Danmaku text: ${danmakuData.message.text}`);
    log(`  mainWindow exists: ${!!mainWindow}`);
    log(`  mainWindow.webContents destroyed: ${mainWindow?.webContents?.isDestroyed()}`);
    
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      log(`Forwarding danmaku to danmaku window: ${danmakuData.message.text}`);
      try {
        mainWindow.webContents.send('receive-danmaku-from-control', danmakuData);
        log(`✅ Successfully sent danmaku to danmaku window`);
      } catch (error) {
        log(`❌ ERROR sending danmaku: ${error}`);
      }
    } else {
      log(`❌ ERROR: mainWindow is null or destroyed, cannot forward danmaku`);
    }
  });
}

// 单实例锁（仅在打包后生效，开发模式跳过以便调试）
const isDev = !app.isPackaged;

if (!isDev) {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

app.whenReady().then(() => {
  log('App ready');
  createDanmakuWindow();
  createControlWindow();  // 创建控制面板窗口
  createTray();
  setupIpcHandlers();  // 注册所有 IPC 处理器
  setupAutoUpdater({ getControlWindow: () => controlWindow, log });  // 自动更新（含 update:* IPC）
  setupLLM({ log });  // 吐槽姬 LLM 调用代理（llm:chat IPC）

  // 定期重新断言 z-order（防止截图、全屏应用等打乱层级）
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && isWindowVisible) {
      if (!mainWindow.isAlwaysOnTop()) {
        mainWindow.setAlwaysOnTop(true, 'floating');
        log(`[Z-ORDER] REASSERT: danmaku alwaysOnTop restored to floating`);
      }
      // 确保弹幕窗口始终保持鼠标穿透
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    // 控制面板层级重断言：macOS 按 controlWindowLevel 记录的目标层级恢复，
    // 避免覆盖输入框聚焦时设置的 normal 层级导致输入法候选框被遮挡
    if (controlWindow && !controlWindow.isDestroyed() && isWindowVisible) {
      const level = process.platform === 'darwin' ? controlWindowLevel : 'screen-saver';
      if (!controlWindow.isAlwaysOnTop()) {
        controlWindow.setAlwaysOnTop(true, level);
        log(`[Z-ORDER] REASSERT: control alwaysOnTop restored to ${level}`);
      }
    }
  }, 5000); // 每5秒检查一次

  // 注册快捷键打开 DevTools（开发和打包版都可用）
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    mainWindow?.webContents.toggleDevTools();
  });
});

function createTray() {
  // Tray 图标路径：开发模式用 appPath/assets，打包后用 resourcesPath/assets
  const isDev = !app.isPackaged;
  
  // 优先使用 ICO 格式（Windows），其次使用 PNG
  let iconPath: string;
  if (process.platform === 'win32') {
    iconPath = isDev
      ? path.join(app.getAppPath(), 'assets/icon.ico')
      : path.join(process.resourcesPath, 'assets/icon.ico');
  } else if (process.platform === 'darwin') {
    iconPath = isDev
      ? path.join(app.getAppPath(), 'assets/icon_1024.png')
      : path.join(process.resourcesPath, 'assets/icon_1024.png');
  } else {
    iconPath = isDev
      ? path.join(app.getAppPath(), 'assets/icon_16.png')
      : path.join(process.resourcesPath, 'assets/icon_16.png');
  }
  
  log(`Tray icon path: ${iconPath}`);
  log(`Tray icon exists: ${fs.existsSync(iconPath)}`);
  
  let icon = nativeImage.createFromPath(iconPath);
  
  // 如果 ICO/ICNS 加载失败，回退到 PNG
  if (icon.isEmpty()) {
    const fallbackPath = isDev
      ? path.join(app.getAppPath(), 'assets/icon_16.png')
      : path.join(process.resourcesPath, 'assets/icon_16.png');
    icon = nativeImage.createFromPath(fallbackPath);
    log(`Fallback to PNG icon: ${fallbackPath}`);
  }
  
  // macOS Tray 图标调整尺寸（不设置为模板图标，因为我们的图标是彩色的）
  if (process.platform === 'darwin' && !icon.isEmpty()) {
    icon = icon.resize({ width: 18, height: 18 });
  } else if (process.platform === 'win32' && !icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
  }
  
  log(`Tray icon isEmpty: ${icon.isEmpty()}, size: ${icon.getSize().width}x${icon.getSize().height}`);
  
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('云弹一下');
  log(`Tray created successfully`);

  const updateContextMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: isWindowVisible ? '隐藏弹幕窗口' : '显示弹幕窗口',
        click: () => {
          log('Tray menu: toggle visibility clicked');
          toggleWindowVisibility();
          updateContextMenu();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          log('Tray menu: quit clicked');
          app.quit();
        },
      },
    ]);
    tray?.setContextMenu(contextMenu);
  };

  // 左键和右键都弹出菜单
  tray.on('click', () => {
    log('Tray clicked');
    tray?.popUpContextMenu();
  });

  tray.on('right-click', () => {
    log('Tray right-clicked');
    tray?.popUpContextMenu();
  });

  updateContextMenu();
  log('Tray setup complete');
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (isWindowVisible) {
    mainWindow.hide();
    isWindowVisible = false;
    log(`[Z-ORDER] Danmaku window hidden`);
  } else {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    log(`[Z-ORDER] Danmaku window shown: floating`);
    isWindowVisible = true;
  }
}

app.on('window-all-closed', () => {
  app.quit();
});