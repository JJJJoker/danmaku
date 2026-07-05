# 修复重连循环 - 部署说明

## 已完成的修改

### 1. 服务器端修改

**文件**: `danmaku-server/src/room.ts`

- 将心跳超时时间从15秒增加到30秒
- 减少因网络波动导致的误判断开

### 2. 客户端修改

**文件**: `src/renderer/services/peerService.ts`

- 添加`persistentUserId`字段保存持久化userId
- 重连时复用相同的userId,而不是生成新的
- 避免用户列表反复更新

---

## 部署步骤

### 步骤1: 上传文件到服务器

在本地Windows PowerShell中执行:

```powershell
cd d:\tools\qoder\qoder_project\yundan\danmaku-server
scp danmaku-server.zip root@REDACTED_SERVER_IP:/opt/danmaku-server/
```

**提示**: 输入服务器root用户的密码

### 步骤2: SSH登录服务器

```bash
ssh root@REDACTED_SERVER_IP
```

### 步骤3: 在服务器上解压和重新编译

```bash
cd /opt/danmaku-server

# 解压覆盖
unzip -o danmaku-server.zip

# 删除压缩包
rm danmaku-server.zip

# 设置权限
chmod +x deploy.sh

# 安装依赖(包含TypeScript类型定义)
npm install --omit=dev
npm install --save-dev @types/ws @types/node typescript

# 重新编译
npm run build

# 重启PM2服务
pm2 restart danmaku-server
```

### 步骤4: 验证部署

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs danmaku-server --lines 20
```

应该看到:
```
[Server] Management API listening on port 8081
[Server] Danmaku server listening on port 8080
```

---

## 客户端测试

### 1. 刷新客户端

客户端代码已通过Vite热更新自动重载,无需重新启动。

如果客户端窗口还在运行,它会自动应用新代码。

### 2. 测试连接稳定性

1. 打开Electron应用
2. 按Ctrl+Shift+I打开开发者工具
3. 输入用户名,创建或加入房间
4. 观察控制台日志

**期望行为**:
- 连接成功后保持稳定
- 不再频繁出现"disconnected"和"Reconnecting"
- 用户列表不再反复更新
- 即使有短暂的网络波动,重连后userId保持不变

### 3. 测试长时间连接

保持客户端运行5-10分钟,观察:
- 连接是否稳定
- 用户列表是否正常
- 没有无限重连循环

---

## 预期效果

### 修复前

```
[02:29:32] 连接状态: disconnected
[02:29:33] 在线用户更新: 2 人
[02:29:52] 👋 用户离开: wph950
[02:29:52] 在线用户更新: 1 人
[02:29:52] 连接状态: disconnected
[02:29:54] 在线用户更新: 2 人  <-- 新用户(实际是同一个客户端)
... (循环往复)
```

### 修复后

```
[02:35:00] ✅ 通过服务器创建房间: danmaku-tth-00hs
[02:35:00] 在线用户更新: 1 人
[02:35:15] 在线用户更新: 2 人  <-- 第二个客户端加入
[02:40:00] 👋 用户离开: user456  <-- 真正的用户离开
[02:40:00] 在线用户更新: 1 人
... (保持稳定)
```

---

## 故障排查

### 问题1: 仍然出现重连循环

**检查服务器日志**:
```bash
pm2 logs danmaku-server --lines 50
```

查看是否有:
- "Client timeout" 消息(说明心跳仍然超时)
- WebSocket错误

**可能原因**:
- 服务器代码未正确重新编译
- PM2未重启服务

**解决**:
```bash
cd /opt/danmaku-server
npm run build
pm2 restart danmaku-server
pm2 logs danmaku-server
```

### 问题2: 客户端未应用新代码

**强制刷新**:
- 关闭Electron应用
- 重新运行 `npm start`

**检查Vite热更新**:
查看终端输出,确认看到:
```
[vite] (client) hmr update /src/renderer/services/peerService.ts
```

### 问题3: userId仍然变化

**检查代码是否正确修改**:

在服务器上:
```bash
cat /opt/danmaku-server/dist/server.js | grep persistentUserId
```

在本地:
```powershell
Get-Content src\renderer\services\peerService.ts | Select-String "persistentUserId"
```

应该能看到相关代码。

---

## 技术细节

### 心跳机制

**客户端**:
- 每5秒发送一次ping消息
- 服务器回复pong消息

**服务器**:
- 记录每个客户端的最后心跳时间
- 每10秒检查一次所有客户端
- 如果超过30秒没有心跳,认为客户端超时并移除

### 重连机制

**之前的问题**:
```typescript
// 每次joinRoom都生成新的userId
this.userId = Math.random().toString(36).substring(2, 8);
```

**修复后**:
```typescript
// 首次连接生成userId,之后复用
if (!this.persistentUserId) {
  this.persistentUserId = Math.random().toString(36).substring(2, 8);
}
this.userId = this.persistentUserId;
```

### 为什么需要两个修改?

1. **增加超时时间**: 给网络波动更多容忍度,减少不必要的断开
2. **复用userId**: 即使断开重连,也保持相同身份,用户体验更好

两者结合才能达到最佳效果。

---

## 后续优化建议

### 1. 添加重连状态提示

在UI中显示重连进度:
```typescript
set({ 
  status: 'reconnecting',
  error: `正在重连... (${attempts}/${maxAttempts})`
});
```

### 2. 添加手动重连按钮

允许用户主动触发重连,而不是完全自动。

### 3. 优化心跳策略

- 根据网络质量动态调整心跳间隔
- 在网络差时降低频率,减少带宽消耗

### 4. 添加连接质量监控

记录:
- 平均延迟
- 丢包率
- 重连次数

---

## 总结

**问题**: 客户端不断重连,导致用户列表反复更新

**根本原因**: 
1. 服务器心跳超时时间过短(15秒)
2. 重连时生成新的userId

**解决方案**:
1. 增加服务器超时到30秒
2. 客户端重连时复用相同userId

**预计效果**: 
- 连接更稳定
- 用户列表不再异常更新
- 更好的用户体验

完成部署后,请测试5-10分钟确保问题已解决。
