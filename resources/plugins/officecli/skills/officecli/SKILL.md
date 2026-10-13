---
name: officecli
description: "当用户要创建、读取、检查格式、排查问题、加图表或修改 Office 文档（.docx/.xlsx/.pptx）时使用。用随 AgentEmployee 内置的 officecli 命令行工具完成——单文件二进制，无需安装 Office，无需联网。"
---

# officecli

OfficeCLI 已随 AgentEmployee 内置（Windows x64 单文件二进制，无需安装 Office，无需联网）。

**本文件是薄壳。** 完整操作指引以内置技能 `officecli` 为唯一真源——请直接按其内容执行。要点摘要：

1. **解析二进制绝对路径**：优先 PATH 上的 `officecli`；否则
   `$AGENTEMPLOYEE_BUNDLED_OFFICECLI_DIR/win32-x64/officecli.exe`；再否则
   `<安装目录>/resources/officecli/win32-x64/officecli.exe`。
   三级都不可用就停下告知用户，**不要自行下载安装**。
2. **动手前先 `officecli load_skill <name>`**——专项技能编译在二进制内，随版本自动同步。
3. **拿不准先 `officecli help <format> <element>`**，不要猜 schema。
4. 每命令首次访问会自启常驻进程；只在**别的程序要读文件前**才 `save` / `close`。
5. 当前只随包提供 Windows x64；WSL / macOS / Linux 下不可用。

MCP 通道（本插件同时声明）把 officecli 暴露为单个 `command` 字符串参数的工具，
参数原样透传给 CLI——例如 `{"command":"load_skill pptx"}`。
