# 服务端 SQLite 持久化与自动部署 workflow

- **日期**：2026-07-07
- **分支**：`dev`
- **性质**：功能设计/实现文档存档（部署操作指南长期有效）
- **目标**：让服务端部署/重启对用户无感——房间状态跨重启存活 + GitHub Actions 一键部署

## 设计

### 1. SQLite 持久化（`danmaku-server/src/persistence.ts`）

**持久化什么**：只存"慢变"的元数据，写入频率 = 建房/删房/改密码/空房计时变更/新 IP，均为低频事件。

| 表 | 字段 | 用途 |
|---|---|---|
| `rooms` | room_id、created_at、password、host_user_id、empty_since | 房间元数据；host_user_id 兼作重启后重建 hostRooms 映射的依据 |
| `ip_user` | ip、user_id | IP→userId 身份映射——重启后同 IP 重连拿回同一身份，房主权限因此存活 |

**不持久化什么**：弹幕消息与历史（产品设计即不保存）、在线连接（重启必然断开，客户端 `serverConnection.ts` 自带自动重连，重连后凭恢复的房间/房主/密码原样回归——这是"无感"的另一半）。

**技术选型**：`better-sqlite3`（同步 API，每次写入一条微事务；服务器消息处理本身是单线程同步的，无需排队。原生模块，prebuild 按平台分发——本机 ARM64 与 CI x64 均验证预编译直接可用）。

**接入方式**：
- `DanmakuServerOptions.dbPath`，默认 `env DANMAKU_DB_PATH` → 缺省 `dist/../danmaku.db`（部署目录即 `/opt/danmaku-server/danmaku.db`）；测试传 `':memory:'`（`tests/helpers.ts` 默认）
- 启动时 `restoreFromStore()`：恢复房间（关机前有人的房间无 empty_since，补记为重启时刻，从此起算 24h 保留）、按 host_user_id 重建 hostRooms、恢复 ipToUserId
- 写入点（与内存变更同步）：建房 upsert、setPassword、markEmpty/addClient 的 empty_since 变更、deleteRoom/清扫删除、IP 映射新增
- `Room` 构造函数新增可选 `RoomRestoreState` 参数（createdAt/password/hostUserId/emptySince 恢复）
- `RoomStore` 写方法带关库守卫：`close()` 后迟到的 ws close 事件不会在已关闭的 db 上抛异常

### 2. 自动部署 workflow（`.github/workflows/deploy-server.yml`）

- **触发**：仅 `workflow_dispatch` 手动（重启虽已基本无感，仍建议低峰操作；稳定后可自行加 push+paths 自动触发）
- **流程**：测试门禁（`npm test` 挂了不部署）→ CI 编译 dist → rsync 上传（`--delete` 只作用于 `dist/` 内部，不触碰 `updates/`、`danmaku.db*`、`node_modules/`、`ecosystem.config.js`）→ 远端 `npm ci --omit=dev`（better-sqlite3 原生模块须服务器本机安装）→ `npx pm2 restart danmaku-server` → 经 SSH 在服务器本机 curl `/stats` 自检（5 次重试，失败 job 红）
- **secrets**：复用 release.yml 更新源同步的同一套（`UPDATE_SSH_KEY / UPDATE_SSH_KNOWN_HOSTS / UPDATE_SSH_HOST / UPDATE_SSH_USER / UPDATE_SSH_PORT`），零新增配置
- **已知风险**：远端 npm 拉 better-sqlite3 预编译二进制走 GitHub，网络不通时回退 node-gyp 编译（需服务器有 build-essential + python3）——首次手动跑 workflow 时关注这一步

## 修改文件

| 文件 | 改动 |
|------|------|
| `danmaku-server/src/persistence.ts` | 新建：RoomStore（建表/加载/写入/关库守卫） |
| `danmaku-server/src/server.ts` | dbPath 选项、restoreFromStore、6 类写入点、close() 关库 |
| `danmaku-server/src/room.ts` | 构造函数支持 RoomRestoreState 恢复 |
| `danmaku-server/package.json` | 新增 better-sqlite3 依赖（@types 为 devDep） |
| `danmaku-server/tests/persistence.test.ts` | 新建：5 个重启场景集成测试（临时文件 db） |
| `danmaku-server/tests/helpers.ts` | startServer 默认 `dbPath: ':memory:'` |
| `.github/workflows/deploy-server.yml` | 新建：手动部署 workflow |
| `danmaku-server/DEPLOYMENT.md` | 「更新服务」改为推荐 workflow；手动方式改 `npx pm2`；持久化文件说明 |
| `.gitignore` | 排除本地 `danmaku-server/danmaku.db*` |

## 验证

已完成：

1. ✅ `danmaku-server` 64 例测试全绿（新增 5 例持久化：房间/密码跨重启、非房主仍需密码、身份映射保留、重启后 24h 清扫继续、删除不复活）
2. ✅ 服务器 tsc 构建零错误；`/test` 全量流水线通过（客户端不受影响，tsc 基线无新增）
3. ✅ 生产入口冒烟：`node dist/server.js` 建房 → 杀进程 → 重启 → 日志 `Restored 1 room(s), 1 known IP(s) from SQLite`，`/stats` 房间与房主映射完整恢复
4. ✅ better-sqlite3 预编译二进制在本机（Linux ARM64）与 CI（ubuntu x64，跑测试即验证）均可用

线上验证步骤（首次跑 Deploy Server workflow 时）：

1. 确认服务器上 `npx pm2 restart danmaku-server` 可用（PM2 已随 deploy.sh 全局安装）
2. Actions 页手动运行 **Deploy Server** → 观察"上传代码并重启服务"一步中 `npm ci --omit=dev` 是否顺利拉到 better-sqlite3 预编译包（失败则登服务器装 `build-essential python3` 后重跑）
3. workflow 绿后：客户端创建带密码的房间 → 再跑一次 workflow（模拟下次部署）→ 客户端应自动重连回原房间，房间列表/密码不丢
