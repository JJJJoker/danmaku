# P2P连接修复 - TURN服务器配置

## 修复内容

已在 `src/renderer/services/peerService.ts` 中添加免费公共TURN服务器配置,解决NAT穿透失败导致的P2P连接超时问题。

### 修改位置

1. **主机创建** (createRoom方法,第89-125行)
2. **客户端加入** (joinRoom方法,第161-203行)

### 新增ICE服务器配置

```typescript
config: {
    iceServers: [
        // STUN 服务器 (用于发现公网IP)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        // 免费公共 TURN 服务器 (当中继失败时使用)
        { 
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
}
```

## 测试步骤

### 准备工作

1. 你朋友作为**主机**:
   - 运行新版本的 `云弹一下.exe` (位于 `dist-new/win-unpacked/`)
   - 使用手机热点网络
   - 点击"创建房间",记录完整的RoomID

2. 你作为**客户端**:
   - 运行新版本的 `云弹一下.exe`
   - 输入朋友提供的完整RoomID
   - 点击"加入房间"

### 预期结果

✅ **成功标志**:
- 不再出现 "Connection timeout after 15s" 错误
- 控制台显示 "Connected to host successfully!"
- 可以正常发送和接收弹幕
- 用户列表正确显示

❌ **如果仍然失败**:
- 检查浏览器控制台(F12)的详细错误信息
- 确认双方使用的RoomID完全一致(包括大小写)
- 尝试双方都切换到手机热点测试
- 查看日志文件: `%APPDATA%\funapp\app.log`

## 技术说明

### 为什么需要TURN服务器?

WebRTC P2P连接需要通过STUN服务器发现公网IP,但在某些网络环境下(如对称型NAT、企业防火墙),STUN无法穿透,此时需要TURN服务器作为数据中继。

### 当前使用的TURN服务

- **提供商**: Metered.ca (OpenRelay项目)
- **类型**: 免费公共TURN服务器
- **限制**: 可能有流量限制,不适合大规模生产环境
- **优势**: 无需自建,立即可用

### 未来优化建议

如果需要更高稳定性或更大规模部署,建议:

1. **自建国内TURN服务器**:
   - 阿里云ECS(杭州/上海): ~¥60/月
   - 腾讯云CVM(广州/北京): ~¥60/月
   - 使用Coturn开源软件部署

2. **添加更多备选STUN服务器**:
   - 小米: stun.miwifi.com:3478
   - 腾讯: stun.qq.com:3478

3. **实现自动切换机制**:
   - 当主TURN服务器不可用时,自动尝试备用服务器

## 注意事项

- TURN服务器是公开免费的,可能有并发连接数限制
- 本次修改不影响现有功能,只是增强P2P穿透能力
- 如果未来需要商业级稳定性,建议自建TURN服务器
