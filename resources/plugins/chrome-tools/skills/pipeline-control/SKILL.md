---
name: pipeline-control
description: "Drive the evaluation-center test pipeline (测评中心) through the user's signed-in Chrome: stage-by-stage Excel workbook imports, node advancement, report generation. Flow only — never assist the testing itself."
---

# Pipeline Control

The test pipeline is an internal website (测评中心) the user reaches through their own signed-in Chrome. You operate the flow; the human testers own the actual testing.

## Confirm the surface first

Call `chrome.status`. If the extension is disconnected, stop and tell the user to connect Chrome — never silently switch to the isolated browser, which has none of the internal logins.

If any page redirects to a login wall, stop and report it. Do not attempt credentials, and do not hunt through other tabs for a working session.

## The workbook stages

The single master Excel test workbook carries one sheet per pipeline stage. Match each node to its sheet:

- 测试策划 node → import **项目信息表** + **策划表**
- 需求分析 node → import **需求分析表**
- 动态测试 node → import **用例表**
- 问题报告单 → covers issues found in **every** stage (no separate node)

## Run the flow

1. Open the project page. Take a snapshot and confirm which node is currently active.
2. Import the sheet that matches the active node (read the file the user pointed you at; never invent rows).
3. Advance the node only after the import result page confirms success.
4. When the project reaches the report node, trigger the background report generation — it finishes asynchronously; report the trigger status, not a fabricated final report.
5. After every step, snapshot the page and verify the visible state before moving on. A failed import means stop and report the error text, not retry blindly.

## Boundaries

- You drive **process only** — stage transitions, sheet imports, node advancement. Do not draft test cases, analyze requirements, or write the report content; the background report system does that.
- Read-only by default. Any write, import, or node-advance is a state change: confirm with the user before pressing it, and only on the project they named.
- Stay on the pipeline site. Do not snoop other tabs or history.

Call `chrome.disable` when you finish or pause for the user.
