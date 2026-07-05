import { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage } from 'electron';
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

  // 平台特定处理：设置窗口层级为最高
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    log('Danmaku window set to screen-saver level on macOS');
  } else if (process.platform === 'win32') {
    // Windows 上使用 'screen-saver' 层级确保弹幕在最顶层
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    log('Danmaku window set to screen-saver level on Windows');
  }

  // 防止窗口被激活/聚焦
  mainWindow.on('focus', () => {
    log('Danmaku window focused - blurring immediately');
    if (mainWindow) {
      mainWindow.blur();
      // Windows上可能需要额外处理
      if (process.platform === 'win32') {
        // 确保窗口不被激活
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    }
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
    resizable: false,
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

  // 设置较低的窗口层级（floating 低于 screen-saver）
  controlWindow.setAlwaysOnTop(true, 'floating');

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
  // 动态切换鼠标穿透
  ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean, options?: { forward: boolean }) => {
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
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
      mainWindow.setAlwaysOnTop(!isOnTop);
    }
  });

    // 输入模式切换：输入聚焦时降低窗口层级，让系统输入法候选框显示在最前面
  ipcMain.on('set-typing-mode', (_event, isTyping: boolean) => {
    if (mainWindow) {
      if (isTyping) {
        // 降低到 floating 级别，让 IME 候选框能显示在窗口上方
        mainWindow.setAlwaysOnTop(true, 'floating');
      } else {
        // 恢复到 screen-saver 级别
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
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
    log(`Received resize-control-window event: ${width}x${height}`);
    if (controlWindow && !controlWindow.isDestroyed()) {
      try {
        controlWindow.setSize(width, height);
        log(`✅ Control window resized to ${width}x${height}`);
      } catch (error) {
        log(`❌ Failed to resize control window: ${error}`);
      }
    } else {
      log(`❌ Control window is null or destroyed`);
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
        label: isWindowVisible ? '最小化（隐藏弹幕）' : '正常展开（显示弹幕）',
        click: () => {
          log('Tray context menu: toggle visibility clicked');
          toggleWindowVisibility();
          updateContextMenu();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          log('Tray context menu: quit clicked');
          app.quit();
        },
      },
    ]);
    tray?.setContextMenu(contextMenu);
  };

  // 点击 Tray 图标切换显示/隐藏
  tray.on('click', () => {
    log('Tray clicked!');
    toggleWindowVisibility();
    updateContextMenu();
  });

  tray.on('right-click', () => {
    log('Tray right-clicked!');
  });

  updateContextMenu();
  log('Tray setup complete');
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (isWindowVisible) {
    mainWindow.hide();
    controlWindow?.hide();
    isWindowVisible = false;
  } else {
    mainWindow.show();
    controlWindow?.show();
    // 恢复窗口层级
    if (process.platform === 'darwin') {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    } else {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    isWindowVisible = true;
  }
}

app.on('window-all-closed', () => {
  app.quit();
});