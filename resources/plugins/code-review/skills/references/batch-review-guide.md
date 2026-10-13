# 分批审查纪律（Batch Review Discipline）

对大型代码库做审查时，必须**分批 + 独立对话调度**进行，以保证**单对话上下文不超**、
**已审函数不污染后续审查**，并**持续落盘进度**供前端展示。

> 只审少数几个函数的小场景：直接一次性审完并落盘，不必走调度。
> 大型代码库（函数/条目数量很大，或存在上千行大函数）：必须走下方的**独立对话调度模式**。

## 0. 两种模式

- **小场景**（≤ 几个函数）：主对话直接 `get_function` 取源码审查，落盘 `<taskId>-<mode>-review.json`。
- **大代码库**（本文件重点）：主对话**编排**，把待审范围切成多个 batch，**每个 batch 一个独立对话**，
  审完由主对话聚合落盘并 `delete_thread` 删除该对话（左侧导航栏不残留）。

## 1. 打包粒度（按模式不同，不要互相套用）

**函数审查（function）**：按源码行数把**多个小函数**打包进一个对话。每对话源码预算
`BATCH_LINE_BUDGET = 2500` 行（128k 模型约 16-18k token，占上下文约 45%）：
- 小函数（`end_line - start_line ≤ 30`）：约 80 个凑一个对话；
- 中等函数（30-800 行）：一函数一对话；
- 大函数（800-2500 行）：一个对话最多 1-2 个；
- 超大函数（> 2500 行）：单独一个对话 + 进度标 `overBudget: true`，提示需分段。

**链路审查（chain）**：**一个入口 / 一条关注链 = 一个对话**，不是按函数打包。
链上涉及函数总行数 > 2500 时**沿链分段**（按链的前后环节切，每段一个对话），
不要强行把不相干函数塞进一个对话。

**功能审查（feature）**：**一个功能 = 一个对话**。功能 > 2500 行时**功能内分段**
（按行为 / 边界 / 异常场景切），不是按函数打包。

预算用尽即开下一个对话。宁可减小每个对话的源码量，不要塞爆上下文。

## 2. 调度流程（每个 batch 一个独立对话）

主对话（编排 agent）对每个 batch 执行：

1. **创建独立对话**：调用 `agentemployee` MCP 的 `create_thread`
   （`projectId` = 当前项目，`title` = `审查 batch-<N> · <M> 个函数` 或 `审查 <函数名>`，
   `agentKind` / `model` 与主对话一致，`prompt` 见步骤 3）。
2. **注入审查指令**：`send_to_thread` 发送**自包含**的审查 prompt（见下"子对话审查指令"），
   让子对话用索引 `get_function` 取源码审查并**写独立批次文件**。
3. **等待完成**：`wait_for_thread`（带超时），必要时 `read_thread` 读子对话输出。
4. **聚合落盘**：主对话读该 batch 的批次文件（或子对话返回的 JSON），把 `problems[]` **追加**
   进累计文件 `<taskId>-<mode>-review.json`，并把该批的 `function_info[]`（每个被审函数一条）
   **合并进累计文件的 `function_info` 数组**。**无论该函数有没有问题，它的功能概述都要落盘**——
   面板会把 `function_description` 常显在问题单最上方（为空则显示占位）。
5. **更新进度**：写 `<taskId>-<mode>-progress.json`（协议见 `references/progress-schema.json`）：
   `done += 该批函数数`，`accumulatedIssues` 累加，`currentFile`/`currentFunction` = 该批最后已审函数。
6. **删除对话**：`delete_thread` 从左侧导航栏移除该独立对话（不留垃圾）。
7. 并发执行下一个 batch（**滑动窗口 2-4 个并发对话**；先建的前几个完成后立即补位）。

## 3. 子对话审查指令（send_to_thread 注入内容）

子对话 prompt 必须**自包含**，不依赖主对话上下文。模板：

```
你是代码审查执行 agent。请审查下面这批函数，并把结果写入指定 JSON 文件。

审查模式: <function|chain|feature>
索引库(用 code-review-index MCP): <dbPath>
待审函数(逐个用 get_function 取完整源码审查;需要时用 get_call_graph):
- <fnName> id=<id> file=<file> lines=<start>-<end>
- …

审查规则: 只审查**代码语义级别的问题**——功能逻辑、边界与异常路径、资源与生命周期、
数据/错误传递、并发/时序等**真正影响正确性或行为**的问题。发现什么类型的问题就报什么,
不套固定问题目录。**禁止报告纯编码规范类问题**(命名风格、注释是否齐全、魔法数字本身、
圈复杂度/函数长度、代码格式等,除非它们直接导致功能缺陷)。
**宁缺毋滥**:每条问题都要说得清会导致什么功能后果,说不清就不要报。
**简单函数**:源码即可判断,无需拉上下文; **复杂函数**(调用多/状态多/分支深):必须用
get_call_graph 展开相关调用,必要时取被调函数源码核对数据流与错误处理。
不下最终结论、不改代码。干净则输出空 problems 数组,不制造问题。

问题等级只有两级: **重要问题**(崩溃/越界/泄漏/数据损坏/错误静默) 与 **一般问题**;
**不得输出「建议改进」**——该等级会被后端解析层自动丢弃。

输出契约: 每条 problem 字段:
id / file_name / function_name / source_code / problem_reason / issue_level(中文两级:
重要问题|一般问题) / issue_name / issue_location /
description_requirement(需求描述,即"应然":函数本应如何) /
description_issue(问题描述,即"实然":实际存在的问题) / description_impact /
description_location / evidence(引用索引行号或调用边) / related(可选)。
description_location 严格为 `xx文件的xx函数的<行号>行：<可全字匹配的问题代码语句>
源程序为：\n<保留关键上下文的源码>`。JSON 内换行用 \n 转义。

**函数功能概述(function_info)必填**: 每个被审函数都要给一条,包含 function_name、file_name
(与 problems[].file_name 同口径,前端据此把函数挂到左侧目录树的对应文件节点下)与
function_description(一两句中文说清该函数做什么、关键输入输出与副作用);实在无法概括
可写空串 "" 但字段不能省略。批次文件里 `function_info` 写成**数组**(每个函数一条):
"function_info": [ { "function_name": "…", "file_name": "src/a.c", "function_description": "…" }, … ]
把完整 JSON 写入 <reviews>/<taskId>-<mode>-batch-<N>.json,回复末尾再输出同样的 ```json 块。
```

子对话会访问项目挂载的 `code-review-index` MCP 取源码，用 Write 写批次文件。

## 4. 上下文纪律（主对话，关键）

- **主对话不拉全量源码**：只持有函数元数据（清单）+ 各 batch 聚合后的 `problems[]` 摘要。
  源码只在子对话里审查。
- **每审完一批即聚合 + 落盘 + 删除对话**：不留已审源码、不留已完成对话。
- **不回顾已审细节**：需要跨批引用（如链路相关性）时用 `file/function/line` + 一句话摘要，
  不要重放源码。
- 若主对话上下文吃紧：先聚合已完成的批（写 progress + review），再结束本轮，下次从 `done` 续。

## 5. 超大函数（> 2500 行）分段

- 单独建一个对话，注入时要求子对话**分段审查**：按函数内逻辑段（循环/错误处理/资源/边界）
  分批取源码，每段落一个批次文件，最后合并进累计文件。
- 进度里对它的 `overBudget` 标 `true`，前端可据此提示"该函数需分段"。

## 6. 进度文件协议

`<taskId>-<mode>-progress.json`（参考 `references/progress-schema.json`）：

```json
{
  "kind": "code-review-progress",
  "version": 1,
  "taskId": "…",
  "mode": "function",
  "status": "running",
  "total": 12000,
  "done": 240,
  "batchSize": 80,
  "currentFile": "src/core/route/nav.c",
  "currentFunction": "distance_km",
  "issuesInBatch": 3,
  "accumulatedIssues": 42,
  "overBudget": false,
  "startedAt": "…",
  "updatedAt": "…"
}
```

- 开始写一次 `status: "running"`（total = 函数总数）。
- 每聚合一批更新一次。
- **全部审完**：`status: "done"`、`done = total`，写最终累计 review JSON。
- 中途暂停：`status: "paused"`，下次从 `done` 续审。

## 7. 断点续审

- 若已有 `<taskId>-<mode>-progress.json` 且 `status` 为 `running`/`paused`，
  从 `done` 处继续（跳过已审 id / 已删对话），不从头重审。

## 8. 结果文件

- 累计审查文件：`<taskId>-<mode>-review.json`（全量 `problems[]` + 全量 `function_info[]`，
  供前端问题清单与「函数功能概述」渲染）。
- 进度文件：`<taskId>-<mode>-progress.json`（供前端进度条渲染）。
- 子对话批次文件：`<taskId>-<mode>-batch-<N>.json`（聚合后可保留或清理）。
- 全部写入 `fileOutputDir`（默认项目根 `reviews/`）。文件不存在则创建。
