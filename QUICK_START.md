# 🚀 快速开始 - WebSocket服务器模式

## 1️⃣ 启动应用
```bash
cd d:\tools\qoder\qoder_project\yundan
npm start
```

## 2️⃣ 连接房间
1. 输入用户名
2. 点击"创建房间"或"加入房间"
3. 观察控制台日志确认连接成功

## 3️⃣ 测试连接
```powershell
.\test-websocket.ps1
```

预期输出: `Connection state: Open` ✅

## 4️⃣ 发送弹幕
1. 在控制面板输入消息
2. 点击发送
3. 在其他客户端查看是否收到

## 🔧 切换模式
```javascript
// 服务器模式 (默认)
localStorage.setItem('funapp-connectionMode', 'server')

// P2P模式
localStorage.setItem('funapp-connectionMode', 'p2p')

// 刷新页面生效
location.reload()
```

## 📊 查看状态
```javascript
// 当前模式
console.log(localStorage.getItem('funapp-connectionMode'))

// 连接状态
console.log(useConnectionStore.getState().status)

// 在线用户
console.log(useConnectionStore.getState().connectedUsers)
```

## 🐛 问题排查

### 连接失败?
```bash
# 检查服务器
ssh root@116.62.47.225
pm2 status danmaku-server
```

### 弹幕不显示?
- 确认在同一房间
- 检查控制台错误
- 查看服务器日志: `pm2 logs danmaku-server`

### 频繁断线?
- 检查网络: `ping 116.62.47.225`
- 查看防火墙设置
- 检查云服务器安全组

## 📖 详细文档
- [CLIENT_USAGE.md](./CLIENT_USAGE.md) - 完整使用指南
- [MULTI_CLIENT_TEST.md](./MULTI_CLIENT_TEST.md) - 多客户端测试
- [INTEGRATION_COMPLETE.md](./INTEGRATION_COMPLETE.md) - 集成报告

## 💡 提示
- 默认使用服务器模式
- 按 `Ctrl+Shift+I` 打开开发者工具
- 查看Console标签获取详细日志
- 心跳每5秒自动发送
