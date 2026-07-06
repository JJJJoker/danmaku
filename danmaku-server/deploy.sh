#!/bin/bash

# ================================
# 云弹一下弹幕服务器一键部署脚本
# ================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置变量
# 你的服务器 IP（可用环境变量 SERVER_IP 覆盖）
SERVER_IP="${SERVER_IP:-YOUR_SERVER_IP}"
DEPLOY_DIR="/opt/danmaku-server"
PORT=8080

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  云弹一下 WebSocket弹幕服务器部署脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检查是否以root权限运行
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}请使用sudo或root权限运行此脚本${NC}"
    exit 1
fi

# 步骤1: 检查Node.js安装
echo -e "\n${GREEN}[Step 1/6] 检查Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js未安装,正在安装...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo -e "${GREEN}✓ Node.js已安装: $(node --version)${NC}"
fi

# 步骤2: 创建项目目录
echo -e "\n${GREEN}[Step 2/6] 创建项目目录...${NC}"
mkdir -p $DEPLOY_DIR
# 更新资产目录: CI 发版时 rsync 推送客户端安装包与 latest.yml 到这里(见仓库 release.yml)
mkdir -p $DEPLOY_DIR/updates
echo -e "${GREEN}✓ 项目目录: $DEPLOY_DIR${NC}"

# 步骤3: 复制项目文件
echo -e "\n${GREEN}[Step 3/6] 复制项目文件...${NC}"
# 注意: 这一步需要在本地执行,将文件上传到服务器
# 这里假设文件已经上传到 $DEPLOY_DIR
if [ ! -f "$DEPLOY_DIR/package.json" ]; then
    echo -e "${RED}错误: package.json不存在,请先上传项目文件${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 项目文件已就绪${NC}"

# 步骤4: 安装依赖
echo -e "\n${GREEN}[Step 4/6] 安装依赖...${NC}"
cd $DEPLOY_DIR
npm install --omit=dev
# 安装TypeScript类型定义(用于可能的重新编译)
npm install --save-dev @types/ws @types/node typescript
# rsync: CI 上传更新资产依赖(断点续传)
if ! command -v rsync &> /dev/null; then
    apt-get install -y rsync
fi
echo -e "${GREEN}✓ 依赖安装完成${NC}"

# 步骤5: 检查是否需要编译TypeScript
echo -e "\n${GREEN}[Step 5/6] 检查编译状态...${NC}"
if [ -f "dist/server.js" ]; then
    echo -e "${GREEN}✓ 编译文件已存在,跳过编译${NC}"
else
    echo -e "${YELLOW}未找到编译文件,正在安装开发依赖并编译...${NC}"
    npm install --save-dev @types/ws @types/node
    npm run build
    echo -e "${GREEN}✓ 编译成功${NC}"
fi

# 步骤6: 配置防火墙
echo -e "\n${GREEN}[Step 6/6] 配置防火墙...${NC}"
if command -v ufw &> /dev/null; then
    ufw allow $PORT/tcp
    # HTTP 端口(弹幕端口+1): /stats 统计接口 + /updates 客户端更新分发
    ufw allow $((PORT + 1))/tcp
    echo -e "${GREEN}✓ 防火墙规则已添加: $PORT, $((PORT + 1))${NC}"
else
    echo -e "${YELLOW}警告: ufw未安装,请手动配置防火墙${NC}"
fi

# 安装PM2(如果未安装)
echo -e "\n${GREEN}安装PM2进程管理器...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    echo -e "${GREEN}✓ PM2已安装${NC}"
else
    echo -e "${GREEN}✓ PM2已存在: $(pm2 --version)${NC}"
fi

# 创建PM2配置文件
cat > $DEPLOY_DIR/ecosystem.config.js << EOF
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
      PORT: $PORT,
      UPDATES_DIR: '$DEPLOY_DIR/updates'
    }
  }]
};
EOF

echo -e "${GREEN}✓ PM2配置文件已创建${NC}"

# 启动服务
echo -e "\n${GREEN}启动服务...${NC}"
cd $DEPLOY_DIR
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  部署完成!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "服务器地址: ${YELLOW}ws://$SERVER_IP:$PORT${NC}"
echo -e "服务状态: ${YELLOW}$(pm2 status danmaku-server)${NC}"
echo ""
echo -e "${YELLOW}常用命令:${NC}"
echo "  查看状态: pm2 status"
echo "  查看日志: pm2 logs danmaku-server"
echo "  重启服务: pm2 restart danmaku-server"
echo "  停止服务: pm2 stop danmaku-server"
echo ""
echo -e "${YELLOW}测试连接:${NC}"
echo "  curl http://localhost:$PORT"
echo ""
