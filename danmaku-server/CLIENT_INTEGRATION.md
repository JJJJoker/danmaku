# 客户端集成指南

> ⚠️ **历史文档**：本文写于服务器模式集成初期，文中提到的 P2P 架构（`RoomConnection`/PeerJS/双模式切换）已于 v1.5.0 彻底移除，客户端现仅支持 WebSocket 服务器中继（`src/renderer/services/serverConnection.ts`）。本文仅作设计背景参考。

如何将WebSocket服务器连接集成到现有客户端代码中。

---

## 当前架构

目前客户端使用P2P架构(`RoomConnection`类),通过PeerJS进行通信。

### P2P架构的问题
- Host离线导致整个房间不可用
- 依赖PeerJS公共服务器,不稳定
- 所有流量经过Host,带宽压力大
- 无法持久化存储数据

---

## 新架构: 客户端-服务器模式

新增`ServerConnection`类,通过WebSocket连接到你的云服务器(<你的服务器IP>:8080)。

### 优势
- ✅ 中心化控制,更稳定
- ✅ 不依赖第三方服务
- ✅ 可持久化存储
- ✅ 支持更多并发用户
- ✅ Host不会"离线"(服务器一直在线)

---

## 集成步骤

### 方式1: 完全切换到服务器模式(推荐)

**修改文件**: `src/renderer/components/App.tsx`

找到创建连接的代码,将:
```typescript
import { peerService } from '../services/peerService';

// 使用 peerService (P2P模式)
peerService.setCallbacks({...});
await peerService.joinRoom(roomId, username);
```

改为:
```typescript
import { ServerConnection } from '../services/peerService';

// 创建新的ServerConnection实例
const serverConn = new ServerConnection();
serverConn.setCallbacks({
  onDanmaku: (danmaku) => {
    // 处理接收到的弹幕
    addDanmaku(danmaku);
  },
  onUserListUpdate: (users) => {
    // 更新用户列表
    setOnlineUsers(users);
  },
  onStatusChange: (status) => {
    // 更新连接状态
    setConnectionStatus(status);
  },
  onError: (error) => {
    // 显示错误信息
    showError(error);
  },
  onUserJoin: (user) => {
    // 用户加入通知
    console.log(`${user.username} 加入了房间`);
  },
  onUserLeave: (userId) => {
    // 用户离开通知
    console.log(`用户离开了房间`);
  }
});

// 加入房间
await serverConn.joinRoom(roomId, username);

// 发送弹幕
const danmaku = {
  id: Date.now().toString(),
  text: message,
  userId: 'current-user-id',
  color: '#FFFFFF',
  fontSize: 24,
  speed: 'normal',
  timestamp: Date.now()
};
serverConn.sendDanmaku(danmaku);

// 断开连接
serverConn.disconnect();
```

### 方式2: 支持双模式切换(高级)

在设置中添加一个选项,让用户选择使用P2P模式还是服务器模式。

**修改文件**: `src/renderer/components/SettingsPanel.tsx`(假设存在)

添加一个开关:
```tsx
const [connectionMode, setConnectionMode] = useState<'p2p' | 'server'>('server');

// ... 在UI中添加切换按钮
<select 
  value={connectionMode} 
  onChange={(e) => setConnectionMode(e.target.value as 'p2p' | 'server')}
>
  <option value="p2p">P2P模式</option>
  <option value="server">服务器模式(推荐)</option>
</select>
```

**修改App.tsx**:
```typescript
import { peerService, ServerConnection } from '../services/peerService';

let connection: any = null;

if (connectionMode === 'server') {
  connection = new ServerConnection();
} else {
  connection = peerService;
}

connection.setCallbacks({...});
await connection.joinRoom(roomId, username);
```

---

## API对比

### RoomConnection (P2P模式)

```typescript
// 加入房间
await peerService.joinRoom(roomId, username);

// 发送弹幕
peerService.sendDanmaku(danmaku);

// 获取在线用户
const users = peerService.getConnectedUsers();

// 断开连接
peerService.disconnect();

// 设置回调
peerService.setCallbacks({
  onDanmaku,
  onUserListUpdate,
  onStatusChange,
  onError,
  onUserJoin,
  onUserLeave
});
```

### ServerConnection (服务器模式)

```typescript
const serverConn = new ServerConnection();

// 加入房间
await serverConn.joinRoom(roomId, username);

// 发送弹幕
serverConn.sendDanmaku(danmaku);

// 注意: ServerConnection没有getConnectedUsers()方法
// 用户列表通过onUserListUpdate回调自动更新

// 断开连接
serverConn.disconnect();

// 设置回调
serverConn.setCallbacks({
  onDanmaku,
  onUserListUpdate,
  onStatusChange,
  onError,
  onUserJoin,
  onUserLeave
});
```

---

## 消息协议

### 客户端 -> 服务器

| 类型 | 说明 | Payload |
|------|------|---------|
| `join` | 加入房间 | `{ roomId, userId, username }` |
| `danmaku` | 发送弹幕 | `DanmakuMessage` |
| `ping` | 心跳 | `{ timestamp, userId }` |
| `leave` | 离开房间 | `{ userId }` |

### 服务器 -> 客户端

| 类型 | 说明 | Payload |
|------|------|---------|
| `init` | 初始化数据 | `{ danmakus: DanmakuMessage[] }` |
| `danmaku` | 转发弹幕 | `DanmakuMessage` |
| `user-list` | 用户列表 | `{ users: RoomUser[] }` |
| `pong` | 心跳响应 | `{ timestamp }` |
| `leave` | 用户离开 | `{ userId }` |

---

## 注意事项

### 1. 服务器地址配置

编辑 `src/renderer/services/peerService.ts`:
```typescript
private SERVER_URL = 'ws://<你的服务器IP>:8080';
```

如果服务器地址变更,只需修改这一行。

### 2. 端口配置

确保服务器监听8080端口,并且防火墙已开放该端口。

### 3. HTTPS/WSS

生产环境建议使用加密连接:
```typescript
private SERVER_URL = 'wss://yourdomain.com:8080';
```

需要配置SSL证书和Nginx反向代理。

### 4. 重连机制

`ServerConnection`内置了自动重连功能:
- 最多重试15次
- 指数退避: 1s → 2s → 4s → 8s → 10s
- 重连失败后提示用户

### 5. 心跳保活

每5秒自动发送一次ping,服务器回复pong。如果超过15秒没有收到pong,判定连接失效。

---

## 测试验证

### 本地测试

1. **启动服务器**:
   ```bash
   cd danmaku-server
   npm start
   # 应该看到: [Server] Danmaku server listening on port 8080
   ```

2. **打开测试页面**:
   ```bash
   # 在浏览器中打开 test-client.html
   ```

3. **连接测试**:
   - 点击"连接"按钮
   - 输入房间ID和用户名
   - 点击"加入房间"
   - 发送几条弹幕
   - 观察接收到的消息

### 远程测试

1. **确保服务器已部署**:
   ```bash
   ssh <用户>@<你的服务器IP>
   pm2 status danmaku-server
   ```

2. **修改客户端配置**:
   ```typescript
   private SERVER_URL = 'ws://<你的服务器IP>:8080';
   ```

3. **从另一个客户端连接并测试**

---

## 常见问题

### Q1: 为什么不直接使用现有的P2P架构?

**A**: P2P架构有以下问题:
- Host离线导致整个房间不可用
- 依赖PeerJS公共服务器,不稳定
- 所有流量经过Host,带宽压力大
- 无法持久化存储数据

服务器模式解决了这些问题。

### Q2: 能否同时支持P2P和服务器模式?

**A**: 可以。可以按照"方式2: 支持双模式切换"实现,让用户选择。

### Q3: 服务器宕机怎么办?

**A**: 
- 短期: 客户端会自动重连(最多15次)
- 长期: 建议配置监控告警,快速恢复
- 可选: 部署多个服务器实例,实现高可用

### Q4: 需要修改哪些文件?

**A**: 最小改动:
- `src/renderer/components/App.tsx` - 切换连接方式
- `src/renderer/services/peerService.ts` - 已经添加了`ServerConnection`类

其他文件不需要修改,因为回调接口保持一致。

---

## 下一步

1. ✅ 服务器端已实现
2. ✅ 客户端`ServerConnection`类已实现
3. ⬜ 修改`App.tsx`使用`ServerConnection`
4. ⬜ 测试远程连接
5. ⬜ 配置HTTPS(可选)
6. ⬜ 添加认证机制(可选)

---

## 性能对比

| 指标 | P2P模式 | 服务器模式 |
|------|---------|-----------|
| 稳定性 | 中(依赖Host) | 高(服务器稳定) |
| 延迟 | 低(直连) | 低(中转) |
| 并发用户数 | 少(<20) | 多(>100) |
| 带宽消耗 | Host高 | 服务器均匀 |
| 数据持久化 | 无 | 可扩展 |
| 维护成本 | 低 | 中(需要服务器) |

---

## 总结

**推荐使用服务器模式**,原因:
1. 更稳定,不依赖Host
2. 支持更多用户
3. 可扩展性强
4. 你已经有了云服务器

**实施建议**:
- 先完全切换到服务器模式
- 测试验证无误后,再考虑添加双模式切换功能
- 保持P2P代码作为备选方案
