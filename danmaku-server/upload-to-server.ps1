# ================================
# Cloud Danmaku Server Upload Script (Windows)
# ================================

$SERVER_IP = "116.62.47.225"
$SERVER_USER = "root"
$DEPLOY_DIR = "/opt/danmaku-server"
$LOCAL_DIR = "."

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Cloud Danmaku WebSocket Server Upload Script" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Check if scp is installed
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    Write-Host "Error: scp command not found. Please install OpenSSH client." -ForegroundColor Red
    exit 1
}

Write-Host "Preparing to upload project files..." -ForegroundColor Yellow
Write-Host "Server: $SERVER_USER@$SERVER_IP`:$DEPLOY_DIR" -ForegroundColor Cyan
Write-Host ""

# Compress project files (exclude node_modules and dist)
Write-Host "[1/3] Compressing project files..." -ForegroundColor Green
$zipFile = "danmaku-server.zip"

# Create temporary directory
$tempDir = "temp-upload"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Copy required files
Copy-Item "$LOCAL_DIR\package.json" "$tempDir\"
Copy-Item "$LOCAL_DIR\tsconfig.json" "$tempDir\"
Copy-Item "$LOCAL_DIR\README.md" "$tempDir\"
Copy-Item "$LOCAL_DIR\deploy.sh" "$tempDir\"
New-Item -ItemType Directory -Force -Path "$tempDir\src" | Out-Null
Copy-Item "$LOCAL_DIR\src\*.ts" "$tempDir\src\"

# Compress
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipFile -Force
Remove-Item -Recurse -Force $tempDir

Write-Host "✓ Compression complete: $zipFile" -ForegroundColor Green

# Upload to server
Write-Host "`n[2/3] Uploading to server..." -ForegroundColor Green

# First, ensure the remote directory exists
Write-Host "Ensuring remote directory exists..." -ForegroundColor Cyan
try {
    ssh ${SERVER_USER}@${SERVER_IP} "mkdir -p $DEPLOY_DIR" 2>&1 | Out-Null
    Write-Host "✓ Remote directory ready" -ForegroundColor Green
} catch {
    Write-Host "Warning: Could not create remote directory via SSH" -ForegroundColor Yellow
}

# Now upload
scp $zipFile "${SERVER_USER}@${SERVER_IP}:${DEPLOY_DIR}/"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Upload successful" -ForegroundColor Green
} else {
    Write-Host "✗ Upload failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Check if server is accessible: ssh ${SERVER_USER}@${SERVER_IP}" -ForegroundColor White
    Write-Host "2. Verify directory exists: ssh ${SERVER_USER}@${SERVER_IP} 'ls -la $DEPLOY_DIR'" -ForegroundColor White
    Write-Host "3. Create directory manually: ssh ${SERVER_USER}@${SERVER_IP} 'mkdir -p $DEPLOY_DIR'" -ForegroundColor White
    Write-Host ""
    Remove-Item $zipFile
    exit 1
}

# Deploy on server
Write-Host "`n[3/3] Deploying on server..." -ForegroundColor Green
Write-Host "Please execute the following commands on the server:" -ForegroundColor Yellow
Write-Host ""
Write-Host "ssh ${SERVER_USER}@${SERVER_IP}" -ForegroundColor Cyan
Write-Host "cd $DEPLOY_DIR" -ForegroundColor Cyan
Write-Host "unzip $zipFile" -ForegroundColor Cyan
Write-Host "chmod +x deploy.sh" -ForegroundColor Cyan
Write-Host "./deploy.sh" -ForegroundColor Cyan
Write-Host ""

# Cleanup
Remove-Item $zipFile

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Upload Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. SSH login to server" -ForegroundColor White
Write-Host "2. Run deployment script: ./deploy.sh" -ForegroundColor White
Write-Host "3. Check service status: pm2 status danmaku-server" -ForegroundColor White
Write-Host ""
