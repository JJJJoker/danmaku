# PeerJS 连通性测试服务器启动脚本
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PeerJS 连通性测试服务器" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "正在检查可用的HTTP服务器..." -ForegroundColor Yellow

$port = 8080
$testPagePath = Join-Path $PSScriptRoot "peerjs-test.html"

# 检查测试页面是否存在
if (-not (Test-Path $testPagePath)) {
    Write-Host "错误: 找不到 peerjs-test.html 文件" -ForegroundColor Red
    Write-Host "请确保此脚本与 peerjs-test.html 在同一目录" -ForegroundColor Yellow
    pause
    exit 1
}

# 尝试使用 Python
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "✓ 找到 Python,正在启动 HTTP 服务器..." -ForegroundColor Green
    Write-Host ""
    Write-Host "请在浏览器中访问: http://localhost:$port/peerjs-test.html" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "按 Ctrl+C 停止服务器" -ForegroundColor Yellow
    Write-Host ""
    
    Set-Location $PSScriptRoot
    python -m http.server $port
    
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
    # 使用 Node.js
    Write-Host "✓ 找到 Node.js,正在启动 HTTP 服务器..." -ForegroundColor Green
    Write-Host ""
    Write-Host "请在浏览器中访问: http://localhost:$port/peerjs-test.html" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "按 Ctrl+C 停止服务器" -ForegroundColor Yellow
    Write-Host ""
    
    Set-Location $PSScriptRoot
    npx http-server -p $port -o /peerjs-test.html
    
} else {
    Write-Host "✗ 未找到 Python 或 Node.js" -ForegroundColor Red
    Write-Host ""
    Write-Host "请安装以下任一工具:" -ForegroundColor Yellow
    Write-Host "  1. Python: https://www.python.org/downloads/" -ForegroundColor White
    Write-Host "  2. Node.js: https://nodejs.org/" -ForegroundColor White
    Write-Host ""
    Write-Host "或者使用在线工具如 ngrok 来提供本地文件" -ForegroundColor Yellow
    pause
    exit 1
}
