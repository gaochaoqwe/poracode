---
name: function-review
description: Perform a code review over individual functions of a C/C++ project — naming, complexity, error handling, resource/memory management, null and bounds safety, magic numbers, return handling, side effects, type safety, and documentation. Use when the user asks to review functions in code, find bugs or quality problems in a function, or audit a single function against review rules. Reports issues with source (file + stable locator), type, severity, and a suggested direction — never a final verdict, never rewrites code.
---

# Function Review（函数审查）

对项目中的**单个函数**做逐项质量审查，输出一份按严重度分组、可机器读取的 issue 列表。
本 skill **不下最终结论、不改代码**——只指出问题与方向，确认与修订由用户决定。

## 1. Inputs

审查前先准备：

- **代码目录**（必填）：待审查的 C/C++ 源码根目录。若用户未给出，先问，不臆测路径。
- **审查范围**（可选）：用户指定要查的函数、文件或模块。缺省时覆盖索引到的全部函数。
- **术语 / 规范规则**（可选）：若项目有 `.agentemployee/terminology.md` 或编码规范，
  先读；否则按 `references/check-catalog.json` 的默认类型判断。

先用 `code-review-index` MCP 建立索引（拿到真实的符号、行号与调用边），再逐函数审查。

## 2. 使用索引（必备第一步）

1. 调用 `index_project`（rootDir=代码目录，dbPath=项目的 review 库，如 `reviews/<project>.db`）。
2. 调用 `list_functions` 拿到函数清单（含 file_id / 行号）。
3. 对每个在范围内的函数调用 `get_function` 取完整源码审查；需要时用 `get_call_graph`
   看它调用了谁，作为错误处理/返回路径判断的依据。

**行号与调用关系必须来自索引结果，不得编造。**

**大库分批（函数数量很大时强制）**：若函数数量在数百/数千以上，必须按
`references/batch-review-guide.md` 分批审查：每批只把该批函数源码取进上下文、
审完即落盘、**绝不重读已审函数源码**，并持续写进度文件。宁可减小批大小（每批
15–30 个），不要塞爆上下文；上下文吃紧时先落盘再结束本轮。

## 3. 审查范围（只报真正影响功能的语义级缺陷）

只审查**代码语义级别的问题**——功能逻辑、边界与异常路径、资源与生命周期、数据/错误传递、
并发/时序等**真正影响正确性或行为**的问题。发现什么类型的问题就报什么，不套固定目录
（`references/check-catalog.json` 仅作参考，不强制限定）。

**禁止报告纯编码规范类问题**（除非它直接导致功能缺陷或崩溃，否则一律不报）：

- 命名风格、命名是否有信息量；
- 注释/文档是否齐全、是否与实现一致（注释与实现不一致**且会误导维护者造成实际误判**的除外，见下）；
- 魔法数字、硬编码字面量本身（未导致越界/错算的不报）；
- 圈复杂度、函数长度、嵌套深度等可读性指标；
- 代码格式、排版、空行；
- 日志/断言是否完备、返回值是否被文档化。

**宁缺毋滥**：每条问题都必须说得清「它会导致什么功能后果」（错误结果、崩溃、越界、
泄漏、死锁、数据损坏、时序错误……）；说不清就不要报，不要为凑数量堆砌。
代码干净时输出空 `problems` 数组。

问题等级 `issue_level` 只有**两级**，不得出现第三级：

- `重要问题` = 会导致崩溃、越界、内存/资源泄漏、数据损坏，或错误被静默吞掉导致下游错误结果；
- `一般问题` = 会造成错误行为、或在特定输入/时序下出错，但后果可控。

> **「建议改进」等级已废弃**：这类问题绝大多数是编码规范/风格建议，对程序功能没有实质
> 影响且数量巨大，会淹没真缺陷。系统在后端解析层会**自动丢弃**该等级（含 `建议`、
> `suggestion`、`low` 等近义写法），所以不要输出它们。

## 4. Method

1. 逐函数读取源码，按语义级标准检查功能逻辑、边界/异常路径、资源与生命周期、数据/错误传递等问题。
2. 每条 problem 落在稳定的 `description_location`（`文件` + `函数` + `行号` +
   可全字匹配的问题代码语句），见 `references/locator-rules.md`。不要把一个缺陷拆成
   多条，也不要把不同缺陷合并。
3. 涉及外部调用/调用图依据时在 `evidence` 注明，来源必须是索引结果。

> **大型代码库（函数很多或含上千行函数）**：遵循 `references/batch-review-guide.md` 的
> **独立对话调度模式**——主对话用 `agentemployee` MCP **把多个小函数按源码行数打包**
> （每对话源码预算 `BATCH_LINE_BUDGET = 2500` 行；≤30 行约 80 个/对话、30-800 一函数一对话、
> >2500 单独 + 标超预算），每个 batch 建一个独立对话
> （`create_thread` → `send_to_thread` 注入自包含审查指令 → `wait_for_thread`），
> 子对话审查并写 `<taskId>-function-batch-<N>.json`，主对话聚合进 `<taskId>-function-review.json`、
> 更新 `<taskId>-<mode>-progress.json`，最后 `delete_thread` 删除该对话。并发滑动窗口 2-4。
> 小场景（≤ 几个函数）直接单对话审完落盘。

## 5. Output

分两部分回复：

**Part 1 — 可读 Markdown 报告**：按严重度分组（重要问题在前），每条给出位置、类型、
相关函数、严重度与建议方向。

**Part 2 — 机器可读问题列表**，作为回复中**最后一个 ```json 代码块**，符合
`references/issue-schema.json`（`mode: "function"`）。结构与字段含义对齐既有
"函数审查"模型返回格式——`issue_level` 用中文两级（`重要问题` / `一般问题`），
`description_location` 严格按
`xx文件的xx函数的xx行：问题代码语句源程序为：\n保留上下文的源代码` 输出，问题代码语句
供前端全字匹配定位：

```json
{
  "kind": "code-review-report",
  "version": 1,
  "mode": "function",
  "scope": { "rootDir": "src/core", "files": ["src/core/route/nav.c"] },
  "problems": [
    {
      "id": "F-1",
      "file_name": "src/core/route/nav.c",
      "function_name": "distance_km",
      "source_code": "double distance_km(...) { ... dlat = (lat2 - lat1) * DEG_TO_RAD; ... }",
      "problem_reason": "fn-bounds：数组越界 / 缓冲区风险",
      "issue_level": "重要问题",
      "issue_name": "dlat/dl 弧度换算未对异常输入做范围保护",
      "issue_location": "src/core/route/nav.c:distance_km",
      "description_requirement": "应在换算前校验 lat/lon 范围并明确返回约定。",
      "description_issue": "dlat/dl 弧度换算对异常 lat/lon 输入未做范围保护，可能产生非预期结果。",
      "description_location": "src/core/route/nav.c文件的distance_km函数的23行：dlat = (lat2 - lat1) * DEG_TO_RAD;源程序为：\ndouble distance_km(...) {\n    ...\n    dlat = (lat2 - lat1) * DEG_TO_RAD;\n    ...\n}",
      "description_impact": "极端输入下可能返回非预期距离，影响导航判断。",
      "evidence": "get_function: distance_km 第23行"
    }
  ],
  "function_info": {
    "function_name": "distance_km",
    "file_name": "src/core/route/nav.c",
    "function_description": "计算两点球面距离。",
    "commented_code": "double distance_km(...) {\n    ... // 换算\n    dlat = (lat2 - lat1) * DEG_TO_RAD; // 弧度换算\n}"
  }
}
```

JSON 块只在完整时输出，其后不再跟任何文字。

> **`function_info` 必填（函数功能概述）**：**即使 `problems` 为空，也必须提供
> `function_info`**，且**必须包含 `function_name` 与 `file_name`**，并**尽量提供
> `function_description`**（用一两句中文说清这个函数做什么、关键输入输出与副作用）。
> `file_name` 与 `problems[].file_name` 同口径——前端据此把函数挂到左侧目录树的对应
> 文件节点下，所以**函数即便没有问题也能在目录树里看到**。
> 前端会把 `function_description` 渲染在问题单最上方，描述为空时会显示「未返回功能概述」
> 占位——所以请尽量给出有信息量的描述。**确实无法概括时可写空串 `""`，但字段本身不要省略。**
>
> 单函数报告里 `function_info` 写成对象；**批量/聚合报告里写成数组**（每个被审函数一条，
> 见 `references/batch-review-guide.md`），两种形态前端都支持：
>
> ```json
> "function_info": [
>   { "function_name": "a", "file_name": "src/a.c", "function_description": "…", "commented_code": "…" },
>   { "function_name": "b", "file_name": "src/a.c", "function_description": "" }
> ]
> ```

**落盘（供前端面板读取）**：把这份完整 JSON 写入 `fileOutputDir` 指定的目录
（场景默认是项目根下的 `reviews/`），文件名为 `<taskId>-<mode>-review.json`，
`taskId` 用 `index_project` 返回的 taskId，`mode` 为 `function`。若目录不存在则创建。
面板会读取该文件渲染问题清单。

**进度（供前端进度条读取）**：审查过程中把进度写入 `<taskId>-<mode>-progress.json`
（协议见 `references/progress-schema.json`）：开始时写 `status: "running"`、`total` 为
函数总数；每批完成更新一次（`done`、`currentFile`、`currentFunction`、
`accumulatedIssues`）；全部审完写 `status: "done"`。大库分批时按
`references/batch-review-guide.md` 维护，支持断点续审。

## 6. Constraints

- **绝不下最终结论**：只报问题与方向，决策权在用户。
- **绝不改写用户已确认的代码**：只指出问题；修复是用户的动作。
- **必须引来源**：无 `description_location` 的 problem 不可用。
- **若代码干净**，输出空 `problems` 数组，不制造问题求全。
