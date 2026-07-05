#!/bin/bash

# Docker方式部署Coturn TURN服务器
# 使用方法: ./deploy-turn-docker.sh YOUR_SERVER_IP username password

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ $# -ne 3 ]; then
    echo -e "${RED}Usage: $0 <SERVER_IP> <USERNAME> <PASSWORD>${NC}"
    echo "Example: $0 123.45.67.89 turnuser turnpass123"
    exit 1
fi

SERVER_IP=$1
USERNAME=$2
PASSWORD=$3

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Docker Coturn Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed!${NC}"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed!${NC}"
    echo "Please install Docker Compose first"
    exit 1
fi

# 创建.env文件
echo -e "\n${GREEN}[Step 1/4] Creating .env file...${NC}"
cat > .env << EOF
SERVER_IP=${SERVER_IP}
TURN_USER=${USERNAME}
TURN_PASS=${PASSWORD}
EOF
echo -e "${GREEN}✓ .env file created${NC}"

# 创建turnserver.conf配置文件
echo -e "\n${GREEN}[Step 2/4] Creating turnserver.conf...${NC}"
cat > turnserver.conf << EOF
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
echo -e "${GREEN}✓ turnserver.conf created${NC}"

# 配置防火墙
echo -e "\n${GREEN}[Step 3/4] Configuring firewall...${NC}"
ufw allow 3478/udp || true
ufw allow 3478/tcp || true
ufw allow 49152:65535/udp || true
echo -e "${GREEN}✓ Firewall rules applied${NC}"

# 启动Docker容器
echo -e "\n${GREEN}[Step 4/4] Starting Docker container...${NC}"
docker-compose -f docker-compose-turn.yml up -d

sleep 3

# 检查容器状态
if docker ps | grep -q "turn-server"; then
    echo -e "${GREEN}✓ Container started successfully!${NC}"
else
    echo -e "${RED}✗ Failed to start container!${NC}"
    docker logs turn-server
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
echo "1. Test connection:"
echo "   Test-NetConnection -ComputerName $SERVER_IP -Port 3478"
echo ""
echo "2. View logs:"
echo "   docker logs -f turn-server"
echo ""
echo "3. Stop server:"
echo "   docker-compose -f docker-compose-turn.yml down"
echo ""
echo "4. Restart server:"
echo "   docker-compose -f docker-compose-turn.yml restart"
echo ""
