# ================================
# 弹幕服务器自动化部署脚本 (Windows)
# ================================

$SERVER_IP = "REDACTED_SERVER_IP"
$SERVER_USER = "root"
$DEPLOY_DIR = "/opt/danmaku-server"
$LOCAL_DIR = "."

Write-Host "========================================" -ForegroundColor Green
Write-Host "  云弹一下 WebSocket弹幕服务器部署脚本" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# 检查是否已编译
Write-Host "[准备] 检查编译状态..." -ForegroundColor Yellow
if (-not (Test-Path "$LOCAL_DIR\dist\server.js")) {
    Write-Host "错误: dist/server.js 不存在,请先运行 npm run build" -ForegroundColor Red
    exit 1
}
Write-Host "✓ 代码已编译" -ForegroundColor Green

# 压缩项目文件
Write-Host "`n[步骤1/3] 压缩项目文件..." -ForegroundColor Green
$zipFile = "danmaku-server.zip"

# 创建临时目录
$tempDir = "temp-upload"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# 复制必要文件
Write-Host "  复制配置文件..." -ForegroundColor Cyan
Copy-Item "$LOCAL_DIR\package.json" "$tempDir\"
Copy-Item "$LOCAL_DIR\tsconfig.json" "$tempDir\"
Copy-Item "$LOCAL_DIR\README.md" "$tempDir\"
Copy-Item "$LOCAL_DIR\deploy.sh" "$tempDir\"

Write-Host "  复制源代码..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$tempDir\src" | Out-Null
Copy-Item "$LOCAL_DIR\src\*.ts" "$tempDir\src\"

Write-Host "  复制编译文件..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$tempDir\dist" | Out-Null
Copy-Item "$LOCAL_DIR\dist\*.js" "$tempDir\dist\"

# 压缩
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipFile -Force
Remove-Item -Recurse -Force $tempDir

Write-Host "✓ 压缩完成: $zipFile ($(Get-Item $zipFile).Length / 1KB KB)" -ForegroundColor Green

# 上传到服务器
Write-Host "`n[步骤2/3] 上传到服务器..." -ForegroundColor Green
Write-Host "目标: ${SERVER_USER}@${SERVER_IP}:${DEPLOY_DIR}" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示: 即将要求输入SSH密码" -ForegroundColor Yellow
Write-Host ""

# 首先确保远程目录存在
try {
    Write-Host "  创建远程目录..." -ForegroundColor Cyan
    ssh ${SERVER_USER}@${SERVER_IP} "mkdir -p $DEPLOY_DIR" 2>&1 | Out-Null
    Write-Host "  ✓ 远程目录就绪" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ 无法通过SSH创建目录,请手动执行: ssh ${SERVER_USER}@${SERVER_IP} 'mkdir -p $DEPLOY_DIR'" -ForegroundColor Yellow
}

# 上传文件
Write-Host "  上传压缩包..." -ForegroundColor Cyan
scp $zipFile "${SERVER_USER}@${SERVER_IP}:${DEPLOY_DIR}/"

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ 上传成功" -ForegroundColor Green
} else {
    Write-Host "  ✗ 上传失败" -ForegroundColor Red
    Write-Host ""
    Write-Host "故障排查:" -ForegroundColor Yellow
    Write-Host "1. 检查网络连接: ping $SERVER_IP" -ForegroundColor White
    Write-Host "2. 测试SSH连接: ssh ${SERVER_USER}@${SERVER_IP}" -ForegroundColor White
    Write-Host "3. 确认远程目录存在: ssh ${SERVER_USER}@${SERVER_IP} 'ls -la $DEPLOY_DIR'" -ForegroundColor White
    Write-Host ""
    Remove-Item $zipFile -ErrorAction SilentlyContinue
    exit 1
}

# 清理本地文件
Remove-Item $zipFile

# 提供部署指令
Write-Host "`n[步骤3/3] 在服务器上部署..." -ForegroundColor Green
Write-Host ""
Write-Host "请在服务器上执行以下命令:" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "ssh ${SERVER_USER}@${SERVER_IP}" -ForegroundColor White
Write-Host "cd $DEPLOY_DIR" -ForegroundColor White
Write-Host "unzip -o danmaku-server.zip" -ForegroundColor White
Write-Host "rm danmaku-server.zip" -ForegroundColor White
Write-Host "chmod +x deploy.sh" -ForegroundColor White
Write-Host "./deploy.sh" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "部署脚本会自动完成:" -ForegroundColor Yellow
Write-Host "  ✓ 检查并安装Node.js" -ForegroundColor White
Write-Host "  ✓ 安装npm依赖" -ForegroundColor White
Write-Host "  ✓ 配置防火墙(8080, 8081端口)" -ForegroundColor White
Write-Host "  ✓ 安装PM2进程管理器" -ForegroundColor White
Write-Host "  ✓ 启动服务并设置开机自启" -ForegroundColor White
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "  上传完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host "1. SSH登录服务器并执行上述部署命令" -ForegroundColor White
Write-Host "2. 验证服务状态: pm2 status" -ForegroundColor White
Write-Host "3. 查看日志: pm2 logs danmaku-server" -ForegroundColor White
Write-Host "4. 测试管理API: curl http://localhost:8081/stats" -ForegroundColor White
Write-Host ""
Write-Host "客户端测试:" -ForegroundColor Yellow
Write-Host "  cd d:\tools\qoder\qoder_project\yundan" -ForegroundColor White
Write-Host "  npm start" -ForegroundColor White
Write-Host ""
