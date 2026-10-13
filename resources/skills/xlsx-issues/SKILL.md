---
name: xlsx-issues
description: "当用户上传 Excel（.xlsx）问题单/缺陷单/检查单，要求逐行读取表格里的问题、按每行给的代码位置修复源码，并把每行修复状态回写到问题单时使用。用 AgentEmployee 内置的 Python 运行时（自带 openpyxl，用户无需安装）解析工作簿结构与行内容，逐行修复后回写状态到问题单副本。只在本技能自带脚本内完成，不自行写脚本；不可用内置运行时须停下告知用户，禁止 pip install。"
---

# Excel 问题单逐行修复（xlsx-issues）

用户上传一份 **问题单工作簿（.xlsx）**，其中**每一行是一个问题**（含问题描述与代码位置），
要求 agent 解析工作簿结构、定位问题单所在 sheet、逐行到指定源码位置修复，
最后把每行的修复状态**回写到问题单的副本**（不覆盖原文件）。

## 一、先解析内置解释器（必做，不要假设 `python` 在 PATH）

**`python` 这个名字不保证在该 shell 的 PATH 上**——agent 的运行 shell 与 AgentEmployee 终端的
PATH 来源不同。先按下面的阶梯解析出**解释器绝对路径**，记为 `<PYTHON>`：

1. **`python` / `python3`**：先直接试；导入检查能过就用它本身。
2. **应用注入的位置**：`$AGENTEMPLOYEE_BUNDLED_PYTHON_DIR\<platform>-<arch>\python.exe`
   （Windows 上即 `...\python\win32-x64\python.exe`）。不依赖 PATH。
3. **应用安装目录**：`<安装目录>\resources\python\win32-x64\python.exe`。

导入检查（缺 `openpyxl` 就换下一个候选）：

```bash
<PYTHON> -c "import openpyxl; print('py-ok', openpyxl.__version__)"
```

- 输出 `py-ok ...` → 继续，并**把 `<PYTHON>` 用于后面所有脚本调用**。
- 三级都不可用 → **停止并告诉用户**：内置运行时缺失（或未随应用打包，或未安装 openpyxl）。
  **不要** `pip install`；也不要改用缺少 `openpyxl` 的系统 Python。
- 内置运行时目前**仅随 Windows(x64) 打包**；WSL / Linux 项目下不可用，遇到就说明并停下。

## 二、技能目录与脚本

本技能文件都在**本 SKILL.md 所在目录**（注入时的 `dir` 属性）下，下文用 `【技能目录】` 表示：

- `【技能目录】/scripts/parse_xlsx.py`：**只读**解析工作簿。`--list` 列出全部 sheet
  （名称 / 行列数 / 表头 / 前几行预览）；`--sheet <名或索引>` 输出该 sheet 的全部行。
- `【技能目录】/scripts/manifest.py`：**任务清单**（JSONL 事件流，对话外持久化、可断点续跑）。
  子命令 `init` / `next` / `mark` / `stats` / `export-statuses` / `compact`。
  每次 `init`/`mark`/`compact` 会在**清单同目录**自动写 `summary.json`（按规则/状态的聚合计数，
  外加 `attention/attentionTotal`：`needs-review`/`failed`/`skipped` 的前 50 条），应用右栏据此显示
  进度与「待确认」条目——无需额外命令；需指定路径时用 `stats --summary-out`。
- `【技能目录】/scripts/write_status.py`：把清单状态回写到问题单**副本**（`--merge` 增量）。

**不要改写 `【技能目录】` 下任何文件**（打包后只读），也**不要临时另写** Python/shell 脚本；
脚本能力不足时停下问用户。所有产物写到项目内。

**调用形式**：一律用 `<PYTHON>` 的**绝对路径**调脚本；文件/中文/路径都作为 `--file`、`--out`
等**文件参数**传入，**不要**塞进 `-c` 内联命令（PowerShell 的引号与 GBK 会把 `-c` 拼坏）。

## 三、工作流（分阶段，先确认问题 sheet 再动手）

### 阶段一 · 解析结构与定位问题 sheet（停下等确认）

1. 用 `--list` 看工作簿结构：

   ```bash
   <PYTHON> "【技能目录】/scripts/parse_xlsx.py" --list "<问题单.xlsx>"
   ```

2. 读返回的 JSON：`sheets[].name` / `maxRow` / `maxColumn` / `header` / `preview`。
   判断**哪个 sheet 是问题单**（逐行为问题、含“问题描述/代码位置”等列）。
3. **向用户报告你的理解并停下确认**：问题单所在 sheet 名、每列的含义（哪个是问题描述、
   哪个是代码位置、编号列等）、共有多少行问题。**未确认不得开始改动源码。**

> 若用户已在提示里指明 sheet 名或列含义，可直接沿用，但仍要**原样复述**列映射视为确认。

### 阶段二 · 建清单 + 按规则分批修复（可断点续跑）

**上万条问题单个对话装不下，所以进度落在盘上。** 清单是 JSONL 事件流，默认
`<项目根>/.agentemployee/xlsx-issues/manifest.jsonl`；**它是唯一真相源，Excel 只是它的投影**。

1. 建清单（已存在就**不要**重建，直接续跑）：

   ```bash
   <PYTHON> "【技能目录】/scripts/manifest.py" init --xlsx "<问题单.xlsx>" --sheet "<sheet名>"
   ```

   返回 JSON 含 `total` 与 `byRule`（按规则的任务数）。列名默认按表头自动识别
   （规则 / 文件 / 代码位置 / 描述）；不符时用 `--rule-column` / `--file-column` /
   `--locator-column` / `--desc-column` 覆盖（传表头文字或列号），并**复述给用户确认**。

2. **把「规则」列成任务**：用你的计划/待办工具，**每条规则一个步骤**（通常几十条；
   **不要**把上万行当步骤）。没有计划工具就把 `byRule` 复述给用户，按规则推进。

3. **循环，每轮只处理一小批（默认 ≤50 行，绝不整表读入上下文）：**
   - 取一批：`manifest.py next --rule "<规则>" --limit 50`（默认只取 `pending`）。
   - 逐条修复：用清单里的 `file` + `locator`（**符号/片段，不是行号**——行号会随前序修改
     漂移，修复前**现场定位**），读源码、按 `desc` 修，保持行为不变。
   - 每行报告：`第 N 行｜问题 → 文件:符号 → 修复 → 依据`。
   - **本批立刻落盘**（不要攒到最后）：

     ```json
     // <项目根>/.agentemployee/xlsx-issues/batch.json
     { "rows": [
       { "id": "I000001", "status": "done", "note": "src/a.ts:login —— 删除未使用变量" },
       { "id": "I000002", "status": "needs-review", "note": "未给文件，已向用户询问" } ] }
     ```
     ```bash
     <PYTHON> "【技能目录】/scripts/manifest.py" mark --batch "<项目根>/.agentemployee/xlsx-issues/batch.json"
     <PYTHON> "【技能目录】/scripts/manifest.py" stats
     ```
   - 状态取值 `pending|in_progress|done|skipped|failed|needs-review`；含糊/改不动的行标
     `needs-review`/`skipped`，**不阻塞**后续批次；`failed` 记原因。
   - 每轮结束**增量回写副本**（阶段三），进度随时可见。

4. 规则全部 `done`（或只剩 `needs-review`/`skipped`）后收尾。

**断点续跑**：随时被 compaction / 线程重启 / 应用重启打断都不怕——清单在盘上。新会话里先
`manifest.py stats` 看进度，再 `next` 接着做。需要压缩日志用 `manifest.py compact`。

**上下文纪律（硬性）**：**永不**把整份 manifest 读进对话（万行 >1MB，也超读取上限）；
只用 `next` 取当前小批、用 `stats` 看聚合计数。清单本身**只经脚本读写，不手改**。

### 阶段三 · 增量回写状态到问题单副本

由清单导出状态并回写副本（`--out` 必须不同于 `--file`）。**每批都可重跑**，`--merge` 在已有
副本上增量更新，不再整本重建：

```bash
<PYTHON> "【技能目录】/scripts/manifest.py" export-statuses \
  --out "<项目根>/.agentemployee/xlsx-issues/statuses.json" --only-touched
<PYTHON> "【技能目录】/scripts/write_status.py" \
  --file "<问题单.xlsx>" \
  --out  "<项目根>/<原文件名>-修复结果.xlsx" \
  --sheet "<sheet名>" \
  --statuses "<项目根>/.agentemployee/xlsx-issues/statuses.json" \
  --status-header "修复状态" --note-header "修复说明" --merge
```

- `--only-touched` 只导出已处理的行；收尾时可去掉它，让副本把剩余行也标成 `pending`。
- `row` 用**电子表格的 1 基行号**（表头第 1 行，与清单一致）。
- `--merge`：`--out` 已存在时以其为基准增量更新，保留前几批结果；**绝不动原文件**。

## 四、约束

- **只用本技能自带脚本**解析/记账/回写工作簿；改源码用你自己的编辑工具。不要另写脚本。
- **先确认后动手**：阶段一列出的问题 sheet 与列映射，未经用户确认不得改源码。
- **清单是唯一真相源，Excel 是它的投影**：进度只写进 manifest（经 `manifest.py`），不要手改
  manifest 文件，也不要把 Excel 当状态存储。
- **不覆盖原文件**：回写一律用 `--merge` 写到新副本；中间文件放 `<项目根>/.agentemployee/xlsx-issues/`。
- **不整读清单**：万级清单只用 `next` 分页取批、`stats` 看计数，绝不整表读进上下文。
- **规则=任务，行=清单**：计划/待办里每条规则一个步骤，不要把上万行当步骤。
- **行为不变、不臆造**：含糊的问题行先问用户，不猜代码位置、不扩张改动范围。
- **产物在项目内**：不写进技能目录或 AgentEmployee 安装目录。
- 只处理 `.xlsx`（旧版 `.xls` 不支持；脚本会报错，提示用户改存为 `.xlsx`）。
