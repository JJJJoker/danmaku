# 部署指南

将WebSocket弹幕服务器部署到云服务器的完整步骤。

## 前置条件

- 云服务器(Ubuntu 20.04/22.04)
- SSH访问权限
- root或sudo权限

---

## 方法1: 一键部署(推荐)

### Windows用户

1. **修改上传脚本配置**:
   编辑 `upload-to-server.ps1`,确认以下信息正确:
   ```powershell
   $SERVER_IP = "<你的服务器IP>"
   $SERVER_USER = "root"
   ```

2. **运行上传脚本**:
   ```powershell
   cd d:\tools\qoder\qoder_project\yundan\danmaku-server
   .\upload-to-server.ps1
   ```

3. **SSH登录服务器并执行部署**:
   ```bash
   ssh <用户>@<你的服务器IP>
   cd /opt/danmaku-server
   unzip danmaku-server.zip
   chmod +x deploy.sh
   ./deploy.sh
   ```

### Linux/Mac用户

1. **使用scp上传文件**:
   ```bash
   cd danmaku-server
   tar -czf danmaku-server.tar.gz package.json tsconfig.json README.md deploy.sh src/
   scp danmaku-server.tar.gz <用户>@<你的服务器IP>:/opt/danmaku-server/
   ```

2. **SSH登录并部署**:
   ```bash
   ssh <用户>@<你的服务器IP>
   cd /opt/danmaku-server
   tar -xzf danmaku-server.tar.gz
   chmod +x deploy.sh
   ./deploy.sh
   ```

---

## 方法2: 手动部署

### 步骤1: 安装Node.js

```bash
# SSH登录服务器
ssh <用户>@<你的服务器IP>

# 添加Node.js 20.x源
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装Node.js
sudo apt-get install -y nodejs

# 验证安装
node --version
npm --version
```

### 步骤2: 创建项目目录

```bash
sudo mkdir -p /opt/danmaku-server
cd /opt/danmaku-server
```

### 步骤3: 上传项目文件

**方式A: 使用Git**(推荐)
```bash
# 在本地初始化Git仓库并提交
cd d:\tools\qoder\qoder_project\yundan\danmaku-server
git init
git add .
git commit -m "Initial commit"

# 推送到GitHub/Gitee,然后在服务器上克隆
```

**方式B: 使用FTP/SFTP工具**
- 使用FileZilla、WinSCP等工具上传整个`danmaku-server`目录

**方式C: 直接复制**
```bash
# 在本地使用scp命令
scp -r danmaku-server/* <用户>@<你的服务器IP>:/opt/danmaku-server/
```

### 步骤4: 安装依赖并编译

```bash
cd /opt/danmaku-server

# 安装生产依赖
npm install --production

# 编译TypeScript
npm run build

# 验证编译结果
ls dist/
# 应该看到: server.js room.js types.js
```

### 步骤5: 配置防火墙

需要开放两个端口:8080(WebSocket 弹幕中继)和 8081(HTTP:/stats 统计 + /updates 客户端更新分发)。

```bash
# 如果使用ufw
sudo ufw allow 8080/tcp
sudo ufw allow 8081/tcp

# 如果使用firewalld(CentOS)
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --permanent --add-port=8081/tcp
sudo firewall-cmd --reload
```

### 步骤6: 测试运行

```bash
# 前台运行(用于测试)
npm start

# 应该看到输出:
# [Server] Danmaku server listening on port 8080
```

按 `Ctrl+C` 停止测试。

### 步骤7: 安装PM2进程管理器

```bash
# 全局安装PM2
sudo npm install -g pm2

# 验证安装
pm2 --version
```

### 步骤8: 创建PM2配置文件

```bash
cat > /opt/danmaku-server/ecosystem.config.js << 'EOF'
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
      PORT: 8080,
      UPDATES_DIR: '/opt/danmaku-server/updates'
    }
  }]
};
EOF
```

### 步骤9: 启动服务

```bash
cd /opt/danmaku-server

# 启动服务
pm2 start ecosystem.config.js

# 保存PM2配置(开机自启)
pm2 save

# 配置开机自启
pm2 startup systemd -u root --hp /root
```

### 步骤10: 验证服务

```bash
# 查看服务状态
pm2 status danmaku-server

# 查看日志
pm2 logs danmaku-server

# 测试本地连接
curl http://localhost:8080

# 或使用wget
wget http://localhost:8080
```

---

## 常用管理命令

### PM2服务管理

```bash
# 查看状态
pm2 status

# 查看详细信息
pm2 show danmaku-server

# 重启服务
pm2 restart danmaku-server

# 停止服务
pm2 stop danmaku-server

# 查看日志
pm2 logs danmaku-server

# 实时监控
pm2 monit
```

### 查看日志

```bash
# 实时日志
pm2 logs danmaku-server --lines 100

# 仅错误日志
pm2 logs danmaku-server --err

# 清空日志
pm2 flush
```

### 更新服务

```bash
# 1. 上传新代码到服务器
# 2. SSH登录服务器
ssh <用户>@<你的服务器IP>

# 3. 进入项目目录
cd /opt/danmaku-server

# 4. 重新编译
npm run build

# 5. 重启服务
pm2 restart danmaku-server

# 6. 验证新版本
pm2 logs danmaku-server
```

---

## 客户端更新分发(/updates)

服务器 8081 端口除 `/stats` 外还提供 `GET /updates/<文件名>` 静态路由,用于分发客户端自动更新资产(比 GitHub Releases 国内下载快)。客户端 electron-updater 以 `http://<服务器IP>:8081/updates` 为 generic 更新源,失败自动回退 GitHub。

### 目录约定

- 资产目录:`/opt/danmaku-server/updates`(可用环境变量 `UPDATES_DIR` 覆盖,ecosystem.config.js 已显式配置)
- 每个版本 7 个文件:`latest.yml`、`latest-mac.yml`、`yundan-<版本>-win-x64.exe`、`.exe.blockmap`、`yundan-<版本>-win-x64.zip`、`yundan-<版本>-mac-arm64.dmg`、`yundan-<版本>-mac-arm64.zip`
- CI 发版时自动 rsync 推送(见主仓库 `.github/workflows/release.yml` 的 `upload-update-server` job),并自动清理只保留最近 3 版(约 1.5GB,`df -h` 定期巡检)
- **保留旧版本不只是备份**:差量更新需要旧版本的 `.blockmap` 在线,删光旧版会让所有客户端退化为全量下载

### GitHub 仓库需要配置的 secrets / vars

| 类型 | 名称 | 内容 |
|---|---|---|
| Variable | `DANMAKU_UPDATE_URL` | `http://<服务器IP>:8081/updates`(置空即关闭自建源,客户端纯走 GitHub) |
| Secret | `UPDATE_SSH_KEY` | 专用 ed25519 私钥(勿复用日常运维私钥) |
| Secret | `UPDATE_SSH_HOST` | 服务器 IP(放 secret 让 Actions 日志自动打码) |
| Secret | `UPDATE_SSH_USER` | SSH 用户(当前部署为 root;将来整体收紧权限时改专用用户) |
| Secret | `UPDATE_SSH_PORT` | 可选,缺省 22 |
| Secret | `UPDATE_SSH_KNOWN_HOSTS` | 服务器 host key,生成方法见下 |

密钥与 host key 生成(在本地机器执行):

```bash
# 1. 生成专用部署密钥对
ssh-keygen -t ed25519 -f danmaku-deploy -N "" -C "danmaku-ci-upload"

# 2. 公钥写入服务器
ssh-copy-id -i danmaku-deploy.pub root@<服务器IP>

# 3. 私钥内容(danmaku-deploy 文件全文)存入 secret UPDATE_SSH_KEY

# 4. 生成 host key 存入 secret UPDATE_SSH_KNOWN_HOSTS
ssh-keyscan -p 22 <服务器IP>
```

### 首次上线回填

配置好后、下一次发版前,`/updates` 目录是空的(客户端请求 404 → 全部走 GitHub 回退,功能无损但验证不了链路)。需要手动把**当前已发布版本**的 7 个资产回填:

```bash
# 本地下载当前版本资产后上传(或用 gh release download)
gh release download v<当前版本> --dir assets
rsync -av assets/ root@<服务器IP>:/opt/danmaku-server/updates/

# 验证
curl -fsS http://<服务器IP>:8081/updates/latest.yml
curl -sI -H "Range: bytes=0-0" http://<服务器IP>:8081/updates/yundan-<当前版本>-win-x64.exe | head -1   # 应为 206
```

### CI 上传失败的手动补传

`upload-update-server` job 失败不影响 GitHub 发版(客户端自动回退)。恢复方式二选一:

1. Actions 页对该次运行点 **"Re-run failed jobs"**(只重跑上传 job;不能整个 workflow 重跑,prepare 会判已发布而跳过)
2. 手动补传:执行与"首次上线回填"相同的命令,注意**先传二进制、最后传两个 yml**,避免窗口期 yml 指向不存在的文件

### 安全说明(当前已知取舍)

- 更新走纯 HTTP + 裸 IP,链路上存在中间人篡改风险(yml 与安装包可被整体替换;Windows 包未签名)。**升级路径**:注册域名 → nginx/Caddy 挂 Let's Encrypt 反代 8081 → 仅把仓库变量 `DANMAKU_UPDATE_URL` 改为 https 域名,客户端与 CI 零代码改动
- GitHub Releases 始终双发布,是权威源与回退源

---

## 故障排查

### 问题1: 端口被占用

**症状**: `Error: listen EADDRINUSE: address already in use :::8080`

**解决**:
```bash
# 查找占用端口的进程
sudo lsof -i :8080
# 或
sudo netstat -tlnp | grep 8080

# 杀死进程
sudo kill -9 <PID>

# 或者更改端口
export PORT=8081
pm2 restart danmaku-server
```

### 问题2: 无法远程连接

**症状**: 本地可以连接,但远程连接失败

**检查**:
1. 防火墙是否开放8080端口
2. 云服务器安全组是否允许8080端口
3. 服务器IP是否正确

**解决**:
```bash
# 检查防火墙规则
sudo ufw status

# 添加规则(如果缺失)
sudo ufw allow 8080/tcp

# 检查云服务器控制台的安全组设置
```

### 问题3: 服务自动重启

**症状**: 服务频繁重启

**检查**:
```bash
# 查看重启次数
pm2 status

# 查看详细日志
pm2 logs danmaku-server --lines 500
```

**可能原因**:
- 内存不足
- 代码错误
- 资源限制

**解决**:
```bash
# 增加内存限制
# 编辑 ecosystem.config.js,修改 max_memory_restart

# 查看系统资源
free -h
top
```

### 问题4: TypeScript编译失败

**症状**: `npm run build` 报错

**解决**:
```bash
# 清理缓存
npm cache clean --force
rm -rf node_modules dist

# 重新安装
npm install

# 重新编译
npm run build
```

---

## 性能优化

### 1. 启用Gzip压缩

安装compression库:
```bash
npm install compression
```

修改 `server.ts`:
```typescript
import compression from 'compression';
// ... 添加gzip支持
```

### 2. 调整最大内存

编辑 `ecosystem.config.js`:
```javascript
max_memory_restart: '1G'  // 增加到1GB
```

### 3. 多实例部署

编辑 `ecosystem.config.js`:
```javascript
instances: 4,  // 运行4个实例
exec_mode: 'cluster'
```

---

## 安全建议

### 1. 配置HTTPS/WSS

获取SSL证书(Let's Encrypt免费):
```bash
sudo apt-get install certbot
sudo certbot certonly --standalone -d yourdomain.com
```

配置Nginx反向代理:
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 2. 添加认证机制

在代码中添加Token验证,防止未授权访问。

### 3. 速率限制

使用express-rate-limit等库限制请求频率。

---

## 监控与告警

### 使用PM2监控

```bash
# 安装PM2 Plus(云端监控)
pm2 plus

# 或使用内置监控
pm2 monit
```

### 设置邮件告警

使用pm2-logrotate和自定义脚本实现异常告警。

---

## 备份与恢复

### 备份数据

```bash
# 备份房间数据和配置
tar -czf danmaku-backup-$(date +%Y%m%d).tar.gz /opt/danmaku-server/

# 下载到本地
scp <用户>@<你的服务器IP>:/opt/danmaku-backup-*.tar.gz .
```

### 恢复数据

```bash
# 上传备份
scp danmaku-backup-*.tar.gz <用户>@<你的服务器IP>:/tmp/

# 解压恢复
ssh <用户>@<你的服务器IP>
tar -xzf /tmp/danmaku-backup-*.tar.gz -C /opt/
pm2 restart danmaku-server
```

---

## 下一步

1. ✅ 服务器已部署
2. ⬜ 修改客户端代码使用ServerConnection
3. ⬜ 测试远程连接
4. ⬜ 配置HTTPS
5. ⬜ 添加认证机制

查看 [CLIENT_INTEGRATION.md](./CLIENT_INTEGRATION.md) 了解如何集成到客户端。
