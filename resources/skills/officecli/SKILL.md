---
name: officecli
description: "当用户要创建、读取、检查格式、排查问题、加图表或修改 Office 文档（.docx/.xlsx/.pptx）时使用。用随 AgentEmployee 内置的 officecli 命令行工具完成——单文件二进制，无需安装 Office，无需联网。"
---

# officecli

面向 AI 的 .docx / .xlsx / .pptx 命令行工具。单文件二进制，无依赖，**不需要安装 Office**。

**本技能是 OfficeCLI 的入口。** 真正决定「怎么写好某类文档」的规则不在本文件里，而在 `load_skill` 加载的专项技能中——**动手前必须先加载**（见下方 [专项技能](#专项技能必须先用-load_skill-加载)）。

---

## 一、先解析 officecli 可执行文件（必做，不要假设它在 PATH 上）

`officecli` 这个名字不保证在该 shell 的 PATH 上——agent 的运行 shell 与 AgentEmployee 终端的 PATH 来源不同。**按下面的阶梯解析出绝对路径**，记为 `<OFFICECLI>`：

1. **PATH 上的 `officecli`**：先直接试 `officecli --version`。能打印版本号就用它本身。
2. **应用注入的位置**：`$AGENTEMPLOYEE_BUNDLED_OFFICECLI_DIR/win32-x64/officecli.exe`
   （`<platform>-<arch>` 形式，Windows x64 即 `win32-x64`）。不依赖 PATH。
3. **应用安装目录**：`<安装目录>/resources/officecli/win32-x64/officecli.exe`。

验证（三选一成功即可）：

```bash
officecli --version                                            # 候选 1
"$AGENTEMPLOYEE_BUNDLED_OFFICECLI_DIR/win32-x64/officecli.exe" --version   # 候选 2
```

- 打印出版本号（如 `1.0.156`）→ 继续，并**把 `<OFFICECLI>` 用于后面所有调用**。
- 三级都不可用 → **停止并告诉用户**：内置 OfficeCLI 缺失（未随应用打包，或平台不支持）。
  **不要**用 `curl`/`irm` 自行下载安装，也**不要** `pip install` 任何东西。

**平台限制**：当前只随包提供 Windows x64。WSL / macOS / Linux 项目下该二进制不可用——
若用户在这些环境里，明确告知不可用，不要尝试用 Windows `.exe` 路径去跑。

**不要让它自更新**：AgentEmployee 内置的二进制已通过 `OFFICECLI_SKIP_UPDATE=1` 关闭自动更新。
如果你看到该变量未设置，请在命令前显式加上，避免运行中版本漂移。

---

## 二、核心工作纪律

**1. 动手前先 `load_skill`。** 见下方专项技能章节。跳过这一步直接 `create`/`add`/`set` 是最常见的失败原因——你会靠猜 schema，然后反复试错。

**2. 拿不准就先查 `help`，不要猜。** 一次 help 胜过「猜错—失败—重试」循环。
`officecli help` ≡ `officecli --help`，`officecli <cmd> --help` ≡ `officecli help <cmd>`，内容相同。

```bash
officecli help                                  # 全部命令 + 全局选项
officecli help docx                             # 列出所有 docx 元素
officecli help docx paragraph                   # 完整 schema：属性、别名、示例、回读
officecli help docx set paragraph               # 按动词过滤：只列 set 能用的属性
officecli help docx paragraph --json            # 结构化 schema（机器可读）
```

格式别名：`word`→`docx`、`excel`→`xlsx`、`ppt`/`powerpoint`→`pptx`。动词：`add`、`set`、`get`、`query`、`remove`。

**3. 逐条执行，别攒大脚本。** officecli 每次调用都会实际改动文件。一条一条跑并检查退出码——
一个 50 行的脚本在第 3 行失败会静默级联。任何结构性操作（新建样式、表格、目录、分节）之后，
先用 `get` 回读再继续叠加。

**4. `$FILE` 约定。** 所有示例用 `"$FILE"`——先设一次（`FILE="你的文档.docx"`）。
**永远不要**把示例里的字面量 `doc.docx` / `review.docx` 直接抄进输出，一律替换成真实目标文件。

---

## 三、策略：L1 读 → L2 DOM 改 → L3 原始 XML

**永远优先用更高层。** 加 `--json` 拿结构化输出。

### L1：创建、读取、检查

```bash
officecli create <file>               # 按扩展名创建空白 .docx/.xlsx/.pptx
officecli view <file> <mode>          # outline | stats | issues | text | annotated | html
officecli get <file> <path> --depth N # 取节点及其子节点 [--json]
officecli query <file> <selector>     # 类 CSS 查询
officecli validate <file>             # 对照 OpenXML schema 校验
```

`view` 模式：

| 模式 | 说明 | 常用参数 |
|------|------|---------|
| `outline` | 文档结构 | |
| `stats` | 统计（页数、字数、形状数） | |
| `issues` | 格式/内容/结构问题 | `--type format\|content\|structure`、`--limit N` |
| `text` | 纯文本提取 | `--start N --end N`、`--max-lines N` |
| `annotated` | 带格式标注的文本 | |
| `html` | 静态 HTML 快照——与 `watch` 同一渲染器，无需起服务 | `--page N`（docx）、`--start/--end`（pptx） |
| `screenshot` | 无头浏览器渲染成 PNG | `-o`、`--screenshot-width/-height`、pptx `--grid N` |
| `svg` / `pdf` / `forms` | SVG（pptx 单页）/ 经导出插件生成 PDF / 表单字段 JSON | |

**`view issues` 和 `validate` 是交付前的必查项。** 布局敏感的场景（尤其幻灯片，绝对定位的形状重叠在文本模式下看不出来）还要 `view screenshot` 做视觉审计，并**以挑刺的心态**判断：重叠、文字溢出、跑出画布、深色压深色、错位。

### L2：DOM 操作

```bash
officecli set <file> <path> --prop key=value [--prop ...]      # 改属性
officecli add <file> <parent> --type <type> [--prop ...]        # 加元素
officecli remove <file> <path>                                  # 删元素
officecli move <file> <path> --to <parent>                      # 移动
officecli swap <file> <a> <b>                                   # 交换
```

**取值格式**：

| 类型 | 格式 | 示例 |
|------|------|------|
| 颜色 | 十六进制（可带 `#`）、命名色、RGB、主题色 | `FF0000`、`#FF0000`、`red`、`rgb(255,0,0)`、`accent1`..`accent6` |
| 间距 | 带单位 | `12pt`、`0.5cm`、`1.5x`、`150%` |
| 尺寸 | EMU 或带后缀 | `914400`、`2.54cm`、`1in`、`72pt`、`96px` |

**点号别名**：`font.color=red`、`font.bold=true`、`font.size=14pt` 在 shape/run/paragraph/table/row/cell/section/styles 上都可用。
完整清单跑 `officecli help <fmt> <element>`。

**查找与替换**（顶层 `--find` / `--replace`，缩放路径控制搜索范围）：

```bash
# 给匹配的文本设格式（自动拆 run）
officecli set doc.docx '/body/p[1]' --find weather --prop bold=true --prop color=red

# 正则匹配
officecli set doc.docx '/body/p[1]' --find '\d+%' --prop regex=true --prop color=red

# 替换（`/` 表示全文范围）
officecli set doc.docx / --find draft --replace final
```

- 默认区分大小写；忽略大小写用 `--prop 'find=(?i)error' --prop regex=true`
- 跨 run 边界也能匹配
- 无匹配 = 静默成功，`--json` 里 `"matched": N`
- **Excel**：只支持 `find` + `replace`，不支持 `find` + 格式属性

**`batch`——一次保存周期内做多件事**（一堆同款段落优先用它）：

```bash
officecli batch <file> --json <<'EOF'
[{"op":"add","parent":"/body","type":"paragraph","props":{"text":"第一章","style":"Heading1"}},
 {"op":"add","parent":"/body","type":"paragraph","props":{"text":"正文内容。"}}]
EOF
```

支持 `add`、`set`、`get`、`query`、`remove`、`move`、`swap`、`view`、`raw`、`raw-set`、`validate`。
字段：`command`（或 `op`）、`path`、`parent`、`type`、`from`、`to`、`index`、`after`、`before`、`props`、`selector`、`mode`、`depth`、`part`、`xpath`、`action`、`xml`。

### L3：原始 XML

L2 表达不了时才用。**不需要写 xmlns 声明**——前缀会自动注册。

```bash
officecli raw <file> <part>                          # 查看原始 XML
officecli raw-set <file> <part> --xpath "..." --action replace --xml '<w:p>...</w:p>'
officecli add-part <file> <parent>                   # 新建文档部件（返回 rId）
```

`raw-set` 动作：`append`、`prepend`、`insertbefore`、`insertafter`、`replace`、`remove`、`setattr`。

---

## 四、常驻模式（性能）

**每条命令首次访问时都会自动拉起常驻进程**（60 秒空闲超时）——文件锁冲突会自动规避。
长会话仍建议显式 `open`/`close`（12 分钟空闲）：

```bash
officecli open report.docx       # 显式常驻内存
officecli set report.docx ...    # 无文件 I/O 开销
officecli close report.docx      # 保存并释放
```

**只在非 officecli 边界才 flush。** officecli 自己的读（`get`/`query`/`view`/`dump`）永远看得到你的最新改动，
所以工作流中途**不需要**保存。只在**别的程序要读这个文件之前**才跑 `save`（只写盘、保留常驻）或
`close`（写盘并释放）——比如 python-docx/openpyxl、Word、渲染器、交付/上传。

---

## 五、专项技能：必须先用 `load_skill` 加载

**这是 OfficeCLI 的核心设计，务必遵守。** `load_skill` 读取的是**编译进二进制的内置资源**——
不需要磁盘上有任何 `skills/` 目录，随二进制版本自动同步。

```bash
officecli load_skill                    # 列出全部技能 + 各自触发条件
officecli load_skill <name>             # 打印该技能完整 SKILL.md + 其附件清单
officecli load_skill <name> --path <relpath>   # 读取该技能捆绑的单个参考文件
```

**加载规则**：

- 在「何时使用」里挑**最具体**的一个；都不匹配就用格式默认技能（`word` / `pptx` / `excel`）。
- 场景技能已包含格式默认技能的全部规则——**每个产物只加载一个**，绝不叠加。
- 加载的规则**跨轮次持续有效**，不必每轮重新加载。
- 两个不同的产物 → 分别加载两次。

### Word（.docx）

| 名称 | 何时使用 |
|------|---------|
| `word` | 报告、信件、备忘录、方案、通用文档 |
| `academic-paper` | 期刊/会议/学位论文：APA/Chicago/IEEE/MLA 引用、公式、SEQ+PAGEREF 交叉引用、多栏期刊排版、参考文献。**不**用于商业报告或信件（那些走 `word`） |
| `word-form` | 可填写 Word 表单：内容控件（SDT）、表单域复选框、MERGEFIELD 邮件合并、文档保护。**独立技能**，不是 `word` 的场景层。**不**用于普通报告/信件 |

### PowerPoint（.pptx）

| 名称 | 何时使用 |
|------|---------|
| `pptx` | 通用幻灯片：汇报、销售演示、全员大会、产品发布 |
| `pitch-deck` | **仅融资**——种子轮 / A-C 轮 / SAFE / 可转债 / 战略融资。**不**用于销售/产品/汇报演示（走 `pptx`） |
| `morph-ppt` | 电影感 Morph 动画演示。**不**用于静态幻灯片（走 `pptx`） |
| `morph-ppt-3d` | 3D Morph：GLB 模型、镜头运动、景深。**不**用于纯 2D Morph（走 `morph-ppt`） |

### Excel（.xlsx）

| 名称 | 何时使用 |
|------|---------|
| `excel` | 通用工作簿、公式、透视表、跟踪表 |
| `financial-model` | 财务模型、情景分析、预测（三表/DCF/LBO）。**不**用于一般数据分析（走 `excel`） |
| `data-dashboard` | CSV/表格数据 → KPI/分析/高管看板（含图表与迷你图）。**不**用于原始数据跟踪（走 `excel`） |

例：一个融资演示任务 → `officecli load_skill pitch-deck` → 按打印出的规则做。

> **注意**：`load_skill` 也有一条 MCP 通道——如果你是通过 MCP 工具调用 officecli，
> 用 `{"command":"load_skill pptx"}` 即可，参数原样透传给 CLI。

---

## 六、常见坑

| 坑 | 正确做法 |
|----|---------|
| `--name "foo"` | 用 `--prop name="foo"`——所有属性都走 `--prop` |
| zsh/bash 里未加引号的 `[N]` 路径 | 一律加引号：`'/slide[1]'` 或 `"/slide[1]"`（shell 会做括号通配） |
| PPT 用 `shape[1]` 放内容 | `shape[1]` 通常是标题占位符，内容形状用 `shape[2]` 起 |
| `/shape[myname]` | 不支持名称索引。用数字下标，或 `@name=`（仅 PPT） |
| 猜属性名 | 跑 `officecli help <format> <element>` 看确切名称 |
| 改一个正被打开的文件 | 先在 PowerPoint/WPS 里关掉 |
| shell 字符串里的 `\n` | `--prop text="..."` 里用 `\\n` 表示换行 |
| shell 文本里的 `$` | `--prop text="$15M"` 的 `$15` 会被剥掉。用单引号 `--prop text='$15M'`，或走 heredoc batch |

---

## 七、注意事项

- 路径是 **1-based**（XPath 约定）：`'/body/p[3]'` = 第三段
- `--index` 是 **0-based**（数组约定）：`--index 0` = 第一个位置
- **Excel 例外**：`add --type row` / `add --type col` 的 `--index N` 是 **1-based**（对齐 OOXML 的 RowIndex / 列字母序号）。`--index 5` 插到第 5 行/第 5 列
- 改动后用 `validate` 和/或 `view issues` 复核
- **拿不准就跑 `officecli help <format> <element>`，不要猜**
