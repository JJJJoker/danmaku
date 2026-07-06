# 软件自动更新与发版指南

> 日期：2026-07-06 ｜ 分支：dev ｜ 适用版本：v1.4.0 起
>
> 本文为功能设计存档。日常发版操作请用 `/release` skill（`.claude/skills/release/SKILL.md`），
> 版本号统一由 `scripts/bump-version.js` 管理（package.json / lock / README / 更新日志四处同步 + `--check` 校验）。

## 一、功能概览

客户端从 GitHub Releases（`JJJJoker/danmaku`，公开仓库，免 token）检查与获取更新：

| 安装形态 | 更新能力 | 行为 |
|---|---|---|
| Windows NSIS 安装版 | 全自动（`auto`） | 提示新版本 → 用户确认下载（带进度）→「重启并安装」；不点安装则正常退出时静默完成安装 |
| Windows zip 便携版 | 提示引导（`download-page`） | 运行中的 exe 被系统锁定且无安装器，无法自更新；提示新版本 +「前往下载页」 |
| macOS（未签名） | 提示引导（`download-page`） | 未签名应用无法走 Squirrel.Mac 自动安装；提示新版本 +「前往下载页」 |
| 开发环境（未打包） | 不支持（`none`） | 「说明」Tab 显示"开发模式不支持检查更新" |

交互入口都在控制面板「说明」Tab 的「🔄 软件更新」区块：

- 应用启动 10 秒后自动检查一次；发现新版本时「说明」Tab 按钮出现红点角标（不弹窗、不打断弹幕）
- 可随时手动点「检查更新」；自动检查失败静默，手动检查失败会提示
- Windows 安装版形态识别：exe 同目录存在 NSIS 卸载器（`Uninstall 云弹一下.exe`）即判定为安装版

## 二、发版流程（合并即发版，owner 零额外操作）

1. **开发者**：在 `dev` 分支修改 `package.json` 的 `version`（如 `1.4.0`），同时更新「说明」Tab 的静态更新日志（`ControlPanel.tsx` about 区块；标题版本号已动态化无需改），提 PR
   - PR 标题/描述写清改动内容——会被 `--generate-notes` 自动收进 Release 更新说明，即客户端里用户看到的"更新说明摘要"
2. **仓库 owner**：审查后点合并，**之后无需任何操作**
3. **CI 自动完成**（`.github/workflows/release.yml`）：
   - `prepare`：检测 `package.json` 版本号没有对应的已发布 Release → 自动打 tag `v{version}` → 预建草稿 Release（自动生成更新说明）
   - `release-windows` / `release-macos`：双平台构建，产物上传到草稿 Release（约 10-15 分钟）
   - `publish`：校验资产 ≥ 7 个后把草稿翻为正式 Release（原子上线，避免用户下载到残缺资产）
4. **存量用户**：启动 10 秒后即可检测到新版本

日常合并不改版本号时，release.yml 只跑 `prepare` 一个 job 几秒即结束，不会误发版。

### Release 资产清单（一个都不能删）

| 资产 | 用途 |
|---|---|
| `yundan-{v}-win-x64.exe` | NSIS 安装包（自动更新下载的就是它） |
| `yundan-{v}-win-x64.exe.blockmap` | 增量下载校验 |
| `latest.yml` | Windows 更新元数据（客户端检查更新先拉它） |
| `yundan-{v}-win-x64.zip` | Windows 便携版 |
| `yundan-{v}-mac-arm64.dmg` | macOS 安装镜像 |
| `yundan-{v}-mac-arm64.zip` + `.blockmap` | macOS 更新元数据引用 |
| `latest-mac.yml` | macOS 更新元数据（检测新版本用） |

> 产物文件名必须是 ASCII（`artifactName: yundan-...`）：GitHub 会把资产名里的中文替换成点号，导致 `latest.yml` 与实际文件名失配、客户端下载 404。**不要**把 `artifactName` 改回中文。

### 异常处理

- **某平台构建失败**：草稿 Release 留在 Releases 页不会发布（`publish` 依赖双平台成功）。修复后在 Actions 页对 release.yml 手动 `workflow_dispatch` 重跑：已存在的 tag/草稿会被复用，缺失资产补齐后自动发布
- **润色更新说明**：owner 可随时直接编辑 Release 正文，之后检查更新的客户端即看到新文案
- **回滚**：删除有问题的 Release（或标为 pre-release），客户端会认为最新版本是上一个正式 Release

## 三、已知限制与说明

- **Windows 未签名**：下载安装时可能出现 SmartScreen「已保护你的电脑」提示（点"仍要运行"）与 UAC 确认，属预期行为。electron-builder 配置中**不要加 `publisherName`**——加了会让 electron-updater 校验安装包签名，未签名包必失败
- **macOS 未签名/未公证**：无法全自动更新（Squirrel.Mac 强制要求签名），只能引导用户去下载页；首次打开需右键→打开绕过 Gatekeeper
- **zip 便携版点「前往下载页」后**：用户需手动下载新版 zip 解压替换；如改用 NSIS 安装包安装则以后可享受全自动更新
- `win.target` 中 **nsis 必须排在 zip 之前**（`latest.yml` 的 `path` 取第一个产物，必须指向 exe 安装包）
- preload.ts **禁止 import `../shared/types`**：`tsconfig.preload.json` 未设 `rootDir`，引入会使输出从 `.vite/preload/preload.js` 漂移到 `.vite/preload/main/preload.js`，打包后白屏（main.ts 硬编码了前者路径）

## 四、真机验证步骤（需桌面端执行）

首次上线（v1.4.0 是第一个带更新功能的版本，只能作为更新起点）：

1. v1.4.0 PR 合并、CI 自动发版完成后，Windows 机器下载 `yundan-1.4.0-win-x64.exe` 安装
2. bump `1.4.1` 再提一个 PR（可只改版本号），合并等 CI 发版完成
3. 在已装的 1.4.0 上验证：
   - 启动 10 秒后「说明」Tab 出现红点
   - 打开「说明」Tab：显示"发现新版本 v1.4.1" + 更新说明摘要
   - 点「下载更新」：进度条推进 → "下载完成" → 点「重启并安装」→ 应用重启后标题显示 v1.4.1
   - 断网后点「检查更新」：显示"检查更新失败"提示，应用不崩溃
4. Windows zip 便携版解压运行 1.4.0：应显示「前往下载页」而非「下载更新」，点击跳转浏览器
5. macOS 安装 1.4.0：检测到新版本后显示「前往下载页」，点击跳转浏览器

## 五、本次改动文件

| 文件 | 改动 |
|---|---|
| `package.json` | 新增 `electron-updater` 依赖、`repository`、`build.publish`（GitHub/draft）、ASCII `artifactName`、win 增加 nsis target |
| `vite.main.config.ts` | `external` 增加 `electron-updater`（依赖树含动态 require，不能被 vite 打包） |
| `src/shared/types.ts` | 新增 `UpdateCapability` / `UpdateInfoLite` / `UpdateStatus` / `UpdateState`，`ElectronAPI` 增加 `updater` 命名空间 |
| `src/main/updater.ts` | 新建：capability 判定、autoUpdater 事件 →`update:status` 推送、`update:*` IPC、启动延迟自动检查 |
| `src/main/main.ts` | `whenReady` 中挂接 `setupAutoUpdater` |
| `src/main/preload.ts` | 暴露 `electronAPI.updater`（any 范式，见上文限制） |
| `src/renderer/components/ControlPanel.tsx` | about Tab 动态版本号 +「软件更新」区块 + Tab 红点角标 |
| `src/renderer/styles/global.css` | 新增 `.cp-tab-badge` / `.cp-update-*` 样式 |
| `.github/workflows/release.yml` | 新建：合并即发版四段式（prepare → win/mac → publish，发布前按名断言关键资产） |
| `.github/workflows/build.yml` | 移除 tag 触发；artifact glob 改 `yundan-*`；新增 NSIS 安装包 artifact |
| `.github/actions/setup-build/action.yml` | 新建 composite action：两个 workflow 四个构建 job 共用的 checkout 后五步前置（Node/缓存/npm ci/build:vite），改 Node 版本或缓存策略只改这一处 |
