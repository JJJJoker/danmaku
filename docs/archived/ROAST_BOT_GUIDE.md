# 吐槽姬（AI 吐槽 Bot）功能设计与实现文档

- **日期**：2026-07-06
- **分支**：`dev`
- **需求来源**：房主在客户端启动一个 AI 吐槽机器人，根据当前时间/弹幕内容/房间名/在线用户调用大模型随机发送吐槽弹幕；支持关键词触发回应、手动触发；人设/语言风格可配置、可保存多个角色并点击切换；accesskey 由房主提供
- **结果**：功能完成；`npm run build:vite` 通过，tsc 与 HEAD 基线比对无新增错误

## 功能概览

| 需求 | 实现 |
|------|------|
| 启动/停止按钮 + 实时状态 | 吐槽姬 tab 内状态 pill（灰点「已停止」/ 绿点脉冲「运行中」），tab 标签上运行时也显示绿点角标 |
| 手动触发 | 「🔥 吐槽一下」按钮，仅运行中可用，生成时转圈 |
| 吐槽人设输入框 | 人设 textarea + 语言风格 input |
| 弹幕风格可配置 | 语言风格（进 prompt）+ 弹幕外观（颜色/字号/位置/滚动模式，默认粉色与普通弹幕区分） |
| 人设保存与切换 | 默认角色 [吐槽姬]；「存为新角色」时调用 LLM 根据人设自动生成 2~6 字角色名；已存角色以 chip 标签横排，点击切换、非默认可删除 |
| 随机吐槽 | 随机定时器（默认 120~300s，下限 30s），prompt 携带当前时间（含深夜/清晨语义）、房间名、在线用户、最近弹幕 |
| 关键词触发 | 房主自设关键词列表（逗号分隔，子串匹配）；弹幕中 `@角色名` 必触发（绕过发送者冷却，不绕全局冷却） |
| accesskey | 房主填写，OpenAI 兼容接口（baseURL/model/key 三项可配置，兼容 DeepSeek/通义/Kimi 等），明文存 localStorage（用户确认的决策），UI 密码框掩码 + 显隐切换 |
| 上下文限制 | LLM 上下文最多携带当前房间最近 **100 条**弹幕（等于 `danmakuStore` 历史内存上限），排除 bot 自己的发言 |

## 架构设计

### 为什么 LLM 调用在主进程

渲染进程 `fetch` 外部 API 会被 Chromium CORS 拦截（`webSecurity` 默认开启、生产环境 origin 为 `file://`，OpenAI 兼容接口普遍不返回浏览器 CORS 头）。因此 HTTP 请求统一放主进程（Node 环境无 CORS 限制），经 IPC `llm:chat` 代理，仿照 `updater.ts` 的 setup 模式。key 保存在渲染进程 localStorage，按次随请求传给主进程，主进程不持久化、日志不落 key。

### 数据流

```
随机定时器 ─┐
关键词命中 ─┼→ botService.trigger() → 组 prompt → electronAPI.llm.chat（IPC）
手动按钮  ─┘                              ↓ 主进程 fetch {baseURL}/chat/completions
                                          ↓ 返回吐槽文本（后处理：去引号/截断）
                    sendBotDanmaku()：构造 DanmakuMessage（sender=角色名, userId=bot_前缀）
                      → addHistory（id 去重）→ forwardDanmakuToWindow（本机弹幕层）
                      → sendDanmaku（网络广播给房间其他人）
```

- 关键词观察点有两个：网络接收走 `App.tsx` 的 `initCallbacks` 回调（单回调槽，在既有回调内追加，仅控制面板/单窗口执行）；房主自己发送的弹幕不经过网络回调，由 `ControlPanel` 两个发送函数发送后调 `botService.onLocalDanmaku` 喂入。
- **服务器零改动**：服务器对 danmaku 原样转发、无 per-sender 鉴权，bot 弹幕就是一条普通弹幕；不依赖服务器回显（本机显示走 IPC 转发）。
- 房主判定为客户端判定：`connectionStore.rooms[activeRoomId].isHost`（与 RoomPanel 同款读法），非房主/未连接时启动按钮禁用并提示原因。

### 防刷屏与防死循环

| 机制 | 说明 |
|------|------|
| `bot_` userId 前缀过滤 | bot 弹幕 userId 为 `bot_<房主持久id>`，观察管线一律跳过，防自触发死循环（含服务器可能的回显） |
| `repliedIds` 去重 | 按弹幕 id 去重（上限 200，淘汰法同 ttsService） |
| 全局冷却 | 关键词回应默认 20s 全局冷却（@提及也不豁免） |
| 每发送者冷却 | 同一发送者 60s 内只触发一次（@提及可豁免） |
| busy 单飞 | 同一时间只允许一次 LLM 调用，后到触发直接丢弃不排队 |
| 运行时校验 | 每次触发实测连接状态与 isHost，断线/被移出/切房自动停止并显示原因 |

### 持久化

`botStore`（zustand persist，localStorage key `danmaku-bot`）只持久化 `config` + `personas`（merge 深合并防旧数据丢字段，抄 settingsStore 模式）；`running/generating/lastError` 为运行态不落盘，重启后自然回到停止态。吐槽姬只运行在控制面板窗口，不做 storage 跨窗口重水合。

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/main/llm.ts`（新增） | `setupLLM` 注册 `llm:chat` IPC：原生 fetch OpenAI 兼容接口，30s 超时，错误以值返回，日志不落 key |
| `src/main/main.ts` | app-ready 处调用 `setupLLM({ log })` |
| `src/main/preload.ts` | 暴露 `electronAPI.llm.chat`（参数保持 any，遵守禁止 import shared 类型的约束） |
| `src/shared/types.ts` | 新增 `LLMChatRequest`/`LLMChatResponse`；`ElectronAPI` 加 `llm.chat` |
| `src/renderer/stores/botStore.ts`（新增） | 配置 + 多人设持久化 store，含默认人设 [吐槽姬]、间隔钳制、default 不可删等约束 |
| `src/renderer/services/botService.ts`（新增） | 触发管线（随机/关键词/手动）、prompt 构造（最多 100 条弹幕上下文）、角色名自动生成、四步发送流 |
| `src/renderer/components/BotPanel.tsx`（新增） | 吐槽姬面板：状态行/API 配置/人设管理/触发设置/弹幕外观五个区块 |
| `src/renderer/components/ControlPanel.tsx` | 新增「吐槽姬」tab（运行中显示绿点角标）；两个发送函数发送后喂 `botService.onLocalDanmaku` |
| `src/renderer/App.tsx` | `initCallbacks` 回调内追加 bot 观察（仅非弹幕窗口） |
| `src/renderer/styles/global.css` | 末尾追加 `cp-bot-*` 样式族（状态 pill/脉冲绿点/人设 chip/表单/色板等） |

## 验证

已完成（本机 headless）：

1. ✅ `npm run build:vite` 通过；preload 产物仍为 `.vite/preload/preload.js`（未漂移），主进程 bundle 含 `llm:chat` 处理器
2. ✅ tsc 与 HEAD 基线比对：基线 16 = 当前 16，无新增类型错误
3. ✅ grep 自查：`preload.ts` 无 shared 类型 import（仅注释提及）；`llm.ts` 日志只记 baseURL/model，不落 apiKey

桌面端手动验证步骤（`npm start`）：

1. 打开「吐槽姬」tab，填 baseURL/model/AccessKey（可用 DeepSeek）→ 未连接时启动按钮禁用并提示「请先连接进入房间」
2. 创建房间（房主）→ 点「▶ 启动」→ 状态 pill 变「运行中」绿点脉冲，tab 标签出现绿点 → 等待随机间隔（默认 120~300s，可临时把最小/最大间隔都调到 30s 加快验证），收到一条 sender 为「吐槽姬」的粉色弹幕，弹幕层与「历史」tab 均可见且不重复
3. 第二个客户端加入同一房间，发含关键词的弹幕 → bot 回应一次；冷却窗口内（默认 20s）再发不重复回应；发 `@吐槽姬 xxx` → 必回应；第二客户端能看到 bot 弹幕
4. 点「🔥 吐槽一下」→ 立即生成一条，生成期间按钮转圈
5. 修改人设 textarea → 点「存为新角色」→ 自动生成角色名 chip 并切换；再发弹幕 sender 变为新角色名；点 × 删除该角色 → 回落「吐槽姬」
6. 点「■ 停止」→ 状态变「已停止」，不再发弹幕;运行中断网或退出房间 → 自动停止并显示原因
7. 填错 AccessKey → 手动触发 → 面板显示 `HTTP 401` 错误，bot 不发弹幕
8. 重启应用 → key/人设/关键词等配置保留，bot 处于停止态
9. 非房主客户端：tab 可见、可预填配置，启动按钮禁用并提示「只有房主可以启动吐槽姬」

## 已知限制

- accesskey 明文存 localStorage（与仓库现有房间密码缓存同口径，用户已确认接受）；如需加密可后续引入 Electron `safeStorage`
- 历史为内存态（上限 100 条重启清空），bot 的上下文随之受限
- P2P 模式下语音/回放消息带 `isReplay=true` 不会触发关键词；服务器模式无回放
