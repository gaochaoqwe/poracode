---
name: oa-jprjcp-collect
description: "Collect incoming tasks from OA and the jprjcp intranet pages through the user's signed-in Chrome: identify new items, narrow-read them, and hand a digest to the chief steward."
---

# OA / jprjcp Task Collection

The user's signed-in Chrome holds their company intranet logins (OA, jprjcp). You read new work items off those pages and hand a clean digest to the chief steward.

## Confirm the surface first

Call `chrome.status`. Disconnected extension → report "connect Chrome", do not fall back to the isolated browser.

If a page hits a login wall, stop and say so. No credentials, no scavenging other tabs.

## Identify new items

Open the OA inbox / jprjcp task list the user named. Snapshot the list. New items are what is unread or newly arrived since last collection — ask the chief steward (or the user) which "new" means if the list has no read-state.

For each new item, narrow-read only that item's page:

- 标题 (title)
- 来源 (origin: which department / system)
- 内容摘要 (a 2–3 sentence summary, quoted where it matters)
- 截止 (deadline, if stated)
- 链接 (the page URL)

Do not click through to attachments, replies, or related items. Do not mark-as-read, forward, or reply.

## Hand off

Return the digest as a list the chief steward can route:

```
- [title] — 来源: x — 截止: y — 摘要: … — URL: …
```

State clearly which pages you could not open and why (login wall / permission error). Never fill gaps from memory.

Stay on the requested pages. Other tabs, unrelated mail, and browsing history are not yours to collect.

Call `chrome.disable` when done or paused.
