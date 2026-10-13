---
name: chain-review
description: Perform a code review over cross-function call chains of a C/C++ project — cycles and infinite loops, chain depth, data-flow breaks, swallowed errors along the chain, layering violations, lifetime/dangling references, inconsistent conditions, and shared-state races. Use when the user asks to review a call path / call chain in code, trace how data or errors flow across functions, or audit an end-to-end code path. Reports issues with source (file + stable locator), type, severity, and a suggested direction — never a final verdict, never rewrites code.
---

# Chain Review（链路审查）

对**跨函数的调用链**做审查：数据如何沿链流动、错误如何传播、依赖方向与共享状态
是否健康。本 skill **不下最终结论、不改代码**。

## 1. Inputs

- **代码目录**（必填）：C/C++ 源码根目录。
- **链路范围**（可选）：用户指定要追的入口函数、调用路径或目标功能。缺省时从索引的
  调用图中选关键链路审查。

先用 `code-review-index` MCP 建索引，拿到**真实的调用图**。

## 2. 使用索引（必备第一步）

1. `index_project`（rootDir、dbPath=项目 review 库）。
2. 对入口/关注函数用 `get_call_graph` 逐层展开调用链（callees 与 callers），
   必要时用 `get_function` 取链上每个函数的源码核对条件与数据流。

**调用边、行号必须来自索引，不得凭记忆构造调用关系。**

**大库分批（链路数量很大时强制）**：若待查链路/函数在数百/数千以上，按
`references/batch-review-guide.md` 分批：每批只把该批涉及的函数源码取进上下文、
审完即落盘、**不重读已审函数源码**，并持续写进度文件。上下文吃紧时先落盘再结束本轮。

## 3. 固定问题目录

只检查 `references/check-catalog.json` 中的类型：

- `ch-cycle` 循环依赖或潜在死循环
- `ch-depth` 调用链过深 / 栈风险
- `ch-data-flow` 数据流断裂或结果未传递
- `ch-error-propagation` 错误被吞掉或未沿链传播
- `ch-layer` 跨层 / 依赖方向违规
- `ch-lifetime` 生命周期 / 悬空引用
- `ch-condition` 链路条件不一致
- `ch-shared-state` 共享状态 / 竞态风险

问题等级 `issue_level` 只有**两级**（不得输出第三级，尤其不得输出「建议改进」——
编码规范/风格建议类问题一律不报，后端解析层也会自动丢弃该等级）：
- `重要问题` = 死循环、崩溃、数据损坏、错误静默导致下游错误结果；
- `一般问题` = 会造成错误行为或在特定输入/时序下出错，但后果可控。

## 4. Method

1. 从入口沿调用链展开，逐环节检查数据与错误是否被正确传递。
2. 每条 problem 落在链上**最应改动的那一环**：`description_location` 用该环节的
   `文件` + `函数` + `行号` + 可全字匹配的问题代码语句（见 `references/locator-rules.md`），
   在 `related` 中列出链上关联环节的 `issue_location`。
3. 用调用图核实环、深度与共享量读写点，依据进 `evidence`。

> **大型代码库（链路很多或含上千行函数）**：遵循 `references/batch-review-guide.md` 的
> **独立对话调度模式**——**一个入口 / 一条关注链 = 一个独立对话**（不是按函数打包）；
> 链上函数总行数 > 2500 时**沿链分段**，每段一个对话（`create_thread` → `send_to_thread` →
> `wait_for_thread`），子对话写 `<taskId>-chain-batch-<N>.json`，主对话聚合 + 更新进度 +
> `delete_thread` 删除。并发滑动窗口 2-4。小场景直接单对话审完落盘。

## 5. Output

分两部分回复。

**Part 1 — 可读 Markdown 报告**：按严重度分组，给出链路走向、断点位置、涉及环节与建议。

**Part 2 — 机器可读问题列表**，作为回复中**最后一个 ```json 代码块**，符合
`references/issue-schema.json`（`mode: "chain"`）。`issue_level` 用中文两级（`重要问题` / `一般问题`），
`description_location` 严格按 `xx文件的xx函数的xx行：问题代码语句源程序为：\n保留上下文源代码`
输出（问题代码语句供前端全字匹配定位）：

```json
{
  "kind": "code-review-report",
  "version": 1,
  "mode": "chain",
  "scope": { "rootDir": "src/core", "files": ["src/core/route/nav.c"] },
  "features": [
    {
      "id": "CH-1",
      "name": "导航距离计算链路",
      "section": "3.2",
      "description": "从 route_ok 入口经 normalize 归一化输入、distance_km 计算球面距离，结果回传调用方。",
      "entry_function": "route_ok",
      "files": ["src/core/route/nav.c"],
      "functions": ["route_ok", "normalize", "distance_km"],
      "chain_order": ["route_ok", "normalize", "distance_km"],
      "sub_features": [
        { "id": "CH-1.1", "name": "输入归一化", "files": ["src/core/route/normalize.c"], "functions": ["normalize"] }
      ]
    }
  ],
  "callgraph": {
    "nodes": [
      { "id": "route_ok", "label": "route_ok", "type": "function", "file": "src/core/route/nav.c" },
      { "id": "normalize", "label": "normalize", "type": "function", "file": "src/core/route/normalize.c" },
      { "id": "distance_km", "label": "distance_km", "type": "function", "file": "src/core/route/nav.c" }
    ],
    "edges": [
      { "from": "route_ok", "to": "normalize" },
      { "from": "route_ok", "to": "distance_km" }
    ]
  },
  "problems": [
    {
      "id": "C-1",
      "file_name": "src/core/route/nav.c",
      "function_name": "route_ok",
      "feature_id": "CH-1",
      "source_code": "int route_ok(...) { ... return normalize(...) == OK; ... }",
      "problem_reason": "ch-error-propagation：错误被吞掉或未沿链传播",
      "issue_level": "重要问题",
      "issue_name": "route_ok 直接使用 normalize 的结果，未检查上游失败路径",
      "issue_location": "src/core/route/nav.c:route_ok",
      "description_requirement": "应在链上定义并传播错误状态，route_ok 据此返回明确结果。",
      "description_issue": "route_ok 直接使用 normalize 的结果，未检查上游失败路径，链上错误被吞。",
      "description_location": "src/core/route/nav.c文件的route_ok函数的30行：return normalize(...) == OK;源程序为：\nint route_ok(...) {\n    ...\n    return normalize(...) == OK;\n}",
      "description_impact": "上游失败被静默吞掉，调用方误以为路由可用。",
      "related": ["src/core/route/normalize.c:normalize"],
      "evidence": "调用图: route_ok -> normalize(28,29), distance_km(30)"
    }
  ]
}
```

JSON 块只在完整时输出，其后不跟文字。

**功能模块 `features`（链路审查四栏的第一栏「功能模块列表」的数据源，必填）**：
按需求文档章节把本次审查覆盖的链路拆成功能模块，输出成树：顶层模块用 `sub_features`
嵌套子功能。每个模块填 `id`、`name`（`section` 有章节号就带上），并尽量给出
`files` / `functions` / `chain_order`（该链路里函数按调用先后排列的名单，入口在前）
与 `description`（一句话功能说明，渲染在第四栏「功能介绍」）。**`features[].id` 要稳定**，
`problems[].feature_id` 引用它——前端据此在选中某模块时精确收敛问题。

**调用关系 `callgraph`（可选）**：链路涉及的文件 / 函数调用边，**必须来自 `get_call_graph`
的索引结果，不得凭记忆构造**。提供了就会在第二栏「调用关系」标签页画出调用图；不提供时
那一页退化为按 `chain_order` 还原的链路顺序，仍然可用。

**落盘（供前端面板读取）**：把这份完整 JSON 写入 `fileOutputDir` 指定的目录
（场景默认是项目根下的 `reviews/`），文件名为 `<taskId>-<mode>-review.json`，
`taskId` 用 `index_project` 返回的 taskId，`mode` 为 `chain`。若目录不存在则创建。
面板会读取该文件渲染问题清单。

**进度（供前端进度条读取）**：审查过程中把进度写入 `<taskId>-<mode>-progress.json`
（协议见 `references/progress-schema.json`）：开始时写 `status: "running"`、`total` 为
待查链路/函数总数；每批完成更新一次；全部审完写 `status: "done"`。大库分批时按
`references/batch-review-guide.md` 维护，支持断点续审。

## 6. Constraints

- **绝不下最终结论**；**绝不改写用户已确认的代码**；**必须引来源**（链上 `description_location`）。
- **干净时输出空 `problems` 数组**，不制造问题。
