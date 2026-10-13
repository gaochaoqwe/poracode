# GenOffice 技术评估 → AgentEmployee 采纳建议清单

> 调研日期：2026-10-11 ｜ 目标项目：AgentEmployee（`E:/code/Poracode-master`）
> 对象项目：**GenOffice** — Genspark 开源的全功能 AI 原生办公套件
> 仓库：https://github.com/genspark-ai/genoffice ｜ 官网：https://genoffice.ai
> 许可证：**Apache-2.0**（与 AgentEmployee 同为 Apache-2.0，商用兼容）

---

## 0. 结论速览（TL;DR）

- **价值不在"它是个办公套件"，而在它的引擎层可以被整块抽出来当能力模块用。** 技术栈与 AgentEmployee 高度同构：Electron + React + TypeScript + TipTap + pnpm workspaces + Vitest，几乎无缝。
- **最强契合点已经存在**：AgentEmployee 已有一套自研 docx 处理（`src/supervisor/documentFill/`：`xml.ts` / `zip.ts` / `document.ts` / `docxToMarkdown.ts`，合计约 3.1k 行，手写 OOXML + ZIP），外加一个 **Windows-only 外挂 `officecli` 二进制**（`src/supervisor/runtime/officeCliRuntime.ts`）。GenOffice 的 `docx-engine` / `xlsx-gateway` / `pptx-engine` / `file-parse` 正是这两条路径的**升级与补位方案**。
- **三条最值得做的事**：① 用 `docx-engine` 替换手写 xml/zip/docx 层，拿到"字节级保真 round-trip + 样式/批注/域/表格/文本框全覆盖"；② 引入 `file-parse` 把 docx/xlsx/pptx/pdf 统一喂给 agent 做上下文注入；③ 借鉴其**安全模型**（渲染进程沙箱 + IPC schema 校验 + 约束式 AST 解释器）加固 AgentEmployee 运行 agent 产物的链路。
- **必须警惕的三点**：GenOffice 的 AI 能力默认走 **Genspark 云代理**（BYOK 只是半成品，不成熟）——**只借鉴引擎与工程范式，绝不采纳其 AI 鉴权/代理链路**；引擎包**未单独发布到 npm**（仅在 monorepo 内由 workspaces 消费），复用 = 需要 vendor / 子模块 / pinned fork；项目仍是 **alpha（v0.5.x）**，官方自述"有 bug"。

---

## 1. GenOffice 技术画像

| 维度 | 事实 |
|------|------|
| 形态 | 7 个 Electron 应用：`docs`(Word) / `sheets`(Excel) / `slides`(PPT) / `pdf` / `markdown` / `html` / `shell`(标签外壳)，外加 headless CLI |
| 架构范式 | **apps/* 放"能跑的界面"，packages/* 放"没有界面的能力"**；引擎层为**纯 TypeScript、零 Electron 依赖、可单测、可被 CLI/headless 复用** |
| 编辑器内核 | Docs=TipTap/ProseMirror；Sheets=Univer core + Rust sidecar；Slides=自研 pptx 引擎 + HarfBuzz 排版；PDF=pdf.js + pdf-lib + PDFium wasm |
| 构建/工程 | pnpm workspaces、Vitest 单测、Playwright E2E、`tsc --noEmit` 全量 typecheck |
| Node 要求 | ≥ 22.12（引擎包），AgentEmployee 要求 ≥ 24.10 —— 兼容 |
| Sheets 额外 | 需 **Rust 工具链**（calamine + IronCalc sidecar，JSON-lines IPC）|
| AI 路径 | 默认登录 Genspark 账号，模型调用走 **Genspark 云代理**；BYOK 存在但 UI 未打通、直连模型版本落后 |
| 许可边界 | 主体 Apache-2.0；`ee/` 目录为**企业专有**（独立许可），不可混用 |

### 引擎层包清单（GenOffice `packages/*`）

| 包 | 职责 | 对 AgentEmployee 的相关度 |
|----|------|--------------------------|
| `docx-engine` | .docx 解析 → Block 树（每块 `docxIndex` 锚点 + 原始 XML 切片）；**段落/表格/文本框外科式补丁**；OOXML 生成；样式/脚注/域/文档保护；字节级 round-trip 保存 | ⭐⭐⭐ 最高（直接对标现有 documentFill） |
| `file-parse` | 从 .doc/.docx/.ppt/.pptx/.xls/.xlsx/.pdf 抽取纯文本，用于 **AI 上下文注入与检索索引** | ⭐⭐⭐（补多格式上下文） |
| `xlsx-gateway` | 纯 TS 的 .xlsx 网关：CSV 导入（字符集嗅探/分隔符探测）、样式/图表/透视表/筛选/数据校验/页设置/包 I/O | ⭐⭐⭐（替代/并行 officecli 的 xlsx 路径） |
| `pptx-engine` / `pptx-render` / `pptx-ops` | pptx 外科补丁、嵌入字体、版式计算/几何变换/文字整形（HarfBuzz）、操作与提示库 | ⭐⭐（新增 PPT 能力） |
| `pdf2docx` | **离线** PDF 转换管线：抽取→版式去重→结构分析→带置信度降级的 IR→重建可编辑 docx/pptx/xlsx | ⭐⭐ |
| `html2docx` | 浏览器侧元素抽取 + 格式化驱动 + docx 生成 | ⭐ |
| `agent-core` | 多轮 **工具调用循环（AgentLoop）**、上下文压缩、历史管理、`AgentSkill` 接口 | ⭐⭐⭐（编排范式） |
| `ai-provider` | 模型后端抽象 + 流式；BYOK 覆盖 Claude/OpenAI/Gemini/DeepSeek/Kimi/GLM/Qwen/Doubao/MiniMax/Grok/Mistral/OpenRouter + 自定义 OpenAI 兼容端点 | ⭐⭐⭐（BYOK 抽象） |
| `ai-search` | Genspark 鉴权 + 联网/图像搜索工具 | ⚠️ 含 Genspark 私有鉴权，**不建议采纳** |
| `cli` | headless CLI：转换/创建/渲染/表格/幻灯片/文档编辑/搜索 | ⭐⭐（可包装成 agent 工具） |
| `font-metrics` | 排版度量、sfnt 表解析（保证渲染与打印字符宽度/行高一致）| ⭐（若做分页预览） |
| `i18n` | 多语言词典、BCP-47 归一、运行时切语言、Mac→Win 快捷键符号转换 | ⭐ |
| `ui` | React 设计系统：design tokens（`tokens.css`）、共享图标、`AiComposer`、输入中指示器 | ⭐（AgentEmployee 用 HeroUI，仅借鉴）|
| `project-store` | 最近文件 + 窗口配置的跨进程（Electron IPC）共享状态 | ⭐ |
| `electron-utils` | 平台/安全工具：`resolveDefaultSaveDir`、设置解析、`safeExternalUrl` 校验守卫 | ⭐⭐ |
| `pipelines` | 高层转换与幻灯片生成管线（headless CLI 与自动化复用）| ⭐ |

### 安全模型（`SECURITY.md`，对 AgentEmployee 参考价值高）
- 每个文档窗口 **renderer 锁定**：`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`。
- 主进程对所有 IPC payload 做 **schema 校验**；Sheets 端到端用 **zod**。
- 外链统一走 `safeExternalUrl` 网关，拒绝 `file:` / `javascript:` / 自定义 scheme。
- Slides 的版式脚本用 **Acorn 解析 + 约束式 AST 解释器**执行（无 `eval`/`Function`、无环境全局、无网络/IPC/定时器、有深度上限）。
- **AI 生成的 HTML 在隐藏 BrowserWindow 中按"敌意内容"处理**：无 preload、无 IPC 面、`executeJavaScript` 带看门狗超时。

---

## 2. 与 AgentEmployee 的现状对照

| 能力 | AgentEmployee 现状 | GenOffice 可提供的差距补位 |
|------|--------------------|---------------------------|
| docx 读写 | `documentFill/` 手写：`xml.ts`(232行)+`zip.ts`(206行)+`document.ts`(312行)，面向**模板填充（plan→fill→apply）** | `docx-engine`：通用 Block 树 + 字节级保真 round-trip，覆盖样式/批注/修订/域/脚注/文本框/保护 |
| docx→文本 | `docxToMarkdown.ts`（**自述有损**：丢图片/页眉页脚/脚注/批注/文本框/超链接/行内格式/公式） | `file-parse`：docx/xlsx/pptx/pdf 统一文本抽取，保留空白与结构顺序 |
| Office 格式 I/O | 外挂 `officecli` 二进制，**仅 Windows x64**，WSL/macOS/Linux 不可用 | `xlsx-gateway`(纯TS) + `pptx-engine`(纯TS) 提供**跨平台纯 TS 路径** |
| PDF | 无本地转换 | `pdf2docx`：完全本地 PDF→可编辑文档 |
| Tiptap | 已是依赖 **3.30.5**，但仅用于 `NotesEditor` | GenOffice Docs 正是 TipTap + docx-engine 的成熟集成范例（**版本号一致**，无冲突） |
| agent 编排 | 以 PTY/结构化运行时**编排外部** agent（GdsAgent/Codex/Gemini） | `agent-core`：**内置**多轮工具调用循环 + 上下文压缩 + Skill 接口（若需自建原生 agent） |
| 模型接入 | provider-agnostic，有 `shared/agentSecrets` 等 | `ai-provider`：成熟的 BYOK 多provider + 流式抽象 |
| 安全 | 强（supervisor 隔离、provider 隔离规则） | `SECURITY.md` 的沙箱/AST 解释器/敌意 HTML 隔离，可加固 agent 产物执行 |
| 工程范式 | 已是 pnpm workspace + vitest + provider-agnostic 共享模块 | 与 GenOffice "纯 TS 引擎包" 哲学**同构**，迁移心智成本低 |

---

## 3. 建议点清单（核心交付）

### 🔴 P0 — 高价值、低阻力、与现有代码直接对标

- **P0-1｜用 `docx-engine` 替换 `documentFill` 里手写的 OOXML 三层。**
  现状 `xml.ts`/`zip.ts`/`document.ts` 是"够用但窄"的极简实现（自述不支持 DTD/CDATA/命名空间解析，ZIP 仅 store+deflate）。`docx-engine` 提供经过单测的完整 OOXML 语义（段落/表格/文本框补丁、样式、域、脚注、文档保护、round-tracked 保存）。
  - 落地：先做 PoC，**保留现有 golden tests 作为回归基线**（`golden.test.ts`/`idaTemplate.test.ts`/`sddTemplate.test.ts`），逐字节对比新旧输出。
  - 收益：模板填充保真度提升；为"AI 直接改 Word 正文"打开空间。

- **P0-2｜引入 `file-parse` 做多格式 agent 上下文注入。**
  现有 `docxToMarkdown` 仅 docx 且有损。`file-parse` 覆盖 doc/xls/ppt/pdf 全系，专为"AI 附件上下文 + 检索索引"设计，与 AgentEmployee 的 `contextExtractor.ts` / `threadAttachments.ts` / `ProjectSearchIndex.ts` 天然衔接。
  - 落地：在附件/索引路径上并联一个 `file-parse` 适配层，逐步替换 docxToMarkdown。

- **P0-3｜借鉴 `agent-core` 的 AgentLoop + 上下文压缩范式。**
  概念（多轮 tool-calling 循环、context compaction、history management、`AgentSkill` 接口）与 AgentEmployee 的 `contextWindow.ts` / `contextExtractor.ts` 方向一致。**若尚未自建原生 agent 循环**，这是最有价值的一手参考实现；若已有，则用作对照补齐压缩策略。

- **P0-4｜采纳 `SECURITY.md` 的安全加固模式。**
  对 AgentEmployee 运行 agent 产出（生成代码/HTML/脚本）的链路尤其相关：
  - 渲染进程三件套（`contextIsolation`/`nodeIntegration:false`/`sandbox`）；
  - 主进程 **IPC schema 校验**（可对齐 zod，项目已依赖 zod@4）；
  - **约束式 AST 解释器**（Acorn + 白名单执行，禁 eval/网络/IPC/定时器、有深度上限）——用于任何"执行 agent 生成脚本"的场景；
  - **敌意 HTML 隐藏窗口隔离**（无 preload/IPC，`executeJavaScript` 带看门狗）。

### 🟠 P1 — 有价值，但需评估集成成本

- **P1-5｜`xlsx-gateway`（纯 TS）并行/替换 `officecli` 的 xlsx 路径。**
  消除 Windows-only 限制，获得跨平台 + 可控的样式/图表/透视表/筛选/数据校验能力。
- **P1-6｜`pptx-engine` + `pptx-render` 增加 PPT 生成/编辑能力。**
  与 `documentTemplates` / `documentFill` 的"模板产出"形态互补，可把 PPT 纳为第三种可交付文档。
- **P1-7｜借鉴 `ai-provider` 的 BYOK provider 抽象。**
  其"内置多家 + 自定义 OpenAI 兼容端点（含本地服务器）"的声明式 provider 设计与 AgentEmployee 的 provider-agnostic 架构同频——**但须按本项目规则把"厂商差异"收敛为 provider 声明的 capability，不得在共享代码里 `kind === '<provider>'` 分支**。
- **P1-8｜`pdf2docx` 提供本地 PDF 转换。**
  补齐 PDF→Word/PPT/Excel 的本地能力（无云、无上传），可包装为 agent 工具。

### 🟡 P2 — 参考性质，按需取舍

- **P2-9｜`i18n` 包的 BCP-47 归一 + Mac→Win 快捷键符号转换**（AgentEmployee 已用 Lingui，仅取个别工具函数）。
- **P2-10｜`project-store` 的最近文件/窗口态跨进程同步模式**（若现有实现有痛点）。
- **P2-11｜把 `cli` 的 headless 能力包装成 agent 工具 / MCP tool**（对齐现有 `src/main/app-controls/mcp/tools/documentFill.ts` 的做法）。
- **P2-12｜`ui` 的 design tokens + "CI 守卫保持 chrome 颜色走 token 系统"机制**（AgentEmployee 用 HeroUI + tailwind token，可借鉴其守卫思路）。

### ⛔ 明确不建议采纳

- **`ai-search` / Genspark 鉴权与云代理链路**：绑定 Genspark 账号、模型调用经其服务器；BYOK 在 UI 上未打通、直连模型版本落后。**只借引擎，不借 AI 通道**——AgentEmployee 应继续用自身 provider 体系。
- **`ee/` 企业目录**：独立专有许可，混入会污染 Apache-2.0 交付。
- **Sheets 的 Rust sidecar**：引入 Rust 工具链会显著增加 Windows 打包复杂度（AgentEmployee 已有 node-pty/better-sqlite3/sharp 等原生依赖，不宜再加）。仅在纯 TS `xlsx-gateway` 不够用时再考虑。
- **整体把 GenOffice 当运行时依赖直接引入**：alpha 质量 + 云绑定，风险高于收益。

---

## 4. 集成方式与风险清单

| 项 | 说明 | 应对 |
|----|------|------|
| **未发布 npm** | 证据显示引擎包仅在 monorepo 内由 npm workspaces 消费；无独立 `@genoffice/*` npm 包 | 采用 **vendor（复制锁定源码）/ git subtree / pinned fork**；把引入的引擎视为"第一方代码"自行维护 |
| **供应链守卫冲突** | AgentEmployee `pnpm-workspace.yaml` 有 `minimumReleaseAge: 10080`（7天）等强供应链策略 | vendor 的是源码快照而非 npm 依赖，不触发守卫；但需记录来源 commit 以便审计 |
| **Alpha 质量** | 官方自述 alpha、有已知/未知 bug | 只取**引擎层**（有单测、无 Electron 依赖），不取应用层；PoC 通过再合并 |
| **Provider 隔离规则** | AGENTS.md 明令：共享代码不得出现厂商名、不得 `kind === "<provider>"` 分支 | 引入 `ai-provider` 时必须把厂商差异下沉为 **provider 声明的 capability** |
| **Node 版本** | GenOffice 引擎要求 ≥22.12；本项目 ≥24.10 | 兼容，但需在 CI 用本项目 Node 版本跑其单测 |
| **许可证** | Apache-2.0（兼容），但 `ee/` 例外 | 保留 NOTICE / 版权归属；**排除 `ee/`**；跑 `pnpm notices` 思路做三方声明 |
| **打包体积** | Electron 产物敏感 | 按需只引入用到的包（docx-engine/file-parse 优先），避免整仓引入 |
| **版本边界** | 若新持久化/派生索引/序列化清单受影响 | 按 AGENTS.md《Versioned State & Protocols》审计并加迁移或版本号失效 |

---

## 5. 建议落地路线

1. **阶段一（PoC，1 个迭代内可验证）**：把 `docx-engine` 的解析/补丁与 `documentFill` 的 golden fixtures 对接，跑通"打开→改一段→保存→字节 diff"，确认保真度是否优于现状。（P0-1）
2. **阶段二**：引入 `file-parse` 替换 `docxToMarkdown`，接入附件/索引链路。（P0-2）
3. **阶段三**：并行试点 `xlsx-gateway` 纯 TS 路径，对比 `officecli`（尤其 macOS/Linux/WSL 场景）。（P1-5）
4. **阶段四**：把 `SECURITY.md` 的 AST 解释器 / 敌意 HTML 隔离，落到"执行 agent 产物"的现有链路上。（P0-4）
5. **阶段五（按需）**：`agent-core` 范式对照、`pptx-engine`、`pdf2docx`、`ai-provider` 抽象。（P0-3 / P1-6/7/8）

---

## 6. 验证 / 防坑清单

- [ ] PoC 阶段用**现有 golden tests + 新增 round-trip fidelity 测试**双基线对比，任何字节差异都要能解释。
- [ ] 确认引入包在本项目 Node 24 下 `typecheck` + `vitest` 全绿。
- [ ] 检查是否引入 `ee/` 或 Genspark 私有依赖（`ai-search`）——必须为零。
- [ ] 复核共享代码里**没有新增 provider 名/分支**（provider 隔离规则）。
- [ ] 度量 Electron 打包体积增量。
- [ ] 记录 vendor 来源 commit，纳入 NOTICE / 三方许可声明。

---

### 附：本次调研信息源
- GenOffice GitHub README / SECURITY.md / CONTRIBUTING.md：https://github.com/genspark-ai/genoffice
- DeepWiki 架构文档：`shared-packages-overview` / `repository-layout` / `genoffice-docs`
- Genspark 官方发布博文、everydev / aibacon / kiadev 第三方分析、GitCode 架构解析
