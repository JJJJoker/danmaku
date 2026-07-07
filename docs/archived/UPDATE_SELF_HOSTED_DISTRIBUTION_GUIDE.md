# 自动更新迁移到自建服务器分发（GitHub 回退）功能文档

- **日期**：2026-07-07
- **分支**：`dev`
- **版本**：v1.5.1
- **需求**：客户端自动更新原先完全依赖 GitHub Releases，国内下载慢。改为发版时把资产同步推送到自建弹幕服务器，客户端更新**优先从自建服务器下载，失败自动回退 GitHub**。

## 总体设计

electron-updater 的更新源由 electron-builder 的 `publish` 配置在打包时写入 `app-update.yml`，运行时 `autoUpdater` 是 provider 无关的。本方案在客户端运行时用 `setFeedURL` 做双源切换：每次检查更新先用 generic 源（自建服务器），失败时静默切回 GitHub 重查一次，UI 全程无感知。

服务器端复用现有 danmaku-server 的 HTTP 服务（8081，原只有 `/stats`），新增 `/updates/<文件>` 静态路由，提供路径穿越防护、单段 Range（差量更新用）、大文件流式传输。CI 发版流程在 GitHub 正式发布**之后**新增一个 job，用 SSH/rsync 把 7 个资产推送到服务器。

GitHub Releases 始终双发布，是权威源与回退源。

### 关键前提

electron-builder 生成的 `latest.yml` 里文件字段是相对文件名（如 `yundan-1.5.1-win-x64.exe`），generic provider 相对 feed URL 解析——所以 GitHub 上的同一份 yml 原样放到自建服务器即可用，无需改写。

### 生效时间差（重要）

存量 v1.5.0 客户端里没有双源 updater 逻辑，只会走 GitHub。因此 v1.5.0 → v1.5.1 这一跳仍走 GitHub；用户装上 v1.5.1 后，**下一次**检查更新才会优先走自建服务器。

## 实现要点

### 客户端 feed 注入

新增独立仓库变量 `DANMAKU_UPDATE_URL`（完整 URL，如 `http://<IP>:8081/updates`），构建期用 vite `define` 注入全局常量 `__DANMAKU_UPDATE_URL__`。为空时纯走 GitHub，天然是回滚开关。不从 `DANMAKU_SERVER_URL` 派生——更新分发将来独立演进（TLS 域名/CDN），改一个 var 即可切换。

main 进程是 vite lib 模式（CJS）构建，用 `define` 而非 `import.meta.env`（后者在 tsconfig.main.json 的 CommonJS 配置下会报 TS1343）。

### 双源回退逻辑

`src/main/updater.ts` 的 `check()`：若注入了自建源，先 `setFeedURL(generic)` + 抑制 error 事件 + `checkForUpdates()`；成功即返回；失败则记日志、`setFeedURL(github)`、维持 checking 状态再查一次。**每次 check 都从 generic 开始**（不做会话内粘性回退，服务器恢复后流量自动切回）。回退只在检查阶段做——`downloadUpdate()` 复用本次检查命中的 provider 缓存，下载中途失败不切源，用户再点"检查更新"会重跑整条链路。

`useMultipleRangeRequest: false` 让差量下载只发单段 Range，与服务端实现配套。

### 服务器静态路由

新文件 `danmaku-server/src/updates-static.ts`：

- 路径穿越双保险：文件名白名单 `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` + `path.resolve` 校验在 `UPDATES_DIR` 前缀内，任何不过（含 decode 异常）→ 404
- Cache-Control：`.yml` → `no-cache`，其余（文件名含版本号，不可变）→ `immutable`
- 单段 Range：`bytes=start-end` / `start-` / `-N` → 206；越界 → 416；多段/畸形 → 忽略回 200 全量（electron-updater 差量失败自动回退全量，安全兜底）
- 流式：`fs.createReadStream` pipe，禁 readFile（exe/dmg 近百 MB）；stream error → `res.destroy()`，res close → `stream.destroy()`
- 空文件与 HEAD 只回头不开流（size 为 0 时 `createReadStream` 会抛参数错）

### CI upload job

`release.yml` 新增 `upload-update-server` job，`needs: [prepare, publish]`（GitHub 正式发布之后），`if` 以 `DANMAKU_UPDATE_URL` 非空为总开关。步骤：`gh release download` 7 资产并断言齐全 → 写 SSH 私钥与 known_hosts → rsync 推送（先二进制、`latest.yml` 最后 `.tmp` + 远端 `mv -f` 原子生效）→ 清理只留最近 3 版 → curl 自检 yml 版本与 Range 206。

上传失败只让该 job 红，GitHub 发版不受影响，客户端走回退。恢复方式：Actions 页 "Re-run failed jobs" 只重跑该 job（不能整个 workflow 重跑，prepare 会判已发布跳过一切）。

## 修改文件

| 文件 | 改动 |
|------|------|
| `vite.main.config.ts` | 加 `define` 注入 `__DANMAKU_UPDATE_URL__` |
| `forge.env.d.ts` | 全局常量声明 |
| `tsconfig.main.json` | include 加 `forge.env.d.ts`（否则 CJS 配置下报 TS2304） |
| `src/main/updater.ts` | 双源 feed + 回退逻辑 + error 抑制 |
| `danmaku-server/src/updates-static.ts` | 新增：`/updates` 静态路由（穿越防护/Range/流式） |
| `danmaku-server/src/server.ts` | 接线 `/updates` 路由 |
| `.github/workflows/release.yml` | 两构建 job 注入 env + 新增 upload job |
| `danmaku-server/deploy.sh` | updates 目录 / ufw 8081 / rsync / UPDATES_DIR env |
| `danmaku-server/DEPLOYMENT.md` | 新增"客户端更新分发"章节 |

## 新增 secrets / vars（GitHub 仓库配置）

| 类型 | 名称 | 内容 |
|---|---|---|
| Variable | `DANMAKU_UPDATE_URL` | `http://<IP>:8081/updates`，兼总开关 |
| Secret | `UPDATE_SSH_KEY` | 专用 ed25519 私钥 |
| Secret | `UPDATE_SSH_HOST` | 服务器 IP |
| Secret | `UPDATE_SSH_USER` | SSH 用户 |
| Secret | `UPDATE_SSH_PORT` | 可选，缺省 22 |
| Secret | `UPDATE_SSH_KNOWN_HOSTS` | `ssh-keyscan` 一次性产出 |

## 已知取舍

更新走纯 HTTP + 裸 IP，链路上存在中间人篡改风险（yml 与安装包可被整体替换；Windows 包未签名）。已接受。**升级路径**：注册域名 → nginx/Caddy 挂 Let's Encrypt 反代 8081 → 仅把 `DANMAKU_UPDATE_URL` 改为 https 域名，客户端与 CI 零代码改动。

## 验证

已完成（本机 headless）：

1. ✅ 注入验证：`DANMAKU_UPDATE_URL=http://127.0.0.1:9999/updates npm run build:vite` 后 `main.js` 含 generic 源 + GitHub 回退源；不带 env 构建则无残留
2. ✅ 类型检查：`/type-check` 基线比对无新增错误（修了一处：tsconfig.main.json 需 include `forge.env.d.ts`）
3. ✅ 服务器路由：本地起服务 curl 全绿——200 + no-cache、Range 206、越界 416、多段降级 200、HEAD 头齐全、空文件 200、穿越攻击（`../`/URL 编码/隐藏文件）全 404、`/stats` 不受影响
4. ✅ workflow：YAML 解析通过；清理旧版本管道本地 dry-run 正确保留最新 3 版

服务器与桌面端手动验证步骤：

1. **服务器准备**：部署新 `dist/*.js` → `mkdir /opt/danmaku-server/updates` → `ufw allow 8081/tcp` + 云安全组放行 8081 入站 → 装 rsync → `pm2 restart` → 外网 `curl http://<IP>:8081/updates/latest.yml` 通
2. **端到端**：Windows 装旧版 NSIS → 发新 patch 版走完整 workflow → 客户端"检查更新"从自建源发现并下载安装（看 `[Updater]` 日志确认 generic URL）
3. **回退**：服务器停 8081 后检查更新 → 日志出现"自建源检查失败，回退 GitHub"，UI 全程只显示 checking→available，无 error 闪烁；恢复后自动回 generic
4. **mac**：新版提示 + "前往下载页"仍跳 GitHub releases 页
