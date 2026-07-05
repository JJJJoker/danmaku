# TURN服务器连接测试脚本
# 使用方法: .\test-turn.ps1 -ServerIP "123.45.67.89" -Port 3478

param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP,
    
    [int]$Port = 3478
)

Write-Host "========================================" -ForegroundColor Green
Write-Host "  TURN Server Connection Test" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Server IP: $ServerIP" -ForegroundColor Yellow
Write-Host "Port: $Port" -ForegroundColor Yellow
Write-Host ""

# 测试TCP连接
Write-Host "[Test 1] Testing TCP connection..." -ForegroundColor Cyan
$tcpResult = Test-NetConnection -ComputerName $ServerIP -Port $Port -InformationLevel Detailed -WarningAction SilentlyContinue

if ($tcpResult.TcpTestSucceeded) {
    Write-Host "✓ TCP connection successful!" -ForegroundColor Green
    Write-Host "  Latency: $($tcpResult.PingReplyDetails.RoundtripTime) ms" -ForegroundColor Gray
} else {
    Write-Host "✗ TCP connection failed!" -ForegroundColor Red
    Write-Host "  Error: $($tcpResult.PingReplyDetails.Status)" -ForegroundColor Red
}

Write-Host ""

# 测试UDP连接 (使用netcat如果可用)
Write-Host "[Test 2] Testing UDP connection..." -ForegroundColor Cyan
try {
    $udpSocket = New-Object System.Net.Sockets.UdpClient
    $udpSocket.Connect($ServerIP, $Port)
    Write-Host "✓ UDP socket created successfully!" -ForegroundColor Green
    $udpSocket.Close()
} catch {
    Write-Host "✗ UDP connection failed!" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
}

Write-Host ""

# DNS解析测试
Write-Host "[Test 3] Testing DNS resolution..." -ForegroundColor Cyan
try {
    $dnsResult = Resolve-DnsName -Name $ServerIP -ErrorAction Stop
    Write-Host "✓ DNS resolution successful!" -ForegroundColor Green
    Write-Host "  IP Address: $($dnsResult.IPAddress)" -ForegroundColor Gray
} catch {
    Write-Host " DNS resolution skipped (using IP address directly)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Test Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

if ($tcpResult.TcpTestSucceeded) {
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Update your application's ICE servers configuration with:" -ForegroundColor White
    Write-Host "   { urls: 'turn:$($ServerIP):$($Port)', username: 'YOUR_USER', credential: 'YOUR_PASS' }" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "2. Rebuild and test your application" -ForegroundColor White
} else {
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Check if the server is running: ssh root@$ServerIP" -ForegroundColor White
    Write-Host "2. Verify firewall rules allow port $Port" -ForegroundColor White
    Write-Host "3. Check Coturn logs: tail -f /var/log/turnserver.log" -ForegroundColor White
}
