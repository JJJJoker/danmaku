# 云弹一下 - 跨平台弹幕桌面应用

## 项目简介

一个基于 Electron + React 的跨平台实时弹幕桌面应用。用户可以创建/加入房间，通过 WebSocket 服务器中继实时发送和接收弹幕，弹幕以动画形式在桌面最顶层滚动显示。

## 📦 版本与下载

<!-- 本区块由 scripts/bump-version.js 维护，版本号行请勿手改格式 -->

- 当前版本：**v1.4.1**
- 下载安装包：[GitHub Releases](https://github.com/JJJJoker/danmaku/releases/latest)（Windows 安装版/便携版、macOS dmg）
- Windows 安装版支持应用内自动更新；各版本更新说明见 Releases 页

## 核心特性

- ✅ 全屏透明置顶窗口，弹幕覆盖在所有应用之上
- ✅ WebSocket 服务器中继联机，支持 macOS/Windows 跨平台互联（服务器地址可在设置中自定义，支持自部署）
- ✅ **多房间支持**：可同时创建/加入多个房间，独立管理连接状态
- ✅ 轨道式弹幕渲染引擎，避免重叠，支持 GPU 加速动画
- ✅ **弹幕覆盖层可调整大小/位置**（百分比定位，8方向拖拽手柄）
- ✅ 可拖拽的悬浮控制面板（⚙️ 按钮触发，支持内容折叠）
- ✅ **3 个功能 Tab：设置、房间、历史**
- ✅ 用户自定义昵称，弹幕显示发送者
- ✅ **系统托盘图标**：点击切换窗口可见性，右键菜单快速操作
- ✅ **弹幕历史记录面板**：自动记录所有房间弹幕
- ✅ **输入法模式**：输入时自动降低窗口层级避免 IME 被遮挡
- ✅ **文件日志系统**：主进程和渲染进程日志输出到文件

## 技术栈

- **桌面框架**: Electron ^34.0.0
- **UI 框架**: React ^18.3.1
- **状态管理**: Zustand ^5.0.0
- **联机通信**: WebSocket（自建中继服务器，见 danmaku-server/）
- **动画库**: Framer Motion ^11.0.0
- **构建工具**: Vite ^6.2.0
- **语言**: TypeScript ^5.6.0
- **打包工具**: Electron Forge ^7.4.0

## 快速开始

### 1. 安装依赖

```bash
npm install
```

**注意**: 如果 Electron 下载失败（网络问题），可以尝试：

```bash
# 使用淘宝镜像
npm install --registry=https://registry.npmmirror.com

# 或者手动下载 Electron
npx electron-download 34.0.0
```

### 2. 准备图标资源

在 `assets/` 目录下放置以下图标文件：
- `icon.ico` (Windows 应用图标)
- `icon.icns` (macOS 应用图标)
- `icon_16.png` (Tray 图标, 16x16) - **开发阶段必需**
- 其他尺寸图标可选（32, 64, 128, 256, 512, 1024）

**临时方案**: 可以先用一个简单的 16x16 PNG 图片作为 `icon_16.png` 进行测试。

### 3. 启动开发服务器

```bash
npm start
```

这将启动 Electron 应用，显示全屏透明窗口和齿轮按钮（右上角）。

### 4. 打包应用

```bash
# 打包当前平台
npm run make

# 指定平台
npm run make -- --platform=win32   # Windows
npm run make -- --platform=darwin  # macOS
```

打包后的文件位于 `out/` 目录。

## 使用说明

### 基本操作

1. **显示控制面板**: 点击右上角 ⚙️ 按钮
2. **隐藏控制面板**: 点击面板右上角 ✕ 按钮
3. **移动控制面板**: 拖拽面板标题栏
4. **折叠/展开面板**: 点击标题栏
5. **切换窗口可见性**: 点击系统托盘图标

### 创建/加入房间

1. 打开控制面板，切换到"房间"Tab
2. **创建房间**: 点击"创建房间"按钮，会生成一个房间 ID
3. **分享房间**: 将你的 **Peer ID** 和 **房间 ID** 分享给其他人
4. **加入房间**: 输入对方的房间 ID 和 Peer ID，点击"加入房间"

### 发送弹幕

目前版本需要在代码中或通过其他方式触发弹幕发送。可以在控制台测试：

```javascript
// 在 DevTools 控制台中测试
import { peerService } from './services/peerService';
import { useSettingsStore } from './stores/settingsStore';

const msg = {
  id: Date.now().toString(),
  roomId: 'your_room_id',
  sender: useSettingsStore.getState().nickname,
  content: '测试弹幕',
  timestamp: Date.now(),
};

peerService.sendDanmaku('your_room_id', msg);
```

### 调整弹幕区域

1. 默认弹幕覆盖整个屏幕
2. 拖拽 8 个方向的蓝色半透明手柄可以调整弹幕区域大小和位置
3. 调整时鼠标穿透会暂时禁用，可以看到边框

### 设置选项

- **昵称**: 弹幕显示的发送者名称
- **字体大小**: 弹幕文字大小（12-48px）
- **滚动速度**: 弹幕从右到左的速度（50-300 px/s）
- **透明度**: 弹幕透明度（10%-100%）
- **启用历史记录**: 是否保存弹幕历史

## 项目结构

```
yundanyixia/
├── assets/                    # 图标资源
├── src/
│   ├── main/                  # Electron 主进程
│   │   ├── main.ts            # 主进程入口
│   │   └── preload.ts         # 预加载脚本
│   ├── renderer/              # React 渲染进程
│   │   ├── components/        # UI 组件
│   │   │   ├── ControlPanel.tsx
│   │   │   ├── DanmakuLayer.tsx
│   │   │   ├── DanmakuItem.tsx
│   │   │   ├── RoomPanel.tsx
│   │   │   └── HistoryPanel.tsx
│   │   ├── services/          # 业务逻辑
│   │   │   ├── danmakuEngine.ts
│   │   │   └── peerService.ts
│   │   ├── stores/            # Zustand 状态管理
│   │   │   ├── connectionStore.ts
│   │   │   ├── danmakuStore.ts
│   │   │   └── settingsStore.ts
│   │   ├── styles/            # CSS 样式
│   │   │   ├── global.css
│   │   │   └── danmaku.css
│   │   ├── App.tsx            # 根组件
│   │   └── main.tsx           # React 入口
│   └── shared/                # 共享类型
│       └── types.ts
├── index.html
├── package.json
├── tsconfig.json
├── forge.config.ts
├── vite.main.config.ts
├── vite.preload.config.ts
├── vite.renderer.config.ts
└── forge.env.d.ts
```

## 日志文件位置

- **Windows**: `%APPDATA%/funapp/app.log`
- **macOS**: `~/Library/Application Support/funapp/app.log`

## 常见问题

### Q: Electron 下载失败怎么办？

A: 尝试使用镜像源或手动下载：
```bash
npm install --registry=https://registry.npmmirror.com
# 或
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

### Q: Tray 图标不显示？

A: 确保 `assets/icon_16.png` 存在且是有效的 PNG 图片。

### Q: 联机连接失败？

A: 
1. 检查网络连接
2. 确认「设置」中的服务器地址正确（自部署见 danmaku-server/ 部署文档）
3. 检查服务器防火墙/安全组是否放行对应端口

### Q: 弹幕不显示？

A:
1. 确认已加入房间并有其他用户连接
2. 检查浏览器控制台是否有错误
3. 查看日志文件了解详细信息

## 开发提示

- 开发模式下可以同时启动多个实例测试联机收发弹幕
- 按 F12 或 Ctrl+Shift+I 打开 DevTools
- 查看主进程日志：终端输出 + 日志文件
- 查看渲染进程日志：DevTools Console + 日志文件

## 许可证

MIT

## 后续优化方向

1. **弹幕高级特效**: 颜色选择、表情符号、特殊动画
2. **房间权限**: 密码保护、管理员踢人
3. **弹幕过滤**: 关键词屏蔽、用户黑名单
4. **性能监控**: FPS 显示、弹幕丢弃统计
5. **云端房间列表**: 发现公共房间
6. **弹幕导入**: 从 Bilibili 等平台导入历史弹幕
