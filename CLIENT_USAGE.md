# 客户端使用指南 - WebSocket服务器模式

## ✅ 当前状态

- **服务器**: ws://<你的服务器IP>:8080 (已部署并运行)
- **客户端**: 通过 WebSocket 服务器中继通信（P2P 模式已于 v1.5.0 移除）

## 🚀 快速开始

### 1. 启动应用

```bash
npm start
```

### 2. 创建或加入房间

1. 在弹出的Electron窗口中输入用户名
2. 点击"创建房间"或"加入房间"
3. 观察控制台日志,应该看到:
   ```
   [ServerConnection] Connecting to ws://<你的服务器IP>:8080...
   [ServerConnection] Connected to server
   [ServerConnection] Starting heartbeat (every 5s)
   [ServerConnection] Joined room: danmaku-xxx
   ```

### 3. 发送弹幕

1. 在控制面板输入弹幕内容
2. 点击发送按钮
3. 在其他客户端(或另一个窗口)应该能看到弹幕显示

## 🧪 测试步骤

### 测试1: 单客户端连接测试

```powershell
.\test-websocket.ps1 -ServerUrl ws://<你的服务器IP>:8080
```

预期输出:
```
Connection state: Open
✅ SUCCESS: WebSocket connection is open!
```

### 测试2: 多客户端通信测试

1. **打开第一个窗口**:
   ```bash
   npm start
   ```
   
2. **打开第二个窗口**(保持第一个运行):
   - 再次运行 `npm start`
   - 或者复制可执行文件到另一个位置运行

3. **两个窗口都加入同一个房间**:
   - 输入相同的房间ID
   - 例如: `danmaku-test-1234`

4. **在一个窗口发送弹幕**:
   - 输入消息并发送
   - 另一个窗口应该立即显示该弹幕

5. **检查用户列表**:
   - 应该显示两个在线用户
   - 当其中一个断开时,列表应自动更新

### 测试3: 断线重连测试

1. 正常连接后,在服务器上重启服务:
   ```bash
   ssh <用户>@<你的服务器IP>
   pm2 restart danmaku-server
   ```

2. 观察客户端日志:
   ```
   [ServerConnection] Connection closed
   [ServerConnection] Attempting to reconnect... (attempt 1)
   [ServerConnection] Reconnected successfully
   ```

## 🔍 调试技巧

### 查看客户端日志

在Electron窗口按 `Ctrl+Shift+I` 打开开发者工具,查看Console标签。

### 查看服务器日志

```bash
ssh <用户>@<你的服务器IP>
pm2 logs danmaku-server --lines 50
```

### 查看实时日志流

```bash
# 服务器端
pm2 logs danmaku-server

# 客户端
# 在开发者工具的Console中观察
```

## ⚙️ 配置说明

### 服务器地址

两种方式（优先级：设置 > 构建默认值）:

1. 在应用「设置」Tab 的「服务器」区块填写地址（如 `ws://<你的服务器IP>:8080`）
2. 构建时注入默认地址: `VITE_DANMAKU_SERVER_URL=ws://<你的服务器IP>:8080 npm run build:vite`（官方发版由 GitHub 仓库变量 `DANMAKU_SERVER_URL` 注入）

### 心跳间隔

默认每5秒发送一次ping,可在 `ServerConnection` 类中调整。

### 重连策略

- 最大重试次数: 10次
- 初始延迟: 1秒
- 指数退避: 每次失败后延迟翻倍

## 🐛 常见问题

### 问题1: 连接超时

**症状**: 
```
[ServerConnection] Connecting to ws://<你的服务器IP>:8080...
```
一直卡住,没有后续日志。

**解决**:
1. 检查服务器是否运行:
   ```bash
   ssh <用户>@<你的服务器IP>
   pm2 status danmaku-server
   ```

2. 检查防火墙:
   ```bash
   ufw status
   # 应该看到 8080/tcp ALLOW
   ```

3. 检查云服务器安全组:
   - 登录阿里云控制台
   - 确保安全组允许8080端口(TCP和UDP)

### 问题2: 弹幕不显示

**症状**: 发送弹幕后对方收不到。

**解决**:
1. 确认双方在同一房间
2. 检查控制台是否有错误
3. 验证服务器日志:
   ```bash
   pm2 logs danmaku-server
   # 应该看到 "Forwarded danmaku from xxx to y clients"
   ```

### 问题3: 用户列表为空

**症状**: 连接成功但看不到其他用户。

**解决**:
1. 确认回调已正确设置
2. 检查心跳是否正常(每5秒应该有ping/pong日志)
3. 尝试重新加入房间

### 问题4: 频繁断线

**症状**: 连接几秒后就断开。

**解决**:
1. 检查网络连接稳定性
2. 增加心跳间隔(如果网络较慢)
3. 检查服务器负载情况

## 📈 性能监控

### 延迟测试

在控制台运行:
```javascript
// 记录发送时间
const sendTime = Date.now();
// 发送测试消息
// ... 在接收端记录接收时间
const receiveTime = Date.now();
console.log(`Latency: ${receiveTime - sendTime}ms`);
```

### 内存使用

```bash
# 服务器端
pm2 monit
```

## 🔐 安全建议

### 生产环境

1. **启用HTTPS/WSS**:
   - 获取SSL证书
   - 配置Nginx反向代理
   - 使用wss://协议

2. **添加认证**:
   - Token验证
   - IP白名单
   - 速率限制

3. **监控告警**:
   - PM2监控
   - 日志聚合
   - 异常告警

## 📝 下一步优化

1. **UI改进**:
   - 添加模式切换按钮
   - 显示连接状态指示器
   - 显示延迟统计

2. **功能增强**:
   - 房间密码保护
   - 管理员权限
   - 消息历史记录

3. **性能优化**:
   - 消息压缩
   - 批量发送
   - 离线缓存

## 🎯 预期结果

完成配置后,你应该能够:

- ✅ 通过服务器模式连接房间
- ✅ 在多个客户端之间收发弹幕
- ✅ 看到实时的在线用户列表
- ✅ 断线后自动重连
- ✅ 心跳机制正常工作(每5秒ping/pong)

## 📞 技术支持

如果遇到问题:

1. 检查本文档的"常见问题"部分
2. 查看服务器和客户端日志
3. 参考相关文档:
   - [DEPLOYMENT.md](../danmaku-server/DEPLOYMENT.md) - 服务器部署
   - [CLIENT_INTEGRATION.md](../danmaku-server/CLIENT_INTEGRATION.md) - 客户端集成
   - [README.md](../danmaku-server/README.md) - 项目说明
