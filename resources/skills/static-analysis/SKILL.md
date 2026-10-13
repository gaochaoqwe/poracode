---
name: static-analysis
description: "当用户创建静态分析任务（场景 static-analysis，模式 纯AI模式·C/normal_c、纯AI模式·FPGA/normal_fpga、工具模式·C/filter_c、工具模式·FPGA/filter_fpga）并要求对代码目录做 GJB8114/CWE 静态分析、生成四段式问题单时使用。工具模式需先解析科代静态分析工具导出的 Excel（.xlsx，列映射编号A/缺陷名称D/问题文件K/问题行数L/问题描述M，目标 sheet 含 GJB_8114）。用 AgentEmployee 内置 Python 运行时（自带 openpyxl）做确定性解析与规则匹配，AI 判定（不确定规则是否真问题）由 agent 完成，最后把结果写成 <项目根>/static-analysis/<taskId>-<mode>-report.json 与 -progress.json（契约见 src/shared/staticAnalysisReport.ts）。只在本技能自带脚本内完成确定性部分，不自行另写脚本；内置运行时不可用须停下告知用户，禁止 pip install。"
---

# 静态分析（static-analysis）

对指定**代码目录（工作区）**执行 GJB8114 / CWE 规则静态分析，输出**四段式问题单**
（需求描述/问题描述/问题定位/影响分析 + 测评单位意见）。**模式决定了输入与执行路径**：

| 模式 | 含义 | 输入 | 执行方式 |
|---|---|---|---|
| `normal_c` | 纯AI模式·C语言 | 代码目录 | agent 按规则库审查 C 代码 |
| `normal_fpga` | 纯AI模式·FPGA | 代码目录 | agent 按规则库审查 FPGA/HDL 代码 |
| `filter_c` | 工具模式·C语言 | 科代 Excel + 代码目录 | 先解析 Excel，再规则匹配 + AI 过滤 |
| `filter_fpga` | 工具模式·FPGA | 科代 Excel + 代码目录 | 同上，目标 FPGA |

任务创建时即已落库（全局 `state.sqlite` 的 static_analysis_* 表）；你只需按本技能把
分析结果写成 `<项目根>/static-analysis/<taskId>-<mode>-report.json`（+ 进度文件），
主进程会自动摄入、渲染端三栏代码视图会轮询展示。**文件名里的 taskId 与 mode 必须和
任务一致**，否则摄入会找不到对应任务行。

## 一、先解析内置解释器（必做，不要假设 `python` 在 PATH）

`python` 不保证在该 shell 的 PATH 上。按下面阶梯解析出解释器绝对路径 `<PYTHON>`：

1. `python` / `python3`：直接试，导入检查能过就用它本身。
2. 应用注入：`$AGENTEMPLOYEE_BUNDLED_PYTHON_DIR\<platform>-<arch>\python.exe`。
3. 应用安装目录：`<安装目录>\resources\python\win32-x64\python.exe`。

导入检查（缺 `openpyxl` 就换下一个候选）：

```bash
<PYTHON> -c "import openpyxl; print('py-ok', openpyxl.__version__)"
```

- 输出 `py-ok ...` → 继续，后面所有脚本调用都用这个绝对路径。
- 三级都不可用 → **停下告诉用户**：内置运行时缺失；**不要** `pip install`，也不要改用缺
  `openpyxl` 的系统 Python。内置运行时目前仅随 Windows(x64) 打包。

## 二、技能目录与脚本

本技能文件都在**本 SKILL.md 所在目录**（注入时的 `dir` 属性），下文用 `【技能目录】` 表示：

- `【技能目录】/scripts/static_analysis.py`：确定性辅助脚本，子命令见下。**不要改写技能目录
  下任何文件**（打包后只读），也**不要临时另写** Python/shell 脚本；能力不足就停下问用户。

调用一律用 `<PYTHON>` 绝对路径，文件/中文/路径作为 `--xx` **文件参数**传入，不塞进 `-c`。

### 子命令一览

- `parse-excel <xlsx> [--out issues.json]`：解析科代 Excel → `{success,total,sheets,issues}`，
  每条 issue 含 `issue_name / issue_file / issue_line / issue_description / gjb_rule_code /
  sheet_name / row_index`。
- `match --issues issues.json --rules-dir <dir> [--selected r1,r2] [--out problems.json]`：
  规则匹配 + 基础过滤 + 四段式问题单 → `{success,total,problems}`。每条 problem 已带
  `problem_sheet.four_part_description`、`problem_sheet.test_unit_opinion`、`issue_level`、
  `rule_code/rule_type/rule_accuracy_type`、`description_requirement/…/description_impact`。
  `--rules-dir` 可省略，脚本会自动探测（仓库 `resources/static-analysis/rules` 或打包路径）。
- `rules --rules-dir <dir> [--type gjb|cwe] [--selected ...] [--out rules.json]`：导出规则库
  （纯AI模式审查看选中规则用）。
- `emit-report --task-id <id> --mode <mode> [--selected ...] [--problems problems.json]
  [--files files.json] --out <report.json>`：组装报告。`--files` 传 `[{file_name,file_path}]`
  时脚本自动读源码片段与函数名。
- `emit-progress --task-id <id> --mode <mode> --status running --progress 60 ... --out <progress.json>`：
  写进度文件（阶段间推进渲染端进度条）。

**报告/进度文件路径**：一律 `<项目根>/static-analysis/<taskId>-<mode>-report.json` 与
`<taskId>-<mode>-progress.json`。目录不存在就创建。

## 三、工具模式（filter_c / filter_fpga）工作流

### 阶段一 · 解析科代 Excel（只读）

```bash
<PYTHON> "【技能目录】/scripts/static_analysis.py" parse-excel "<科代结果.xlsx>" --out "<项目根>/static-analysis/parsed-issues.json"
```

- 脚本只读目标 sheet（优先含 `GJB_8114`，跳过 `项目详情/你的问题汇总`），列映射已固定。
- 读取 `parsed-issues.json`，**向用户复述**：命中的 sheet、问题总数、规则命中情况。未确认
  一般不阻塞（这是只读解析），但问题数异常（0）要停下说明。

### 阶段二 · 规则匹配 → 问题单草稿

```bash
<PYTHON> "【技能目录】/scripts/static_analysis.py" match --issues "<parsed-issues.json>" --out "<项目根>/static-analysis/matched-problems.json"
```

- 命中规则 `accuracy_type == "accurate"` 的问题 → **确定问题**，直接保留。
- 命中规则 `accuracy_type == "uncertain"` 或**未命中任何规则**的问题 → **不确定**，进入
  阶段三 AI 判定。
- 含排除关键词（如"建议"）的问题 → 标 `is_filtered=true`、`ai_analyzed=true`、
  `ai_is_real_issue=false`、`filter_reason="含排除关键词(建议)"`，不进 AI 判定。

### 阶段三 · AI 判定不确定问题（agent 亲自做）

对每条 `rule_accuracy_type=="uncertain"` 且未过滤的问题，**到代码目录读取该问题
`issue_file` 对应行附近源码**，依据 `rule_description` 判断是否真违反规则：

- 判定为真问题：`ai_analyzed=true`、`ai_is_real_issue=true`、`ai_confidence=0~1`、
  `ai_reasoning`（为何违反）、`ai_recommendations`（如何改）、`problem_status` 保持 0。
- 判定为误报/不违反：`ai_is_real_issue=false`、`ai_confidence`、`ai_reasoning`，
  并视需要 `is_filtered=true`、`filter_reason="AI判定非真问题"`、`problem_status=3`。
- **如何改这些字段**：`matched-problems.json` 是草稿；你在内存中构造最终 `problems` 数组
  （在每条 problem 上补齐 AI 字段），再交给 `emit-report`。不要把草稿文件本身当最终报告。

### 阶段四 · 文件清单 + 出报告 + 进度

1. 生成文件清单（被问题命中的源码文件）`<项目根>/static-analysis/files.json`：
   `[{"file_name","file_path"}]`（路径相对项目根解析；读不到源码也保留路径，`source_code`
   留空即可）。
2. 出报告：

   ```bash
   <PYTHON> "【技能目录】/scripts/static_analysis.py" emit-report \
     --task-id "<taskId>" --mode "filter_c" \
     --problems "<最终 problems.json>" --files "<files.json>" \
     --out "<项目根>/static-analysis/<taskId>-filter_c-report.json"
   ```

3. 期间分阶段写进度（running→progress 递增→completed），收尾把 status 置 `completed`。

## 四、纯AI模式（normal_c / normal_fpga）工作流

1. **拿规则**：`rules --type gjb|cwe` 导出选中规则（或从任务给的选择）；工具模式也可复用
   但纯AI模式**无 Excel**，规则即审查依据。
2. **扫代码**：遍历代码目录里的 C（`.c/.h/.cpp`）或 FPGA（`.v/.sv/.vhd/.vhdl`）源文件，
   对照选中规则的 `rule_description / keywords / detection_method` 逐文件审查。
3. **构造问题单**：对每个真问题，构造与 `match` 输出**同构**的 problem（字段见契约），
   四段式用相同模板：

   ```
   需求描述:<将问题名反译成正向要求>。
   问题描述:<问题名>。
   问题定位: <file>文件<line>行,具体内容如下："<源码片段>",如上述内容所示,<问题名>。
   影响分析:<按问题名生成的影响>。
   ```

   `issue_level`：含"越界/章节缺失/失效"→重要问题，否则一般问题。`rule_accuracy_type`：
   规则自带；纯AI审查结论放 `ai_analyzed=true / ai_is_real_issue=true / ai_reasoning /
   ai_recommendations`。
4. **出报告 + 进度**：同工具模式阶段四（mode 用 `normal_c` / `normal_fpga`）。

## 五、报告字段契约（必须对齐 `src/shared/staticAnalysisReport.ts`）

`report.json` 顶层：`{ schemaVersion:1, taskId, mode, fileName, files:[], problems:[],
selectedRules:[] }`。

每条 problem 关键字段：`problemId, issue_name, issue_file, issue_line, issue_location,
issue_description, issue_level, rule_code, rule_type(gjb|cwe|fpga|null), rule_accuracy_type
(accurate|uncertain), ai_analyzed, ai_is_real_issue, ai_confidence, ai_analysis_result,
ai_reasoning, ai_recommendations, problem_status(0新发现/1已查看/2已过滤/3已标记), is_filtered,
filter_reason, file_name, violation_rules, description_requirement, description_issue,
description_location, description_impact, problem_sheet{issue_name,four_part_description,
test_unit_opinion}, function_name, source_code, sheet_name, row_index`。

`progress.json` 顶层：`{ taskId, mode, status(pending|running|paused|completed|failed), progress,
totalFiles, processedFiles, totalProblems, totalRules, accurateRules, uncertainRules,
totalUnits, processedUnits, currentRuleCode, currentAnalyzingIssue, toolCallsCount, updatedAt }`。

## 六、约束

- **只用本技能自带脚本**做确定性部分（Excel 解析/规则匹配/报告组装）；改源码、AI 判定用
  你自己的能力。
- **文件名=摄入契约**：`<taskId>-<mode>-report.json` / `<taskId>-<mode>-progress.json`，
  taskId 与 mode 必须与创建的任务一致，否则落库找不到任务行（渲染端不显示）。
- **产物在项目内**：全部写到 `<项目根>/static-analysis/`，不写技能目录或安装目录。
- **AI 判定要落到代码**：不确定问题必须读源码后判断，不臆造 `ai_reasoning`。
- **进度要推进**：长任务按阶段写 progress，别攒到最后一次写完。
- **不覆盖用户源码**：只读审查，不改代码。
- 只处理 `.xlsx`（旧版 `.xls` 不支持，提示用户改存为 `.xlsx`）。
