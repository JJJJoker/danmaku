# 连接健康检测和自动重连功能测试指南

## 📋 功能概述

本次更新添加了基于心跳响应的连接健康检测机制,解决了PeerJS无法及时检测连接断开的问题。

### 核心改进

1. **实时健康检测**: 每5秒检查一次连接状态,15秒内发现Host断开
2. **自动重连**: 检测到断开后自动重连,无需用户手动操作
3. **指数退避**: 重连间隔从1秒逐步增加到10秒,避免频繁重连
4. **明确提示**: 重连失败后向用户显示错误信息

---

## 🔧 工作原理

### 心跳响应机制

```
Client (每5秒)              Host
    |                         |
    |-- ping --------------->|
    |                         |-- 收到ping
    |                         |-- 发送pong
    |<-- pong ----------------|
    |                         |-- 广播用户列表
    |<-- user-list -----------|
    |                         |
(所有客户端收到用户列表更新)
```

### 健康检测逻辑

- Client记录每次收到pong的时间 (`lastHeartbeatResponseTime`)
- 每5秒检查一次: 如果超过15秒没有收到pong,判定连接失效
- 连续3次失败后触发重连 (`consecutiveFailedHeartbeats >= 3`)

### 重连策略

```
第1次重连: 等待1秒
第2次重连: 等待2秒
第3次重连: 等待4秒
第4次重连: 等待8秒
第5次及以后: 等待10秒(上限)
最多重试15次
```

---

## 🧪 测试场景

### 场景1: 正常连接(验证pong响应)

**步骤**:
1. 启动应用,创建房间并加入
2. 打开控制台(F12)
3. 观察日志输出

**预期日志**:
```
[RoomConnection:xxx] Starting client heartbeat (every 5s)
[RoomConnection:xxx] Starting heartbeat health check
[RoomConnection:xxx] Client sent heartbeat to host
[RoomConnection:xxx] Sent pong to client: abc123
[RoomConnection:xxx] Received pong from host, latency: 50ms
[RoomConnection:xxx] Broadcasted updated user list after receiving heartbeat
```

**验证点**:
- ✅ 每5秒看到 `Client sent heartbeat to host`
- ✅ 每5秒看到 `Received pong from host, latency: XXms`
- ✅ `consecutiveFailedHeartbeats` 保持为0
- ✅ 延迟通常在10-200ms之间

---

### 场景2: Host断开(验证自动重连)

**步骤**:
1. 正常连接后,让Host关闭应用或退出房间
2. 观察Client日志

**预期日志**:
```
[RoomConnection:xxx] Client sent heartbeat to host
[RoomConnection:xxx] Client sent heartbeat to host  (继续发送)
[RoomConnection:xxx] Client sent heartbeat to host  (继续发送)
...
[RoomConnection:xxx] No heartbeat response for 15000ms (attempt 1)
[RoomConnection:xxx] No heartbeat response for 20000ms (attempt 2)
[RoomConnection:xxx] No heartbeat response for 25000ms (attempt 3)
[RoomConnection:xxx] Connection unhealthy! Triggering reconnect...
[RoomConnection:xxx] Handling connection failure...
[RoomConnection:xxx] Attempting reconnect in 1000ms (attempt 1)...
[RoomConnection:xxx] Connecting to host: danmaku-xxx-host
[RoomConnection:xxx] Reconnection timeout
[RoomConnection:xxx] Attempting reconnect in 2000ms (attempt 2)...
...
[RoomConnection:xxx] Max reconnect attempts reached
[RoomConnection:xxx] 连接已断开,重连失败。请检查网络或重新加入房间。
```

**验证点**:
- ✅ 停止收到pong响应
- ✅ 15秒后(3次失败)看到 `No heartbeat response for XXXms`
- ✅ 看到 `Connection unhealthy! Triggering reconnect...`
- ✅ 开始重连尝试,间隔逐步增加
- ✅ 最多重试15次后提示用户

---

### 场景3: Host重新上线(验证重连成功)

**步骤**:
1. Client检测到断开并开始重连
2. 在重连过程中,让Host重新上线(重启应用并创建相同房间)
3. 观察Client是否能自动重连成功

**预期日志**:
```
[RoomConnection:xxx] Attempting reconnect in 4000ms (attempt 3)...
[RoomConnection:xxx] Connecting to host: danmaku-xxx-host
[RoomConnection:xxx] Reconnected successfully!
[RoomConnection:xxx] Starting client heartbeat (every 5s)
[RoomConnection:xxx] Starting heartbeat health check
[RoomConnection:xxx] Received pong from host, latency: 80ms
```

**验证点**:
- ✅ 看到 `Reconnected successfully!`
- ✅ 重新启动心跳和健康检查
- ✅ 恢复收到pong响应
- ✅ 重连计数重置为0
- ✅ 可以正常收发弹幕

---

### 场景4: 网络波动(验证网络恢复)

**步骤**:
1. 正常连接后,禁用网卡或断开网络
2. 观察是否触发重连
3. 恢复网络,观察是否自动重连成功

**预期行为**:
- 网络断开后,心跳超时触发重连
- 网络恢复后,重连成功

---

## 📊 关键指标

### 性能指标

| 指标 | 值 | 说明 |
|------|-----|------|
| 心跳间隔 | 5秒 | 每5秒发送一次ping |
| 检测超时 | 15秒 | 连续3次无响应判定为断开 |
| 首次重连延迟 | 1秒 | 第一次重连等待时间 |
| 最大重连延迟 | 10秒 | 指数退避上限 |
| 最大重连次数 | 15次 | 超过后提示用户 |

### 用户体验

| 场景 | 用户感知 | 系统行为 |
|------|---------|---------|
| 正常连接 | 无感知 | 后台维持心跳 |
| Host短暂离线(<15s) | 无感知 | 继续等待响应 |
| Host断开(>15s) | 看到重连提示 | 自动重连 |
| 重连成功 | 恢复正常 | 无缝恢复连接 |
| 重连失败 | 看到错误提示 | 需要手动处理 |

---

## 🐛 故障排查

### 问题1: 没有收到pong响应

**症状**: 
- 只看到 `Client sent heartbeat to host`
- 没有看到 `Received pong from host`

**可能原因**:
1. Host端没有正确处理ping消息
2. Host已经断开但Client未检测到
3. 网络问题导致消息丢失

**解决方法**:
- 检查Host端日志,确认是否有 `Host received heartbeat from client`
- 检查Host是否在线
- 尝试重新加入房间

---

### 问题2: 频繁触发重连

**症状**:
- 每隔15秒就触发一次重连
- 重连成功后很快又断开

**可能原因**:
1. 网络不稳定
2. Host端负载过高,无法及时响应
3. PeerJS服务器问题

**解决方法**:
- 检查网络连接
- 降低 `maxFailedHeartbeats` 的值(从3改为5)
- 联系Host检查其应用状态

---

### 问题3: 重连一直失败

**症状**:
- 持续看到 `Attempting reconnect in XXms`
- 始终无法 `Reconnected successfully`

**可能原因**:
1. Host确实不在线
2. 房间ID或Host ID不正确
3. PeerJS服务器不可用

**解决方法**:
- 确认Host是否在线
- 检查房间号是否正确
- 等待15次重连失败后重新加入房间

---

## 🔬 高级配置

### 调整心跳间隔

在 `peerService.ts` 中修改:
```typescript
private heartbeatInterval: number = 5000; // 改为其他值(如3000、10000)
```

### 调整失败阈值

```typescript
private maxFailedHeartbeats: number = 3; // 改为其他值(如5、10)
```

### 调整重连策略

```typescript
private maxReconnectAttempts: number = 15; // 最大重连次数
const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000); // 10000是上限
```

---

## 📝 技术细节

### 为什么需要pong响应?

- **双向确认**: ping只能证明Client发了消息,pong证明Host收到了并响应
- **精确计时**: 可以计算往返延迟(RTT)
- **可靠检测**: 比单纯依赖PeerJS的底层检测更快速准确

### 为什么是3次失败?

- **平衡误判和及时性**: 
  - 1次失败可能是网络抖动
  - 2次失败仍有可能是临时问题
  - 3次失败(15秒)基本可以确定连接断开
- **可配置**: 通过 `maxFailedHeartbeats` 参数调整

### 指数退避策略

```
第1次: 1秒
第2次: 2秒
第3次: 4秒
第4次: 8秒
第5次+: 10秒(上限)
```

**优点**:
- 避免在网络恢复前频繁重连
- 减少服务器压力
- 给用户足够时间解决问题

---

## ✅ 验收标准

- [x] 正常连接时,每5秒收到pong响应
- [x] Host断开后,15秒内检测到连接失效
- [x] 自动触发重连,无需用户手动操作
- [x] 重连间隔按指数退避(1s → 2s → 4s → 8s → 10s)
- [x] 最多重试15次后提示用户
- [x] Host重新上线后,Client能自动重连成功
- [x] 重连成功后,恢复正常心跳和健康检查
- [x] 重连计数正确重置

---

## 📅 版本历史

**v1.0.0** (2026-07-05)
- ✅ 添加心跳响应追踪
- ✅ 实现Host端pong响应
- ✅ 添加健康检查定时器
- ✅ 实现连接失败处理
- ✅ 实现带超时的重连机制
- ✅ 在适当位置启动/停止健康检查
