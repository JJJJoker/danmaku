# TURN服务器快速部署 - 5分钟上手

## 最快部署方式(Docker)

### 1. 准备服务器

购买阿里云/腾讯云服务器:
- Ubuntu 20.04 LTS
- 1核2GB
- 3Mbps带宽
- 月费约¥60-80

### 2. SSH连接服务器

```bash
ssh root@YOUR_SERVER_IP
```

### 3. 一键部署

```bash
# 下载部署脚本
curl -O https://raw.githubusercontent.com/your-repo/deploy-turn-docker.sh
chmod +x deploy-turn-docker.sh

# 运行(替换为你的IP、用户名、密码)
./deploy-turn-docker.sh 123.45.67.89 turnuser MyPass123!
```

### 4. 测试连接

在你的Windows电脑上:

```powershell
Test-NetConnection -ComputerName 123.45.67.89 -Port 3478
# 应该看到 TcpTestSucceeded: True
```

### 5. 修改应用配置

编辑 `src/renderer/services/peerService.ts`,在主机和客户端两处添加:

```typescript
{ 
    urls: 'turn:123.45.67.89:3478',
    username: 'turnuser',
    credential: 'MyPass123!'
}
```

### 6. 重新打包

```bash
npm run build:win
```

### 7. 测试P2P连接

让你朋友创建房间,你加入,应该在15秒内成功!

---

## 常用命令

```bash
# 查看日志
docker logs -f turn-server

# 重启服务
docker restart turn-server

# 停止服务
docker-compose -f docker-compose-turn.yml down

# 启动服务
docker-compose -f docker-compose-turn.yml up -d
```

---

## 故障排查

**问题**: Test-NetConnection失败

**解决**:
```bash
# 检查防火墙
ufw allow 3478/udp
ufw allow 3478/tcp

# 检查服务状态
docker ps | grep turn-server

# 查看错误日志
docker logs turn-server
```

---

## 下一步

详细文档请查看:
- [TURN_SERVER_GUIDE.md](TURN_SERVER_GUIDE.md) - 完整部署指南
- [DEPLOY_TURN_SERVER.md](DEPLOY_TURN_SERVER.md) - 直接安装方案
- [docker-compose-turn.yml](docker-compose-turn.yml) - Docker配置
