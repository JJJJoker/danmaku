# 服务器部署检查清单

## 部署前准备

- [ ] 本地代码已编译 (`npm run build`)
- [ ] dist目录包含 server.js, room.js, types.js
- [ ] 压缩包已生成 (danmaku-server.zip)
- [ ] SSH可以连接到服务器 (ssh <用户>@<你的服务器IP>)

---

## 上传阶段

### 方式1: 使用自动化脚本(推荐)

```powershell
cd d:\tools\qoder\qoder_project\yundan\danmaku-server
.\deploy-to-server.ps1
```

脚本会自动:
- ✓ 检查编译状态
- ✓ 压缩必要文件
- ✓ 上传到服务器
- ✓ 提供后续部署指令

### 方式2: 手动上传

```powershell
# 1. 创建远程目录
ssh <用户>@<你的服务器IP> "mkdir -p /opt/danmaku-server"

# 2. 上传压缩包
scp danmaku-server.zip <用户>@<你的服务器IP>:/opt/danmaku-server/
```

---

## 服务器端部署

SSH登录服务器后执行:

```bash
# 1. 进入部署目录
cd /opt/danmaku-server

# 2. 解压文件
unzip -o danmaku-server.zip

# 3. 删除压缩包
rm danmaku-server.zip

# 4. 设置执行权限
chmod +x deploy.sh

# 5. 运行部署脚本
./deploy.sh
```

**预期输出**:
```
[Step 1/6] 检查Node.js...
✓ Node.js已安装: v20.x.x

[Step 2/6] 创建项目目录...
✓ 项目目录: /opt/danmaku-server

[Step 3/6] 复制项目文件...
✓ 项目文件已就绪

[Step 4/6] 安装依赖...
✓ 依赖安装完成

[Step 5/6] 编译TypeScript...
✓ 编译成功

[Step 6/6] 配置防火墙...
✓ 防火墙规则已添加: 8080

安装PM2进程管理器...
✓ PM2已安装

启动服务...
[PM2] Starting /opt/danmaku-server/dist/server.js in fork_mode (1 instance)
[PM2] Done.

========================================
  部署完成!
========================================

服务器地址: ws://<你的服务器IP>:8080
服务状态: online
```

---

## 验证部署

### 1. 检查PM2状态

```bash
pm2 status
```

**期望结果**:
```
┌────┬─────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┐
│ id │ name            │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ watching │
├────┼─────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┤
│ 0  │ danmaku-server  │ default     │ 1.0.0   │ fork    │ 12345    │ 30s    │ 0    │ online    │ 0%       │ 25mb     │ disabled │
└────┴─────────────────┴─────────────┴─────────┴──────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┘
```

**关键点**:
- ✅ status 为 `online`
- ✅ ↺ (重启次数) 为 0
- ✅ mem 正常 (< 100MB)

### 2. 查看日志

```bash
pm2 logs danmaku-server --lines 20
```

**期望输出**:
```
[TAILING] Tailing last 20 lines for [danmaku-server] process
/opt/danmaku-server/dist/server.js:
[Server] Management API listening on port 8081
[Server] Danmaku server listening on port 8080
```

**关键点**:
- ✅ 没有错误信息
- ✅ 看到两个端口监听消息

### 3. 测试管理API

```bash
curl http://localhost:8081/stats
```

**期望输出**:
```json
{
  "totalRooms": 0,
  "totalClients": 0,
  "rooms": []
}
```

### 4. 检查端口监听

```bash
netstat -tlnp | grep -E '8080|8081'
```

**期望输出**:
```
tcp        0      0 0.0.0.0:8080            0.0.0.0:*               LISTEN      12345/node
tcp        0      0 0.0.0.0:8081            0.0.0.0:*               LISTEN      12345/node
```

### 5. 检查防火墙

```bash
# Ubuntu/Debian
ufw status | grep -E '8080|8081'

# CentOS/RHEL
firewall-cmd --list-ports | grep -E '8080|8081'
```

**期望结果**:
- 8080/tcp: ALLOW
- 8081/tcp: ALLOW

如果没有开放,执行:

```bash
# Ubuntu/Debian
ufw allow 8080/tcp
ufw allow 8081/tcp

# CentOS/RHEL
firewall-cmd --add-port=8080/tcp --permanent
firewall-cmd --add-port=8081/tcp --permanent
firewall-cmd --reload
```

---

## 客户端连接测试

### 1. 启动本地客户端

```powershell
cd d:\tools\qoder\qoder_project\yundan
npm start
```

### 2. 打开开发者工具

按 `Ctrl+Shift+I`,切换到Console标签

### 3. 创建房间

输入用户名,点击"创建房间"

**期望日志**:
```
[ServerConnection] Connecting to ws://<你的服务器IP>:8080...
[ServerConnection] Connected to server
[ServerConnection] Starting heartbeat (every 5s)
[ServerConnection] Sent join message
```

### 4. 在服务器上查看日志

```bash
pm2 logs danmaku-server --lines 10
```

**期望输出**:
```
[Room:danmaku-test-abc1] User joined: user123 (张三), count: 1
```

### 5. 测试多客户端

打开第二个客户端窗口,加入同一个房间

**第一个客户端应该看到**:
- 用户列表更新,显示新用户

**服务器日志应该显示**:
```
[Room:danmaku-test-abc1] User joined: user456 (李四), count: 2
```

### 6. 测试房间切换

在第一个客户端切换到另一个房间

**服务器日志应该显示**:
```
[ServerConnection] Sent leave message for room: danmaku-test-abc1
[Room:danmaku-test-abc1] User left: user123, count: 1
[Room:danmaku-new-room] User joined: user123 (张三), count: 1
```

### 7. 测试优雅断开

直接关闭第一个客户端窗口

**服务器日志应该显示**:
```
[ServerConnection] Sent leave message for room: danmaku-new-room
[Room:danmaku-new-room] User left: user123, count: 0
[Server] Empty room, cleaning up: danmaku-new-room
```

---

## 常见问题排查

### 问题1: PM2显示status为errored

**检查错误日志**:
```bash
pm2 logs danmaku-server --err --lines 50
```

**常见原因**:
1. 端口被占用
2. Node.js版本过低
3. 依赖未安装

**解决**:
```bash
# 释放端口
kill $(lsof -t -i:8080)

# 重新安装依赖
cd /opt/danmaku-server
npm install

# 重启服务
pm2 restart danmaku-server
```

### 问题2: 客户端无法连接

**从本地测试网络连通性**:
```powershell
telnet <你的服务器IP> 8080
```

如果连接失败:

1. **检查服务器防火墙**:
   ```bash
   ufw status
   # 或
   firewall-cmd --list-all
   ```

2. **检查云服务器安全组**:
   - 登录云控制台
   - 找到安全组配置
   - 添加入站规则: TCP 8080, 8081

3. **检查服务是否运行**:
   ```bash
   pm2 status
   netstat -tlnp | grep 8080
   ```

### 问题3: 管理API无法访问

**在服务器上测试**:
```bash
curl http://localhost:8081/stats
```

如果本地可以但远程不行:
- 检查防火墙是否开放8081端口
- 检查云服务器安全组

### 问题4: PM2开机自启失效

**重新配置**:
```bash
pm2 startup systemd -u root --hp /root
pm2 save
```

**验证**:
```bash
systemctl list-units | grep pm2
```

应该看到 `pm2-root.service` 处于active状态。

---

## 性能监控

### 实时监控

```bash
pm2 monit
```

可以看到:
- CPU使用率
- 内存使用
- 请求吞吐量

### 资源限制

编辑 `/opt/danmaku-server/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'danmaku-server',
    script: 'dist/server.js',
    max_memory_restart: '512M',  // 内存超过512MB自动重启
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    }
  }]
};
```

应用更改:
```bash
pm2 reload ecosystem.config.js
```

---

## 备份和恢复

### 备份

```bash
# 在服务器上
cd /opt
tar czf danmaku-server-backup-$(date +%Y%m%d).tar.gz danmaku-server/
```

下载到本地:
```powershell
scp <用户>@<你的服务器IP>:/opt/danmaku-server-backup-20260705.tar.gz .
```

### 恢复

```bash
# 停止服务
pm2 stop danmaku-server

# 解压备份
cd /opt
tar xzf danmaku-server-backup-20260705.tar.gz

# 重启服务
pm2 restart danmaku-server
```

---

## 部署完成确认

完成以下所有检查项后,部署才算成功:

- [ ] PM2状态为online
- [ ] 日志无错误信息
- [ ] 管理API返回正确JSON
- [ ] 端口8080和8081正在监听
- [ ] 防火墙已开放端口
- [ ] 客户端可以成功连接
- [ ] 多客户端房间同步正常
- [ ] 房间切换功能正常
- [ ] 优雅断开连接正常
- [ ] PM2开机自启已配置

---

## 维护命令速查

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs danmaku-server

# 重启服务
pm2 restart danmaku-server

# 停止服务
pm2 stop danmaku-server

# 删除服务
pm2 delete danmaku-server

# 查看资源
pm2 monit

# 保存当前进程列表
pm2 save

# 查看保存的进程
pm2 list
```

---

## 联系支持

如遇问题,请提供:
1. `pm2 logs danmaku-server --lines 50` 的输出
2. `pm2 status` 的输出
3. 客户端控制台的错误信息
4. 服务器操作系统版本: `cat /etc/os-release`
5. Node.js版本: `node --version`
