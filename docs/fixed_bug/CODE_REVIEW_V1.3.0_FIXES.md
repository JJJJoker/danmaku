# v1.3.0 语音弹幕代码审查与修复报告

- **日期**：2026-07-06
- **审查范围**：`dev` 分支最新提交 `2aaa99c`（v1.3.0 语音弹幕功能，`git diff HEAD~1`，12 个文件）
- **审查方式**：多 Agent 工作流审查（xhigh 强度，45 个 agent，39 个候选问题经独立对抗验证 → 15 项结论）
- **结果**：15 项结论全部修复，无跳过项

## 总体结论

v1.3.0 的语音弹幕功能上线时存在根本性缺陷：语音设置永远无法从控制面板窗口同步到弹幕窗口（功能开了没反应，重启后又读旧值）、StrictMode 下新增的监听器清理逻辑会杀掉全部弹幕转发、TTS 的过期回调会破坏播放队列并使 10 秒上限失效。本次已全部修复，并对朗读链路做了架构级重构。

## 问题清单与修复

### 致命——功能失效类

#### 1. 语音设置永远传不到弹幕窗口（CONFIRMED）

- **位置**：`src/renderer/components/DanmakuLayer.tsx`
- **问题**：语音开关/语速/音量在控制面板窗口的 zustand store 中修改，但朗读触发逻辑读取的是弹幕窗口独立进程里的 store 副本，后者只在窗口加载时水合一次，两窗口间无任何同步机制。功能开启后不生效；重启后生效但再也关不掉；拖动弹幕区域还会把过期设置快照写回 localStorage，静默还原用户刚改的设置。
- **修复**：
  - 架构重构（见第 13 项）：朗读改在控制面板窗口（设置的产生地）直接触发，不再依赖弹幕窗口的 store 副本。
  - `settingsStore.ts` 增加 `storage` 事件监听重水合，两窗口设置实时同步（顺带修复弹幕窗口透明度/弹幕开关等设置不实时生效的历史问题）。

#### 2. StrictMode 下弹幕转发完全失效（CONFIRMED）

- **位置**：`src/renderer/App.tsx`
- **问题**：模块级 `danmakuListenerRegistered` 标志位与本次新增的 unsubscribe 清理叠加：StrictMode 的 挂载→清理→重挂载 之后监听器数量为零。开发模式下从控制面板发送任何弹幕（语音或普通）屏幕都不显示。
- **修复**：删除模块级标志位，注册/注销完全交给 effect 的 unsubscribe 清理函数。

#### 3. TTS 过期回调破坏队列、10 秒上限失效（CONFIRMED）

- **位置**：`src/renderer/services/ttsService.ts`
- **问题**：语音 A 超 10 秒被 `forceStop` 取消并开始播放 B 后，A 的异步 `onerror/onend` 才到达，清掉 B 的看门狗、重复推进队列，导致 B 还在播时 C 已入队，状态从此错乱——后续超长语音完整播完，播放顺序错乱。
- **修复**：`onend/onerror` 只处理仍属于 `currentUtterance` 的事件；`forceStop` 在 `cancel()` 前先清空 `currentUtterance`。

### 已证实的正确性缺陷

#### 4. 输入法上屏的 Enter 被当成发送 + 60 秒锁定（CONFIRMED）

- **位置**：`src/renderer/components/ControlPanel.tsx`
- **问题**：中文输入法选字确认的 Enter（`isComposing=true`）触发发送，半截文字被发出，且 60 秒冷却锁死输入框。
- **修复**：语音输入框和普通输入框的 Enter 处理均增加 `!e.nativeEvent.isComposing` 判断。

#### 5. P2P 历史回放重复朗读旧语音（CONFIRMED）

- **位置**：`src/renderer/components/DanmakuLayer.tsx` / `peerService.ts`
- **问题**：任何人进房/重连时，房主推送的最近 10 条历史弹幕（`init` 消息）走同一条 onDanmaku 链路，几分钟前的旧语音弹幕会被再次朗读。
- **修复**：`peerService.ts` 的 `init` 回放路径经 `connectionStore` 透传 `isReplay=true` 标志，朗读入口跳过回放消息。

#### 6. 接收端无限频（CONFIRMED）

- **位置**：`src/renderer/components/ControlPanel.tsx`
- **问题**：发送端 60 秒冷却只是本地 React 状态，改造过的客户端或反复刷新控制面板即可绕过，一秒发 20 条语音可强制所有接收端播放约 200 秒无法停止的语音。
- **修复**：朗读入口 `speakVoiceDanmaku()` 增加接收端按发送者限频（50 秒最小间隔，与发送端 60 秒冷却留余量），叠加原有 20 条队列上限。

#### 7. 语音开关关了再开会重复朗读（CONFIRMED）

- **位置**：`src/renderer/components/DanmakuLayer.tsx`
- **问题**：关闭开关会清空 `spokenIdsRef`，还在屏上的语音弹幕在重新开启后被当作新弹幕再次朗读。
- **修复**：去重改为在消息接收入口按弹幕 ID（带 200 条容量上限的集合），与渲染列表解耦，开关切换不再影响。

#### 8. 🔊🔊🔊 前缀未计入碰撞宽度（CONFIRMED）

- **位置**：`src/renderer/services/danmakuEngine.ts` / `DanmakuItem.tsx`
- **问题**：渲染时语音弹幕文字前加 🔊🔊🔊（约 3 倍字号 + 4px 间距），但引擎 `estimateTextWidth` 只测正文，`hasSpace()` 判断偏松，后续弹幕会叠在语音弹幕尾部。
- **修复**：宽度估算把前缀和间距计入。

#### 9. 非法窗口层级名 `'normal-window'`（CONFIRMED）

- **位置**：`src/main/main.ts`（两处，含 `as any` 强转）
- **问题**：Electron `setAlwaysOnTop` 文档化的层级不含 `'normal-window'`，现有行为依赖原生映射的未文档化兜底，Electron 升级后可能抛异常（经全局 uncaughtException → `app.exit(1)` 直接杀死整个应用）或落到错误层级。
- **修复**：改为文档化的 `'normal'`，移除 `as any`。

### 疑似竞态 / 回归（PLAUSIBLE）

#### 10. IPC 处理器的窗口已销毁竞态

- **位置**：`src/main/main.ts`
- **问题**：`speak-danmaku` 处理器的守卫 `controlWindow.webContents.isDestroyed()` 在窗口已销毁但尚未置 null 时本身就会抛异常；`set-control-window-level` 只判断了真值没判断 `isDestroyed()`。任一竞态触发都会经 uncaughtException 杀死整个应用。
- **修复**：`speak-danmaku`/`stop-speak-danmaku` 处理器随架构重构整体删除；`set-control-window-level` 补上 `!controlWindow.isDestroyed()`。

#### 11. macOS 丢失置顶自愈能力

- **位置**：`src/main/main.ts`
- **问题**：v1.3.0 为保护输入法层级把 5 秒置顶重断言循环在 darwin 上整体跳过，全屏应用/截屏打乱层级后控制面板再也不会自动恢复置顶。
- **修复**：主进程用 `controlWindowLevel` 变量记录目标层级（打字时 `normal`，其余 `screen-saver`），重断言循环按记录恢复，既保住自愈能力又不与输入法修复冲突。

#### 12. `synth.speak()` 同步抛错导致队列停摆

- **位置**：`src/renderer/services/ttsService.ts`
- **问题**：catch 分支复位状态后不调用 `processQueue()`，与 onend/onerror 路径不对称，队列剩余语音无限期滞留。
- **修复**：catch 分支补上 `processQueue()` 继续播放。

### 架构重构（第 1、5、6、7 项的根因修复）

#### 13. 三跳 IPC 朗读链改为消息入口直接触发（CONFIRMED, cleanup）

- **原架构**：弹幕窗口渲染列表检测新弹幕 → IPC → 主进程 → IPC → 控制面板朗读。朗读耦合在渲染列表上：消息爆发期被 maxCount 挤掉的语音弹幕永远不会被读；设置过期问题也源于此。
- **新架构**：TTS 在消息产生/到达处直接触发——本地发送在 `handleSendVoiceDanmaku`，远程接收在 `App.tsx` 的接收回调——统一走 `ttsService.ts` 新增的 `speakVoiceDanmaku()` 入口（内置按 ID 去重 + 按发送者限频）。弹幕窗口回归纯展示。
- **删除**：`speak-danmaku`/`stop-speak-danmaku` IPC 通道、preload 的 4 个相关 API、`types.ts` 对应类型、DanmakuLayer 的语音检测 effect 与 `spokenIdsRef` 机制（净删约 90 行）。

### 清理项

#### 14. macOS 输入法层级切换只覆盖 2 个输入框

- **问题**：4 段复制粘贴的 onFocus/onBlur 闭包只挂在 ControlPanel 的两个输入框上，RoomPanel 的全部输入框（房间号、用户名等）依旧复现 v1.2.0 的候选框遮挡 bug。
- **修复**：改为一个 document 级 `focusin`/`focusout` 监听，统一覆盖当前及未来所有文本输入框。

#### 15. 注释与更新日志勘误

- `{/* 语音弹幕输入区 - 始终显示 */}` 实际受 `voiceEnabled` 控制，注释已改为"语音开关开启时显示"。
- 更新日志中语音功能误记在 v1.2.0（该版本实际只改了 package.json 和 main.ts），已移至 v1.3.0。

## 验证情况

| 检查项 | 结果 |
| --- | --- |
| `tsc` 主进程（tsconfig.main.json） | ✅ 零错误 |
| `tsc` preload（tsconfig.preload.json） | ✅ 零错误 |
| `tsc` 渲染进程（tsconfig.json） | ⚠️ 有报错，但与 HEAD 的错误集逐项对比完全一致，全部为历史遗留（项目用 Vite 构建，不做类型检查），本次改动未新增任何错误 |
| Vite 渲染进程打包构建 | ✅ 构建成功 |

**注意**：审查环境无显示器且未安装 Electron 二进制，未做真机端到端验证。发版前建议在 macOS/Windows 真机上手动过一遍：接收即朗读、中文输入法 Enter 行为、macOS 窗口层级切换、语音开关关闭即停。

## 修改文件

```
src/main/main.ts                         层级名修正、销毁守卫、层级跟踪重断言、删 speak IPC
src/main/preload.ts                      删 4 个语音 IPC API
src/renderer/App.tsx                     删模块级标志位、接收入口触发朗读
src/renderer/components/ControlPanel.tsx IME 守卫、document 级层级切换、发送即朗读、开关即停、勘误
src/renderer/components/DanmakuLayer.tsx 删语音检测 effect（回归纯展示）
src/renderer/services/danmakuEngine.ts   语音前缀计入宽度
src/renderer/services/peerService.ts     init 回放标记 isReplay
src/renderer/services/ttsService.ts      回调身份校验、catch 续播、speakVoiceDanmaku 入口
src/renderer/stores/connectionStore.ts   透传 isReplay
src/renderer/stores/settingsStore.ts     storage 事件跨窗口同步
src/shared/types.ts                      删语音 IPC 类型、收紧监听器返回类型
package-lock.json                        版本号同步至 1.3.0
```

## 遗留未改项（审查提及但按范围搁置）

- 调试用 console.log 数量偏多（DanmakuLayer/DanmakuItem/ControlPanel 每帧多条）。
- `ttsService.getVoices()` / `getChineseVoices()` 无调用方。
- `handleSendVoiceDanmaku` 与 `handleSendDanmaku` 大量重复，可提取公共构造函数。
- `voiceCooldown` 倒计时 effect 依赖数组写法为 `[voiceCooldown > 0]`（可用但不规范）。
- zustand persist 双窗口互写 localStorage 的固有竞态已被 storage 同步大幅缓解，但极端并发写仍可能丢一次更新。
