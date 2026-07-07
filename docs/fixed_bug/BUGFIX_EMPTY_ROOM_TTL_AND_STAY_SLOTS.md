# 空房 TTL 回收与清屏停留槽位修复报告

- **日期**：2026-07-07
- **分支**：`dev`（提交 `170df88`）
- **问题反馈**：v1.5.x 接入 vitest 测试时（`c1c7365`）发现三处疑似缺陷，当时用测试"钉住现状"未修。经用户裁决：① 空房 TTL 修复为"空置 24h 后销毁"，规则写入用户说明；② connectionStore 日志封顶 51 条保持现状；③ engine.clear 不清停留槽位需修复。
- **结果**：定位到 2 个根因，修复 2 项 + 用户文档 2 处；`/test` 全量流水线通过（168 例全绿、tsc 基线无新增、build:vite 与服务器 tsc 构建通过）。

## 总体结论

两处都是"意图与实现不一致"：服务器清扫逻辑里一个多余的按房龄删除分支，把"空房保留 24 小时等房主回来"的设计实际废掉了；弹幕引擎的 `clear()` 只清了滚动轨道，漏了停留槽位的占用记录。修复后空房统一按**空置时长** 24h 回收（期间房主可免密回来，房间 ID/密码不变），清屏后停留弹幕从槽 0 重新分配。24h 自动销毁这条规则本身是有意保留的兜底回收——userId 按 IP 分配，用户 IP 变化后旧房间无法再从界面手动删除，只能靠服务器自动清理——已写入面向用户的说明文档。

## 问题清单与修复

### Bug A — 空房间房龄超 1h 即被销毁，24h 保留形同虚设

- **位置**：`danmaku-server/src/server.ts`（`sweepRooms`，原 `ROOM_TTL` 分支）
- **问题**：清扫逻辑对空房间有两个删除分支：先查"空置超 `EMPTY_ROOM_TTL`（24h）"，再查"房龄超 `ROOM_TTL`（1h）"。第二个分支对空房无条件生效——只要房间创建超过 1 小时，一旦变空，下一轮清扫（60s 周期）就会删除。触发条件：房主开播使用超过 1 小时后全员离开/掉线；后果：房间连同密码设置立即消失，房主重进等于重建房间，"保留 24h 等房主回来"的设计只对建房不满 1 小时的房间成立。
- **修复**：删除按房龄删除的分支与 `ROOM_TTL` 常量，空房统一按空置时长 24h 回收；经健康检查剔除最后一人的房间没有 `emptySince`（只有 leave/断线/切房路径会 `markEmpty`），清扫时补记计时起点，下一轮按 24h 规则处理。测试从"钉住现状"翻转为断言正确行为，并加了"空置 2h 房主仍可免密回房"的断言（`danmaku-server/tests/server.test.ts` TTL 清扫 describe）。

### Bug B — 清屏后停留弹幕槽位被"幽灵记录"顶开

- **位置**：`src/renderer/services/danmakuEngine.ts`（`clear()`）
- **问题**：`clear()` 只遍历清空滚动轨道 `tracks`，stay 模式的槽位占用记录 `staySlots` 原样残留。触发条件：清屏（`clearAll`）后立即发送停留弹幕；后果：屏幕已空但引擎认为槽位仍被占，新停留弹幕跳过"被占"槽位往后排，直到旧记录自然过期，位置分配不符合预期。
- **修复**：`clear()` 增加 `this.staySlots.clear()`，清屏后槽位从 0 重新分配。测试翻转为断言"清屏前占到槽 2，清屏后下一条停留弹幕拿到槽 0"（`src/renderer/services/danmakuEngine.test.ts`）。

### 附带处理 — 用户裁决记录同步进文档

- connectionStore 日志封顶 51 条（`slice(-50)` 后追加 1 条）经用户确认**保持现状**，对应用例注释改为"2026-07 已确认保持此行为"。
- `docs/archived/TESTING_GUIDELINES.md`、`CLAUDE.md`（本地）、`.claude/skills/test/SKILL.md`（本地）中"钉住现状待决 bug"清单同步更新：空房 TTL 与 engine.clear 两处标记已修复，空房 24h 保留升级为产品规则（勿当作 bug 改回按房龄清理）。

## 修改文件

| 文件 | 改动 |
|------|------|
| `danmaku-server/src/server.ts` | 删除 `ROOM_TTL` 按房龄删空房分支；空房按空置 24h 回收；无 `emptySince` 的空房补记计时起点 |
| `src/renderer/services/danmakuEngine.ts` | `clear()` 同时清空 `staySlots` |
| `danmaku-server/tests/server.test.ts` | TTL 用例翻转：空置 2h 不删且房主可免密回房；24h 过期删除用例保留 |
| `src/renderer/services/danmakuEngine.test.ts` | clear 用例翻转：清屏后停留弹幕从槽 0 重新分配 |
| `src/renderer/stores/connectionStore.test.ts` | 日志封顶 51 用例注释更新为"已确认保持" |
| `README.md` | 「创建/加入房间」新增房间生命周期说明（24h 保留与自动销毁缘由） |
| `CLIENT_USAGE.md` | 「创建或加入房间」新增同款房间生命周期说明 |
| `docs/archived/TESTING_GUIDELINES.md` | "钉现状"清单更新（仅剩日志封顶 51 一处） |

## 验证

已完成：

1. ✅ `/test` 全量流水线通过：客户端 vitest 109 例 + 服务器 vitest 59 例全绿（含翻转后的 3 个用例）
2. ✅ tsc 与 HEAD 基线比对无新增错误（仍为 3 个历史遗留）
3. ✅ `npm run build:vite` 编译通过；`danmaku-server` `npm run build`（tsc）零错误（`ROOM_TTL` 删除无残留引用）

桌面端手动验证步骤（`npm start` + 本地 `danmaku-server`）：

1. 创建房间 → 全员退出 → 等 2 分钟后房主重新加入 → 应能免密回到原房间（房间 ID/密码不变，不再被清扫掉；若要验证 1h 边界，可临时把服务器 `EMPTY_ROOM_TTL` 调小观察到期销毁）
2. 发送若干条"停留"模式弹幕（占用多个槽位）→ 点击清屏 → 立即再发一条停留弹幕 → 新弹幕应出现在最顶部槽位（不再往下顺延）
