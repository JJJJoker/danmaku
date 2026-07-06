# 自动更新功能（v1.4.0）代码审查修复报告

- **日期**：2026-07-06
- **分支**：`dev`
- **问题反馈**：自动更新功能（electron-updater + GitHub Releases + workflows 改造）实现完成后的自查代码审查，8 个角度（逐行扫描/被删行为审计/跨文件追踪/复用/简化/效率/实现高度/CLAUDE.md 约定）
- **结果**：定位 8 项确认/疑似问题，全部修复；另有 1 项误报经验证驳回。修复后 `npm run build:vite` 通过，tsc 与基线比对无新增错误（基线 16 = 当前 16），三个 workflow/action YAML 语法校验通过

> 功能本体设计与发版流程见 `docs/AUTO_UPDATE_RELEASE_GUIDE.md`，本报告只存档审查发现的缺陷与修复。

## 总体结论

新功能主链路（IPC 三方签名、双窗口路由、窗口重建状态恢复、产物命名迁移）经跨文件核对无破坏性问题。审查发现的缺陷集中在两类：一是**状态时序**——防重入标志滞后于用户操作窗口、快照与实时推送的竞态、错误状态覆盖已下载状态；二是 **CI 门槛强度**——发布校验只数数量不认文件名，兜不住"缺关键资产"的场景。全部按根因修复而非打补丁。

## 问题清单与修复

### 问题 1 — 下载防重入存在时序空窗，连点可重复触发下载

- **位置**：`src/main/updater.ts`（`update:download` 处理器）
- **问题**：原实现用 `busy` 变量做防重入，但它只在首个 `download-progress` 事件到达时才置为 `'downloading'`。慢网下从点击「下载更新」到首个进度事件之间有数秒空窗，期间 UI 仍显示 available 区块、按钮未禁用，连点会并发调用 `autoUpdater.downloadUpdate()`（仅靠 electron-updater 内部幂等兜底）。`update:check` 同理存在更短的空窗。
- **修复**：在 IPC 处理器入口**同步**推送状态（download 入口推 `downloading@0%`、check 入口推 `checking`），防重入判断改为读 `lastStatus.state`。第二次点击到达时状态已翻转，直接拦截；UI 也即时切到进度区块，按钮消失。

### 问题 2 — release.yml 发布门槛按资产数量校验，缺关键文件也能过

- **位置**：`.github/workflows/release.yml`（`publish` job）
- **问题**：草稿翻正式前只校验资产数 ≥ 7。若构建部分成功、数量凑够但缺的恰是 `latest.yml` 或 NSIS exe，门槛照样放行 → 全体存量客户端检查更新时 404，更新链路整体断裂且无人发现。
- **修复**：改为按文件名逐一断言 7 个关键资产（`latest.yml`、`latest-mac.yml`、win 的 exe/exe.blockmap/zip、mac 的 dmg/zip），任一缺失则报错不发布并列出缺失项。

### 问题 3 — downloaded 状态可被后续检查失败的 error 覆盖

- **位置**：`src/main/updater.ts`（`check()`）
- **问题**：更新已下载完成（UI 显示「重启并安装」）后，用户若再点「检查更新」且此次网络失败，`error` 状态覆盖 `lastStatus`，安装入口从 UI 消失（尽管更新包已在本地，退出时仍会静默安装，但用户失去主动安装入口）。
- **修复**：`check()` 入口增加守卫——`lastStatus` 为 `downloaded` 时直接返回，不再发起检查。

### 问题 4 — quitAndInstall 与单实例锁的重启竞争（疑似）

- **位置**：`src/main/updater.ts`（`update:install` 处理器）↔ `src/main/main.ts`（`requestSingleInstanceLock`）
- **问题**：`quitAndInstall(true, true)` 安装后自动重启新实例；打包态启用了单实例锁，若安装器拉起新 exe 时旧进程尚未完全退出，新实例抢锁失败会 `app.quit()` 自杀——用户看到"更新完成但应用没起来"。NSIS 通常会等旧进程退出，概率低，但代价为零的防御值得加。
- **修复**：`quitAndInstall` 前先 `app.releaseSingleInstanceLock()` 主动释放锁。

### 问题 5 — 控制面板挂载时快照与实时推送的竞态

- **位置**：`src/renderer/components/ControlPanel.tsx`（更新状态 `useEffect`）
- **问题**：原实现先发起异步 `getState()` 再订阅 `onStatus`。下载进行中重建窗口时，若实时进度推送（如 40%）先到、较慢的 `getState` 快照（30%）后解析，旧快照会覆盖新推送，进度条回退闪烁。
- **修复**：改为先订阅再拉快照，且快照仅在尚无实时状态时生效（`setUpdateStatus(prev => prev ?? s.status)`）。

### 问题 6 — 下载进度高频推送引发控制面板整树重渲染

- **位置**：`src/main/updater.ts`（`pushStatus`）
- **问题**：electron-updater 的 `download-progress` 不节流、每秒可触发多次，每次推送都让 900+ 行的 ControlPanel（含 framer-motion 子树）整体重新协调，下载期间面板可能掉帧——而用户此刻正盯着进度条。
- **修复**：在主进程 `pushStatus` 对 `downloading` 状态做 300ms 节流（`lastStatus` 仍实时更新保证快照正确，只是不高频跨 IPC 推送）。

### 问题 7 — 两个 workflow 四个 job 的构建前置五步逐字重复

- **位置**：`.github/workflows/build.yml` + `.github/workflows/release.yml`
- **问题**：checkout 后的 setup-node → cache → `npm ci` → `npm run build:vite` 在 4 个 job 中各复制一份。升级 Node 或改缓存策略需同步改 4 处，漂移是静默的（发版构建与 CI 冒烟用了不同 Node 却都是绿的）。
- **修复**：抽出 composite action `.github/actions/setup-build/action.yml`，四个 job 统一引用。

### 问题 8 — `busy` 与 `lastStatus.state` 双源并行维护 + 死代码

- **位置**：`src/main/updater.ts`
- **问题**：`busy` 在六个事件处理器里与 `pushStatus` 成对赋值，信息完全可由 `lastStatus.state` 推导；双源一旦漏改一处，防重入守卫与 UI 状态就会不一致（点击静默 no-op）。另外 `app:get-version` handler 全仓无调用方（`update:get-state` 已含 `currentVersion`）。
- **修复**：删除 `busy` 变量，防重入统一走 `isBusy()`（读 `lastStatus.state`，配合问题 1 的入口同步置状态）；删除 `app:get-version` 死代码。

### 误报驳回 — 可选链后接 `.then` 不会空引用崩溃

审查角度A曾报告 `window.electronAPI?.updater?.getState().then(...)` 在 `electronAPI` 为 undefined 时会抛 `TypeError`。经 node 实测驳回：JS 可选链短路覆盖整条链尾，表达式整体返回 undefined，`.then` 不会被求值。未修改。

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/main/updater.ts` | 问题 1/3/4/6/8：入口同步置状态、downloaded 守卫、释放单实例锁、进度节流、删 busy 与死代码 |
| `src/renderer/components/ControlPanel.tsx` | 问题 5：先订阅后拉快照，快照不覆盖实时状态 |
| `.github/workflows/release.yml` | 问题 2/7：关键资产按名断言；引用 composite action |
| `.github/workflows/build.yml` | 问题 7：引用 composite action |
| `.github/actions/setup-build/action.yml` | 问题 7：新建，四 job 共用的构建前置五步 |

## 验证

已完成：

1. ✅ `npm run build:vite` 通过（renderer + main + preload），preload 输出路径无漂移（仍为 `.vite/preload/preload.js`），main.js 中 electron-updater 保持 external
2. ✅ tsc 与 HEAD 基线比对无新增错误（基线 16 = 当前 16，历史遗留错误不计）
3. ✅ `release.yml` / `build.yml` / `action.yml` YAML 语法校验通过
4. ✅ 可选链误报经 node 实测驳回

桌面端手动验证步骤（`npm start` / 打包版）：

1. 打包版（Windows NSIS 安装）存在新版本时：连续快速双击「下载更新」→ 只触发一次下载，UI 即时切换为进度条
2. 下载完成后断网再点「检查更新」→「重启并安装」按钮应保持可见（本次修复后 check 直接返回）
3. 下载进行中关闭再打开控制面板窗口 → 进度条从当前进度继续显示，无回退闪烁
4. 点「重启并安装」→ 应用退出、静默安装、新版本自动启动（单实例锁不拦截）
5. 下载过程中观察控制面板交互流畅度（进度约 0.3s 刷新一次）
