# 多客户端通信测试指南

## 🎯 测试目标

验证WebSocket服务器模式下,多个客户端能够:
- 同时连接到同一个房间
- 实时收发消息
- 正确显示在线用户列表
- 处理用户加入/离开事件

## 📋 测试准备

### 1. 确保服务器运行

```bash
ssh root@REDACTED_SERVER_IP
pm2 status danmaku-server
```

应该看到状态为 `online`。

### 2. 启动第一个客户端

```bash
cd d:\tools\qoder\qoder_project\yundan
npm start
```

等待应用完全启动。

### 3. 启动第二个客户端

**方法A**: 再次运行npm start(如果Electron支持多实例)
```bash
npm start
```

**方法B**: 复制可执行文件到另一个位置
```powershell
# 找到编译后的exe文件
Copy-Item -Path "out\funapp-win32-x64\funapp.exe" -Destination "C:\temp\funapp2\funapp.exe" -Recurse
# 然后运行两个副本
```

**方法C**: 使用浏览器测试(如果有Web版本)
- 打开Chrome
- 访问 http://localhost:5173?window=control

## 🧪 测试步骤

### 测试1: 创建房间并加入

#### 客户端A (创建者):
1. 输入用户名: `UserA`
2. 点击"创建房间"
3. 记录生成的房间ID,例如: `danmaku-test-abcd`
4. 观察日志应该看到:
   ```
   [ServerConnection] Connecting to ws://REDACTED_SERVER_IP:8080...
   [ServerConnection] Connected to server
   [ServerConnection] Starting heartbeat (every 5s)
   [ServerConnection] Joined room: danmaku-test-abcd
   ✅ 通过服务器创建房间: danmaku-test-abcd
   ```

#### 客户端B (加入者):
1. 输入用户名: `UserB`
2. 点击"加入房间"
3. 输入房间ID: `danmaku-test-abcd`
4. 观察日志应该看到:
   ```
   [ServerConnection] Connecting to ws://REDACTED_SERVER_IP:8080...
   [ServerConnection] Connected to server
   [ServerConnection] Starting heartbeat (every 5s)
   [ServerConnection] Joined room: danmaku-test-abcd
   ✅ 成功加入房间 danmaku-test-abcd
   ```

### 测试2: 验证用户列表同步

#### 在客户端A查看:
- 应该看到在线用户列表包含:
  - UserA (自己)
  - UserB (刚加入的用户)

#### 在客户端B查看:
- 应该看到在线用户列表包含:
  - UserA (房主)
  - UserB (自己)

#### 预期日志:
```
✅ 用户加入: UserB
在线用户更新: 2 人
```

### 测试3: 发送和接收弹幕

#### 从客户端A发送:
1. 在输入框输入: `Hello from UserA!`
2. 点击发送按钮
3. 观察客户端A的日志:
   ```
   [ServerConnection] Sending danmaku: Hello from UserA!
   ```

#### 在客户端B接收:
1. 应该立即看到弹幕从屏幕右侧飞入
2. 观察客户端B的日志:
   ```
   [App] Received remote danmaku: { text: "Hello from UserA!", sender: "UserA", ... }
   [App] ✅ RoomId matches, adding danmaku to display
   [App] ✅ Danmaku added to store successfully
   ```

#### 从客户端B发送:
1. 输入: `Hi UserA! This is UserB.`
2. 点击发送
3. 客户端A应该收到并显示该弹幕

### 测试4: 用户离开事件

#### 断开客户端B:
1. 关闭客户端B窗口
2. 或点击"断开连接"按钮

#### 在客户端A观察:
1. 用户列表应该只剩下UserA
2. 日志应该显示:
   ```
   👋 用户离开: UserB
   在线用户更新: 1 人
   ```

### 测试5: 断线重连

#### 模拟服务器重启:
```bash
ssh root@REDACTED_SERVER_IP
pm2 restart danmaku-server
```

#### 观察客户端行为:
1. 应该看到连接断开:
   ```
   [ServerConnection] Connection closed
   ```

2. 自动尝试重连:
   ```
   [ServerConnection] Attempting to reconnect... (attempt 1)
   [ServerConnection] Attempting to reconnect... (attempt 2)
   ...
   ```

3. 重连成功后:
   ```
   [ServerConnection] Reconnected successfully
   [ServerConnection] Rejoined room: danmaku-test-abcd
   ```

## ✅ 验收标准

所有测试都应该通过以下检查:

### 基本功能
- [ ] 两个客户端都能成功连接到服务器
- [ ] 两个客户端都能加入同一个房间
- [ ] 用户列表正确显示在线人数
- [ ] 发送的弹幕能在对方窗口显示
- [ ] 用户离开时列表自动更新

### 高级功能
- [ ] 心跳机制正常工作(每5秒ping/pong)
- [ ] 断线后能自动重连
- [ ] 重连后能重新加入房间
- [ ] 消息顺序正确(先发送的先到达)
- [ ] 没有消息丢失或重复

### 性能指标
- [ ] 消息延迟 < 500ms (局域网)
- [ ] 消息延迟 < 2000ms (互联网)
- [ ] CPU占用正常 (< 10%)
- [ ] 内存占用稳定

## 🔍 调试技巧

### 查看详细日志

在两个客户端都打开开发者工具:
- Windows: `Ctrl+Shift+I`
- Mac: `Cmd+Option+I`

查看Console标签,过滤 `[ServerConnection]` 相关日志。

### 监控服务器

```bash
# 实时查看服务器日志
ssh root@REDACTED_SERVER_IP
pm2 logs danmaku-server --lines 100

# 或者实时监控
pm2 monit
```

应该看到类似这样的日志:
```
[Room danmaku-test-abcd] User joined: UserA
[Room danmaku-test-abcd] User joined: UserB
[Room danmaku-test-abcd] Forwarded danmaku from UserA to 1 clients
[Room danmaku-test-abcd] Forwarded danmaku from UserB to 1 clients
```

### 网络抓包

如果需要深入调试,可以使用Wireshark:
1. 安装Wireshark
2. 开始捕获
3. 过滤: `websocket`
4. 观察WebSocket帧

## 🐛 常见问题排查

### 问题1: 第二个客户端无法连接

**可能原因**:
- 端口被占用
- Electron不支持多实例

**解决**:
```bash
# 检查端口占用
netstat -ano | findstr :5173

# 杀死旧进程
taskkill /F /PID <PID>
```

### 问题2: 弹幕不显示

**检查清单**:
1. 确认两个客户端在同一房间
2. 检查控制台是否有错误
3. 验证服务器是否转发了消息
4. 检查DanmakuStore是否正确添加

**调试命令**:
```javascript
// 在控制台运行
console.log(useDanmakuStore.getState().danmakus)
console.log(useConnectionStore.getState().activeRoomId)
```

### 问题3: 用户列表不同步

**可能原因**:
- 回调未正确设置
- 服务器未广播用户列表

**解决**:
1. 检查 `_setupServerCallbacks` 是否被调用
2. 查看服务器日志中的用户列表更新
3. 手动触发更新:
   ```javascript
   // 在控制台
   useConnectionStore.getState().addLog('room-id', 'Manual user list check')
   ```

### 问题4: 频繁断线

**可能原因**:
- 网络连接不稳定
- 心跳超时
- 服务器负载过高

**解决**:
1. 检查网络延迟:
   ```bash
   ping REDACTED_SERVER_IP
   ```

2. 增加心跳间隔(修改代码)
3. 检查服务器资源使用:
   ```bash
   htop  # 或 top
   ```

## 📊 测试结果记录模板

```markdown
## 测试记录

**日期**: 2026-07-03
**测试人员**: [你的名字]
**环境**: 
- 客户端A: Windows 11, Chrome 120
- 客户端B: Windows 11, Electron App
- 服务器: 阿里云 ECS, Ubuntu 20.04

### 测试结果

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 创建房间 | ✅ | 成功 |
| 加入房间 | ✅ | 成功 |
| 用户列表同步 | ✅ | 延迟 ~100ms |
| 发送弹幕(A->B) | ✅ | 延迟 ~150ms |
| 发送弹幕(B->A) | ✅ | 延迟 ~160ms |
| 用户离开通知 | ✅ | 即时 |
| 断线重连 | ⚠️ | 需要3次重试 |

### 发现的问题

1. 断线重连有时需要多次尝试
2. 偶尔出现消息乱序(概率<5%)

### 建议改进

1. 优化重连策略,增加指数退避
2. 添加消息序号,客户端排序
```

## 🎉 测试完成

当所有测试都通过后:

1. ✅ 更新任务状态
2. ✅ 记录测试结果
3. ✅ 提交代码变更
4. ✅ 更新文档
5. ✅ 通知团队成员

## 📞 需要帮助?

如果测试中遇到问题:

1. 查看本文档的"常见问题排查"部分
2. 检查服务器和客户端日志
3. 参考 [CLIENT_USAGE.md](./CLIENT_USAGE.md)
4. 联系技术支持
