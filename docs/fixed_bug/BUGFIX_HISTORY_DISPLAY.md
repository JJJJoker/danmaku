# 弹幕历史记录显示缺陷修复报告

- **日期**：2026-07-06
- **分支**：`dev`
- **问题反馈**：所有弹幕（包括语音弹幕）在「历史」（弹幕记录）面板中都没有正常正确显示
- **结果**：定位到 2 个根因，全部修复；`npm run build:vite` 与 `tsc` 基线比对通过（无新增类型错误）

## 总体结论

历史记录此前**只依赖网络回环路径写入**：只有从服务器/P2P 收到的弹幕才会进入历史。本地发送的弹幕（普通和语音）从未写入历史，离线使用时历史面板永远显示「暂无弹幕记录」。此外，v1.3.0 新增的 `isVoice` 语音标志在整条历史链路中被丢弃，即使联网回显写入了历史，语音弹幕也与普通弹幕无法区分（缺少 🔊🔊🔊 标记）。

## 问题清单与修复

### Bug A — 本地发送的弹幕从未写入历史（影响所有弹幕）

- **位置**：`src/renderer/components/ControlPanel.tsx`（`handleSendDanmaku` / `handleSendVoiceDanmaku`）
- **问题**：两个发送函数只做了 IPC 转发到弹幕窗口 +（已连接时）发到服务器，从不调用 `addHistory`。历史只能靠 `App.tsx` 的网络接收回调写入（服务器回显）。因此：
  - 未加入房间（离线本地使用）时，发送的弹幕永远不会出现在历史里，面板始终显示「暂无弹幕记录」；
  - `addDanmaku` 在组件中被解构且列入 useCallback deps，但从未被调用（死引用）。
- **修复**：两个发送函数在构造 `message` 后立即调用 `addHistory` 本地写入历史（联网时带上 `activeRoomId` 作为房间标签），并清理了 `addDanmaku` 死引用、同步更新 deps 数组。

### Bug B — `isVoice` 标志在历史链路中被丢弃（语音弹幕无 🔊🔊🔊 标记）

- **位置**：`src/renderer/stores/danmakuStore.ts`、`src/renderer/App.tsx`、`src/renderer/components/HistoryPanel.tsx`
- **问题**：v1.3.0 给 `DanmakuMessage` 增加了 `isVoice` 并在实时弹幕层渲染 🔊🔊🔊（`DanmakuItem.tsx`），但历史链路完全没有接上：
  - `HistoryItem` 接口没有 `isVoice` 字段；
  - `addDanmaku` 构造 historyItem 时未拷贝 `message.isVoice`；
  - `App.tsx` roomId 不匹配路径的 `addHistory` 同样遗漏；
  - `HistoryPanel` 渲染时没有任何语音标记。
- **修复**：`HistoryItem` 增加 `isVoice?: boolean`，三处历史写入点全部透传该标志，`HistoryPanel` 在发送者与内容之间渲染与实时弹幕一致的 🔊🔊🔊 标记。

### 附带修复 — 历史按弹幕 ID 去重

- **位置**：`src/renderer/stores/danmakuStore.ts`（`addHistory`）
- **问题**：服务器模式会把弹幕回显给发送者本人（`danmaku-server/src/room.ts` 广播不排除发送者）。修复 Bug A 后，本地发送先写一次历史，服务器回显会以同一 `message.id` 再写一次，产生重复记录（且 `HistoryPanel` 用 `item.id` 作 React key，会产生重复 key 警告）。单窗口兼容模式下 IPC 转发回同一窗口也有同样的重复风险。
- **修复**：`addHistory` 按 `id` 去重，已存在同 ID 记录时跳过写入。

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/renderer/stores/danmakuStore.ts` | `HistoryItem` 增加 `isVoice`；`addDanmaku` 透传 `isVoice`；`addHistory` 按 ID 去重 |
| `src/renderer/components/ControlPanel.tsx` | 两个发送函数本地写入历史；移除 `addDanmaku` 死引用 |
| `src/renderer/App.tsx` | roomId 不匹配路径的历史写入透传 `isVoice` |
| `src/renderer/components/HistoryPanel.tsx` | 语音弹幕渲染 🔊🔊🔊 标记 |

## 验证

已完成（本机为无显示环境，GUI 步骤需在桌面端复验）：

1. ✅ `npm run build:vite`（renderer + main + preload）编译通过
2. ✅ `tsc --noEmit` 与修改前基线比对：错误列表完全一致（仅行号偏移），无新增类型错误

桌面端手动验证步骤（`npm start`）：

1. **不加入房间**，发送普通弹幕 → 「历史」Tab 立即出现记录（修复前完全为空）
2. 不加入房间，发送语音弹幕 → 历史中出现该条且带 🔊🔊🔊 前缀
3. 加入房间后发送弹幕 → 历史中只出现一条（不因服务器回显而重复）
4. 收到其他用户的语音弹幕 → 历史中带 🔊🔊🔊 标记
