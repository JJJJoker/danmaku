# 服务器代码压缩脚本
$ErrorActionPreference = "Continue"

Write-Host "正在准备服务器代码..." -ForegroundColor Cyan

# 清理临时文件
if (Test-Path temp-upload) {
    Remove-Item -Recurse -Force temp-upload
}

# 创建临时目录
New-Item -ItemType Directory -Path temp-upload | Out-Null
New-Item -ItemType Directory -Path temp-upload\src | Out-Null
New-Item -ItemType Directory -Path temp-upload\dist | Out-Null

# 复制文件
Copy-Item package.json, tsconfig.json, README.md, deploy.sh temp-upload\
Copy-Item src\*.ts temp-upload\src\
Copy-Item dist\*.js temp-upload\dist\

Write-Host "正在压缩文件..." -ForegroundColor Cyan

# 压缩
Compress-Archive -Path "temp-upload\*" -DestinationPath "danmaku-server.zip" -Force

# 清理临时目录
Remove-Item -Recurse -Force temp-upload

Write-Host "✓ 服务器代码已压缩到 danmaku-server.zip" -ForegroundColor Green
Write-Host ""
Write-Host "下一步: 上传到服务器" -ForegroundColor Yellow
Write-Host "scp danmaku-server.zip root@YOUR_SERVER_IP:/opt/danmaku-server/" -ForegroundColor Gray
