# 开源化安全整改报告：移除硬编码服务器信息与 P2P 模式

- **日期**：2026-07-06
- **分支**：`dev`（随 v1.5.0 发版合入 main）
- **问题反馈**：仓库将作为开源项目维护，用户提出「硬编码服务器信息是不是不行」，要求给出方案并处理提交历史
- **结果**：定位到 3 类泄露（服务器 IP、TURN 真实凭据、历史全污染），完成 4 个提交的代码/文档整改；构建与 tsc 基线验证通过；提交历史重写与服务器侧轮换以待执行清单列出

## 总体结论

服务器 IP `REDACTED_SERVER_IP` 与自建 TURN 服务器的真实凭据（`root/tth012...`，本报告不再复现全文）自根提交起就硬编码在源码和大量文档中，污染了全部提交历史。整改思路：客户端默认服务器地址本质是公开信息（必然打进发布安装包），所以方案不是"藏地址"而是**让源码与仓库不含任何真实基础设施信息**——地址改为「设置自定义 > CI 构建期注入 > 空」三级解析；泄露的 TURN 凭据属于真实机密，必须在服务器侧轮换/停用（历史重写不能撤回已泄露的值）。P2P 模式（TURN 的唯一使用方）本身是遗留代码（默认走服务器中继、UI 无入口），借此机会彻底移除。

## 问题清单与修复

### 问题 A — 服务器地址硬编码在源码

- **位置**：原 `src/renderer/services/peerService.ts`（`ServerConnection.SERVER_URL`、`fetchServerStats`）
- **问题**：`ws://<IP>:8080` 与 `http://<IP>:8081/stats` 写死在源码，开源后暴露个人云服务器；换服务器需要改代码发版
- **修复**：新增 `src/renderer/services/serverConfig.ts`，解析优先级为 设置 Tab 自定义地址 > 构建期 `VITE_DANMAKU_SERVER_URL`（官方发版由 GitHub 仓库变量 `DANMAKU_SERVER_URL` 经 CI 注入）> 空（连接时友好报错）；stats 地址按「弹幕端口 +1」约定从服务器地址派生。设置 Tab 新增「服务器」区块（`ControlPanel.tsx`），存 localStorage 键 `funapp-server-url`

### 问题 B — TURN 真实凭据泄露（最高严重级）

- **位置**：原 `peerService.ts` 三处 ICE 配置；`TEST_TURN_SERVER.md`、`QUICK_TEST_TURN.md` 两份文档
- **问题**：自建 TURN 服务器（`turn:<IP>:3478`）的账号口令明文入库，任何人可用该凭据中继流量；且凭据已随历史提交和已发布安装包扩散
- **修复**：随 P2P 模式整体删除（见问题 C）；文档删除。**代码删除不等于止损**——服务器侧轮换见「待执行操作」

### 问题 C — P2P 遗留模式（TURN 的唯一使用方）

- **位置**：`peerService.ts`（1255 行）、`connectionStore.ts` 各 action 的 `connectionMode` 分支
- **问题**：P2P 是遗留代码：默认模式为 server，UI 中无切换入口（`setConnectionMode` 全仓库零调用），却带着 peerjs 依赖、TURN 凭据和 27 个 tsc 遗留错误
- **修复**：整体移除。`ServerConnection` 拆分为独立模块 `serverConnection.ts` 并改用 `shared/types.ts` 的完整 `ServerMessage` 协议（顺带消除 21 个因本地窄版协议类型导致的 tsc 错误）；卸载 peerjs；删除根目录 6 个 peerjs 测试物

### 问题 D — 文档/脚本中的运维信息泄露

- **位置**：约 19 份 md（含大量 `ssh root@<IP>`）、5 个部署脚本
- **问题**：真实 IP、root 登录方式随文档入库
- **修复**：24 份过时进度文档与 TURN 部署物删除；保留的部署文档 IP 全部占位符化（`<你的服务器IP>`）；部署脚本改为环境变量/参数注入（`deploy.sh` 用 `SERVER_IP` 环境变量、ps1 用 `DANMAKU_SERVER_IP`、`test-websocket.ps1` 加 `-ServerUrl` 参数）

### 附带修复 — 有密码房间断线重连失败

- **位置**：`serverConnection.ts` `attemptReconnect`
- **问题**：重连时不带密码调 `joinRoom`，有密码房间重连必然被拒（存量 bug）
- **修复**：重连时带上 `ServerConnection.getRoomPassword(roomId)` 缓存密码，并补 `.catch` 防未配置地址时的 unhandled rejection

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/renderer/services/serverConnection.ts` | 新增：ServerConnection 独立模块（自 peerService 拆出），接地址解析、修重连密码 |
| `src/renderer/services/serverConfig.ts` | 新增：服务器地址三级解析 + stats 地址派生 |
| `src/renderer/services/peerService.ts` | 删除（1255 行，含 TURN 凭据） |
| `src/renderer/stores/connectionStore.ts` | 移除 connectionMode 与全部 P2P 分支；新增 `serverUrl`/`setServerUrl` |
| `src/renderer/components/ControlPanel.tsx` | 设置 Tab 新增「服务器」区块；更新日志 v1.5.0 |
| `src/renderer/components/RoomPanel.tsx`、`src/renderer/services/botService.ts`、`src/renderer/App.tsx` | import 路径与文案调整 |
| `src/shared/types.ts` | 删 `PeerMessage`/`RoomInfo`；`joinSuccess` 补 `password?/hasPassword?` |
| `src/renderer/vite-env.d.ts` | 新增：`VITE_DANMAKU_SERVER_URL` 类型声明 |
| `.github/workflows/release.yml`、`build.yml` | 4 处构建 step 注入 `VITE_DANMAKU_SERVER_URL: ${{ vars.DANMAKU_SERVER_URL }}` |
| `.gitignore`、`.env.example` | 忽略 `.env*`；示例改为 `VITE_DANMAKU_SERVER_URL` |
| `README.md`、`CLIENT_USAGE.md`、`QUICK_START.md`、`danmaku-server/*.md`、部署脚本 | P2P 描述改为 WebSocket 中继；IP 占位符化/参数化 |
| 24 份过时文档、TURN 部署物、peerjs 测试物 | 删除 |

## 验证

已完成：

1. ✅ `npm run build:vite` 通过（4 个提交后各验证一次）
2. ✅ tsc 与基线比对：30 → 3，无新增错误（剩余 3 个为与本次无关的历史遗留：App.tsx never 收窄、ControlPanel WebkitAppRegion、danmakuStore trackIndex）
3. ✅ 工作树 grep 真实 IP 与 TURN 凭据：零命中
4. ✅ 构建产物注入校验：不带 `VITE_DANMAKU_SERVER_URL` 构建的 bundle 中无任何服务器地址；带变量构建后地址正确内联
5. ✅ `node scripts/bump-version.js --check` 版本一致性通过

桌面端手动验证步骤（`npm start` 或安装包）：

1. 不配置服务器地址（开发态无 `.env.local`）→ 创建/加入房间应弹出错误「未配置服务器地址，请在「设置」中填写」
2. 设置 Tab「服务器」区块填 `ws://<你的服务器IP>:8080` → 重新创建房间应连接成功，房间/弹幕收发正常
3. CI 官方安装包（仓库变量注入后构建）→ 开箱不填任何地址即可联机
4. 有密码房间连接后在服务器 `pm2 restart danmaku-server` → 客户端应自动重连成功（验证重连带密码）
5. 吐槽姬（随 v1.5.0 一同发布）：房主启动后 AI 正常发送吐槽弹幕

## 待执行操作（代码之外，须人工完成）

### 1. GitHub 仓库变量（发版前）

Settings → Secrets and variables → Actions → Variables 新建 `DANMAKU_SERVER_URL = ws://<你的服务器IP>:8080`（将来换域名/服务器只改这里）。

### 2. 服务器侧轮换与加固（尽快，凭据已泄露）

- **停用/卸载 coturn（3478 端口）**——P2P 已移除，TURN 不再需要；如仍要保留服务则必须更换泄露的账号口令
- SSH 加固：禁用 root 密码登录，改用密钥登录
- （可选）为服务器挂域名 + wss/TLS，之后只需更新仓库变量与客户端设置

### 3. 重写提交历史（v1.5.0 Release 确认正常后）

IP 与凭据自根提交污染全部历史（25/25 提交），操作步骤：

```bash
git clone --mirror https://github.com/JJJJoker/danmaku.git danmaku-backup.git  # 备份留底
git clone https://github.com/JJJJoker/danmaku.git danmaku-rewrite && cd danmaku-rewrite
pip install git-filter-repo
cat > /tmp/replacements.txt <<'EOF'
REDACTED_SERVER_IP==>REDACTED_SERVER_IP
<TURN凭据原文>==>REDACTED_CREDENTIAL
EOF
git filter-repo --replace-text /tmp/replacements.txt   # branches + tags 一并重写
git remote add origin https://github.com/JJJJoker/danmaku.git
git push origin --force --all && git push origin --force --tags
```

注意事项：

- Release 挂在 tag 名上，强推后资产（latest.yml/exe/dmg）与 electron-updater 自动更新不受影响；push main 会触发 release.yml，但 v1.5.0 已发版 → 版本门禁自动跳过
- 重写后**所有协作者与本机必须重新 clone**，旧 clone 废弃（继续 push 会把旧历史带回来）
- GitHub 上按旧 SHA 仍可访问缓存提交与 PR 引用（refs/pull/1..3），需联系 GitHub Support 清理（官方流程 "Removing sensitive data from a repository"）
- 验证：全新 clone 上 `git log -S 'REDACTED_SERVER_IP' --all` 与凭据同款搜索均应为空
