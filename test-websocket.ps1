# 测试WebSocket服务器连接
# 用法: .\test-websocket.ps1 -ServerUrl ws://<你的服务器IP>:8080
param(
    [string]$ServerUrl = "ws://YOUR_SERVER_IP:8080"
)

Write-Host "Testing WebSocket connection to $ServerUrl ..." -ForegroundColor Cyan
Write-Host ""

try {
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ct = New-Object System.Threading.CancellationToken
    $task = $ws.ConnectAsync($ServerUrl, $ct)
    $task.Wait()
    
    Write-Host "Connection state: $($ws.State)" -ForegroundColor Green
    Write-Host ""
    
    if ($ws.State -eq 'Open') {
        Write-Host "✅ SUCCESS: WebSocket connection is open!" -ForegroundColor Green
        Write-Host ""
        Write-Host "You can now:" -ForegroundColor Yellow
        Write-Host "1. Open the Electron app" -ForegroundColor White
        Write-Host "2. Enter a username" -ForegroundColor White
        Write-Host "3. Click 'Create Room' or 'Join Room'" -ForegroundColor White
        Write-Host "4. Check the console logs for connection messages" -ForegroundColor White
    } else {
        Write-Host "❌ FAILED: Connection state is not Open" -ForegroundColor Red
    }
    
    $ws.Dispose()
} catch {
    Write-Host "❌ ERROR: Failed to connect" -ForegroundColor Red
    Write-Host "Error message: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Check if server is running: pm2 status danmaku-server" -ForegroundColor White
    Write-Host "2. Check firewall settings on server" -ForegroundColor White
    Write-Host "3. Check cloud provider security group rules" -ForegroundColor White
}
