# -*- coding: utf-8 -*-
"""重建 模拟公司电脑文件夹/测试项目 目录树（三态结构 v10）。

- 未开展：<年>/未开展/<项目名>/  + 1组织资产/2参考项目资料/3本项目资料
- 进行中：<年>/进行中/<项目名>/  + P0~P14（P0 内含 组织资产/参考资料/本项目资料）
- 已完成：<年>/已完成/<软件类型>[/<子类>]/<项目名>/ + 1测试申请文件/2测试过程文件/3测试结果文件
  子类用汉语大写数字（一光雷…五地防）。
"""
import os
import shutil

ROOT = r"E:\code\github\poracode\模拟公司电脑文件夹\测试项目"

TYPES = [
    ("一系统控制类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("二随动控制类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("三图像处理类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("四温补调焦类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("五激光类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("六红外类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("七手柄类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("八分色滤光类", ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"]),
    ("九外部测试", []),
    ("十搜潜", []),
]

UNSTARTED_DIRS = ["1组织资产", "2参考项目资料", "3本项目资料"]
P0_DIRS = ["组织资产", "参考资料", "本项目资料"]
COMPLETED_DIRS = ["1测试申请文件", "2测试过程文件", "3测试结果文件"]

P_NODES = [
    "P0-测试申请文件",
    "P1-准入审查",
    "P2-测试策划",
    "P3-文档审查",
    "P4-静态分析",
    "P5-代码审查",
    "P6-动态测试-用例设计",
    "P7-动态测试-用例执行",
    "P8-动态测试-用例修正",
    "P9-动态测试-问题单生成",
    "P10-表单质量检查",
    "P11-报告生成",
    "P12-报告编写",
    "P13-报告质量检查",
    "P14-最终报告",
]

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def clear_dir(path):
    if os.path.isdir(path):
        shutil.rmtree(path)
    ensure_dir(path)

def touch_gitkeep(path):
    open(os.path.join(path, ".gitkeep"), "w", encoding="utf-8").close()

def write_readme(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

for year in ["2025", "2026"]:
    year_dir = os.path.join(ROOT, year)

    # 未开展：直接按项目名
    todo_dir = os.path.join(year_dir, "未开展")
    clear_dir(todo_dir)
    touch_gitkeep(todo_dir)

    # 进行中：直接按项目名
    doing_dir = os.path.join(year_dir, "进行中")
    clear_dir(doing_dir)
    touch_gitkeep(doing_dir)

    # 已完成：软件类型 → 子类（汉语大写）→ 项目名
    done_dir = os.path.join(year_dir, "已完成")
    clear_dir(done_dir)
    touch_gitkeep(done_dir)
    for type_name, sub_types in TYPES:
        type_dir = os.path.join(done_dir, type_name)
        ensure_dir(type_dir)
        touch_gitkeep(type_dir)
        if sub_types:
            for sub in sub_types:
                sub_dir = os.path.join(type_dir, sub)
                ensure_dir(sub_dir)
                touch_gitkeep(sub_dir)

# ── 2026 示例项目（三态各一份，名字不同避免操作冲突）──
Y = os.path.join(ROOT, "2026")

# 1) 未开展示例：示例项目-B回归测试（测试主管准备三个文件夹）
proj = os.path.join(Y, "未开展", "示例项目-B回归测试")
ensure_dir(proj)
for d in UNSTARTED_DIRS:
    ensure_dir(os.path.join(proj, d))
    touch_gitkeep(os.path.join(proj, d))
write_readme(
    os.path.join(proj, "README.md"),
    "# 示例项目-B回归测试（未开展）\n\n"
    "本示例展示「未开展」测试项目的内部结构：由测试主管准备三个文件夹。\n\n"
    "- 1组织资产：组织级资产（模板、规范、历史项目资料等）\n"
    "- 2参考项目资料：其他项目可参考的资料\n"
    "- 3本项目资料：本项目待测资料（回归测试需 影响域分析报告 + 变更前后两版代码）\n\n"
    "项目开始前，测试主管确认三个文件夹齐备后，把整个项目文件夹移入「进行中」。\n",
)

# 2) 进行中示例：示例项目-A配置项测试（P0~P14 节点骨架）
proj = os.path.join(Y, "进行中", "示例项目-A配置项测试")
ensure_dir(proj)
for node in P_NODES:
    node_dir = os.path.join(proj, node)
    ensure_dir(node_dir)
    touch_gitkeep(node_dir)
p0 = os.path.join(proj, "P0-测试申请文件")
for d in P0_DIRS:
    ensure_dir(os.path.join(p0, d))
    touch_gitkeep(os.path.join(p0, d))
write_readme(
    os.path.join(proj, "README.md"),
    "# 示例项目-A配置项测试（进行中）\n\n"
    "本示例展示「进行中」测试项目的内部结构：按 P0~P14 建节点子目录。\n\n"
    "- P0-测试申请文件：内含 组织资产 / 参考资料 / 本项目资料\n"
    "- P1-准入审查：测试项目主管审查资料齐套性（配置项测试需 需求规格说明+代码），输出 通过/不通过\n"
    "- P2-测试策划：测试主管输出「示例项目-A配置项测试表单 2.00.00」\n"
    "- P3~P9：文档审查 / 静态分析 / 代码审查 / 动态测试（用例设计→执行→修正→问题单生成）\n"
    "- P10 表单质量检查 → P11 报告生成 → P12 报告编写 → P13 报告质量检查 → P14 最终报告\n\n"
    "文件系统驱动（FlowDriver）扫描「进行中」目录并按节点状态唤醒员工线程：\n"
    "节点文件夹名带状态前缀（[P0-测试申请文件-进行中] / [P0-测试申请文件-已完成]）。\n",
)

# 3) 已完成示例：示例项目-C配置项测试（按 软件类型/子类 归档，内含三个文件夹）
proj = os.path.join(Y, "已完成", "一系统控制类", "一光雷", "示例项目-C配置项测试")
ensure_dir(proj)
for d in COMPLETED_DIRS:
    ensure_dir(os.path.join(proj, d))
    touch_gitkeep(os.path.join(proj, d))
write_readme(
    os.path.join(proj, "README.md"),
    "# 示例项目-C配置项测试（已完成）\n\n"
    "本示例展示「已完成」测试项目的归档结构：先按软件类型分、再按产品（子类）分、最后按项目名分。\n\n"
    "- 1测试申请文件：P0 测试申请文件归档\n"
    "- 2测试过程文件：P1~P13 各节点过程产物归档\n"
    "- 3测试结果文件：P14 最终报告归档\n\n"
    "项目全部节点完成后，测试主管把项目从「进行中」移入「已完成」对应类型/子类目录。\n",
)

# 根 README 说明
write_readme(
    os.path.join(ROOT, "README.md"),
    "# 模拟公司电脑文件夹 · 测试项目\n\n"
    "## 目录结构（三态）\n\n"
    "- `未开展/<项目名>/`：测试主管准备 1组织资产 / 2参考项目资料 / 3本项目资料，齐备后移入「进行中」\n"
    "- `进行中/<项目名>/`：按 P0~P14 建节点子目录（P0-测试申请文件内含 组织资产/参考资料/本项目资料），"
    "文件系统驱动按节点状态流转唤醒员工线程\n"
    "- `已完成/<软件类型>[/<子类>]/<项目名>/`：先按软件类型分、再按产品分（一~八类下分 一光雷/二吊舱/三转塔/四告警/五地防，"
    "九外部测试/十搜潜 直接按项目名），项目内含 1测试申请文件 / 2测试过程文件 / 3测试结果文件\n\n"
    "## 示例项目\n\n"
    "- 未开展：`2026/未开展/示例项目-B回归测试`（三文件夹结构）\n"
    "- 进行中：`2026/进行中/示例项目-A配置项测试`（P0~P14 结构，可直接启动实测）\n"
    "- 已完成：`2026/已完成/一系统控制类/一光雷/示例项目-C配置项测试`（三文件夹归档结构）\n"
    "\n"
    "注：三个示例为不同项目，仅用于展示三种状态的项目内部结构；实际使用中一个项目同一时刻只存在于一个状态目录。\n",
)

print("done")
