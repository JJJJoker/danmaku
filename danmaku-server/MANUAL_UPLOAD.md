# Manual Upload Instructions

If the automated upload script fails, you can manually upload the server files using these steps.

## Prerequisites

- SSH access to your server (<你的服务器IP>)
- SCP or SFTP client installed

---

## Method 1: Using SCP (Command Line)

### Step 1: Create Remote Directory

```bash
ssh <用户>@<你的服务器IP> "mkdir -p /opt/danmaku-server"
```

### Step 2: Compress Files

In PowerShell:
```powershell
cd d:\tools\qoder\qoder_project\yundan\danmaku-server

# Create temp directory
New-Item -ItemType Directory -Force -Path temp-upload | Out-Null

# Copy required files
Copy-Item "package.json" "temp-upload\"
Copy-Item "tsconfig.json" "temp-upload\"
Copy-Item "README.md" "temp-upload\"
Copy-Item "deploy.sh" "temp-upload\"
New-Item -ItemType Directory -Force -Path "temp-upload\src" | Out-Null
Copy-Item "src\*.ts" "temp-upload\src\"

# Compress
Compress-Archive -Path "temp-upload\*" -DestinationPath danmaku-server.zip -Force
Remove-Item -Recurse -Force temp-upload
```

### Step 3: Upload

```bash
scp danmaku-server.zip <用户>@<你的服务器IP>:/opt/danmaku-server/
```

### Step 4: Deploy on Server

```bash
ssh <用户>@<你的服务器IP>

cd /opt/danmaku-server
unzip danmaku-server.zip
chmod +x deploy.sh
./deploy.sh
```

---

## Method 2: Using SFTP (Interactive)

### Step 1: Start SFTP Session

```bash
sftp <用户>@<你的服务器IP>
```

### Step 2: Navigate and Create Directory

```
sftp> cd /opt
sftp> mkdir danmaku-server
sftp> cd danmaku-server
```

### Step 3: Upload Files

```
sftp> put package.json
sftp> put tsconfig.json
sftp> put README.md
sftp> put deploy.sh
sftp> mkdir src
sftp> cd src
sftp> put src/*.ts
```

### Step 4: Exit and Deploy

```
sftp> exit
```

Then SSH to deploy:
```bash
ssh <用户>@<你的服务器IP>
cd /opt/danmaku-server
npm install --production
npm run build
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## Method 3: Using FileZilla (GUI)

### Step 1: Connect to Server

1. Open FileZilla
2. Enter connection details:
   - Host: `<你的服务器IP>`
   - Username: `root`
   - Password: (your server password)
   - Port: `22`
3. Click "Quickconnect"

### Step 2: Create Remote Directory

1. In the remote site panel, navigate to `/opt`
2. Right-click and create new directory: `danmaku-server`
3. Enter the directory

### Step 3: Upload Files

Upload these files from local `danmaku-server/` directory:
- `package.json`
- `tsconfig.json`
- `README.md`
- `deploy.sh`
- All files in `src/` directory

### Step 4: Deploy via SSH

```bash
ssh <用户>@<你的服务器IP>
cd /opt/danmaku-server
chmod +x deploy.sh
./deploy.sh
```

---

## Method 4: Using Git (Recommended for Updates)

### Initial Setup on Server

```bash
ssh <用户>@<你的服务器IP>

# Install git if not present
apt-get install -y git

# Create project directory
mkdir -p /opt/danmaku-server
cd /opt/danmaku-server

# Initialize git repo
git init
```

### From Your Local Machine

```bash
cd d:\tools\qoder\qoder_project\yundan\danmaku-server

# Initialize git if not already done
git init
git add .
git commit -m "Initial commit"

# Add remote (replace with your Git hosting service)
git remote add origin https://github.com/yourusername/danmaku-server.git

# Push to remote
git push -u origin master
```

### On Server

```bash
cd /opt/danmaku-server

# Pull latest code
git pull origin master

# Install and build
npm install --production
npm run build

# Restart service
pm2 restart danmaku-server
```

---

## Verification

After deployment, verify the server is running:

```bash
# Check PM2 status
pm2 status danmaku-server

# View logs
pm2 logs danmaku-server

# Test connection
curl http://localhost:8080

# Or use wget
wget http://localhost:8080
```

Expected output:
```
[Server] Danmaku server listening on port 8080
```

---

## Troubleshooting

### Problem 1: Permission Denied

**Error**: `Permission denied (publickey,password).`

**Solution**:
- Verify your SSH password is correct
- Check if SSH keys are configured properly
- Try: `ssh -v <用户>@<你的服务器IP>` for verbose output

### Problem 2: Directory Not Found

**Error**: `No such file or directory`

**Solution**:
```bash
# Manually create directory
ssh <用户>@<你的服务器IP> "mkdir -p /opt/danmaku-server"

# Set permissions
chown root:root /opt/danmaku-server
chmod 755 /opt/danmaku-server
```

### Problem 3: Upload Too Slow

**Solution**:
- Exclude `node_modules` and `dist` directories
- Use compression: `scp -C file.zip user@host:/path/`
- Consider using rsync for incremental updates:
  ```bash
  rsync -avz --exclude 'node_modules' --exclude 'dist' \
    ./danmaku-server/ <用户>@<你的服务器IP>:/opt/danmaku-server/
  ```

### Problem 4: npm Install Fails

**Solution**:
```bash
# Clear npm cache
npm cache clean --force

# Remove node_modules and reinstall
rm -rf node_modules
npm install --production
```

---

## Quick Deployment Checklist

- [ ] Server accessible via SSH
- [ ] Node.js installed on server
- [ ] Project files uploaded to `/opt/danmaku-server`
- [ ] Dependencies installed (`npm install`)
- [ ] TypeScript compiled (`npm run build`)
- [ ] PM2 installed and configured
- [ ] Service running (`pm2 status`)
- [ ] Firewall port 8080 open
- [ ] Can connect locally (`curl http://localhost:8080`)

---

## Next Steps

After successful deployment:

1. **Test Remote Connection**:
   - Modify client `SERVER_URL` to `ws://<你的服务器IP>:8080`
   - Run client application
   - Verify WebSocket connection

2. **Monitor Server**:
   ```bash
   # Real-time logs
   pm2 logs danmaku-server
   
   # Resource usage
   pm2 monit
   ```

3. **Configure Auto-start**:
   ```bash
   pm2 startup
   pm2 save
   ```

4. **Set Up HTTPS** (Optional but Recommended):
   - Get SSL certificate (Let's Encrypt)
   - Configure Nginx reverse proxy
   - Change client URL to `wss://yourdomain.com`

---

For more detailed deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).
