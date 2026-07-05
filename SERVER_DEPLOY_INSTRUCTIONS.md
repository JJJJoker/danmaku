# 服务器端代码部署说明

## 已完成的工作

✅ 服务器端代码已修改并编译成功
✅ 添加了房间密码管理功能
✅ 扩展了消息协议(joinSuccess, joinError, setPassword, passwordChanged)
✅ 压缩包已生成: `danmaku-server/danmaku-server.zip`

---

## 部署步骤

### 1. 上传文件到服务器

在本地Windows PowerShell中执行:

```powershell
cd d:\tools\qoder\qoder_project\yundan\danmaku-server
scp danmaku-server.zip root@REDACTED_SERVER_IP:/opt/danmaku-server/
```

**提示**: 输入服务器root用户的密码

### 2. SSH登录服务器

```bash
ssh root@REDACTED_SERVER_IP
```

### 3. 在服务器上解压和部署

```bash
cd /opt/danmaku-server

# 备份当前版本(可选但推荐)
cp -r dist dist.backup

# 解压覆盖
unzip -o danmaku-server.zip

# 删除压缩包
rm danmaku-server.zip

# 安装依赖(包含TypeScript类型定义)
npm install --omit=dev
npm install --save-dev @types/ws @types/node typescript

# 重新编译(确保使用最新代码)
npm run build

# 重启PM2服务
pm2 restart danmaku-server

# 查看日志确认启动状态
pm2 logs danmaku-server --lines 20
```

---

## 测试验证

### 1. 检查服务器状态

```bash
# 查看PM2进程状态
pm2 status danmaku-server

# 查看实时日志
pm2 logs danmaku-server --lines 50

# 访问管理API
curl http://localhost:8081/stats
```

### 2. 客户端测试基本功能

在当前运行的客户端中测试:

1. **创建房间**: 输入任意中文名称(如"我的聊天室"),点击"创建房间"
2. **加入房间**: 其他用户输入相同的房间名称,点击"加入房间"
3. **验证通信**: 两个用户应该能看到彼此的在线状态和弹幕

### 3. 预期行为

- ✅ 房间名称支持中文
- ✅ 第一个加入房间的用户自动成为房主
- ✅ 无密码的房间任何人都可以直接加入
- ⏳ 密码功能需要等待UI更新后才能使用

---

## 后续工作

目前只完成了服务器端的密码功能实现,客户端还需要:

1. **RoomPanel.tsx**: 添加密码输入框和密码管理UI
2. **connectionStore.ts**: 添加isHost状态和setPassword方法
3. **测试完整流程**: 密码设置、修改、清除等功能

---

## 如果遇到问题

### 问题1: 服务器启动失败

检查日志:
```bash
pm2 logs danmaku-server --err --lines 50
```

常见原因:
- 缺少依赖: `npm install --save-dev @types/ws @types/node`
- 编译错误: `npm run build` 查看详细错误

### 问题2: 客户端无法连接

检查:
- 服务器是否在运行: `pm2 status`
- 防火墙是否开放8080端口
- 客户端连接的服务器地址是否正确

### 问题3: 房间功能异常

重置服务器:
```bash
pm2 stop danmaku-server
pm2 delete danmaku-server
cd /opt/danmaku-server
rm -rf dist
npm run build
pm2 start dist/server.js --name danmaku-server
```

---

## 当前进度总结

| 模块 | 状态 | 说明 |
|------|------|------|
| Room类密码管理 | ✅ 完成 | room.ts已修改并编译 |
| 服务器密码验证 | ✅ 完成 | server.ts已处理join/setPassword消息 |
| 消息协议扩展 | ✅ 完成 | types.ts已更新 |
| 客户端类型定义 | ✅ 完成 | shared/types.ts已更新 |
| peerService | ✅ 完成 | joinRoom支持password参数,setPassword方法已添加 |
| connectionStore | ⏳ 待完成 | 需要添加isHost状态和方法 |
| RoomPanel UI | ⏳ 待完成 | 需要添加密码输入和管理界面 |

---

**下一步**: 上传代码到服务器并测试基本的房间创建/加入功能(暂不测试密码)
