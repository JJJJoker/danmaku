# Coturn TURN服务器一键部署脚本

## 使用说明

本脚本用于在Ubuntu服务器上自动安装和配置Coturn TURN服务器。

### 前置条件

1. Ubuntu 20.04/22.04 LTS系统
2. root权限或sudo权限
3. 已获取服务器公网IP地址

### 部署步骤

#### 方法1: 直接运行脚本(推荐)

```bash
# 下载脚本
curl -o deploy-turn.sh https://raw.githubusercontent.com/your-repo/deploy-turn.sh

# 赋予执行权限
chmod +x deploy-turn.sh

# 运行脚本(替换为你的服务器IP、用户名、密码)
./deploy-turn.sh YOUR_SERVER_IP username password
```

#### 方法2: 手动执行命令

按照下面的"详细部署步骤"逐一执行命令。

---

## 详细部署步骤

### 步骤1: 更新系统和安装依赖

```bash
#!/bin/bash

echo "=== Step 1: Updating system ==="
apt update && apt upgrade -y

echo "=== Step 2: Installing Coturn ==="
apt install coturn -y

echo "=== Verifying installation ==="
turnserver --version
```

### 步骤2: 配置Coturn

创建配置文件 `/etc/turnserver.conf`:

```conf
# ================================
# Coturn TURN Server Configuration
# ================================

# 监听端口
listening-port=3478
tls-listening-port=5349

# 外部IP地址 (必须替换为实际公网IP!)
external-ip=YOUR_SERVER_PUBLIC_IP

# 认证配置
user=username:password
realm=myturnserver.com

# 允许的协议
fingerprint
lt-cred-mech

# 日志配置
verbose
syslog

# 安全设置
no-tlsv1
no-tlsv1_1

# 性能优化
min-port=49152
max-port=65535

# 禁用某些功能
no-multicast-peers
no-cli
```

**重要**: 将 `YOUR_SERVER_PUBLIC_IP`、`username`、`password` 替换为实际值!

### 步骤3: 配置防火墙

```bash
#!/bin/bash

echo "=== Configuring firewall ==="

# 允许UDP 3478端口
ufw allow 3478/udp

# 允许TCP 3478端口
ufw allow 3478/tcp

# 允许ICE候选端口范围
ufw allow 49152:65535/udp

# 启用UFW
ufw enable

echo "=== Firewall rules applied ==="
ufw status
```

### 步骤4: 启动Coturn服务

```bash
#!/bin/bash

echo "=== Starting Coturn service ==="

# 启动服务
systemctl start coturn

# 设置开机自启
systemctl enable coturn

# 检查状态
systemctl status coturn

echo "=== Service started successfully ==="
```

### 步骤5: 测试连接

```bash
#!/bin/bash

SERVER_IP=$1

echo "=== Testing local connection ==="
nc -vz localhost 3478

echo "=== Testing remote connection ==="
echo "请在你的Windows电脑上运行以下命令测试:"
echo "Test-NetConnection -ComputerName $SERVER_IP -Port 3478 -InformationLevel Detailed"
```

---

## 完整的一键部署脚本

将以下内容保存为 `deploy-turn.sh`:

```bash
#!/bin/bash

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 参数检查
if [ $# -ne 3 ]; then
    echo -e "${RED}Usage: $0 <SERVER_IP> <USERNAME> <PASSWORD>${NC}"
    echo "Example: $0 123.45.67.89 turnuser turnpass123"
    exit 1
fi

SERVER_IP=$1
USERNAME=$2
PASSWORD=$3

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Coturn TURN Server Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Server IP: ${YELLOW}$SERVER_IP${NC}"
echo -e "Username: ${YELLOW}$USERNAME${NC}"
echo -e "Password: ${YELLOW}****${NC}"
echo ""
read -p "Continue? (y/n): " confirm
if [ "$confirm" != "y" ]; then
    echo "Deployment cancelled."
    exit 0
fi

# 步骤1: 更新系统
echo -e "\n${GREEN}[Step 1/5] Updating system...${NC}"
apt update && apt upgrade -y

# 步骤2: 安装Coturn
echo -e "\n${GREEN}[Step 2/5] Installing Coturn...${NC}"
apt install coturn -y
turnserver --version

# 步骤3: 配置Coturn
echo -e "\n${GREEN}[Step 3/5] Configuring Coturn...${NC}"
cat > /etc/turnserver.conf << EOF
# Coturn TURN Server Configuration
listening-port=3478
tls-listening-port=5349
external-ip=${SERVER_IP}
user=${USERNAME}:${PASSWORD}
realm=myturnserver.com
fingerprint
lt-cred-mech
verbose
syslog
no-tlsv1
no-tlsv1_1
min-port=49152
max-port=65535
no-multicast-peers
no-cli
EOF

echo -e "${GREEN}Configuration saved to /etc/turnserver.conf${NC}"

# 步骤4: 配置防火墙
echo -e "\n${GREEN}[Step 4/5] Configuring firewall...${NC}"
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 49152:65535/udp
ufw --force enable
ufw status

# 步骤5: 启动服务
echo -e "\n${GREEN}[Step 5/5] Starting Coturn service...${NC}"
systemctl start coturn
systemctl enable coturn
sleep 2
systemctl status coturn

# 测试
echo -e "\n${GREEN}Testing local connection...${NC}"
if nc -vz localhost 3478 2>&1 | grep -q "succeeded"; then
    echo -e "${GREEN}✓ Local connection test passed!${NC}"
else
    echo -e "${RED}✗ Local connection test failed!${NC}"
    exit 1
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Server IP: ${YELLOW}$SERVER_IP${NC}"
echo -e "Port: ${YELLOW}3478${NC}"
echo -e "Username: ${YELLOW}$USERNAME${NC}"
echo -e "Password: ${YELLOW}$PASSWORD${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Test remote connection from your computer:"
echo "   Test-NetConnection -ComputerName $SERVER_IP -Port 3478 -InformationLevel Detailed"
echo ""
echo "2. Update your application's ICE servers configuration:"
echo "   { urls: 'turn:$SERVER_IP:3478', username: '$USERNAME', credential: '$PASSWORD' }"
echo ""
echo "3. View logs:"
echo "   tail -f /var/log/turnserver.log"
echo ""
```

---

## 快速部署命令

如果你已经有服务器,可以直接复制以下命令一次性执行:

```bash
# 替换这三个变量
SERVER_IP="YOUR_SERVER_IP"
USERNAME="turnuser"
PASSWORD="turnpass123"

# 一键部署
apt update && apt upgrade -y && \
apt install coturn -y && \
cat > /etc/turnserver.conf << EOF
listening-port=3478
tls-listening-port=5349
external-ip=${SERVER_IP}
user=${USERNAME}:${PASSWORD}
realm=myturnserver.com
fingerprint
lt-cred-mech
verbose
syslog
no-tlsv1
no-tlsv1_1
min-port=49152
max-port=65535
no-multicast-peers
no-cli
EOF
ufw allow 3478/udp && \
ufw allow 3478/tcp && \
ufw allow 49152:65535/udp && \
ufw --force enable && \
systemctl start coturn && \
systemctl enable coturn && \
echo "Deployment complete! Server: $SERVER_IP:3478, User: $USERNAME, Pass: $PASSWORD"
```

---

## 验证部署

部署完成后,在你的Windows电脑上运行:

```powershell
# 测试TCP连接
Test-NetConnection -ComputerName YOUR_SERVER_IP -Port 3478 -InformationLevel Detailed

# 应该看到 TcpTestSucceeded: True
```

如果显示连接成功,说明TURN服务器部署成功!
