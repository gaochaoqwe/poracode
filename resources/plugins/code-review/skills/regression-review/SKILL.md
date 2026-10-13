---
name: regression-review
description: Perform a regression review over changed code against an uploaded impact-analysis report — check consistency between the code change and the report's claimed impact scope, and review the change itself for semantic problems. Use when the user asks to review a regression / a code change against an impact-analysis report, verify that a change matches its stated impact, or audit what a change might break. Reports issues with source (file + stable locator), type, severity, and a suggested direction — never a final verdict, never rewrites code.
---

# Regression Review（回归审查）

对**代码变更**做回归审查，双任务合一：
1. **一致性**：变更代码 vs 影响域分析报告是否一致（报告覆盖的变更、影响范围判断是否正确、是否遗漏变更或夸大影响）。
2. **变更本身**：变更代码本身有没有语义级问题（功能逻辑、边界、异常、资源、数据传递等）。

本 skill **不下最终结论、不改代码**——只指出问题与方向，确认与修订由用户决定。

## 1. Inputs

- **影响域分析报告**（必填）：用户上传，描述本次变更的变更内容、影响文件/函数/模块、风险点。
  缺失时先问，不臆造报告内容。
- **变更范围**（必填）：基线路径（旧代码）+ 变更路径（新代码）。若只有工作区变更（无独立旧目录），
  用 Poracode 的 git diff 通道。

## 2. 取变更差异（必备第一步）

- 用 **`diff_paths`** MCP（`leftPath` = 基线/旧，`rightPath` = 变更/新）取变更 diff 与 `changedFiles`。
  可先用 `statOnly: true` 看变更文件清单，再按需 `filePaths` 取指定文件的完整 diff。
- **变更文件清单是"本次变更"的事实来源**；变更内容、行号以 `diff_paths` 返回为准，不得编造。

## 3. 双任务审查

**任务 A — 一致性审查**（变更 vs 报告）：
- 报告声称影响的文件 / 函数 / 模块，与 `changedFiles` 是否一致？
- 报告遗漏的实际变更（diff 有、报告未提及）？
- 报告声称影响但代码并未变更（报告夸大 / 过时）？
- 影响范围判断（新增 / 修改 / 删除、调用方、数据流、边界）是否正确？

**任务 B — 变更本身语义审查**：
- 只审**语义级**问题：功能逻辑、边界 / 异常路径、资源与生命周期、数据 / 错误传递、并发 / 时序。
- **不限定问题类型**；不审纯编码规范类（除非直接导致缺陷）。

## 4. Output

分两部分回复。

**Part 1 — 可读 Markdown 报告**：一致性问题 + 变更问题，按严重度分组（重要在前）。

**Part 2 — 机器可读问题列表**，作为回复中**最后一个 ```json 代码块**。每条 problem 字段：

```json
{
  "kind": "code-review-report",
  "version": 1,
  "mode": "regression",
  "scope": { "leftPath": "…", "rightPath": "…", "files": ["src/core/nav.c"] },
  "problems": [
    {
      "id": "R-1",
      "file_name": "src/core/route/nav.c",
      "issue_level": "重要问题",
      "issue_name": "变更新增的分支未在影响域报告中声明",
      "issue_kind": "consistency",
      "consistency_kind": "missing",
      "description_location": "src/core/route/nav.c文件的route_ok函数的45行：if (lat2 - lat1 > DEG_MAX) return -1;源程序为：\nint route_ok(...) {\n    ...\n    if (lat2 - lat1 > DEG_MAX) return -1;\n}",
      "description_requirement": "影响域报告应覆盖本次变更新增的所有行为分支。",
      "description_issue": "diff 显示新增了对 lat 越界的提前返回，但报告未提及该分支及对调用方的影响。",
      "description_impact": "新增分支可能改变调用方行为而未在影响域分析中识别。",
      "evidence": "diff_paths changedFiles + 报告对应段落"
    }
  ]
}
```

- `issue_level` 用中文**两级**：`重要问题` / `一般问题`（不得输出「建议改进」，后端解析层会自动丢弃该等级）。
- `issue_kind`：`consistency`（一致性）或 `change`（变更本身）。
- `consistency_kind`（仅 consistency）：`missing`（报告遗漏）/ `overclaim`（夸大或未变更）/ `mismatch`（不一致）/ `correct`。
- `description_location` 严格为 `xx文件的xx函数的xx行：<可全字匹配的问题代码语句>源程序为：\n<保留关键上下文的源码>`，定位到**变更代码**；JSON 内换行用 `\n` 转义。

**落盘（供前端面板读取）**：把这份完整 JSON 写入 `fileOutputDir`（场景默认项目根 `reviews/`），
文件名为 `<taskId>-regression-review.json`（`taskId` 与报告/任务关联），若目录不存在则创建。
面板读取该文件渲染问题清单。

**落盘 diff 数据（供前端 diff 视图）**：在取到 `diff_paths` 的变更结果后，除问题单外，
还要把差异数据额外写一份到同一 `fileOutputDir`（与问题单同目录，默认 `reviews/`），
文件名为 `<taskId>-regression-diff.json`。结构如下：

```json
{
  "kind": "code-review-regression-diff",
  "version": 1,
  "taskId": "<taskId>",
  "leftPath": "<基线目录（有则填）>",
  "rightPath": "<变更目录（有则填）>",
  "updatedAt": "<ISO 时间，可选>",
  "changedFiles": [
    { "path": "src/core/route/nav.c", "status": "modified", "left": "<基线完整文件文本>", "right": "<变更后完整文件文本>" }
  ]
}
```

三点要求：
- `status` 取值仅为 `modified` / `added` / `deleted`。
- `left` 为基线（变更前）**完整文件文本**，新增文件为 `null`；`right` 为变更后**完整文件文本**，
  删除文件为 `null`。写入的是**完整文件文本**，**不是 unified diff 格式**——行映射由前端
  Monaco DiffEditor 自行计算，无需写入 JSON。
- `changedFiles` 只包含 `diff_paths` 覆盖到的变更文件，不要夹带未变更的文件。

## 5. Constraints

- **绝不下最终结论**：只报问题与方向，决策权在用户。
- **绝不改写用户已确认的代码**：只指出问题；修复是用户的动作。
- **必须引来源**：无 locator（变更代码或报告段落）的 issue 不可用。
- **若变更干净且与报告一致**，输出空 `problems` 数组，不制造 issue。
