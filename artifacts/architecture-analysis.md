# Poracode（AgentEmployee）架构分析报告

> 只读勘察，未修改任何源码。仓库根：`D:\code\Poracode-master`。版本：`agentemployee@1.8.1`。
> 目的：为"数字员工"改造（员工档案 / 团队编排 / 可视化办公室）提供事实基础。

---

## ① 仓库地图（目录 + 职责）

### 根级配置
- `package.json`：Electron 44.0.0 壳；React 19.2.8 + `@heroui/react@3.2.4`；Lingui 6.6（i18n）；`better-sqlite3@13` + `node-pty`；Zod 4.5、zustand 5、`@tanstack/react-router` 1.170、xterm.js 6.1 beta；React Compiler（`babel-plugin-react-compiler@1.0.0` 精确钉版）。
- `pnpm-workspace.yaml`：workspaces = `.`、`website`、`packages/agents-usage`、`packages/codex-protocol`；`minimumReleaseAge` 供应链守卫。
- `AGENTS.md` / `CLAUDE.md`：同一套硬规则（PTY/GUI 双通道、renderer 不得 spawn agent、provider-agnostic、React Compiler、i18n 12 语言全量翻译、版本边界审计）。`CODEX.md` 为通用编码纪律。
- `.agents/docs/`：`architecture.md`、`agent-adapters.md`（provider 隔离硬规则 + 新 provider 清单）、`skills-plugins-mcp.md`、`editing-rules.md`、`versioning.md`、`ui-patterns.md`、`i18n.md`。

### `src/main/`（Electron 主进程）
| 文件/目录 | 职责 |
|---|---|
| `main.ts` / `preload.ts` | 应用入口、context-isolated 桥 `window.agentemployee` |
| `db/connection.ts`（334 行） | better-sqlite3 连接 + 建表 DDL（projects/threads/app_state/…） |
| `db/migrations.ts`（1000 行） | 全部 schema 迁移（含 stream chunks、tasks、pr_watches 等） |
| `sharedSettingsFile.ts` | **sealed settings 读写器**：`agentInstances`、`agentSettings`、`mcpServers` 持久化于此 |
| `supervisor/` | fork supervisor 子进程、转发 webContents 事件 |
| `ipc/`、`threads/`、`gitState/`、`tasks/`、`remote/`、`ssh/`、`browser/`、`mcp/` | 主进程侧 IPC 处理器与远程/移动端服务 |

### `src/supervisor/`（fork 出的 Node 进程，独占所有 agent 进程）
| 文件/目录 | 职责 |
|---|---|
| `index.ts`（114 行） | IPC dispatcher（UUID request/reply，Zod 在主进程预校验） |
| `ipcHandlers.ts`（~500 行） | 线程启动/输入/中断等命令表 |
| `supervisorRuntime.ts`（1064 行） | agent 注册表装配、状态缓存、spawn 调度中枢 |
| `runtime/threadSessionManager.ts`（**1653 行，god file**） | 单会话所有者：PTY 与 structured session 双通道状态机 |
| `runtime/threadSession/spawnPipeline.ts`（1639 行） | 启动管线：argv 组装、WSL 包装、env 注入、MCP 挂载 |
| `runtime/threadSession/`（子目录 27 文件） | ptyLifecycle、sessionRuntimeLifecycle、structuredTurnQueue、steerCoordinator、followUpQueueCoordinator、subAgentRegistry 等 |
| `runtime/agentRegistryService.ts`（733 行）/ `agentStatusService.ts` | 注册表与 per-environment 安装/认证状态 |
| `runtime/threadOutputPipeline.ts`（762 行） | 运行事件 → 渲染器转发 |
| `agents/` | **provider 插件目录**（见 ③） |
| `crossagentMcp/`（见 ⑦ 团队编排） | 子线程编排：`toolRegistry.ts`（991）、`SubagentRunManager.ts`（1074）、`spawnPlan.ts`、`oneShotChild.ts`、`CrossagentMcpIngress.ts` |
| `git.ts`、`github.ts`（1270 行） | 直接 execFile git，无 simple-git |
| `workflows/transcriptReader.ts` | workflow manifest 读取（子代理计数） |

### `src/renderer/`（React 渲染层，只允许通过 IPC 操作）
- `state/`：70+ zustand store（`appStore.ts`、`workspaceStore.ts`、`scenarioInputsStore.ts`、`threadLiveWorkflowStore.ts`、`workflowRunStore.ts`、`subAgentSelectors.ts` …）；`dbStorage.ts` 是 SQLite 持久化桥。
- `components/layout/`：`PageLayout.tsx`、`SplitPaneContainer.tsx`、`UnifiedRightPanel.tsx`、`MainView/`、`HomeView.tsx`、`SettingsOverlay/`、`TasksView/`、`WelcomeOverlay.tsx`。
- `components/composer/`、`components/thread/`：输入区与聊天/终端呈现。
- `components/providers/<kind>/`：21 个 provider UI 插件（manifest + Icon + 注册）。
- `components/scenarios/` + `src/renderer/scenarios/`：场景卡片与目录（见 ⑥）。
- `actions/scenarioActions.ts:176`：`startScenario()`。
- `locales/`：`en` + 12 个非英语目录（zh-CN/ja/ko/fr/de/es/pt-BR/ru/uk/pl/vi/tr）。

### `src/shared/`（Zod schema + 类型 + IPC 契约）
- `contracts/thread.ts`、`workspace.ts`、`scenario.ts`、`config.ts`、`agentInstance.ts`、`common.ts`、`agent.ts`、`project.ts`、`mcpServer.ts`、`skill.ts`、`task.ts`、`runtimeEvent.ts`。
- `ipc/bridge.ts`：`AgentEmployeeBridge` 类型，经 `ipc.ts` barrel 导出。

---

## ② 核心数据模型（含文件路径）

**Thread（会话）** — `src/shared/contracts/thread.ts:24` `threadSchema`
- 关键字段：`id`、`projectId`、`workspaceId?`、`title`、`agentKind`、`agentInstanceId?`、`config: ThreadConfig`、`status`、`attention`、`sessionRef?`、`presentationMode?: "terminal"|"gui"`、`parentThreadId?`、`groupId?/groupName?`、`archived/done/starred`。
- `ThreadConfig`（`src/shared/contracts/config.ts`）：`model`、`effort?`、`contextSize?`、`mode?`、`approvalPolicy?`、`sandboxMode?`、`browserMcp/computerUse/chromeMcp?`、`knowledgeBaseId?`、`executionEnvironment?`。
- 持久化：SQLite `threads` 表（`src/main/db/connection.ts:85`）；运行行存 `thread_runtime_items` + `thread_runtime_item_stream_chunks`；经 renderer `appStore` + `dbStorage` 桥同步。

**Workspace（工作区/项目分组）** — `src/shared/contracts/workspace.ts:32`
- 字段：`id/name/icon/category?: ScenarioCategory/defaultScenarioIds?: string[]`。
- 持久化：**renderer localStorage**（`state/workspaceStore.ts` zustand `persist` + `createJSONStorage(() => localStorage)`），不在 SQLite。
- 默认种子：`DEFAULT_WORKSPACE_NAMES = ["通用任务","文档编写","软件编码","软件测试"]`。

**Scenario（场景/任务模板）** — `src/shared/contracts/scenario.ts:20` `ScenarioDefinition`
- 仅 `id/category/relatedSkillIds?/relatedPluginIds?/enableMcpServerIds?`，**不含任何用户可见文案、不含 provider/model**。
- 展示层副本：`src/renderer/scenarios/catalog.ts:177` `SCENARIOS: ScenarioView[]`（19 个内置场景），文案/`prompt`/`steps`/`requiredInputs`/`outputModes`/`leadingSkillId` 都在这里。**无持久化，硬编码目录**。

**AgentInstanceConfig（provider 实例/Profile）** — `src/shared/contracts/agentInstance.ts:56`
- 字段：`id/driver/displayName?/icon?/accentColor?/enabled?/environment?/config?`。
- 用途：① `acp-generic:<id>` 注册任意 ACP 二进制；② 多 profile（`AGENT_PROFILE_DRIVERS`，当前 cursor）。
- 持久化：主进程 sealed settings 文件（`src/main/sharedSettingsFile.ts`，`settings.agentInstances`）。

**SQLite 表清单**（`db/connection.ts` + `db/migrations.ts`）：`projects`、`threads`、`app_state`、`thread_runtime_items`、`thread_runtime_item_stream_chunks/state`、`thread_completed_turns`、`thread_context_usage`、`project_notes`、`usage_events`、`usage_token_ledger/samples`、`scheduled_tasks/runs`、`tasks/task_runs/task_drafts`、`pr_watches`、`remote_command_receipts`。

---

## ③ Provider 抽象与注册机制

**适配器接口** — `src/supervisor/agents/base/types.ts:765` `AgentAdapter`，组合自：
- `AgentMetadata`：`kind/label/capabilities（models/modes/approvalPolicies/presentation mode/live input mode）/baseSpawnEnv?/firstClassAcpRegistryId?`
- `AgentLauncher`：`buildLaunchArgv()/buildResumeArgv()/createInitialSessionRef()`
- `AgentDetector`：`detectInstall(ctx)`（基于 `DetectionSpec` 由引擎统一探测 WSL/native）
- `AgentTerminalObserver`：`detectTerminalStatus/detectAutoResponse/discoverSessionRef…`
- 可选 `createStructuredSession()` → `StructuredSessionHandle`（`types.ts:128`：`startTurn/steerTurn/interruptTurn/controlGoal/setListener/dispose/readThread/rollbackThread…`）

**注册表** — `src/supervisor/agents/registry.ts`
- `createAgentRegistry()` / `buildAgentRegistryEntries(userInstances, options)`；builtIns 顺序固定：cline → gds-agent → dsh-agent → copilot → codex → gemini → qwen → qoder → grok → kimi → muse → antigravity → commandcode → cursor → opencode → opencode2 → pi → factory。
- 用户实例：`acp-generic` driver 经 `createAcpGenericAdapter` 入列；`profileAdapterFactories = { cursor: createCursorProfileAdapter }`。
- 守卫：`registry.test.ts` 目录 parity + kind 唯一；`src/supervisor/agents/acp/providerIsolation.test.ts` 禁止共享 ACP 代码出现 provider 名。

**Renderer 插件** — `src/renderer/components/providers/<kind>/`：`<Kind>Icon.tsx`、`manifest.ts`（`RendererProviderManifest`）、`index.tsx`（`registerProviderIcon/registerComposerControls/registerCommitGenDefaults…`）；由 bootstrap 文件系统自动发现。

**隔离三逃生门**（agent-adapters.md）：①声明式 capability flag；②`AcpSessionBehavior` 命名选项；③provider 自有 hook（`AcpTextStreamExtension`/`acpSessionUpdateTransform` 等）。新 provider 对共享文件**零改动**。

---

## ④ Runtime 双通道（PTY / structured）组织

- **PTY 通道**：`runtime/threadSession/ptyLifecycle.ts` + `spawnPipeline.ts`；底层 `nodePty.ts`；WSL 经 `wsl.exe -d <distro> --cd <path> --exec` 包装。terminal-presentation 线程必须挂真实 PTY 进程。
- **Structured/GUI 通道**：adapter `createStructuredSession` 返回 `StructuredSessionHandle`；`sessionRuntimeLifecycle.ts`、`structuredTurnQueue.ts`、`steerCoordinator.ts`（运行中转向）、`followUpQueueCoordinator.ts`（排队发言队列）。
- **进程归属铁律的代码落实**：renderer 一切启动走 IPC `startThreadPayload`（`thread.ts:198`）→ 主进程校验 → fork 出的 supervisor `index.ts` dispatcher → `supervisorRuntime.ts` → `threadSessionManager.ts`；renderer 侧无任何 spawn 调用点。事件回流：`threadOutputPipeline.ts` → `webContents.send`。
- 活动呈现面是事实来源：terminal 线程由 TUI 启发式（`detectTerminalStatus`）推状态，gui 线程由 `StructuredSessionUpdate` 推状态。

---

## ⑤ UI 与 i18n 现状

- 布局：`layout/PageLayout.tsx` + `SplitPaneContainer.tsx` + `UnifiedRightPanel.tsx`；视图级 Home/Settings/Tasks 与 Overlay 体系（`OverlayShell.tsx`）。
- 场景 UI：`components/scenarios/ScenarioCard.tsx`、`ScenarioGuideCard.tsx`、`ScenarioInputsPanel.tsx`、`ScenarioOutputModePicker.tsx`。
- i18n：Lingui v6，仅扫描 `src/renderer`；JSX 用 `<Trans>`、组件内用 `useLingui()` 的 `t`、模块级 `msg`；主/supervisor 侧字符串走 `src/shared/messages.ts` + `renderer/i18n/sharedMessages.ts`。新增文案必须 `pnpm i18n:extract` 后填满 12 个非英语 `msgstr`。
- 状态持久化二分：SQLite（`appStore`、`threadTodoDockStore`）vs localStorage（`workspaceStore`、`sidebarUiStore`、`sharedSettingsStore` 等）。

---

## ⑥ "场景"现状解读：用户概念 ↔ 代码现实对照

**用户设想**："当前每一个场景就是一类员工，赋予不同的 provider 和后台模型就是不同的员工。"

**代码现实——这个映射不成立，三者是正交的：**

1. **Scenario（场景）= 纯任务模板，与"谁"完全无关。**
   - `ScenarioDefinition`（`shared/contracts/scenario.ts:20`）只有 id/category/技能/MCP 开关；`ScenarioView`（`renderer/scenarios/catalog.ts:101`）再加 prompt/steps/输入要求/输出模式。
   - `startScenario()`（`renderer/actions/scenarioActions.ts:176`）做的唯一事情：把 prompt 预填进 composer draft、挂上 requiredInputs 收集面板、（可选）inline document template。它**不创建线程、不选 provider、不选模型**。用户发消息时仍要在 composer 的 provider/model 选择器里挑一个。
   - 即：场景是"干什么活的说明书"，不是"谁来干"。

2. **Workspace（工作区）= 项目分组，只是场景卡片的过滤器。**
   - `Workspace.category + defaultScenarioIds`（`workspace.ts:43-45`）只决定"这个工作区侧边栏/首页默认露出哪几张场景卡片"。它不含 provider、不含模型、不含人。

3. **"员工身份"在今天最接近的对应物是两个片段的乘积，且无独立实体：**
   - **Thread 级**：`threadSchema.agentKind + agentInstanceId + config.model`（`thread.ts:40-43`）——一次会话绑定一个 provider+模型，但 thread 是**一次性会话记录**，不可复用为"档案"。
   - **Instance 级**：`AgentInstanceConfig`（`agentInstance.ts:56`）已经有 `displayName/icon/accentColor/environment`——**外观与身份字段已经存在**，但它的语义是"某个 provider 的第二个账号/第二条 ACP 二进制"，不含人设、职责、默认模型、能力标签、权限。
   - **结论**：当前代码里不存在"员工"这个一等概念。最接近的是 thread（=一次雇佣关系的发生）× instance（=provider 凭证档案）。要做数字员工，必须**新增一个独立于 thread 和 instance 的 EmployeeProfile 实体**，把"场景（干什么）× provider+模型（谁来干）× 人设/权限（怎么干）"三者显式绑定成可复用档案——而不是把现有 scenario 直接改造成员工。

---

## ⑦ 数字员工改造挂载点清单（具体文件 + 建议）

### A. 新增"Employee 档案"实体（名字/角色/人设/职责/provider/模型/能力标签/权限）

| # | 挂载点 | 文件路径 | 建议动作 |
|---|---|---|---|
| A1 | 新 contract | 新建 `src/shared/contracts/employee.ts`（并挂 `src/shared/contracts/index.ts` barrel） | `EmployeeProfileSchema`（zod）：`id/name/roleTitle/persona/systemPrompt/responsibilities/providerKind/agentInstanceId?/defaultThreadConfig（model/effort/mode/approvalPolicy）/skillIds[]/capabilityTags[]/permissions{}/accentColor/icon`。**共享概念，不得写 provider 分支**。 |
| A2 | 持久化 | `src/main/sharedSettingsFile.ts` | 在 sealed settings 里新增 `employeeProfiles` map（与 `agentInstances` 同级、同生命周期）；按 `versioning.md` 清单 bump 格式版本 + 迁移。**不要**直接塞 threads 表——档案是跨会话的。 |
| A3 | 渲染层 store | 新建 `src/renderer/state/employeeStore.ts` | 仿 `workspaceStore.ts`（persist 桥到主进程 settings，而非 localStorage——档案含敏感 provider 绑定）。 |
| A4 | 启动管线（关键） | `src/renderer/actions/scenarioActions.ts:176 startScenario()` + composer provider 选择区（`components/composer/`） | startScenario 之后、生成 `startThreadPayload` 之前插入"员工绑定"：由 employee 解析出 `agentKind/agentInstanceId/config`。Thread schema 增 `employeeId?` 字段（`thread.ts:24`）→ threads 表加列（`db/migrations.ts` 新版本迁移）。 |
| A5 | Supervisor 消费 | `src/supervisor/runtime/threadSession/spawnPipeline.ts` + `supervisorRuntime.ts` | 组装 launchConfig 时按 `employee.defaultThreadConfig` 覆盖；保持 provider-agnostic——employee 是共享层概念，这里只读 employeeId，不出现任何 provider 名。 |
| A6 | 员工管理 UI | `components/layout/SettingsOverlay/parts/`（旁置 `agentRegistryNative.ts`） | 新增 employees parts：CRUD 档案、选 provider（复用现有 provider 选择器）、选模型（复用 capabilities 声明列表）。 |
| A7 | i18n | `src/renderer/locales/{12 语言}/messages.po` | 所有新文案 Trans/msg 包裹 + extract + 填译文。 |

### B. 新增"团队编排"（多员工组队、主管派活、轮转/委派发言）

**可直接复用的现有能力：**
- `src/supervisor/crossagentMcp/` 全套：`toolRegistry.ts`（MCP `create_thread` 工具，991 行）、`SubagentRunManager.ts`（1074 行）、`spawnPlan.ts`、`oneShotChild.ts`、`subAgentRegistry.ts`——**子线程动态创建与回收已经存在**。
- `threadSchema` 已有 `parentThreadId`（`thread.ts:78`）、`groupId/groupName`（`thread.ts:51-52`）——父子线程 + 侧边栏分组已支持。
- `threadSession/followUpQueueCoordinator.ts`——单线程内排队发言/转向队列。
- `state/workflowRunStore.ts` + `threadLiveWorkflowStore.ts`——workflow manifest 轮询（子代理计数）。
- `remoteThreadCommandSchema`（`thread.ts:398`）已有 `start/set-group` 等元数据命令，是远程/编排端创建线程的现成协议。

**缺口与新增挂载点：**
| # | 挂载点 | 建议 |
|---|---|---|
| B1 | 新 contract `src/shared/contracts/team.ts` | `TeamSchema`（id/name/memberEmployeeIds[]/managerEmployeeId?/dispatchPolicy: round-robin\|free-for-all\|manager-assigns）。 |
| B2 | 新 supervisor 模块 `src/supervisor/crossagentMcp/teamOrchestrator.ts` | 中央调度器：目前子线程由父 agent 自发经 MCP 创建，**无中央编排**；新增 team 级任务队列、委派路由（把 user 消息按 policy 投递给成员 employee 的线程）、发言轮转。 |
| B3 | IPC | `src/supervisor/index.ts` dispatcher + `src/shared/ipc/bridge.ts`（`AgentEmployeeBridge`）新增 `startTeam/dispatchTeamTask/assignTeamMember`。 |
| B4 | 持久化 | team 定义入 sealed settings（`sharedSettingsFile.ts`）；team 运行态入 SQLite（`db/migrations.ts` 新表 `teams/team_memberships`，仿 `tasks/task_runs`）。 |
| B5 | UI | 侧边栏（layout sidebar）按 team 分组展示员工线程；复用 `threadSubAgentDockStore` 展示子任务。 |

### C. 新增"可视化办公室"界面（员工渲染成办公室角色）

| # | 挂载点 | 建议 |
|---|---|---|
| C1 | 新视图 | `src/renderer/components/layout/` 下新建 `OfficeView/`（与 `HomeView.tsx`、`TasksView/` 同级），经 `@tanstack/react-router` 路由或 `UnifiedRightPanel`/侧边栏入口切换。 |
| C2 | 数据源 | 员工身份 ← `employeeStore`；"谁在工作" ← `runtime/agentStatusService.ts`（per-agent status）+ `state/threadLiveWorkflowStore.ts`（活跃 turn）；线程 ← `appStore`。 |
| C3 | 角色形象 | **零新资产**：员工头像直接复用 `components/providers/<kind>/<Kind>Icon.tsx` 已注册的 provider icon + `AgentInstanceConfig.accentColor`；工位状态色映射 `ThreadStatus`（idle/working/needs_approval/error）。 |
| C4 | 交互 | 点击工位 → 切到该员工的活跃 thread 视图；复用现有 thread 切换逻辑，不新造导航。 |

---

## ⑧ 模块规模统计（关键文件 LOC，2026-10-09 实测）

| 文件 | LOC | 说明 |
|---|---|---|
| `src/supervisor/runtime/threadSessionManager.ts` | 1653 | 会话状态机 god file（PTY+structured 双通道） |
| `src/supervisor/runtime/threadSession/spawnPipeline.ts` | 1639 | 启动管线 |
| `src/supervisor/supervisorRuntime.ts` | 1064 | 调度中枢 |
| `src/main/db/migrations.ts` | 1000 | schema 迁移全集 |
| `src/supervisor/crossagentMcp/toolRegistry.ts` | 991 | 子线程 MCP 工具 |
| `src/supervisor/crossagentMcp/SubagentRunManager.ts` | 1074 | 子线程运行管理 |
| `src/supervisor/agents/base/index.ts` | 938 | adapter 引擎 |
| `src/supervisor/agents/base/types.ts` | 826 | AgentAdapter 契约 |
| `src/renderer/scenarios/catalog.ts` | 787 | 19 个场景目录 |
| `src/supervisor/runtime/threadOutputPipeline.ts` | 762 | 事件管线 |
| `src/supervisor/runtime/agentRegistryService.ts` | 733 | 注册表服务 |
| `src/shared/contracts/thread.ts` | 588 | 线程契约 |
| `src/main/db/connection.ts` | 334 | 建表 |
| `src/renderer/state/workspaceStore.ts` | 268 | 工作区 store |
| `src/shared/contracts/workspace.ts` | 176 | 工作区契约 |
| `src/supervisor/agents/registry.ts` | 188 | provider 注册表 |
| `src/renderer/state/appStore.ts` | 156 | 主 store |
| `src/supervisor/index.ts` | 114 | IPC dispatcher |

> 改造估时参考：Employee 档案（A1–A7）以新增为主，触碰面小但横跨 shared/main/supervisor/renderer 四层；团队编排（B）复用 crossagentMcp 已完成约 60% 的子线程机制，主要新增中央调度器；Office UI（C）为纯 renderer 新视图，风险最低。所有持久化边界（settings 文件版本、threads 新列、teams 新表）必须按 `.agents/docs/versioning.md` 走版本 bump + 迁移 + 回归测试。

---

## ⑨ 工作区→员工岗位映射（新口径补充）

> 新口径：**一个 Workspace = 一个员工/岗位**（"文档编写工作区"即"文档编写员工岗位"）；**一个 Scenario = 该岗位生命周期内的一次任务实例**，不是岗位的定义单元；岗位内部聚合多种能力。
> 本节同时修正 ② 的一处精度问题：workspaces **列表**持久化在 `sharedSettingsStore` → 主进程 `src/main/sharedSettingsFile.ts`（sealed settings，跨窗口共享）；`src/renderer/state/workspaceStore.ts`（localStorage，key=`agentemployee-active-workspace`，version 1）只存 `activeWorkspaceId` 与 `lastProjectIdByWorkspace` 两个 UI 态。

### 9.1 Workspace 实体与"员工岗位"的差距

现有 `Workspace`（`src/shared/contracts/workspace.ts:32`）字段：`id/name/createdAt/icon/category?/defaultScenarioIds?`。对照岗位定义，差距与补法：

| 岗位需要的维度 | 现状 | 要动的文件 / 加的字段 |
|---|---|---|
| 岗位名 | `name` 已有 | 无需动；UI 标签从"工作区"改"岗位/员工"即可 |
| 人设/职责描述 | 无 | `workspaceSchema` 加 `persona?: z.string().optional().catch(undefined)`、`responsibilities?: z.string().optional().catch(undefined)`（沿用现有 `.catch(undefined)` 容错模式，`workspace.ts:56-57`） |
| 聚合能力集 | 只有 `defaultScenarioIds`（可见场景过滤） | 加 `skillIds?: string[]`（该岗位绑定的 `/skill` 集）、`capabilityTags?: string[]`（展示用能力标签，对应 scenario 的 `relatedSkillIds`） |
| provider+模型默认绑定 | 无 | 加 `agentKind?: agentKindSchema.optional()`、`agentInstanceId?`（复用 `agentInstanceIdSchema`）、`defaultThreadConfig?: threadConfigBaseSchema.optional()`（model/effort/mode/approvalPolicy——直接复用 `src/shared/contracts/config.ts` 的 `threadConfigBaseSchema`，零新 schema） |
| 权限 | 无 | 加 `permissions?: z.object({...}).optional()`（如 `allowComputerUse/requireApproval`，映射到 threadConfig 同名开关） |

连锁文件：
- `src/shared/contracts/workspace.ts`：schema 扩展（全部 optional + `.catch`，向后兼容）。
- `src/renderer/state/sharedSettingsStore.ts`：settings shape 与 mutator（`setWorkspaces` 路径，现有 `setScenarios` 变更在 `sharedSettingsStore.ts:1011-1012` 可参照）。
- `src/main/sharedSettingsFile.ts`：sealed settings 版本 bump + merge 逻辑（`agentInstances` 同款白名单合并，见 `sharedSettingsFile.ts:92-117`）。
- `src/renderer/state/workspaceStore.ts`：`buildDefaultWorkspaces()`（:215）与 `backfillDefaultWorkspaceScenarios()`（:192）给 4 个内置岗位补默认 persona/provider 绑定；`bootstrapWorkspaces()` 的 untouched 检测逻辑要把新字段纳入"用户未定制"判定。
- `src/renderer/views/SettingsOverlay/parts/WorkspaceScenariosSection.tsx`（:88 读 `defaultScenarioIds`）：扩展为"岗位编辑页"（人设/能力/provider 绑定）。

### 9.2 能力集组织与场景目录过滤

- **能力集放岗位层**：`skillIds`（岗位级绑定的技能集）+ `capabilityTags`（展示标签）。场景自身仍保留 `relatedSkillIds`（`catalog.ts` 各条目）——岗位过滤 = `岗位.skillIds ∪ 岗位.defaultScenarioIds 指向的 scenario`。
- **现状已有过滤管道**：`defaultScenarioIds` 已被三处消费——`state/workspaceSelectors.ts:74`（selector）、`SettingsOverlay/parts/WorkspaceScenariosSection.tsx:88`（编辑）、`MainView/parts/Sidebar/parts/SidebarScenarioList.tsx`（侧边栏场景列表）。新口径下这条管道**天然就是"按岗位过滤可见场景"**，只需把数据源从 workspace 字段换成扩展后的岗位字段，无需新管道。
- 场景目录 `src/renderer/scenarios/catalog.ts`（`SCENARIOS`、`scenariosByCategory()`、`scenarioById()`）**不动**；过滤仍发生在消费侧。

### 9.3 岗位承接多场景任务实例：startScenario 的变化

现状：`startScenario(scenario, projectId?)`（`src/renderer/actions/scenarioActions.ts:176`）只预填 draft，不绑人。新口径下：
- **岗位即当前工作区**：`useActiveWorkspaceId()`（`workspaceStore.ts:95`）返回的就是岗位 id。startScenario 启动任务实例时：
  1. draft 的 `agentKind/agentInstanceId/config` 默认取自当前岗位的 `agentKind/defaultThreadConfig`（用户仍可在 composer 覆盖）；
  2. 生成 thread 时写入 `employeeId = activeWorkspaceId`——**注意 `threadSchema` 已有 `workspaceId?`（`thread.ts:38`）且语义就是"该 Home 线程创建时所在的工作区"**，新口径下它直接兼任 employeeId，无需新增列；项目线程的岗位归属经 `project.workspaceId`（`isProjectInWorkspace`/`isThreadInWorkspace`，`workspace.ts:152-176`）自动继承。
- 一次"任务实例"= 一个 thread；同岗位可并发多个任务线程（现状本就如此），`parentThreadId/groupId`（`thread.ts:51,78`）继续用于子任务分组。

### 9.4 对原报告 ⑦ 挂载点清单的修订

| 原行 | 修订 |
|---|---|
| A1（新建 `src/shared/contracts/employee.ts`） | **改为**：扩展 `src/shared/contracts/workspace.ts`（见 9.1 表）；不新建平行实体。EmployeeProfile = 扩展后的 Workspace shape。 |
| A2（sealed settings 新增 `employeeProfiles` map） | **改为**：不新增顶层 key；在现有 `workspaces` 数组元素上加 optional 字段，bump settings 版本；`sharedSettingsFile.ts` merge 沿用现有白名单逻辑。 |
| A3（新建 `state/employeeStore.ts`） | **不需要**；复用 `sharedSettingsStore.workspaces` + `workspaceStore.activeWorkspaceId`。 |
| A4（startScenario 插入员工绑定） | **简化**：绑定 = 读当前岗位的 `agentKind/defaultThreadConfig`；`thread.employeeId` 直接复用现有 `thread.workspaceId`，**threads 表不加列**。 |
| A5（spawnPipeline 按 employee 覆盖 launchConfig） | 保留：`spawnPipeline.ts` 组装 launchConfig 时从 thread 所在岗位的 `defaultThreadConfig` 取默认；仍是共享概念、无 provider 分支。 |
| A6（SettingsOverlay 新 employees parts） | 改为扩展现有 `WorkspaceScenariosSection.tsx` 为岗位编辑页。 |
| B（团队编排 member 语义） | **修订**：team 的成员列表 = 岗位 id 集合（即 workspace id）；`SubagentRunManager.ts`/`spawnPlan.ts` 派生子线程时，子线程的 `agentKind/config` 从成员岗位的默认绑定解析；主管岗位（managerEmployeeId）= dispatchPolicy 的路由源。 |
| C（OfficeView 工位） | **简化**：每个工位 = 一个 workspace/岗位卡片；状态色直接读该岗位名下活跃 thread 的 status（`appStore` 按 `workspaceId` 过滤线程即可，现有 `isThreadInWorkspace` 过滤器复用）。 |

### 9.5 演进路径建议：原地扩展，不做新实体+迁移

**建议：原地扩展 Workspace（全部 optional 新字段），不引入平行 Employee 实体、不做存量数据迁移。** 理由：

1. **语义已对齐**：现有 4 个内置工作区（`DEFAULT_WORKSPACE_NAMES = ["通用任务","文档编写","软件编码","软件测试"]`，`workspace.ts:85`）按新口径就是 4 个内置岗位；用户心智中的"岗位"与现有工作区一一对应。
2. **归属机制已存在**：`isProjectInWorkspace`/`isThreadInWorkspace`（`workspace.ts:152-176`）、侧边栏过滤、PR 视图过滤、`lastProjectIdByWorkspace` 全部围绕 workspaceId 运转——岗位化后这些机制零改动。
3. **持久化容错模式现成**：`workspaceInputSchema` 已用 `.catch(undefined)` 容忍旧值（`workspace.ts:56-57`）；新增字段全部 optional，旧 settings 文件直接合法，无需迁移脚本；`bootstrapWorkspaces()` 的 untouched-default 回填机制（:141）负责给存量内置岗位补默认值。
4. **thread 侧零 backfill**：`thread.workspaceId` 直接兼任 employeeId，历史线程归属不断裂；这是新口径相比"新实体"方案最大的省事点。
5. **代价可控**：唯一要克制的是命名——代码层仍叫 `Workspace`，UI 层可叫"岗位/员工"，避免一次跨全仓的 rename；provider 绑定、人设等新字段只在需要时读取。

**不建议"新实体+迁移"的原因**：新实体要求 backfill 全部现有 thread 的归属、维护两套并行归属机制（workspaceId vs employeeId），且与"一个工作区=一个岗位"的口径直接冲突——等于把已经对齐的概念劈成两个。
