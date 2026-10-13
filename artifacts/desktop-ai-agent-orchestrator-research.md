# 桌面端 AI Agent 编排器 / 多 Agent 桌面应用 开源调研报告

> 调研用途：为我方 Electron 桌面 AI agent 编排器（管理 GdsAgent / Codex / Gemini 等，真实 PTY 终端会话 + 结构化聊天 runtime，React + TypeScript）改造为"数字员工"产品形态做选型借鉴。
> 数据抓取时间：**2026-10-09（周五，UTC+8）**。所有 star 数均通过 GitHub REST API（`https://api.github.com/repos/{owner}/{repo}`）实时拉取，非凭记忆；License 同时核对了仓库 LICENSE 文件正文。
> 说明：本报告只做调研，未克隆任何仓库、未修改任何被调研项目的文件。

---

## ① 总对比表（全字段）

| 项目 | 仓库 URL | 语言/技术栈 | 桌面端? | 自定义角色/persona 能力 | 多 agent 团队/编排能力 | 数字员工契合度 | Star（2026-10-09） | License |
|---|---|---|---|---|---|---|---|---|
| **Munder Difflin** ★重点 | github.com/HarnessMD/munder-difflin | TypeScript · Electron · React 18 · node-pty · xterm.js · **Pixi.js** · better-sqlite3 · electron-vite | ✅ 原生桌面（macOS/Win/Linux） | 每个 agent 可配 CLI/模型/自治等级/工位；内置 **Agent Gallery** 一键导入现成角色 | ✅✅ 核心即此：GOD 编排 agent（Michael）路由 + mailbox/inbox/outbox + 共享记忆 + 黑板/任务账本 | **5/5** 本身就是"一间 agent 办公室"，数字员工形态标杆 | **8,610**（fork 1,254） | MIT |
| **5ire** | github.com/nanbingxyz/5ire | TypeScript · Electron 系 · MCP client | ✅ 跨平台桌面 | 自定义助手（prompt/参数）+ 本地知识库 + MCP 工具 | ❌ 基本是单助手，无多 agent 协作编排 | 2/5 单助手桌面客户端，无团队编排 | 5,373 | 修改版 Apache-2.0（Community Edition 附加条款） |
| **Cherry Studio** | github.com/CherryHQ/cherry-studio | TypeScript · Electron · React | ✅ 桌面 | ✅ 强：自定义助手（人设 prompt + 知识库 + 文件 + MCP），助手市场 | ⚠️ 多助手并列管理，但无 agent 间自动协作/组队 | 3/5 数字员工"入口/助手柜"，无真实多 agent runtime | 52,490 | AGPL-3.0 |
| **LobeChat**（已更名 lobehub/lobehub） | github.com/lobehub/lobehub | TypeScript · Next.js | ⚠️ Web 为主，有桌面壳/PWA | ✅✅ 角色广场/助手市场成熟，人设（prompt + 知识库 + 插件 + 知识库）定义完善 | ⚠️ 2026 年定位转向"Chief Agent Operator"，提 hire/schedule/report AI 团队，但仍偏云端/Web | 3/5 人设体系最值得抄，但非桌面 PTY 形态 | 83,080 | LobeHub Community License（自定义，含商用限制） |
| **Open Interpreter**（已更名 openinterpreter/openinterpreter） | github.com/openinterpreter/openinterpreter | **Rust**（原 Python，已重写） | ❌ CLI/本地代码执行 agent | 中：system prompt / 配置化 | ⚠️ 单 coding agent 为主，无办公室式团队编排 | 3/5 本地执行能力强，但非多员工编排器 | 68,534 | Apache-2.0 |
| **Chatbox** | github.com/chatboxai/chatbox（原 Bin-Huang/chatbox） | TypeScript · Electron | ✅ 桌面 | 弱-中：自定义 prompt/角色预设，无角色市场 | ❌ 单聊客户端为主 | 2/5 通用聊天壳，角色能力弱 | 41,979 | GPL-3.0 |
| **NextChat** | github.com/ChatGPTNextWeb/NextChat | TypeScript · Next.js | ⚠️ Web，有移动端/桌面包 | 中：助手/角色（system prompt + 知识库），轻量 | ❌ 聊天，无 agent 编排 | 2/5 轻量 Web 聊天，参考价值低 | 88,840 | MIT |
| **Open WebUI** | github.com/open-webui/open-webui | Python · Svelte | ❌ Web 自托管（浏览器访问） | ✅ personas / 模型工作台 / Functions / Tools | ⚠️ 有 teams/workspace，但为 Web 多用户，非桌面多 agent | 3/5 自托管 Web，persona 体系可参考 | 154,106 | Open WebUI License（自定义，BSD 衍生含商用限制） |
| **Vercel eve** | github.com/vercel/eve | TypeScript | ❌ 服务端/云 agent 框架 | 以"项目/能力"定义 agent | ✅ 子 agent、持久执行、人工审批，但跑在 Vercel 云 | 2/5 框架非桌面数字员工 | 5,504 | Apache-2.0 |
| **Vercel open-agents** | github.com/vercel-labs/open-agents | TypeScript | ❌ 云端后台 coding agent 模板 | 模板化 subagent/tools/skills | ✅ 沙箱编排 + GitHub 集成，云端跑 | 2/5 云端，非桌面 | 5,844 | MIT |
| **EastGenesis / CaoGen**（补充发现） | github.com/opengenesishq/EastGenesis | TypeScript · Electron | ✅ 桌面（macOS/Win/Linux） | 多 provider agent runtime + GUI 自动化 + MCP | ✅ 任务编排 + Git worktree + effect ledger + **3D 办公室工作区** | 4/5 形态极接近我方，且已做 3D 办公室，但很小众 | 117 | AGPL-3.0 |

> 备注：用户原列的 `get5ire/5ire` 仓库 **404 已不存在**（组织 `get5ire` 也 404）。经核实，5ire 的真实仓库为 **`nanbingxyz/5ire`**，且技术栈是 **TypeScript（Electron 桌面）而非 Rust**——用户记忆中的"Rust 多 agent 编排器"与实际不符，已在下文更正。

---

## ② 每项目要点 + 来源链接

### Munder Difflin（重点，详见第③节）
- 一句话：把你已付费的 Claude Code / Codex / Gemini CLI / Grok / Kimi / Qwen / OpenCode 等终端 CLI，变成一间"办公室"里并行干活的数字员工，配 Pixi.js 像素办公室可视化。
- 与我方形态重合度最高：同样 Electron + React + TypeScript + node-pty + xterm.js，只是多了 Pixi.js 地板。
- 来源：https://github.com/HarnessMD/munder-difflin ｜ 主页 https://munderdiffl.in

### 5ire（nanbingxyz/5ire）
- 跨平台桌面 AI 助手 + MCP 客户端，接主流厂商，支持本地知识库与 MCP 工具；内置 MCP server 开关。
- 是"单助手 + 工具"模型，**没有多 agent 团队编排**，离"数字员工办公室"较远。
- 来源：https://github.com/nanbingxyz/5ire ｜ https://5ire.app/ ｜ https://modelcontextprotocol.io/clients.md

### Cherry Studio
- 桌面 AI 生产力工作室：智能聊天、autonomous agent、300+ 预设助手，统一接前沿模型；自定义助手 = 人设 prompt + 知识库 + MCP。
- **借鉴点：助手市场/助手卡片的组织方式**（把"角色"当可管理对象）。AGPL-3.0，商用需注意传染性。
- 来源：https://github.com/CherryHQ/cherry-studio

### LobeChat / LobeHub
- 角色广场、自定义 agent 人设（prompt + 插件 + 知识库）体系最成熟；2026 年官方定位已转向"Chief Agent Operator"——hire（雇佣）、schedule（排班）、report（汇报）整支 AI 团队。
- **借鉴点：角色市场/人设资产沉淀与分发**；但 License 为自定义 Community License（含商用限制），且非桌面 PTY 形态。
- 来源：https://github.com/lobehub/lobehub

### Open Interpreter
- 本地代码执行 agent，已用 Rust 重写为"面向开放模型的 coding agent"；单 agent 执行能力强，无办公室式多员工编排。
- **借鉴点：本地代码执行/沙箱边界设计**。
- 来源：https://github.com/openinterpreter/openinterpreter

### Chatbox
- 通用桌面 AI 客户端，支持自定义 prompt/角色预设，但无角色市场、无多 agent 协作。参考价值有限。
- 来源：https://github.com/chatboxai/chatbox

### NextChat
- 零配置 Web 聊天助手，跨端（Web/iOS/macOS/Android/Linux/Windows），轻量 system-prompt 级角色。无 agent 编排。
- 来源：https://github.com/ChatGPTNextWeb/NextChat

### Open WebUI
- 自托管 Web 界面（Ollama/OpenAI 兼容），personas、Functions、Tools、teams/workspace 完善。是 Web 多用户而非桌面多 agent。
- **借鉴点：persona + 工具（Functions）的抽象分层**。License 为自定义 Open WebUI License（BSD 衍生，商用有限制）。
- 来源：https://github.com/open-webui/open-webui

### Vercel Agent.exe —— 未找到对应公开仓库
- GitHub 搜索 `Agent.exe vercel` 返回 **0 结果**，未发现 Vercel 发布过名为 "Agent.exe" 的公开桌面 agent 仓库。
- Vercel 实际的开源 agent 主线是：**eve**（`vercel/eve`，构建/运行 agent 的开源框架，持久执行 + 沙箱 + 子 agent + 人工审批）、**open-agents**（`vercel-labs/open-agents`，云端后台 coding agent 模板）、**skills** CLI（`vercel-labs/skills`，33.5k★）。均为云端/框架，非桌面数字员工。
- 来源：https://vercel.com/blog/introducing-eve ｜ https://vercel.com/oss

### 补充发现：同赛道"可视化办公室"项目
- **cubicle.run**：munder-difflin 设计血缘上的直接对标（其 DESIGN.md 明确"in the lineage of cubicle.run"）。"给你 AI 团队的迷你像素办公室"，read-only 仪表盘，包装 Claude Code/Codex/Gemini CLI，讲 MCP，npm 包 `@caglarutkuguler/cubicle`；另有 VS Code 扩展 "Ctrl/Cubicles"。
- **EastGenesis / CaoGen**（117★，AGPL-3.0）：vendor-neutral、local-first 的 AI 工作桌面，多 provider agent runtime + GUI 自动化 + MCP + Git worktree + 任务编排 + **3D 办公室工作区**。
- 其它长尾：`pjmbatman/agent-office`（2D 宝可梦风多 agent 桌面）、`lalomorales22/penguin-office`（等距 3D 企鹅办公室）、`Kundara/AgentsOfficeTower`（多层办公楼）、`opencroc/cube-pets-office`。均为个位数/十几 star 的早期个人项目。
- 来源：https://cubicle.run ｜ https://www.npmjs.com/package/@caglarutkuguler/cubicle ｜ https://github.com/opengenesishq/EastGenesis

---

## ③ ★ Munder Difflin 深挖小节

### 是否找到仓库：✅ 已明确找到
- **仓库：https://github.com/HarnessMD/munder-difflin**
- 定位依据：GitHub Search API `q=munder-difflin` / `q=munder+difflin` 均返回同一头部结果，8,610★、TypeScript、MIT，描述为"run an office of claude code/codex like agents on your laptop"。
- 注意：README/badge 中仍指向原作者个人路径 `chaitanyagiri/munder-difflin`，现主体已迁移到组织 **HarnessMD**（公司站 harnessmd.com / munderdiffl.in）。两者指同一项目。
- 创建于 2026-05-31，最近 push 2026-10-09（极活跃），当前版本 v0.5.3（pre-release）。

### 它到底是什么形态
- **不是纯 UI 概念项目，而是真·多 agent 桌面 harness**。它把已有的终端 coding CLI（`claude`、`codex`、`grok`、`kimi`、`qwen`、`opencode`、`crush`、`pi`、`copilot`、Cursor 等，外加自定义命令）每个都作为**真实 node-pty 进程**拉起，再把它们组织成一个"办公室"。
- 架构（README 原文 ASCII 图）：
  - 你只跟 **GOD agent（Michael，"你的克隆体"）** 说话；
  - Michael = orchestrator/supervisor：roster、路由、裁决、黑板（blackboard）、任务账本；
  - 它把任务 assign/route/escalate 给下层 agent A/B/C；
  - 共享 hive = 本地 git 仓库里的纯文件：每个 agent 写自己的 `outbox/`，router 投递到对方 `inbox/`（单提交者设计避免 index.lock 冲突）；
  - 只有花钱、破坏性操作、范围变更等才进入人工审批队列。
- 每个 agent 配备：独立工作目录 + 身份 + 长时记忆（markdown-first + 语义召回索引，"MemPalace"）+ 邮箱 + 一个工位。

### 视觉风格（已下载官方截图 docs/media/floor.png 亲验）
- **2D 俯视像素风办公室**（Pixi.js 渲染），不是地图/不是 3D。
- 画面构成：
  - **左侧主画布 = 办公室地板**：米白/奶油色墙面 + 绿色地砖，摆着工位、显示器、办公椅、绿植、饮水机、复印机、茶水间、会议室长桌。
  - **AI 员工 = 像素小人 avatar**，坐在/走到工位前干活；头顶飘气泡状态标签：`idle` / `awaiting` / `starting up` / `working`；agent 间通信时"信封 desk-to-desk 飞"。
  - **右侧 = Command Center**：奶油底 + 等宽字体（neo-brutalist），一排 tab（terminal / monitor / tasks / ask me / triggers / memory / graph / activity / commands / workers），下方是实时 PTY 终端流（带 ctx 用量 gauge、bypass permissions 状态），底部 "Message Michael" 输入框。
  - **底部 = agent 卡片条**：MICHAEL(GOD/hive)、JIM、PAM、KEVIN、RYAN、STANLEY、MEREDITH……每张卡有头像、名字、状态徽章（idle/working/starting up）、子状态、进度条。
  - **顶栏**：MUNDER DIFFLIN 栗色 logo + 版本号 + "auto mode on"。
- **品牌/美术语言**（来自其 docs/DESIGN.md）：暖纸色画布（cream `#F5F2E8`/paper `#FFFDF7`）、近黑墨色（文字+边框同色 `#1B1B1B`）、正方形直角（border-radius:0）、硬偏移投影（6–10px 无模糊）、JetBrains Mono 为主字体、单一暖黄 CTA 色（`#FFCA54`）、栗色品牌色（`#B23A4E`）+ 淡彩卡片（lilac/peach/mint/tan/rose）。整体是**暖纸感 + 轻新粗野主义（neo-brutalist）**，致敬美剧《办公室》(The Office / Dunder Mifflin 造纸公司)，所以员工都叫 Michael/Jim/Pam……
- 一句话给设计："**像素风 2D 办公室地板 + 每个 agent 一个工位头像 + 头顶状态气泡 + 信封乱飞 + 右侧命令中心实时终端 + 底部员工卡片条**"。

### 技术栈（package.json 实证）
- 运行壳：**Electron + electron-vite + electron-builder**；前端 **React 18 + react-dom**。
- 终端：**node-pty + @xterm/xterm（webgl/unicode11/fit addon）**——与我方 PTY 路线完全一致。
- 办公室画布：**pixi.js ^8.5.1**（像素地板/avatar/信封动画）。
- 数据/编辑：**better-sqlite3**、monaco-editor、@codemirror/* 系列。
- 其他：i18next/react-i18next（已做国际化）、electron-updater、posthog 埋点、Whisper 本地语音转写（Stapler 会议记录功能）。
- 分发：预编译 macOS（签名公证）/ Windows / Linux 安装包，无需自建。

### 与我方最值得抄的点
1. **Pixi.js 2D 办公室地板**作为"多 agent 状态总览画布"，把每个 PTY 线程映射为工位 avatar + 状态气泡——正好承接用户"把可视化办公室界面引入产品"的诉求。
2. **GOD agent（只跟一个 supervisor 对话）+ mailbox/inbox/outbox + 共享记忆 + 审批队列**的多 agent 协作模型，是"数字员工团队"可直接参考的运行时设计。
3. **Agent Gallery（一键导入现成角色）+ agent 卡片行（状态/引擎/模型/context  gauge/当前 ticket/右键菜单）**。
4. 它与我方同为 Electron+React+node-pty+xterm.js，**Pixi.js 地板是增量、不是重构**，改造成本可控。

来源 URL：
- 仓库 https://github.com/HarnessMD/munder-difflin
- README https://raw.githubusercontent.com/HarnessMD/munder-difflin/main/README.md
- 截图 https://raw.githubusercontent.com/HarnessMD/munder-difflin/main/docs/media/floor.png
- 设计系统 https://github.com/HarnessMD/munder-difflin/blob/main/docs/DESIGN.md
- 主页 https://munderdiffl.in

---

## ④ 与 Poracode（我方）借鉴点汇总

| 借鉴方向 | 抄谁 | 具体到功能 |
|---|---|---|
| **可视化办公室 UI** | Munder Difflin（首选）+ cubicle.run / EastGenesis | Pixi.js 2D 像素地板：每 agent 一个工位 avatar、头顶状态气泡（idle/working/awaiting）、工位间信封动画；右侧命令中心实时终端；底部员工卡片条（头像/状态/context gauge/当前任务）。暖纸+直角+硬投影的 neo-brutalist 皮肤 |
| **多 agent 编排运行时** | Munder Difflin | 单 supervisor（GOD/“你的克隆”）统一接单 → mailbox/inbox/outbox 文件路由 → 共享 markdown 记忆 + 语义召回 → 花钱/破坏性操作才进人工审批队列 |
| **角色/人设资产** | LobeChat（角色广场）、Cherry Studio（助手市场）、munder-difflin Agent Gallery | 把"数字员工"做成可雇佣/可导入/可排序的资产：选 CLI+模型+自治等级+工位即上岗；内置角色模板库 |
| **助手柜/多助手管理 UI** | Cherry Studio | 多助手并列卡片、分组、右键常用操作、崩溃条（crash strip）替代静默终端 |
| **persona + 工具分层抽象** | Open WebUI（personas + Functions + Tools）、5ire（MCP） | 角色定义与工具/能力解耦，统一 MCP 工具接入 |
| **本地代码执行/沙箱边界** | Open Interpreter、Vercel eve（人工审批子 agent） | 自治等级（spend/scope/destructive）可配置的"带缰绳自治" |
| **服务端/云端编排参考** | Vercel eve / open-agents | 若未来做云端排班/后台 agent，参考其持久执行 + 沙箱 + GitHub 集成（与我方桌面形态互补，不必照搬） |

**结论**：与我方"数字员工"形态重合度最高、且技术栈几乎同构的是 **Munder Difflin**（5/5）——它就是把我方这种"PTY + 结构化 runtime"再包一层办公室可视化 + 一个 GOD supervisor。改造路径建议：先引入 **Pixi.js 办公室地板 + 员工卡片条**做视觉外壳，再演进 **GOD agent + mailbox 协作模型**，角色市场可借鉴 LobeChat/Cherry Studio 的资产沉淀方式。

---

## ⑤ 无法核实 / 需注意项（如实标注）

1. **`get5ire/5ire` 404**：用户记忆中的该地址与组织均已不存在；真实仓库为 `nanbingxyz/5ire`，且是 TypeScript 桌面助手而非"Rust 多 agent 编排器"——此处与用户描述不符，已更正。
2. **"Vercel Agent.exe" 无公开仓库**：GitHub 搜索 `Agent.exe vercel` 为 0 结果，未找到该名称的开源桌面 agent；Vercel 开源 agent 主线为 eve / open-agents / skills。若用户指的是某内部产品或别名，需进一步确认。
3. **License 为自定义/带附加条款的项目**（非标准 OSI）：5ire（修改版 Apache-2.0 Community Edition）、LobeHub（LobeHub Community License）、Open WebUI（Open WebUI License）——商用前需逐条核对附加限制，不能直接当 MIT/Apache 用。
4. **star 数为 2026-10-09 单次快照**，会随时间变化；本报告已通过 GitHub API 实时抓取并标注日期。
5. munder-difflin 部分子功能（如 Stapler 会议转写、Pro 版侧边栏 Tasks/Automations/Memory）为 Pro 付费功能，开源 free 版能力边界以其 README/releases 为准。
6. 长尾项目（agent-office / penguin-office / AgentsOfficeTower 等）star 个位数、信息有限，仅作"可视化办公室赛道已有人在做"的佐证，未逐一深挖。
