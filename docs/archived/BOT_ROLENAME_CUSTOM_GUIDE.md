# 吐槽姬角色名自定义功能文档

- **日期**：2026-07-10
- **分支**：`dev`（提交 `d2cba10`）
- **需求来源**：GitHub issue #4 延伸需求——用户希望"桌宠"（经确认即吐槽姬）的名称可自定义，方便在弹幕里 `@名字` 触发它（吐槽姬整体功能见 `docs/archived/ROAST_BOT_GUIDE.md`）

## 功能说明

吐槽姬 Tab 人设编辑区新增**角色名**输入框（带 `n/10` 字数提示）：

- **保存修改**：校验通过后连同人设/风格一起回写当前角色，改名立即生效——弹幕中 `@新名字` 即可触发吐槽（触发匹配 `botService.ts` 动态取 `activePersona.roleName`，无需额外改动），面板提示文案同步更新
- **存为新角色**：填了名字直接使用（跳过 LLM 起名，省一次 API 调用且所见即所得）；留空则保持原行为由 LLM 自动起名
- 默认人设（吐槽姬）同样允许改名

## 校验规则（`botStore.validateRoleName`）

| 规则 | 提示 |
|------|------|
| trim 后非空 | 角色名不能为空 |
| 至少 2 字 | 角色名至少 2 个字（太短容易误触发 @ 提及——匹配是 `includes('@'+名字)` 子串） |
| 最多 10 字 | 角色名最多 10 个字 |
| 与其他人设不重名（excludeId 排除自身） | 角色名已被其他人设占用，换一个吧 |

放在 store 层做成导出纯函数，便于脱离 React 渲染直接单测（仓库无组件测试基础设施）。

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/renderer/stores/botStore.ts` | 新增导出纯函数 `validateRoleName`（`updatePersona` 的 patch 类型本就支持 roleName，主体未动） |
| `src/renderer/components/BotPanel.tsx` | `roleNameDraft` 草稿态（随切换人设重置）；角色名输入框；`handleSaveCurrent` 校验并回写；`handleSaveAsNew` 填名直用/留空 LLM 起名 |
| `src/renderer/stores/botStore.test.ts` | 新建，11 个用例：roleName 改名与持久化、default 允许改名、校验规则全覆盖 |

## 已知边界（有意不处理）

- 重名判断为 trim 后精确相等，不做全半角/大小写归一化
- 新名字若与真实观众网名重合，`botService` 的 botNames 过滤会把该观众弹幕一并从吐槽上下文排除——现有机制既有副作用，非本次引入

## 验证

已完成：

1. ✅ `botStore.test.ts` 11 用例通过；客户端全量 vitest 通过
2. ✅ tsc 与基线一致（3 个历史遗留错误）无新增

桌面端手动验证步骤（`npm start`）：

1. 吐槽姬 Tab 修改角色名并保存 → 提示"已保存到「新名字」"，`@新名字` 提示文案联动
2. 房间内发弹幕 `@新名字 你怎么看` → 触发吐槽回应
3. 空名/单字/超 10 字/与其他人设重名 → 分别被拦截并提示
4. 留空角色名"存为新角色" → 仍由 AI 自动起名
