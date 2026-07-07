import { app, ipcMain, shell, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus, UpdateCapability, UpdateInfoLite, UpdateState } from '../shared/types';
const path = require('path');
const fs = require('fs');

// 更新源为双源策略：构建期注入了自建服务器地址时优先自建源（国内下载快），
// 检查失败自动回退 GitHub Releases（公开仓库，客户端免 token）；未注入时纯 GitHub。
// 下载页给 mac 与 zip 便携版用，保持指向 GitHub（权威发布源）
const DOWNLOAD_PAGE = 'https://github.com/JJJJoker/danmaku/releases/latest';

// GitHub 回退源：与 package.json build.publish 保持一致
const GITHUB_FEED = { provider: 'github', owner: 'JJJJoker', repo: 'danmaku' } as const;
// 自建更新源：__DANMAKU_UPDATE_URL__ 由 vite.main.config.ts 构建期注入，空串表示未配置。
// useMultipleRangeRequest: false —— 服务端只实现了单段 Range，多段请求会被降级为全量 200
const GENERIC_FEED = __DANMAKU_UPDATE_URL__
  ? ({ provider: 'generic', url: __DANMAKU_UPDATE_URL__, useMultipleRangeRequest: false } as const)
  : null;

// 启动后延迟自动检查，避开窗口创建/渲染高峰
const AUTO_CHECK_DELAY_MS = 10_000;

// releaseNotes 展示上限（剥标签后的纯文本）
const RELEASE_NOTES_MAX_LEN = 600;

/**
 * 判定本安装形态的更新能力：
 * - 开发环境（未打包）无 app-update.yml，不支持检查更新
 * - macOS 未签名，Squirrel.Mac 装不上，只能提示跳转下载页
 * - Windows NSIS 安装版目录下有卸载器（Uninstall xxx.exe），可全自动更新；
 *   zip 便携版没有安装器且运行中 exe 被锁定，无法自更新，同样走下载页
 */
function detectCapability(log: (msg: string) => void): UpdateCapability {
  if (!app.isPackaged) return 'none';
  if (process.platform === 'darwin') return 'download-page';
  if (process.platform === 'win32') {
    try {
      const exeDir = path.dirname(app.getPath('exe'));
      const hasUninstaller = fs
        .readdirSync(exeDir)
        .some((name: string) => /^Uninstall .+\.exe$/i.test(name));
      return hasUninstaller ? 'auto' : 'download-page';
    } catch (err) {
      log(`[Updater] 检测安装形态失败，回退为 download-page: ${err}`);
      return 'download-page';
    }
  }
  // 其他平台（linux 等）保守处理
  return 'download-page';
}

// 归一化 releaseNotes：GithubProvider 返回 HTML 字符串或分版本数组，剥标签、截断
function normalizeReleaseNotes(notes: unknown): string | undefined {
  let text = '';
  if (typeof notes === 'string') {
    text = notes;
  } else if (Array.isArray(notes)) {
    text = notes
      .map((n) => `${n?.version ? `v${n.version}: ` : ''}${n?.note ?? ''}`)
      .join('\n');
  }
  text = text.replace(/<[^>]+>/g, '').trim();
  if (!text) return undefined;
  return text.length > RELEASE_NOTES_MAX_LEN ? `${text.slice(0, RELEASE_NOTES_MAX_LEN)}…` : text;
}

export function setupAutoUpdater(opts: {
  getControlWindow: () => BrowserWindow | null;
  log: (msg: string) => void;
}) {
  const { getControlWindow, log } = opts;

  const capability = detectCapability(log);
  log(`[Updater] capability=${capability}, version=${app.getVersion()}`);

  // 最近一次状态缓存：控制面板窗口重建后经 update:get-state 恢复。
  // 同时是防重入的唯一依据（checking/downloading 中忽略重复请求），
  // 请求入口处同步置状态，堵住"已发起但事件未到"的重入窗口
  let lastStatus: UpdateStatus | null = null;
  // downloading 进度节流：控制面板是大组件，高频 setState 会引起整树重渲染
  let lastProgressPushAt = 0;
  // 自建源检查失败待回退 GitHub 期间置 true：error 事件只记日志不推状态，
  // 避免 UI 先闪一次 error 再回到 checking（checkForUpdates 的 rejection 与 error 事件同源）
  let suppressErrorStatus = false;

  function pushStatus(status: UpdateStatus) {
    if (status.state === 'downloading') {
      const now = Date.now();
      if (now - lastProgressPushAt < 300 && lastStatus?.state === 'downloading') {
        lastStatus = status;
        return;
      }
      lastProgressPushAt = now;
    } else {
      log(`[Updater] status: ${JSON.stringify(status)}`);
    }
    lastStatus = status;
    const win = getControlWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:status', status);
    }
  }

  function isBusy() {
    return lastStatus?.state === 'checking' || lastStatus?.state === 'downloading';
  }

  function toInfoLite(info: { version: string; releaseNotes?: unknown; releaseDate?: string }): UpdateInfoLite {
    return {
      version: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      releaseDate: info.releaseDate,
    };
  }

  if (capability !== 'none') {
    // 用户确认后才下载；用户不点"重启安装"时，正常退出也静默完成安装（仅 NSIS 生效）
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (m: unknown) => log(`[Updater][info] ${m}`),
      warn: (m: unknown) => log(`[Updater][warn] ${m}`),
      error: (m: unknown) => log(`[Updater][error] ${m}`),
      debug: (m: unknown) => log(`[Updater][debug] ${m}`),
    };

    autoUpdater.on('checking-for-update', () => {
      pushStatus({ state: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
      pushStatus({ state: 'available', info: toInfoLite(info) });
    });
    autoUpdater.on('update-not-available', () => {
      pushStatus({ state: 'not-available' });
    });
    autoUpdater.on('download-progress', (progress) => {
      pushStatus({
        state: 'downloading',
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      pushStatus({ state: 'downloaded', info: toInfoLite(info) });
    });
    autoUpdater.on('error', (err) => {
      if (suppressErrorStatus) {
        log(`[Updater] 自建源出错（待回退 GitHub，不推送状态）: ${err?.message ?? err}`);
        return;
      }
      // 错误只推状态不弹窗：自动检查失败静默，手动检查由渲染端决定展示
      pushStatus({ state: 'error', message: (err?.message ?? String(err)).slice(0, 200) });
    });
  }

  async function check() {
    if (capability === 'none') {
      pushStatus({ state: 'error', message: '开发环境不支持检查更新' });
      return;
    }
    if (isBusy()) return;
    // 已下载完成时不再检查：避免网络失败的 error 状态覆盖 downloaded，把"重启并安装"入口冲掉
    if (lastStatus?.state === 'downloaded') return;
    pushStatus({ state: 'checking' });
    // 双源检查：每次都从自建源开始（不做会话内粘性回退，服务器恢复后流量自动切回），
    // 自建源失败回退 GitHub。回退只发生在检查阶段：downloadUpdate 复用本次检查
    // 命中的 provider 缓存，下载中途失败不切源，用户再点"检查更新"会重跑整条链路
    if (GENERIC_FEED) {
      autoUpdater.setFeedURL(GENERIC_FEED);
      suppressErrorStatus = true;
      try {
        await autoUpdater.checkForUpdates();
        suppressErrorStatus = false;
        return;
      } catch (err) {
        suppressErrorStatus = false;
        log(`[Updater] 自建源检查失败，回退 GitHub: ${(err as Error)?.message ?? err}`);
        autoUpdater.setFeedURL(GITHUB_FEED);
        // 维持 checking 状态，UI 对回退无感知
        pushStatus({ state: 'checking' });
      }
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // rejection 与 error 事件同源，事件回调里已推送 error 状态
    }
  }

  // ========== IPC ==========
  ipcMain.handle('update:get-state', (): UpdateState => ({
    capability,
    currentVersion: app.getVersion(),
    status: lastStatus,
  }));

  ipcMain.handle('update:check', () => check());

  ipcMain.handle('update:download', async () => {
    if (capability !== 'auto' || isBusy()) return;
    // 入口同步置状态：downloadUpdate 到首个 download-progress 事件之间有数秒空窗，防连点重复下载
    pushStatus({ state: 'downloading', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      // 同上，error 事件已推送状态
    }
  });

  ipcMain.on('update:install', () => {
    log('[Updater] quitAndInstall');
    // 先释放单实例锁：避免安装器重启新实例时旧进程未退净、新实例抢锁失败自杀
    app.releaseSingleInstanceLock();
    // 静默安装并自动重启（NSIS assisted 安装器走 /S）
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  ipcMain.on('update:open-download-page', () => {
    shell.openExternal(DOWNLOAD_PAGE);
  });

  // 启动自动检查一次：mac / zip 便携版也检查，发现新版走「前往下载页」提示
  if (capability !== 'none') {
    setTimeout(() => {
      check();
    }, AUTO_CHECK_DELAY_MS);
  }
}
