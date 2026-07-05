# 图标资源说明

此目录需要放置以下图标文件:

## 必需图标:
- icon.ico (Windows 应用图标)
- icon.icns (macOS 应用图标)
- icon_16.png (Tray 图标, 16x16)
- icon_32.png (32x32)
- icon_64.png (64x64)
- icon_128.png (128x128)
- icon_256.png (256x256)
- icon_512.png (512x512)
- icon_1024.png (1024x1024)

## 临时方案:
在开发阶段,可以创建一个简单的 PNG 图片作为 icon_16.png 用于 Tray 测试。
其他图标可以在打包前再准备。

## 图标制作工具:
- 在线工具: https://www.favicon-generator.org/
- macOS: 使用 Icon Composer 或命令行工具 iconutil
- Windows: 使用 Visual Studio 图标编辑器或在线 .ico 生成器
