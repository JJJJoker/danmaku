# 快速部署指南

## 当前状态

✅ 代码已在本地编译完成
✅ 压缩包已生成: `danmaku-server/danmaku-server.zip`

---

## 手动部署步骤

由于SSH需要密码认证,请按以下步骤手动操作:

### 步骤1: 上传文件到服务器

打开PowerShell或CMD,执行:

```powershell
cd d:\tools\qoder\qoder_project\yundan\danmaku-server
scp danmaku-server.zip <用户>@<你的服务器IP>:/opt/danmaku-server/
```

**提示**: 输入服务器root用户的密码

### 步骤2: SSH登录服务器

```bash
ssh <用户>@<你的服务器IP>
```

### 步骤3: 在服务器上解压和部署

```bash
# 进入部署目录
cd /opt/danmaku-server

# 解压文件
unzip -o danmaku-server.zip

# 删除压缩包
rm danmaku-server.zip

# 设置执行权限
chmod +x deploy.sh

# 运行部署脚本
./deploy.sh
```

部署脚本会自动完成:
- 检查并安装Node.js(如需要)
- 安装npm依赖
- 配置防火墙
- 安装PM2
- 启动服务

### 步骤4: 验证部署

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs danmaku-server --lines 20

# 测试管理API
curl http://localhost:8081/stats
```

应该看到类似输出:
```json
{
  "totalRooms": 0,
  "totalClients": 0,
  "rooms": []
}
```

---

## 如果遇到问题

### 问题1: SCP上传失败

**错误**: `Permission denied` 或 `Connection timed out`

**解决**:
1. 确认服务器IP正确: <你的服务器IP>
2. 确认SSH服务运行: `ssh <用户>@<你的服务器IP>`
3. 检查防火墙是否允许SSH(端口22)

### 问题2: unzip命令不存在

**解决**:
```bash
# Ubuntu/Debian
apt-get install -y unzip

# CentOS/RHEL
yum install -y unzip
```

### 问题3: deploy.sh执行失败

**查看详细错误**:
```bash
bash -x ./deploy.sh
```

**常见原因**:
- Node.js版本过低: 需要>=16
- npm未安装
- 权限不足: 确保以root运行

### 问题4: PM2启动失败

**查看错误日志**:
```bash
pm2 logs danmaku-server --err
```

**重启服务**:
```bash
pm2 restart danmaku-server
```

---

## 客户端测试

部署完成后,在本地Windows机器上:

```powershell
cd d:\tools\qoder\qoder_project\yundan
npm start
```

打开Electron应用后:
1. 按 `Ctrl+Shift+I` 打开开发者工具
2. 查看控制台,应该看到连接成功的日志
3. 创建房间并测试弹幕功能

---

## 监控和维护

### 常用命令

```bash
# 查看服务状态
pm2 status

# 查看实时日志
pm2 logs danmaku-server

# 重启服务
pm2 restart danmaku-server

# 停止服务
pm2 stop danmaku-server

# 访问管理API
curl http://localhost:8081/stats
```

### 从本地访问管理API

如果服务器开放了8081端口,可以从浏览器访问:

```
http://<你的服务器IP>:8081/stats
```

---

## 备份建议

部署成功后,建议备份当前版本:

```bash
# 在服务器上执行
cd /opt
tar czf danmaku-server-backup-$(date +%Y%m%d).tar.gz danmaku-server/
```

恢复时:

```bash
pm2 stop danmaku-server
cd /opt
tar xzf danmaku-server-backup-20260705.tar.gz
pm2 restart danmaku-server
```

---

## 下一步

部署完成后,你可以:

1. ✅ 测试单客户端连接
2. ✅ 测试多客户端房间同步
3. ✅ 测试房间切换功能
4. ✅ 测试优雅断开连接
5. ✅ 监控服务器性能和日志

如有问题,请查看 `pm2 logs danmaku-server` 获取详细错误信息。
