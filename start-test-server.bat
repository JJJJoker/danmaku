@echo off
echo ========================================
echo   PeerJS 连通性测试服务器
echo ========================================
echo.
echo 正在启动本地服务器...
echo.
echo 请在浏览器中访问: http://localhost:8080/peerjs-test.html
echo.
echo 按 Ctrl+C 停止服务器
echo.

cd /d "%~dp0"
python -m http.server 8080 || powershell -Command "Start-Process python -ArgumentList '-m','http.server','8080'"

pause
