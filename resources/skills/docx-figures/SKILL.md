---
name: docx-figures
description: "当用户要求往 Word 文档里插图、画图、生成配图、做系统组成图/流程图/性能曲线，或提到 matplotlib、python-docx 插图、GJB 438C 配图时使用。用 AgentEmployee 内置的 Python 运行时（无需用户安装）渲染图表并插入到指定 .docx 的锚点处，自动续编图号。只在本技能自带脚本内完成，不自行写脚本。渲染后必须用多模态读回 PNG 逐项自检并按清单迭代，禁止一次出图直接交付。"
---

# Word 配图与插图（docx-figures）

用 AgentEmployee **内置的 Python 运行时**（自带 `matplotlib`、`python-docx`，用户无需安装）
把图表渲染成 PNG，并插入到已有 `.docx` 的指定位置。

## 一、先解析内置解释器（必做，不要假设 `python` 在 PATH）

**`python` 这个名字不保证在该 shell 的 PATH 上**——agent 的运行 shell 与 AgentEmployee 终端的
PATH 来源不同，`python` 很可能解析不到。先按下面的阶梯解析出**解释器绝对路径**，记为
`<PYTHON>`，之后所有脚本都用它调用：

1. **`python` / `python3`**：先直接试；能跑通导入检查就用它本身。
2. **应用注入的位置**：`$AGENTEMPLOYEE_BUNDLED_PYTHON_DIR\<platform>-<arch>\python.exe`
   （Windows 上即 `...\python\win32-x64\python.exe`）。这是 AgentEmployee 主动传给 agent 的路径，
   不依赖 PATH。
3. **应用安装目录**：`<安装目录>\resources\python\win32-x64\python.exe`。
   定位命令（忽略 `Lib\venv\...` 下的 venv 模板）：
   `Get-ChildItem '<安装目录>\resources\python' -Recurse -Filter python.exe`

用解析到的解释器做导入检查：

```bash
<PYTHON> -c "import docx, matplotlib, PIL, lxml; print('py-ok')"
```

- 输出 `py-ok` → 继续，并**把 `<PYTHON>` 用于后面所有脚本调用**。
- 三级都不可用 → **停止并告诉用户**：内置运行时缺失（或未随应用打包）。**不要** `pip install`；
  也不要改用**缺少这些依赖**的系统 Python（判定标准是导入检查通过，不是"有 python 就行"）。

## 二、技能目录

本技能文件都在**本 SKILL.md 所在目录**（注入时的 `dir` 属性）下，下文用 `【技能目录】` 表示：

- `【技能目录】/scripts/render_chart.py`：按 JSON 规格用 matplotlib 渲染 PNG（数据图）
- `【技能目录】/scripts/render_diagram.py`：把文本 DSL 渲染成 PNG（blockdiag 系列：组成图/流程图/时序图/网络图）
- `【技能目录】/scripts/insert_image.py`：把图片（可带自动编号题注）插入 .docx 锚点

三个脚本都支持 `--manifest <json>` 批量模式（一次渲染/一次插入多张，多图时更快），单图模式不变；详见阶段二「批量渲染」与阶段三。

**不要改写 `【技能目录】` 下任何文件**（打包后只读）。所有产物写到项目内。

## 三、工作流（分阶段，先与用户确认图清单）

### 阶段一 · 先想后画 + 列图清单（停下等确认）

动笔之前先**想清楚**：这张图要表达的**唯一要点**是什么、层级关系是什么（分层 / 树状 / 时序 / 交联）、
放哪些节点、哪些细节属于「不必上图」。**只画正文真正需要的内容**，宁可少而清。

再从材料/正文里提炼**需要哪些图**，逐条列出：图的类型（组成图/流程图/时序图/性能曲线/柱状/饼图…）、
标题、数据来源（必须来自材料或用户给定）。**输出后停下，等用户确认或修改**；未确认不得出图。

> 若图清单已在**调用方技能**（例如 `gjb438c-srs` / `gjb438c-sdd` 的阶段二大纲）里由用户确认过，
> 可以**沿用**——但必须在回复里写明「沿用已确认的图清单」并**原样列出**，视同确认；
> 不得默不作声地跳过本步。

### 阶段二 · 出图（先想后画 → 校验 → 渲染 → 读回自检 → 迭代）

**每张图都必须走完这个闭环，不允许「一次出图直接交付」。**

1. **写规格**：数据图写 JSON；结构/流程图写 DSL 文本（见下）。
2. **先校验**：`render_diagram.py --check` 只解析 DSL、不渲染——语法错就地改掉，坏图绝不进渲染。
3. **渲染**：脚本会回报 PNG 的像素尺寸。
4. **读回自检**：用多模态能力**实际打开刚生成的 PNG**，逐项对照《图面自检清单》。
5. **落地验证记录（强制写出）**：对**这一版**写出一行，未写出记录的图不得进入插图阶段：

   ```
   图<name> v<n> | WxH px | 尺寸✅ | 乱码✅ 重叠✅ 溢出✅ 穿字✅ 截断✅ 完整✅ 字号✅ | 结论:…
   ```

   每个检查项要给**具体观察**（哪个字被截、哪条边压住了谁），不接受「看着还行」这种空话。

6. **迭代**：不过关就改 DSL/规格重渲染。每轮**只改一个维度**（宽度 / 标签 / 图型），
   改完**立刻重渲染并重读这一版**。「通常 2–4 轮」只是参考；只做 1 轮也算完成，
   但那一轮必须真的**读过**、**改过**。
7. **终检（收尾门禁）**：最后一次修改之后，**对全部图逐一重读**——不允许用「之前看过」代替。
   任何一张自上次读回后**又被改过**、或**从未读回**，都回到第 4 步补做。

数据图规格 JSON：

```json
{
  "kind": "line|bar|pie|scatter",
  "title": "图标题",
  "xlabel": "X 轴",
  "ylabel": "Y 轴",
  "categories": ["A", "B", "C"],
  "series": [{ "name": "系列1", "values": [1, 2, 3] }],
  "figsize": [8, 4.5],
  "dpi": 200
}
```

```bash
<PYTHON> "【技能目录】/scripts/render_chart.py" \
  --spec "<项目根>/.agentemployee/figures/<name>.spec.json" \
  --out  "<项目根>/docs/figures/<name>.png"
```

**结构/流程图：不写 JSON，写 DSL 文本**（blockdiag 系列，纯 Python、离线）。

| 图              | `--kind`    | DSL 片段                                         |
| --------------- | ----------- | ------------------------------------------------ |
| 组成图 / 框图   | `blockdiag` | `blockdiag { A [label="采集"]; A -> B; }`        |
| 流程图 / 活动图 | `actdiag`   | `actdiag { A [label="采集"]; A -> B -> C; }`     |
| 时序图          | `seqdiag`   | `seqdiag { "操作员" -> "系统" [label="启动"]; }` |
| 网络 / 部署图   | `nwdiag`    | `nwdiag { network { A; B; } }`                   |

DSL 写到 `<项目根>/.agentemployee/figures/<name>.diag`，**先校验、再渲染**：

```bash
<PYTHON> "【技能目录】/scripts/render_diagram.py" --kind actdiag \
  --source "<项目根>/.agentemployee/figures/<name>.diag" --check
<PYTHON> "【技能目录】/scripts/render_diagram.py" --kind actdiag \
  --source "<项目根>/.agentemployee/figures/<name>.diag" \
  --out  "<项目根>/docs/figures/<name>.png"
```

中文字体默认用系统 `msyh.ttc`（脚本自动查找）；非中文 Windows 用 `--font <ttf/ttc>` 指定。
**只写 DSL/JSON，不要手绘坐标/连线，也不要改这两个渲染脚本。**

**调用形式**：一律用 `<PYTHON>` 的**绝对路径**调脚本；文件名/中文/路径都作为 `--source`、
`--out` 等**文件参数**传入，**不要**塞进 `-c` 内联命令——PowerShell 的引号与 GBK 会把 `-c` 单行
拼坏，`[10]` 这类方括号还会被当成通配符。

### 批量渲染（可选，多图时更快）

图清单敲定后，如果一次要出多张图，用 manifest 一次渲染，避免每张图各自起一个解释器：

```json
// <项目根>/.agentemployee/figures/charts.manifest.json
{ "charts": [
  { "spec": "<项目根>/.agentemployee/figures/a.spec.json", "out": "<项目根>/docs/figures/a.png" },
  { "spec": { "kind": "bar", "categories": ["A"], "series": [{"name":"s","values":[1]}] },
    "out": "<项目根>/docs/figures/b.png" } ] }
```
```json
// <项目根>/.agentemployee/figures/diagrams.manifest.json
{ "diagrams": [
  { "kind": "actdiag", "source": "<项目根>/.agentemployee/figures/a.diag", "out": "<项目根>/docs/figures/a.png" },
  { "kind": "blockdiag", "source": "<项目根>/.agentemployee/figures/b.diag", "out": "<项目根>/docs/figures/b.png", "scale": 6 } ] }
```
```bash
<PYTHON> "【技能目录】/scripts/render_chart.py" --manifest "<项目根>/.agentemployee/figures/charts.manifest.json"
<PYTHON> "【技能目录】/scripts/render_diagram.py" --manifest "<项目根>/.agentemployee/figures/diagrams.manifest.json" --jobs 4
```

- `chart` 的 `spec` 可以是**路径**（同 `--spec`）或**内联对象**；`diagram` 顶层可写 `font`/`scale` 作为默认，每条可覆盖。
- `--jobs`：并行渲染的 worker 数，默认 = CPU 核数，`1` = 顺序；图多时明显更快。
- `--check`：只解析 DSL 不渲染（批量校验全部 `source`）。
- **批量只省重复启动/导入，不省自检**：spec/DSL 冻结后才能批量渲染，之后**每张 PNG 仍要按下面的清单逐张读回自检**，不合格的图单张重渲染（脚本的单图模式仍然可用）。

### 图面自检清单（每张渲染后逐项过）

把刚生成的 PNG **读回来看**，逐条确认；任何一项不过就回到阶段二调整后重渲染，**不要带着问题插图**：

- **文字完整（最常被漏）**：**节点 / 单元格内的文字是否完整显示**——有没有被切掉一半、
  被白色背景或相邻框遮住、只露半边。**逐框核对每一个节点**，不要只看整幅图的整体观感。
- **乱码 / 方框**：中文是否正常（非中文 Windows 用 `--font` 指定 CJK 字体）。
- **重叠 / 拥挤**：节点文字、边标签、箭头是否互相压住。
- **溢出 / 越界**：文字是否超出节点框、子框或画布；`nwdiag` 的子网框是否越界。
- **箭头穿字**：连线是否穿过节点或标签文字。
- **标签截断**：边标签/节点名是否被截成「启动…」这类省略号。
- **字号可读**：见《宽度与字号预算》。
- **配色**：图是**彩色**（不是灰度），且不同角色的节点颜色有区分（见《配色》）。
- **内容正确**：文字、方向、层级与正文/材料一致，不臆造。

#### 文字被裁 / 被遮挡时怎么修

先分清是「图内」还是「插图后」：

- **图内某个框里文字只露一半、另一半像被白色盖住**：几乎都是**框比文字小**。
  `nwdiag` 的单元格对超长节点名尤其不友好。修法（代价从低到高）：
  1. 把该标签**改短**，或用 `\n` 拆成两行短词；
  2. **换图型**：`nwdiag` → `blockdiag`（blockdiag 会按文字自动撑大框）；
  3. 给该节点**显式尺寸**，如 `A [label = "波形与发射链路仿真", width = 200]`。
- **插入 Word 后整幅图被裁、右侧被白块盖住**：是**插入宽度超过版心**。
  把 `--width-cm` 调小（默认 14，正文版心一般 ≤15cm）；并确认锚点段落不在**表格单元格**里
  （单元格会裁掉超宽图片）。
- 每次修完**重渲染并重读该图**，确认文字完整再继续。

### 配色（默认彩色，禁止交付灰度图）

blockdiag 家族**默认是黑白**（白底黑线）。每一张结构 / 流程 / 交联图都要**按角色配色**：

- 颜色写在节点的 `color=` 上，配 `shape = box` 最显眼；**不要整图一个色，更不要留白**。
- 想省事可在图级写一次 `default_node_color = "lightblue";`（节点自带的 `color=` 优先）。
- 脚本兜底：DSL 里**完全没有颜色**时，`render_diagram.py` 会自动注入
  `default_node_color = "lightblue"` 并提示——**那只是保险，正式图请按角色配色**。

| 角色                     | `color`       |
| ------------------------ | ------------- |
| 软件 / 主体 / 核心       | `lightyellow` |
| 外部实体 / 接口 / 交互方 | `lightblue`   |
| 数据 / 存储 / 报文       | `lightgreen`  |
| 人 / 角色 / 岗位         | `lightpink`   |
| 硬件 / 设备 / 被测对象   | `lightsalmon` |
| 边界 / 辅助 / 其它       | `lightgray`   |

### 宽度与字号预算（插图后能不能看清，由它决定）

图片插进 Word 时会被缩到固定宽度（默认 14cm，一般 ≤15cm）。**插图后的有效字号
≈ 图上像素高度 ÷ 图宽像素 × 插入宽度**——所以瓶颈是**横向宽度**，不是美观：

- **硬约束：图宽目标 ≤ 750px（按 1x 逻辑宽度算）**（按 12–14cm 插入时文字仍 ≈7pt 可读）。
- **清晰度由脚本保证**：blockdiag 只有 1× 栅格，脚本会按 **≈300 DPI @14cm** 自动放大几何
  （输出形如 `(1824x480 px, 4x raster)`），**布局不变、只是像素更多**，不会再糊。要更清晰加
  `--scale 6`；这里的"图宽"看 **1x 逻辑宽度**（示例 1824÷4 ≈ 456）。
- 脚本渲染后会打印 `(WxH px, Nx raster)`；若逻辑宽度 `>900px` 会给 hint。**收到 hint 必须缩窄**：
  1. 换图型（`blockdiag` 链太长 → 试 `nwdiag` 分块或 `actdiag` 泳道）；
  2. 压节点数（能合就合，别把十个节点排成一条线）；
  3. 缩标签（长句边标签改短词，细节挪进节点文字）；
  4. 减少层级 / 并排列数。
- 不要用 `--scale 1` 去"救"宽度——那只会变糊；宽度问题靠**减少横向内容**解决。

### 常用 DSL 骨架（复用版式，只换数据）

在骨架上替换节点/文字，不要每次从零排布：

```
// 分层 / 组成图（blockdiag）：分层、列数少
blockdiag {
  orientation = portrait;
  A [label = "输入"];
  B [label = "处理1"]; C [label = "处理2"];
  D [label = "输出"];
  A -> B -> D; A -> C -> D;
}

// 流程 / 活动图（actdiag）：节点先声明，再连线
actdiag {
  A [label = "准备"];
  B [label = "建模"];
  C [label = "输出"];
  A -> B -> C;
}

// 交互 / 时序图（seqdiag）：参与者少、消息短
seqdiag {
  "操作员" -> "系统" [label = "启动"];
  "系统" -> "操作员" [label = "就绪"];
}

// 交联 / 部署图（nwdiag）：按方块分组
nwdiag {
  network { A; B; }
  network { C; D; }
}
```

> `nwdiag` 只渲染**节点名**、不渲染 `description`——把说明写进带引号的节点名，如 `"波形与发射链路仿真"`。

### 阶段三 · 插图

对目标 `.docx`（通常是 `fill_document_template` 生成的那份）逐张插入：

```bash
<PYTHON> "【技能目录】/scripts/insert_image.py" \
  --docx   "<项目根>/docs/[10][SRS] 软件需求规格说明-438C-2021-filled.docx" \
  --image  "<项目根>/docs/figures/<name>.png" \
  --anchor "<正文里唯一的整句，如：本软件是…的核心组成软件>" \
  --chapter 3 --caption-title "系统功能组成" \
  --width-cm 14
```

- `--anchor`：目标段里的一段**正文唯一整句**（脚本按子串匹配，`--occurrence` 取第几处命中）。
  **不要用章节标题**——标题会在目录缓存、合格性/追踪表里多处命中，甚至那段在填充时已被清理掉。
- `--chapter N --caption-title "…"`：**自动续号**为 `图N-<下一序号> …`（扫描文档里已有的 `图N-x`）。
  也可以直接给 `--caption "图3-1 …"` 指定题注文本。
- 图片默认居中、宽 14cm；需要时用 `--width-cm` 调整。

**多图一次插入（更快）**：把全部图写成 manifest，脚本**一次打开、按序插入、一次保存**，比逐张调用省去 N 次整份文档的解析与保存：

```json
// <项目根>/.agentemployee/figures/insert.manifest.json
{ "docx": "<项目根>/docs/…-filled.docx",
  "out":  "<项目根>/docs/…-filled-figures.docx",
  "figures": [
    { "image": "<项目根>/docs/figures/a.png", "anchor": "<正文唯一整句>",
      "chapter": 3, "caption_title": "系统功能组成", "width_cm": 14 },
    { "image": "<项目根>/docs/figures/b.png", "anchor": "<另一处唯一整句>",
      "chapter": 3, "caption_title": "数据采集流程", "position": "after", "occurrence": 1 } ] }
```
```bash
<PYTHON> "【技能目录】/scripts/insert_image.py" --manifest "<项目根>/.agentemployee/figures/insert.manifest.json"
```

- 条目**按数组顺序处理**，题注在内存里**连续续号**（已存在 `图3-1` 时会接着 `图3-2`…）。
- **全有或全无**：任何一条失败（锚点找不到等）都**不写文件**，原文档保持不变；报错会点名 `figure[下标]`。
- `out` 省略时**原地保存**（用临时文件原子替换，崩溃不会截断原文件）。
- 每条仍需**唯一锚点句**；同一锚点叠加多张图时显式递增 `occurrence`。

插完提示用户：在 Word 中 **F9 / 更新整个目录**（若图影响了分页）。

## 四、约束

- **只用本技能自带脚本**：`render_diagram.py` / `render_chart.py` / `insert_image.py`。**不要临时编写** Python / shell / 其它脚本；脚本能力不足时停下问用户。批量用的 `--manifest` JSON 是给这些脚本的**输入**（放 `<项目根>/.agentemployee/figures/` 下），不是自写脚本。
- **先校验、后自检、再交付**：DSL 先 `--check`；每张图渲染后**读回 PNG 逐项自检**并迭代，**禁止一次出图直接交付**；不合格的图不要插进 Word。
- **逐图留痕 + 终检**：每张图每一版都要有阶段二第 5 步那行验证记录；**插图前**必须对全部图做过第 7 步终检（最后一次改动之后重读）。缺记录或缺终检的图，视为未完成。
- **改在填充之后**：`fill_document_template` 会整篇覆盖输出。**先完成填充、再做插图**；若之后重跑填充，需重新插图（原图会丢）。
- **不改结构**：只在锚点处**插入**图片段与题注段，不改动模板既有章节/表格结构。
- **产物在项目内**：图与中间 JSON 写到 `<项目根>/docs/` 与 `<项目根>/.agentemployee/`；不写进技能目录或 AgentEmployee 安装目录。
- **不臆造数据**：图表数据必须来自材料或用户输入；缺失就列出来让用户补，不得编造。
- 题注编号沿用 `图<章>-<序>`，由脚本按已有编号自动续号。
