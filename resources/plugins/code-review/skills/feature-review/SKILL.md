---
name: feature-review
description: Perform a code review over a whole feature of a C/C++ project — completeness versus requirements, boundary and edge handling, input validation, behavior mismatch, default behavior, concurrency/timing, testability, cross-mode consistency, and documentation. Use when the user asks to review a feature / functionality in code, check a feature against its requirement, or audit end-to-end behavior of a capability. Reports issues with source (file + stable locator), type, severity, and a suggested direction — never a final verdict, never rewrites code.
---

# Feature Review（功能审查）

对**一个完整功能/特性**做审查：它覆盖了需求里要求的哪些行为、边界与异常路径是否
齐备。本 skill **不下最终结论、不改代码**。

## 1. Inputs

- **代码目录**（必填）：C/C++ 源码根目录。
- **功能范围**（必填）：待审查的功能，以及（如存在）对应需求描述。若功能或需求描述
  缺失，先问，不臆造功能边界。

先用 `code-review-index` MCP 建索引。

## 2. 使用索引（必备第一步）

1. `index_project`（rootDir、dbPath=项目 review 库）。
2. 用 `list_functions` / `get_call_graph` 圈定该功能涉及的函数与入口，
   再用 `get_function` 取每个函数的源码核对行为、边界与输入处理。

**所有行号与调用关系来自索引，不得编造。**

**大库分批（功能/涉及函数数量很大时强制）**：若范围涉及函数在数百/数千以上，按
`references/batch-review-guide.md` 分批：每批只把该批涉及的函数源码取进上下文、
审完即落盘、**不重读已审函数源码**，并持续写进度文件。上下文吃紧时先落盘再结束本轮。

## 3. 固定问题目录

只检查 `references/check-catalog.json` 中的类型：

- `fe-incomplete` 功能不完整 / 与需求有缺口
- `fe-boundary` 边界条件缺失
- `fe-input-validation` 输入校验缺失
- `fe-requirement-mismatch` 行为与需求不符
- `fe-default` 缺省值 / 默认行为未定义
- `fe-concurrency` 并发 / 时序问题
- `fe-testability` 可测试性差
- `fe-consistency` 跨模式 / 跨配置行为不一致
- `fe-documentation` 功能说明 / 注释缺失

问题等级 `issue_level` 只有**两级**（不得输出第三级，尤其不得输出「建议改进」——
编码规范/风格建议类问题一律不报，后端解析层也会自动丢弃该等级）：
- `重要问题` = 功能不满足需求、边界/校验缺失导致错误或崩溃；
- `一般问题` = 会造成错误行为或在特定输入/时序下出错，但后果可控。

## 4. Method

1. 依据功能范围与需求，列出应具备的行为、边界、异常场景，逐项对照实现核对。
2. 每条 problem 落在**最能代表问题的那处代码**：`description_location` 用该函数的
   `文件` + `函数` + `行号` + 可全字匹配的问题代码语句（见 `references/locator-rules.md`），
   涉及多个函数时用 `related` 关联（`issue_location`）。
3. 需求依据或代码依据写入 `evidence`。

> **大型代码库（功能涉及大量函数或含上千行函数）**：遵循 `references/batch-review-guide.md` 的
> **独立对话调度模式**——**一个功能 = 一个独立对话**（不是按函数打包）；
> 功能 > 2500 行时**功能内分段**（按行为 / 边界 / 异常场景切），每段一个对话
> （`create_thread` → `send_to_thread` → `wait_for_thread`），子对话写
> `<taskId>-feature-batch-<N>.json`，主对话聚合 + 更新进度 + `delete_thread` 删除。
> 并发滑动窗口 2-4。小场景直接单对话审完落盘。

## 5. Output

分两部分回复。

**Part 1 — 可读 Markdown 报告**：按严重度分组，说明功能缺口、涉及函数与建议方向。

**Part 2 — 机器可读问题列表**，作为回复中**最后一个 ```json 代码块**，符合
`references/issue-schema.json`（`mode: "feature"`）。`issue_level` 用中文两级（`重要问题` / `一般问题`），
`description_location` 严格按 `xx文件的xx函数的xx行：问题代码语句源程序为：\n保留上下文源代码`
输出（问题代码语句供前端全字匹配定位）：

```json
{
  "kind": "code-review-report",
  "version": 1,
  "mode": "feature",
  "scope": { "rootDir": "src/core", "files": ["src/core/route/nav.c"] },
  "features": [
    {
      "id": "F-1",
      "name": "导航距离计算",
      "description": "按两点经纬度计算球面距离，供路径长度与导航判断使用（来自用户给出的功能描述）。",
      "entry_function": "distance_km",
      "status": "done",
      "files": ["src/core/route/nav.c"],
      "functions": ["distance_km", "route_ok"]
    }
  ],
  "problems": [
    {
      "id": "FE-1",
      "file_name": "src/core/route/nav.c",
      "function_name": "distance_km",
      "feature_id": "F-1",
      "source_code": "double distance_km(...) { ... dlat = (lat2 - lat1) * DEG_TO_RAD; ... }",
      "problem_reason": "fe-boundary：边界条件缺失",
      "issue_level": "重要问题",
      "issue_name": "导航距离功能未处理 lat/lon 越界输入",
      "issue_location": "src/core/route/nav.c:distance_km",
      "description_requirement": "应在功能入口统一校验并定义越界返回值约定。",
      "description_issue": "导航距离功能未处理 lat/lon 越界输入，极端输入下结果不可信。",
      "description_location": "src/core/route/nav.c文件的distance_km函数的23行：dlat = (lat2 - lat1) * DEG_TO_RAD;源程序为：\ndouble distance_km(...) {\n    ...\n    dlat = (lat2 - lat1) * DEG_TO_RAD;\n    ...\n}",
      "description_impact": "极端输入下返回不可信距离，影响导航判断。",
      "related": ["src/core/route/nav.c:route_ok"],
      "evidence": "需求: 导航距离在越界输入下应明确返回约定；代码: 入口未校验"
    }
  ]
}
```

JSON 块只在完整时输出，其后不跟文字。

**功能清单 `features`（功能审查四栏的第一栏「功能列表」的数据源，必填）**：
把本次审查的**每个功能**作为一条平铺列出（一次只审一个功能就只写一条），每条的
`id` 稳定，并填 `name`、`description`（用户给出的功能描述）、`entry_function`、
`status`（`done` / `failed`）、`files`、`functions`。**`features[].id` 要稳定**，
`problems[].feature_id` 引用它——前端据此在选中某功能时精确收敛问题。

**落盘（供前端面板读取）**：把这份完整 JSON 写入 `fileOutputDir` 指定的目录
（场景默认是项目根下的 `reviews/`），文件名为 `<taskId>-<mode>-review.json`，
`taskId` 用 `index_project` 返回的 taskId，`mode` 为 `feature`。若目录不存在则创建。
面板会读取该文件渲染问题清单。

**进度（供前端进度条读取）**：审查过程中把进度写入 `<taskId>-<mode>-progress.json`
（协议见 `references/progress-schema.json`）：开始时写 `status: "running"`、`total` 为
待查功能/函数总数；每批完成更新一次；全部审完写 `status: "done"`。大库分批时按
`references/batch-review-guide.md` 维护，支持断点续审。

## 6. Constraints

- **绝不下最终结论**；**绝不改写用户已确认的代码**；**必须引来源**（代码 `description_location`）。
- **干净时输出空 `problems` 数组**，不制造问题。
