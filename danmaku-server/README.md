# 云弹一下 WebSocket弹幕服务器

基于Node.js和WebSocket的实时弹幕服务器,支持多房间、消息转发、心跳保活等功能。

## 功能特性

- ✅ 多房间支持
- ✅ 实时消息转发
- ✅ 心跳保活机制
- ✅ 自动断线重连
- ✅ 历史弹幕缓存(最近50条)
- ✅ 在线用户列表同步
- ✅ 健康检查与超时清理

## 技术栈

- Node.js + TypeScript
- ws (WebSocket库)
- 纯文本JSON协议

## 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 编译TypeScript
npm run build

# 启动服务器(默认端口8080)
npm start

# 或使用ts-node直接运行
npm run dev
```

### 部署到云服务器

#### 方法1: 手动部署

1. SSH登录到服务器:
```bash
ssh <用户>@<你的服务器IP>
```

2. 安装Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

3. 上传项目文件到服务器 `/opt/danmaku-server`

4. 安装依赖并编译:
```bash
cd /opt/danmaku-server
npm install --production
npm run build
```

5. 开放防火墙端口:
```bash
ufw allow 8080/tcp
ufw allow 8080/udp
```

6. 启动服务:
```bash
npm start
```

#### 方法2: 使用PM2进程管理(推荐)

1. 全局安装PM2:
```bash
npm install -g pm2
```

2. 创建 `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'danmaku-server',
    script: 'dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    }
  }]
};
```

3. 启动服务:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # 配置开机自启
```

4. 管理服务:
```bash
pm2 status        # 查看状态
pm2 logs          # 查看日志
pm2 restart all   # 重启服务
pm2 stop all      # 停止服务
```

## 协议说明

### 客户端 -> 服务器

**加入房间**:
```json
{
  "type": "join",
  "payload": {
    "roomId": "danmaku-test-abc123",
    "userId": "user123",
    "username": "张三"
  }
}
```

**发送弹幕**:
```json
{
  "type": "danmaku",
  "payload": {
    "id": "msg-001",
    "text": "Hello World!",
    "userId": "user123",
    "color": "#FFFFFF",
    "fontSize": 24,
    "speed": "normal",
    "timestamp": 1234567890
  }
}
```

**心跳ping**:
```json
{
  "type": "ping",
  "payload": {
    "timestamp": 1234567890,
    "userId": "user123"
  }
}
```

**离开房间**:
```json
{
  "type": "leave",
  "payload": {
    "userId": "user123"
  }
}
```

### 服务器 -> 客户端

**初始化数据**:
```json
{
  "type": "init",
  "payload": {
    "danmakus": [ /* 历史弹幕数组 */ ]
  }
}
```

**转发弹幕**:
```json
{
  "type": "danmaku",
  "payload": { /* 弹幕对象 */ }
}
```

**用户列表更新**:
```json
{
  "type": "user-list",
  "payload": {
    "users": [
      { "userId": "user123", "username": "张三" },
      { "userId": "user456", "username": "李四" }
    ]
  }
}
```

**心跳pong**:
```json
{
  "type": "pong",
  "payload": {
    "timestamp": 1234567890
  }
}
```

**用户离开通知**:
```json
{
  "type": "leave",
  "payload": {
    "userId": "user123"
  }
}
```

## 配置说明

### 环境变量

- `PORT`: 服务器监听端口(默认8080)

### 修改服务器地址

编辑 `src/renderer/services/peerService.ts`:
```typescript
private SERVER_URL = 'ws://YOUR_SERVER_IP:8080';
```

## 测试

### 本地测试

使用WebSocket客户端工具或浏览器控制台:

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => {
  console.log('Connected');
  
  // 加入房间
  ws.send(JSON.stringify({
    type: 'join',
    payload: {
      roomId: 'test-room',
      userId: 'user1',
      username: 'TestUser'
    }
  }));
};

ws.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};
```

### 远程测试

```powershell
# PowerShell测试连接
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync("ws://<你的服务器IP>:8080", [Threading.CancellationToken]::None).Wait()
```

## 监控与维护

### 查看日志

```bash
# PM2日志
pm2 logs danmaku-server

# 或查看日志文件
tail -f ~/.pm2/logs/danmaku-server-out.log
tail -f ~/.pm2/logs/danmaku-server-error.log
```

### 性能监控

```bash
# 查看资源占用
pm2 monit

# 或使用top/htop查看进程信息
top -p $(pgrep -f "node.*server")
```

## 故障排查

### 问题1: 服务器无法启动

**症状**: 端口被占用

**解决**:
```bash
# 查找占用端口的进程
lsof -i :8080
# 或
netstat -tlnp | grep 8080

# 杀死进程
kill -9 <PID>
```

### 问题2: 客户端连接失败

**症状**: Connection refused

**可能原因**:
1. 服务器未启动
2. 防火墙阻止
3. IP地址或端口错误

**解决**:
```bash
# 检查服务器状态
pm2 status

# 检查防火墙
ufw status

# 测试本地连接
curl http://localhost:8080
```

### 问题3: 心跳超时

**症状**: 客户端频繁断开重连

**可能原因**:
1. 网络不稳定
2. 服务器负载过高

**解决**:
- 调整健康检查间隔
- 检查服务器资源使用情况

## 安全建议

1. **防火墙配置**: 只开放必要的端口
2. **HTTPS/WSS**: 生产环境建议使用加密连接
3. **认证机制**: 添加Token验证防止未授权访问
4. **速率限制**: 防止DDoS攻击
5. **输入验证**: 过滤敏感词和非法字符

## 扩展方向

1. **Redis集成**: 支持多实例部署和会话共享
2. **数据库持久化**: 保存历史记录和用户信息
3. **负载均衡**: Nginx反向代理和多服务器集群
4. **监控告警**: Prometheus + Grafana
5. **管理后台**: Web界面管理房间和用户

## 许可证

MIT
