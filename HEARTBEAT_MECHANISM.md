# P2P心跳机制 - 保持连接稳定

## ✅ 已完成的功能

### 1. Client端心跳发送

**实现位置**: `src/renderer/services/peerService.ts`

**功能**:
- Client每5秒向Host发送一次ping消息
- 包含timestamp、userId、roomId信息
- 自动检测连接状态,只在连接打开时发送

**关键代码**:
```typescript
private startClientHeartbeat() {
  this.heartbeatTimer = setInterval(() => {
    const pingMessage: PeerMessage = {
      type: 'ping',
      payload: { timestamp: Date.now(), userId: this.userId, roomId: this.roomId }
    };
    if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(pingMessage);
      console.log(`[RoomConnection:${this.roomId}] Client sent heartbeat to host`);
    }
  }, 5000); // 5秒间隔
}
```

### 2. Host端心跳处理

**实现位置**: `src/renderer/services/peerService.ts` - handleIncomingConnection方法

**功能**:
- Host收到Client的ping消息
- 立即广播最新的用户列表给所有客户端
- 确保所有客户端的用户列表保持同步

**关键代码**:
```typescript
} else if (message.type === 'ping') {
  const clientId = message.payload.userId;
  console.log(`[RoomConnection:${this.roomId}] Host received heartbeat from client: ${clientId}`);
  
  // Host收到Client心跳后,立即广播最新的用户列表给所有客户端
  this.broadcastUserList();
  console.log(`[RoomConnection:${this.roomId}] Broadcasted updated user list after receiving heartbeat`);
}
```

### 3. 心跳生命周期管理

**启动时机**:
- Client成功连接到Host后立即启动 (`conn.on('open')`)

**停止时机**:
- Client主动断开连接 (`disconnect()`方法)
- Client与Host的连接关闭 (`conn.on('close')`)
- 切换房间或退出应用

**关键代码**:
```typescript
// 在connectToHost的conn.on('open')中
this.startClientHeartbeat();

// 在conn.on('close')中
this.stopHeartbeat();

// 在disconnect()方法开头
this.stopHeartbeat();
```

---

## 🔍 测试步骤

### 1. 运行新版本应用

```bash
dist-new/win-unpacked/云弹一下.exe
```

### 2. 创建房间并加入

**主机操作**:
1. 点击"创建房间"
2. 记录RoomID

**客户端操作**:
1. 输入RoomID
2. 点击"加入房间"
3. 等待连接成功

### 3. 观察心跳日志

打开F12开发者工具,切换到Console标签页,应该看到:

#### Client端日志(每5秒):
```
[RoomConnection:xxx] Client sent heartbeat to host
```

#### Host端日志(每5秒,每个Client):
```
[RoomConnection:xxx] Host received heartbeat from client: abc123
[RoomConnection:xxx] Broadcasted updated user list after receiving heartbeat
```

#### 所有客户端日志:
```
[DanmakuStore] addHistory called (来自user-list更新)
```

### 4. 长时间保持连接测试

**测试场景**:
1. 保持应用运行5分钟、10分钟、30分钟
2. 不进行任何操作(不发送弹幕)
3. 观察是否仍然能看到心跳日志

**预期结果**:
- ✅ 每5秒持续看到心跳日志
- ✅ 连接状态保持为"connected"
- ✅ 不会自动断开

### 5. 验证弹幕收发

在长时间保持连接后:
1. 发送一条测试弹幕
2. 确认对方能正常接收
3. 确认没有超时错误

---

## 📊 工作原理

### 心跳流程图

```
Client                          Host
  |                               |
  |-- ping (每5秒) ------------->|
  |                               |-- 收到ping
  |                               |-- 广播用户列表
  |<-- user-list ----------------|
  |                               |
  |-- 所有客户端收到用户列表更新 -->|
  |                               |
  (5秒后重复...)
```

### 为什么需要心跳?

1. **防止NAT超时**: 路由器/NAT设备会清理长时间无活动的连接映射
2. **防止防火墙关闭**: 某些防火墙会关闭空闲的TCP/UDP连接
3. **保持PeerJS活跃**: PeerJS服务器可能对空闲连接有超时限制
4. **同步用户状态**: 通过广播用户列表,确保所有客户端看到一致的在线用户

### 为什么是5秒?

- **太短(<3秒)**: 增加不必要的网络流量和CPU占用
- **太长(>10秒)**: 可能在两次心跳之间连接就断了
- **5秒**: 平衡了保活效果和资源消耗

---

## ❌ 故障排查

### 问题1: 看不到心跳日志

**可能原因**:
1. Client未成功连接到Host
2. 连接在启动心跳前就断开了
3. 控制台过滤了日志

**解决方法**:
```javascript
// 在控制台检查连接状态
console.log('Connection status:', useConnectionStore.getState().status);
console.log('Host connection:', window.peerService?.rooms?.[roomId]?.hostConnection);
```

### 问题2: 心跳发送失败

**日志示例**:
```
[RoomConnection:xxx] Failed to send heartbeat: Error: Connection is not open
```

**可能原因**:
1. Host连接已关闭但未检测到
2. 网络中断

**解决方法**:
- 检查是否有`Connection to host closed`日志
- 查看是否有重连尝试

### 问题3: Host收不到心跳

**可能原因**:
1. Client的心跳定时器未启动
2. 消息发送失败但被静默忽略

**调试方法**:
在Client端控制台执行:
```javascript
// 检查心跳定时器是否存在
console.log('Heartbeat timer:', useConnectionStore.getState()._heartbeatTimer);
```

### 问题4: 用户列表不同步

**症状**: 
- Client A看到2个用户
- Client B看到1个用户

**可能原因**:
- broadcastUserList未正确调用
- 某个Client未收到user-list消息

**解决方法**:
检查Host日志中是否有:
```
[RoomConnection:xxx] Broadcasted updated user list after receiving heartbeat
```

---

## 🎯 预期效果

修复后应该达到:

✅ **连接稳定性**:
- 可以保持连接数小时不断开
- 即使不发送弹幕,连接也保持活跃
- 网络波动后能快速恢复

✅ **用户列表同步**:
- 所有客户端看到的在线用户一致
- 新用户加入时立即更新
- 用户离开时立即移除

✅ **日志清晰**:
- 每5秒看到规律的心跳日志
- 能够追踪连接状态变化
- 便于诊断问题

✅ **用户体验**:
- 不会因为空闲而断开连接
- 随时可以发送和接收弹幕
- 无需重新加入房间

---

## 🔧 高级配置

### 调整心跳间隔

如果需要修改心跳间隔,编辑 `src/renderer/services/peerService.ts`:

```typescript
private heartbeatInterval: number = 5000; // 改为其他值,单位毫秒
```

**推荐范围**: 3000-10000ms (3-10秒)

### 禁用心跳(仅调试用)

```typescript
private startClientHeartbeat() {
  return; // 直接返回,不启动定时器
  // ... 其余代码
}
```

---

## 📝 技术细节

### PeerJS DataConnection特性

- **可靠传输**: `reliable: true` 确保消息按序到达
- **JSON序列化**: `serialization: 'json'` 自动处理对象序列化
- **元数据**: 可以在连接时传递metadata(如userId、username)

### 心跳消息格式

```typescript
{
  type: 'ping',
  payload: {
    timestamp: number,  // 发送时间戳
    userId: string,     // 发送者ID
    roomId: string      // 房间ID
  }
}
```

### 用户列表消息格式

```typescript
{
  type: 'user-list',
  payload: {
    users: Array<{
      userId: string,
      username: string
    }>
  }
}
```

---

## 🚀 下一步优化建议

### 1. 添加pong响应(可选)

当前只有单向ping,可以添加双向确认:

```typescript
// Host回复pong
const pongMessage: PeerMessage = {
  type: 'pong',
  payload: { timestamp: Date.now(), fromUserId: this.userId }
};
conn.send(pongMessage);

// Client计算延迟
case 'pong':
  const latency = Date.now() - message.payload.timestamp;
  console.log(`Ping latency: ${latency}ms`);
  break;
```

### 2. 连接健康监控

定期检查最后心跳时间,检测失联:

```typescript
private lastHeartbeatTime: number = 0;

// 收到pong时更新
this.lastHeartbeatTime = Date.now();

// 定期检查
setInterval(() => {
  const timeSinceLast = Date.now() - this.lastHeartbeatTime;
  if (timeSinceLast > 15000) { // 超过15秒无心跳
    console.warn('Connection may be unhealthy');
    // 尝试重连
  }
}, 10000);
```

### 3. 自适应心跳间隔

根据网络质量动态调整:

```typescript
// 如果延迟低,可以延长间隔
if (avgLatency < 50) {
  this.heartbeatInterval = 10000; // 10秒
} else {
  this.heartbeatInterval = 3000;  // 3秒
}
```

---

**祝你测试顺利! P2P连接将保持稳定! 🎉**
