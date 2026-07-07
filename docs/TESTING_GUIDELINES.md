# 测试编写规范与流程

> 本文档是**活文档**：约定变化时直接更新本文，不做存档。首次建立于 2026-07-07（客户端 + danmaku-server 全面接入 vitest）。

## 1. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 测试框架 | **Vitest 4** | 与客户端 Vite 6 同源（复用转译管线与别名解析）、原生 TS 零配置、内置 fake timers / mock / stubEnv；客户端与 danmaku-server 统一用同一框架 |
| 客户端 DOM 环境 | **happy-dom** | 只测纯逻辑（services/stores），不做组件渲染测试；需要的只有 localStorage / URL / StorageEvent，happy-dom 比 jsdom 快且轻。单个文件如遇兼容问题可在文件头加 `// @vitest-environment jsdom` 逃生（届时再补装 jsdom） |
| 服务器环境 | node | 集成测试起真实 WebSocket/HTTP 服务器 |
| 覆盖率 | @vitest/coverage-v8（`npm run test:coverage`，按需跑） | v8 provider 零配置；`coverage/` 已 gitignore |

两个项目**各自独立**接入：根项目配置在 `vitest.config.ts`（独立于三个构建用 vite config），服务器配置在 `danmaku-server/vitest.config.ts`。

## 2. 目录与命名约定

- **客户端**：测试与被测模块**同目录共置**，命名 `<模块名>.test.ts`（如 `src/renderer/services/danmakuEngine.test.ts`）。全局 setup 在 `src/test/setup.ts`（每用例后清 localStorage、还原真实时钟——保持极简，模块专属 mock 放各自测试文件）。
- **服务器**：测试集中在 `danmaku-server/tests/`（与 `src/` 平级，不在 tsconfig include 内，天然不进 `npm run build` 产物）。共用辅助在 `tests/helpers.ts`（startServer / connect / join / fetchStats / waitUntil）。
- **一个被测模块一个测试文件**；`describe`/`it` 描述**一律中文**，描述行为而非实现（"相同 id 二次写入被忽略"，而不是"测试 addHistory 的 some 判断"）。
- **不开 vitest globals**：每个测试文件显式 `import { describe, it, expect, vi } from 'vitest'`——避免改 tsconfig `types` 字段引入新的基线类型错误。测试文件在根 tsconfig include 内，会被 `tsc --noEmit` 一并类型检查，这是有意的。

## 3. 如何运行

```bash
# 客户端（仓库根目录）
npm test                 # 单次全量（CI 同款）
npm run test:watch       # 监听模式
npm run test:coverage    # 带覆盖率

# 服务器
cd danmaku-server && npm test     # 或 npm run test:watch

# 一键全量验收流水线（两端测试 + tsc 基线比对 + build:vite，支持 --client/--server/--types/--build 组合）
bash .claude/skills/test/check.sh
```

> 用 Claude Code 开发时对应 `/test` skill（本地 skill，不随仓库分发）；无该 skill 的环境按上面命令手动跑。

本机是 headless Linux 跑不了 Electron GUI，但 **vitest 测试完全可以本机直接跑**——这是本仓库无头环境下最主要的自动化验收手段。

**CI 门禁**：`build.yml` 和 `release.yml` 各有一个 `Test` job（两处内容同款，改动时保持同步）。release.yml 的 `prepare` 依赖 test job——**测试红 = 不打 tag、不建草稿、不发版**。建议在 GitHub 分支保护中把 `Test` 设为 required check。

## 4. 何时必须写测试

- **新功能**：涉及 services/stores/服务器逻辑的新功能必须带测试用例，随功能同 PR 提交。
- **修 bug**：先写一个**能复现 bug 的失败用例**，再修代码让它转绿——回归钉死，同类问题不二进宫。
- **重构**：动手前先确认现有测试覆盖了将被重构的行为；没有就先补"钉现状"的测试再重构。
- **钉现状 ≠ 认可现状**：发现疑似 bug 时测试按现状断言并在用例注释里标注"钉住现状/待决 bug"（如服务器空房 TTL 清扫、connectionStore 日志封顶 51 条、engine.clear 不清 staySlots），**不要在测试 PR 里顺手修行为**——修复属行为变更，另行提案。
- 纯 UI 组件（React 渲染层）暂不要求测试，靠 `npm run build:vite` + GUI 手动验证兜底。

## 5. Mock 与时间约定

- **时间一律确定性驱动，禁止 sleep 真实时间**：
  - 单元层用 `vi.useFakeTimers()` + `vi.setSystemTime` / `vi.advanceTimersByTime`（Date.now 会一并被接管）；
  - 服务器 TTL 类逻辑用"注入 now 参数"模式（`server.sweepRooms(Date.now() + 25h)`），零 flaky；
  - 等异步生效用轮询条件（`tests/helpers.ts` 的 `waitUntil`），不用裸 `setTimeout` 等待。
- **单元测试 mock 到系统边界为止，不 mock 被测系统内部**：Room 测试用最小 fake socket `{ readyState, send: vi.fn(), close: vi.fn() }`；store 测试 mock `ServerConnection` 模块、spyOn `danmakuEngine` 单例。
- **集成测试不 mock**：服务器集成测试用真实 ws 客户端连 `port: 0` 临时端口（避免 CI 端口冲突），afterEach `await server.close()`。
- **`import.meta.env` 用 `vi.stubEnv`**（配置里已开 `unstubEnvs` 自动还原）。注意 vitest 走 vite env 管线，本机 `.env.local` 会泄漏进测试——测"未配置"分支必须**显式 stub 空串**建基线，不能依赖变量缺席（见 serverConfig.test.ts）。
- **Web API 缺失就手工 stub**：happy-dom 没有 speechSynthesis，TTS 测试用 `vi.stubGlobal` 注入 FakeUtterance 与 mock synth（已开 `unstubGlobals` 自动还原）。
- **Zustand store 用例间用 `setState` 重置切片**；模块级单例状态（如 ttsService 的去重集合）用专门的 `__resetXxxForTests` 钩子清理。

## 6. 可测性设计原则（本仓库踩过的坑）

写新代码时遵守这些，测试才写得动：

1. **禁止 import 副作用**：模块顶层不得启动服务器/定时器/网络连接。可执行入口用守卫：
   ```ts
   // typeof require 前置判断必须——vitest 会把 CJS 转 ESM，裸引用 require 会 ReferenceError
   if (typeof require !== 'undefined' && require.main === module) { new DanmakuServer(); }
   ```
   （server.ts 曾 import 即监听端口，是接入测试时最大的重构点；**不得恢复顶层 `new DanmakuServer()`**。）
2. **写死的常量改构造参数注入**，默认值 = 生产值（`DanmakuServerOptions` 的 maxRooms/maxRoomsPerHost 等）。
3. **模块级读 env 改调用时求值**（updates-static 的 `getUpdatesDir()` 教训：顶层 `const` 快照让测试无法注入目录）。
4. **网络组件必须支持 `port: 0`** 并提供 `ready()` / `close()` / `getXxxPort()`，测试才能并行、才能收尾。
5. **定时器句柄要持有**（close 时 clearInterval），**回调主体抽成可直接调用的方法**并接受 `now` 参数（`sweepRooms(now)` 模式）。
6. **模块私有状态留测试重置钩子**（`__resetVoiceDanmakuStateForTests` 模式，注释注明生产代码不得调用）。
7. **外部输入留注入缝**：如客户端 IP 解析 `resolveClientIp`——测试里所有连接都来自 127.0.0.1，没有这个缝就无法模拟多用户（服务器按 IP 分配 userId）。
8. **UI 里的业务逻辑抽成 DI 工厂纯函数**（App.tsx 接收回调 → `incomingDanmaku.ts` 的 `createIncomingDanmakuHandler(deps)` 模式），组件里只剩接线代码。

## 7. 与现有验证流程的关系

vitest 是新增的一环，**不替代**原有验证，改完代码的完整验收顺序：

1. `npm test`（根 + danmaku-server，两边全绿）；
2. `npx tsc -p tsconfig.json --noEmit` 与基线比对（3 条历史遗留错误，验"无新增"；**按错误内容比对而非行号**——行号会随代码增删漂移。可用 `/test` skill 的 `--types` 阶段自动比对）；
3. `npm run build:vite` 编译通过；
4. 涉及 GUI 的改动：手动验证步骤写进 docs/ 报告，由用户在桌面端执行（headless 限制只针对 Electron GUI）。

## 8. 当前覆盖范围（2026-07-07）

| 范围 | 测试文件 | 用例数 |
|---|---|---|
| 客户端 services | danmakuEngine / serverConfig / ttsService / incomingDanmaku | 约 60 |
| 客户端 stores | danmakuStore / settingsStore / connectionStore | 约 50 |
| 服务器 | room（单元）/ server（集成）/ updates-static（集成） | 59 |

**有意不测**（性价比低，留待将来）：connectionStore 的 createRoom/joinRoom/switchRoom 完整网络编排流、React 组件渲染层、main 进程（updater/IPC，依赖 Electron 运行时）。
