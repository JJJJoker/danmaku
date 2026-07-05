# TURN服务器完整部署指南

## 概述

本指南提供在国内云服务器上自建Coturn TURN服务器的完整方案,解决P2P连接超时问题。

## 为什么需要自建TURN服务器?

1. **免费公共TURN不稳定**: openrelay.metered.ca等免费服务可能有流量限制或延迟高
2. **国内网络优化**: 自建国内节点可将延迟降低到50ms以内
3. **完全可控**: 自主管理配置、监控和运维
4. **提高成功率**: 连接成功率可提升到95%以上

## 快速开始(推荐Docker方式)

### 前置条件

- Ubuntu 20.04/22.04 LTS服务器
- Docker和Docker Compose已安装
- 获取服务器公网IP地址

### 一键部署

```bash
# 1. SSH连接到服务器
ssh root@YOUR_SERVER_IP

# 2. 上传部署文件到服务器
# (将 docker-compose-turn.yml, deploy-turn-docker.sh, .env.example 上传到服务器)

# 3. 运行部署脚本
chmod +x deploy-turn-docker.sh
./deploy-turn-docker.sh YOUR_SERVER_IP turnuser YourPassword123!

# 4. 测试连接(在你的Windows电脑上)
.\test-turn.ps1 -ServerIP "YOUR_SERVER_IP" -Port 3478
```

### 验证部署

在Windows PowerShell中运行:

```powershell
Test-NetConnection -ComputerName YOUR_SERVER_IP -Port 3478 -InformationLevel Detailed
```

应该看到 `TcpTestSucceeded: True`

## 详细部署方案

### 方案1: Docker Compose部署(推荐)

**优点**: 简单、易维护、可快速迁移

**步骤**:

1. 创建 `.env` 文件:
```bash
cp .env.example .env
# 编辑 .env 填入实际值
```

2. 启动服务:
```bash
docker-compose -f docker-compose-turn.yml up -d
```

3. 查看日志:
```bash
docker logs -f turn-server
```

4. 停止服务:
```bash
docker-compose -f docker-compose-turn.yml down
```

### 方案2: 直接安装Coturn

**优点**: 无需Docker,资源占用略少

**步骤**:

参见 [DEPLOY_TURN_SERVER.md](DEPLOY_TURN_SERVER.md) 中的详细步骤。

### 方案3: 使用阿里云/腾讯云镜像市场

**优点**: 最快部署,无需手动配置

**步骤**:

1. 登录阿里云控制台
2. 搜索"Coturn"或"TURN服务器"
3. 选择镜像市场的预装镜像
4. 按向导完成购买和部署
5. 根据提供商文档配置用户名密码

## 修改应用配置

部署完成后,修改 [`src/renderer/services/peerService.ts`](src/renderer/services/peerService.ts):

### 主机创建配置 (第89-125行)

```typescript
this.peer = new Peer(peerId, {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    debug: 1,
    config: {
        iceServers: [
            // STUN 服务器
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            
            // 自建国内TURN服务器(优先使用)
            { 
                urls: 'turn:YOUR_SERVER_IP:3478',
                username: 'turnuser',
                credential: 'YourPassword123!'
            },
            {
                urls: 'turn:YOUR_SERVER_IP:3478?transport=tcp',
                username: 'turnuser',
                credential: 'YourPassword123!'
            },
            
            // 免费公共TURN作为备选
            { 
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
    },
});
```

### 客户端加入配置 (第161-203行)

应用相同的ICE服务器配置。

**替换以下占位符**:
- `YOUR_SERVER_IP`: 你的服务器公网IP
- `turnuser`: 你设置的用户名
- `YourPassword123!`: 你设置的密码

## 重新打包应用

```bash
npm run build:win
```

输出位置: `dist-new/win-unpacked/云弹一下.exe`

## 测试验证

### 测试步骤

1. **你朋友(主机)**:
   - 运行新版本应用
   - 使用手机热点网络
   - 创建房间,记录RoomID

2. **你(客户端)**:
   - 运行新版本应用
   - 输入朋友的RoomID
   - 点击"加入房间"

3. **观察结果**:
   - ✅ 成功: 15秒内连接,显示"Connected to host successfully!"
   -  失败: 仍然超时,查看浏览器控制台(F12)的详细错误

### 查看WebRTC日志

按F12打开开发者工具,在Console标签页应该看到:

```
[RoomConnection:xxx] Client peer opened with ID: xxx
[RoomConnection:xxx] Attempting to connect to host: xxx_host
ICE connection state: checking
ICE candidate gathering...
[RoomConnection:xxx] Connected to host successfully!
```

## 监控和维护

### 查看TURN服务器日志

```bash
# Docker方式
docker logs -f turn-server

# 直接安装方式
tail -f /var/log/turnserver.log
```

### 常见问题排查

#### 问题1: 客户端无法连接TURN服务器

**症状**: Test-NetConnection失败

**解决**:
```bash
# 检查防火墙
ufw status

# 检查服务状态
systemctl status coturn
# 或
docker ps | grep turn-server

# 重启服务
systemctl restart coturn
# 或
docker restart turn-server
```

#### 问题2: P2P仍然超时

**可能原因**:
1. external-ip配置错误
2. 用户名密码不匹配
3. 服务器带宽不足

**解决**:
```bash
# 检查配置文件
cat /etc/turnserver.conf
# 或
docker exec turn-server cat /etc/turnserver.conf

# 确认external-ip与服务器公网IP一致
# 确认username和password与应用配置一致
```

#### 问题3: 高并发下性能问题

**症状**: 多人同时使用时连接变慢

**解决**:
1. 升级服务器配置(2核4GB+)
2. 增加带宽到5Mbps+
3. 考虑使用负载均衡或多节点部署

## 安全建议

1. **定期更换密码**: 每3个月更换一次TURN用户名密码
2. **限制访问IP**: 如果可能,在防火墙中限制只允许特定IP段访问
3. **启用TLS加密**: 生产环境建议使用WSS(WebSocket Secure)
4. **监控日志**: 定期检查 `/var/log/turnserver.log` 发现异常访问

## 成本估算

### 阿里云ECS(杭州/上海)

- t6/t5 突发性能型 (1核2GB): ¥60-80/月
- 带宽 3Mbps: 包含在实例费用中
- 存储 40GB: ¥20/月
- **总计**: ~¥80-100/月

### 腾讯云CVM(广州/北京)

- S4/S5 标准型 (1核2GB): ¥60-80/月
- 带宽 3Mbps: 包含在实例费用中
- 存储 50GB: ¥15/月
- **总计**: ~¥75-95/月

### 按量付费模式(测试用)

- 1核2GB: ¥0.12/小时
- 测试1天: ~¥3
- 适合短期测试验证

## 后续优化

### 1. 添加监控告警

使用Prometheus + Grafana监控:
- CPU/内存使用率
- 网络连接数
- 带宽使用情况
- 服务可用性

### 2. 自动化部署

使用Ansible或Terraform实现:
- 一键部署新服务器
- 自动配置备份
- 版本升级自动化

### 3. 多节点部署

在不同地域部署多个TURN服务器:
- 华东(上海/杭州)
- 华南(广州/深圳)
- 华北(北京)
- 实现就近接入,降低延迟

### 4. 证书管理

申请SSL证书并启用WSS:
```bash
# 使用Let's Encrypt免费证书
certbot certonly --standalone -d turn.yourdomain.com

# 配置Coturn使用证书
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
```

## 技术支持

如遇到问题:

1. 查看日志文件定位错误
2. 检查防火墙和安全组配置
3. 测试端口连通性
4. 参考Coturn官方文档: https://github.com/coturn/coturn

## 附录

### 相关文件清单

- `docker-compose-turn.yml`: Docker Compose配置文件
- `deploy-turn-docker.sh`: Docker一键部署脚本
- `.env.example`: 环境变量模板
- `test-turn.ps1`: Windows连接测试脚本
- `DEPLOY_TURN_SERVER.md`: 直接安装Coturn详细指南

### 常用命令速查

```bash
# 启动服务
docker-compose -f docker-compose-turn.yml up -d

# 停止服务
docker-compose -f docker-compose-turn.yml down

# 重启服务
docker-compose -f docker-compose-turn.yml restart

# 查看日志
docker logs -f turn-server

# 进入容器
docker exec -it turn-server bash

# 更新镜像
docker pull coturn/coturn:latest
docker-compose -f docker-compose-turn.yml up -d
```

---

**祝你部署顺利!如有问题欢迎反馈。**
