# 房间删除与切换全链路修复报告

- **日期**：2026-07-10
- **分支**：`dev`（提交 `36800ef`）
- **问题反馈**：GitHub issue #11「房间删除和在已有房间加入其他房间的操作，貌似存在bug」——房间删除按钮不能正确删除房间；房间切换存在异常，疑似旧 UI 代码与逻辑 bug 残留。
- **结果**：全面排查定位到 7 个真实缺陷，全部修复；两端测试全绿（客户端 134 例 / 服务器 69 例），tsc 与基线一致无新增错误，build:vite 编译通过。

## 总体结论

「删不掉」的本质是**删除请求从未到达服务器**：删除走 WebSocket 消息，而用户删除"我的房间"里未连接的房间时 ws 并未打开，`send()` 静默丢弃；客户端又是乐观先删本地，随后 `/stats` 对账把房间原样拉回——表现为"删了又回来"。「切换异常」的本质是 `switchRoom` 复用旧连接对象直接重连，被孤儿化的旧 socket 的 `onclose` 仍指向同一实例，之后触发时把新房间误标断线甚至发起错位重连。修复后删除改为 **HTTP 确认制**（成功才移除本地，失败弹可见提示），切换与加入统一为"断旧建新"，并补齐状态回收、竞态守卫与服务器错误反馈通道。

## 问题清单与修复

### Bug 1 — 删除未连接的房间静默失败，随对账"复活"（主根因）

- **位置**：`src/renderer/stores/connectionStore.ts`（`deleteRoom`）、`src/renderer/services/serverConnection.ts`（`send`）
- **问题**：`syncOwnedRoomsFromServer` 挂载时无条件创建 `ServerConnection` 单例（不建 ws），`deleteRoom` 的 `if (conn && myUserId)` 判断因此恒真；但 `send()` 在 `ws` 未打开时仅 `console.warn` 静默丢弃。随后乐观 `removeOwnedRoom` + `syncOwnedRoomsFromServer()` 又把服务器上仍存在的房间拉回本地。
- **修复**：服务器 stats HTTP 服务新增 `DELETE /rooms/:id` 端点（`danmaku-server/src/app.ts`），用 `resolveClientIp` → `ipToUserId` 反查房主身份（比 WS 信任 payload 更权威），另接受 `?userId=` 查询参数兜底；WS `deleteRoom` 分支核心抽为 `performDeleteRoom(roomId, authorizedUserIds)` 供两路复用，三条响应文案与历史行为逐字一致。客户端新增 `ServerConnection.deleteRoomOnServer()`（HTTP DELETE 等确认）与 `serverConfig.deriveRoomDeleteUrl()`（端口 +1 派生，同 stats 约定）；`connectionStore.deleteRoom` 改为**先等服务器确认，成功才移除本地，失败保留并弹提示**。

### Bug 2 — switchRoom 复用连接不断开，孤儿 socket 污染新房间状态

- **位置**：`src/renderer/stores/connectionStore.ts`（`switchRoom`）、`src/renderer/services/serverConnection.ts`（`joinRoom`）
- **问题**：`switchRoom` 不像 `joinRoom`/`createRoom` action 那样先 `disconnect()` 置空单例，直接在旧实例上再次 `joinRoom`；而 `ServerConnection.joinRoom` 无条件 `new WebSocket` 且不 close 旧 ws。孤儿 socket 的 `onclose/onerror` 仍指向同一实例，之后触发（如服务器心跳超时）会掐断新房间心跳、把新房间误标 `disconnected`、甚至用被覆盖的 roomId 发起 `attemptReconnect`。
- **修复**：双保险——`switchRoom` 改为与 joinRoom 一致的"断开旧单例并置空 → 新建实例"；`ServerConnection.joinRoom` 顶部加自清理（存在旧 ws 先做等价 disconnect），防御所有调用方。

### Bug 3 — 旧房间 status 永不回收，"在线"判断口径不一

- **位置**：`src/renderer/stores/connectionStore.ts`、`src/renderer/components/RoomPanel.tsx`
- **问题**：切走后旧房间条目永久停留在 `connected`；RoomPanel 一处按 `status === 'connected'` 判在线、另两处只按 `!!rooms[id]`，被过期状态欺骗后提供错误的"切换"入口。
- **修复**：新增 `markOthersDisconnected(rooms, exceptId)` helper，create/join/switch 成功后把其它房间置 `disconnected`（全局只有一条物理连接）；RoomPanel 三处统一为 `isOnline = (id) => rooms[id]?.status === 'connected'`。

### Bug 4 — onRoomDeleted 的 1 秒延迟竞态误踢新房间

- **位置**：`src/renderer/stores/connectionStore.ts`（`_setupServerCallbacks` 内 `onRoomDeleted`）
- **问题**：原实现 `setTimeout(() => disconnectRoom(roomId), 1000)`；若 1 秒内用户已切入新房间，`disconnectRoom` 读到的是新连接，会经它发 leave（服务器 `case 'leave'` 忽略 payload.roomId，只踢当前房间）把用户从**新房间**踢出并关闭新连接。
- **修复**：去掉 setTimeout 改为同步处理；加幂等守卫（`!rooms[roomId]` 早返回，防与 HTTP 自删重复）；仅当 `activeRoomId === roomId` 且全局连接仍是回调捕获的实例时才 `clearServerConnection()`；不再调用会误发 leave 的 `disconnectRoom`。

### Bug 5 — 两套不兼容的 funapp-room-history 写入并存（遗留残留）

- **位置**：`src/renderer/components/RoomPanel.tsx`、`src/renderer/stores/connectionStore.ts`（joinRoom action 内）
- **问题**：同一 localStorage key 两套 schema（`timestamp/role:'client'` vs `lastJoined/role:'guest'`，后者还存明文密码），同一提交引入后无人清理；"我的房间-进入"按钮又不写历史。
- **修复**：以 RoomPanel schema 为准（`{roomId, roomName, role:'host'|'client', timestamp}`，不再存密码——密码已有独立 `funapp-room-passwords`）；删除 store 侧写入块；`loadRoomHistory` 加归一化（`'guest'→'client'`、`lastJoined→timestamp`、丢弃 password）兼容旧数据；"进入"按钮按在线分流 switchRoom/joinRoom 并补写历史。

### Bug 6 — 服务器 error/success 消息被客户端吞掉，鉴权失败零反馈

- **位置**：`src/shared/types.ts`、`danmaku-server/src/types.ts`、`src/renderer/services/serverConnection.ts`（`handleMessage`）
- **问题**：服务器发送的 `{type:'error'|'success'}` 不在两端 `ServerMessage` 联合类型里（裸 send 绕过类型系统），客户端 `handleMessage` 无对应 case——非房主删除等失败场景用户完全无感知。
- **修复**：两端协议各加 `error`/`success` 成员；`handleMessage` 新增 case → 新回调 `onServerNotice` → store 新增 `notice` 状态 → RoomPanel 镜像到现有 `rp-inline-message` 内联 toast（5 秒自动清除）。

### Bug 7 — 删除确认框后缺鼠标穿透重置

- **位置**：`src/renderer/components/RoomPanel.tsx`（`handleDeleteRoom`）
- **问题**：原生 `confirm()` 弹窗后未调用 `setIgnoreMouseEvents(true, {forward:true})`（同文件另两处弹窗操作均有），特定环境下悬浮面板会暂时点不动。
- **修复**：confirm 后无论确认与否都重置鼠标穿透，再 `await deleteRoom`。

## 修改文件

| 文件 | 改动 |
|------|------|
| `danmaku-server/src/app.ts` | WS deleteRoom 核心抽为 `performDeleteRoom` 复用；新增 `DELETE /rooms/:id` HTTP 端点（IP 反查 + ?userId 兜底）；CORS Allow-Methods 加 DELETE |
| `danmaku-server/src/types.ts` | ServerMessage 加 `error`/`success` 成员 |
| `danmaku-server/tests/server.test.ts` | 新增 `HTTP DELETE /rooms/:id` describe：离线删除成功不复活 / 非房主 403 / 不存在房间清除语义 / ?userId 兜底 / 房内客户端收到 roomDeleted 广播 |
| `src/shared/types.ts` | ServerMessage 加 `error`/`success`（与服务器同步） |
| `src/renderer/services/serverConfig.ts` | 新增 `deriveRoomDeleteUrl`（端口 +1、wss→https 派生） |
| `src/renderer/services/serverConnection.ts` | joinRoom 自清理；`onServerNotice` 回调；静态 `deleteRoomOnServer`；旧 WS `deleteRoom` 标记 `@deprecated` |
| `src/renderer/stores/connectionStore.ts` | `notice` 状态；`markOthersDisconnected`；switchRoom/deleteRoom/onRoomDeleted 重写；移除 history 旧写入 |
| `src/renderer/stores/connectionStore.test.ts` | 删除确认制、切换断旧建新、onRoomDeleted 同步与竞态守卫、joinRoom 不再写 history 等用例 |
| `src/renderer/components/RoomPanel.tsx` | history 归一化；`isOnline` 统一口径；handleDeleteRoom 异步 + 穿透重置；"进入"分流并补历史；notice 镜像 toast |

## 验证

已完成：

1. ✅ 客户端 vitest：8 文件 134 用例全部通过
2. ✅ 服务器 vitest：4 文件 69 用例全部通过（含新增 HTTP DELETE 5 例，真实 ws/http 连临时端口）
3. ✅ tsc 基线比对：与 HEAD 基线一致（3 个历史遗留错误），无新增
4. ✅ build:vite：renderer + main + preload 编译通过

**部署提醒**：服务器端改动（HTTP DELETE 端点）需合并 main 后手动运行 Deploy Server workflow 才在生产生效；在服务器更新前，客户端离线删除会得到"无法连接服务器/删除失败"的可见提示（不再是静默假删）。

桌面端手动验证步骤（`npm start`，需先部署新版服务器）：

1. 不进入任何房间，直接在"我的房间"删除一个自己的房间 → 提示"房间已删除"，刷新/重启后不再出现
2. 用另一台机器（不同 IP）尝试删除他人房间 → 内联提示"只有房主可以删除房间"，房间保留
3. 房间 A 连接中切换到房间 B，等待 1 分钟 → 房间 B 保持在线，不出现莫名断线/重连；房间 A 显示离线
4. 删除当前所在房间后 1 秒内立即"进入"另一个自己的房间 → 正常进入，不被踢出
5. 点删除弹出确认框后取消 → 控制面板仍可正常点击（鼠标穿透已重置）
