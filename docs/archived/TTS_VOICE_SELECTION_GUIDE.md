# 语音弹幕音色选择功能文档

- **日期**：2026-07-10
- **分支**：`dev`（提交 `511d932`）
- **需求来源**：GitHub issue #5「语音弹幕的音色看看能不能给几个可以切换的备选项」

## 功能说明

设置 Tab「语音弹幕」区新增**音色**下拉框与**试听**按钮（仅在语音朗读开关打开时显示）：

- 下拉列出系统已安装的中文语音（`lang` 以 `zh` 开头），首项「系统默认」；系统无中文语音包时回退显示全部语音并提示「未检测到中文语音包，已显示全部系统语音」
- 试听按钮用当前语速/音量/音色朗读一句示例文案
- 音色选择持久化（localStorage，随 settingsStore 现有机制），重启后保持

## 设计要点

### 为什么用 voiceURI 而不是 name / index

`SpeechSynthesisVoice.voiceURI` 是 Web Speech API 为标识语音设计的稳定字段；`name` 跨语言包版本文案会变，index 依赖 `getVoices()` 数组顺序（系统更新后可能漂移）。设置项 `DanmakuSettings.voiceURI`（`''` = 系统默认）朗读时按 voiceURI 查找，**找不到（语音包被卸载/换机器）时静默回落系统默认**，不报错不阻塞队列。

### voices 异步加载

Chromium 下 `speechSynthesis.getVoices()` 首次调用可能返回空，需监听 `voiceschanged`。`ttsService` 新增 `onVoicesChanged(callback): 取消函数`；`ControlPanel` 用组件本地 state + useEffect 订阅驱动重渲染（当前唯一消费者，不建共享 store）。

### 跨窗口

TTS 只在控制面板窗口触发（`incomingDanmaku.ts` 排除 `?window=danmaku`），音色设置经 settingsStore 现有 persist + storage 事件同步，无需额外工作。

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/shared/types.ts` | `DanmakuSettings` 加 `voiceURI: string` |
| `src/renderer/stores/settingsStore.ts` | `DEFAULT_SETTINGS.voiceURI = ''`（merge 深合并保证旧存档回落默认） |
| `src/renderer/services/ttsService.ts` | speak options / 队列项透传 voiceURI；processQueue 查找并设置 `utterance.voice`；新增 `onVoicesChanged`；`speakVoiceDanmaku` Pick 扩展 |
| `src/renderer/services/incomingDanmaku.ts` | `speakVoice` 依赖签名 Pick 同步加 `'voiceURI'`（连锁类型点） |
| `src/renderer/components/ControlPanel.tsx` | 音色下拉 + 试听按钮 + voices 订阅 |
| `src/renderer/styles/global.css` | 新增 `.cp-select`（深色，与 `.cp-server-input` 一致） |
| `src/renderer/services/ttsService.test.ts` | 音色命中/未命中回落/订阅取消等 6 个新用例 |
| `src/renderer/stores/settingsStore.test.ts` | voiceURI 回落与持久化用例 |
| `src/renderer/services/incomingDanmaku.test.ts` | SETTINGS 常量补字段（类型修复） |

## 已知限制

- 原生 `<select>` 下拉弹出层在 Windows/Electron 上可能呈系统亮色，与深色主题不完全一致（OS 原生控件限制，接受）
- 音色列表来自用户操作系统安装的语音包，各机器可选项不同；选中的语音包被卸载后静默回落系统默认

## 验证

已完成：

1. ✅ 客户端 vitest 全量通过（含新增用例）
2. ✅ tsc 与基线一致（3 个历史遗留错误）无新增；build:vite 编译通过

桌面端手动验证步骤（`npm start`）：

1. 设置 Tab 打开语音朗读 → 出现音色下拉，列出本机中文语音
2. 切换音色后点试听 → 以所选音色朗读示例句
3. 发送/接收语音弹幕 → 按所选音色朗读
4. 重启应用 → 音色选择保持
