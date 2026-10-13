#!/usr/bin/env python3
"""Durable, resumable task manifest for large issue workbooks (append-only JSONL).

A single conversation cannot hold thousands of issue rows, so progress lives on
disk: one append-only event log per project, reduced on demand. Plain JSONL keeps
it provider-agnostic and readable with ordinary file tools; `compact` rewrites a
snapshot to bound growth.

Layout (default `<cwd>/.agentemployee/xlsx-issues/manifest.jsonl`):
  {"t":"meta","version":1,"sheet":"...","xlsx":"...","created":"..."}
  {"t":"add","id":"I000001","row":57,"rule":"no-unused-vars","file":"src/a.ts","locator":"login","desc":"...","status":"pending"}
  {"t":"set","id":"I000001","status":"done","note":"...","ts":"..."}

Commands:
  init            --xlsx <f> --sheet <name|index> [--manifest p] [--rule-column c] [--file-column c]
                  [--locator-column c] [--desc-column c] [--header-row N] [--force]
  next            [--manifest p] [--rule R] [--status S] [--limit N]
  mark            [--manifest p] (--batch <json> | --set ID=STATUS ...)
  stats           [--manifest p] [--summary-out <json>]
  export-statuses --manifest p --out <json>
  compact         [--manifest p]
"""

import argparse
import json
import os
import sys
from datetime import datetime

try:
    import openpyxl
except ImportError:  # pragma: no cover - depends on the interpreter used
    openpyxl = None

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):  # pragma: no cover
        pass

DEFAULT_MANIFEST = os.path.join(".agentemployee", "xlsx-issues", "manifest.jsonl")
MANIFEST_VERSION = 1
VALID_STATUSES = ("pending", "in_progress", "done", "skipped", "failed", "needs-review")
# Statuses that need a human look; surfaced (capped) in summary.json for the app panel.
ATTENTION_STATUSES = ("needs-review", "failed", "skipped")
ATTENTION_LIMIT = 50

# Auto-detection key sets (lowercased substring match against the header row).
RULE_KEYS = ("规则", "类型", "类别", "编码", "rule", "type", "category")
FILE_KEYS = ("文件", "路径", "代码位置", "位置", "file", "path", "location")
LOCATOR_KEYS = ("符号", "函数", "方法", "类", "行", "symbol", "function", "method", "class", "line")
DESC_KEYS = ("描述", "问题", "说明", "详情", "description", "problem", "issue", "detail", "message")


def now_iso():
    return datetime.now().replace(microsecond=0).isoformat()


def fail(message):
    sys.exit(message)


def manifest_path(args):
    return os.path.abspath(args.manifest)


# --- JSONL event log I/O -----------------------------------------------------


def read_events(path):
    if not os.path.exists(path):
        return []
    events = []
    with open(path, "r", encoding="utf-8") as handle:
        for lineno, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                fail("corrupt manifest line %d in %s: %s" % (lineno, path, line[:120]))
    return events


def append_events(path, events):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def atomic_write_lines(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.tmp-%d" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as handle:
        for line in lines:
            handle.write(line + "\n")
    os.replace(tmp, path)


def reduce_events(events):
    """Fold the event log into (meta, records-by-id, insertion order)."""
    meta = None
    records = {}
    for event in events:
        kind = event.get("t")
        if kind == "meta":
            meta = event
        elif kind in ("add", "state"):
            records[event["id"]] = {k: v for k, v in event.items() if k != "t"}
        elif kind == "set":
            record = records.get(event.get("id"))
            if record is None:
                continue
            for key, value in event.items():
                if key not in ("t", "id"):
                    record[key] = value
    return meta, records


def load_state(path):
    return reduce_events(read_events(path))


def build_summary(meta, records):
    """Aggregate counts by status and by rule (the shape the app panel reads)."""
    by_status = {}
    groups = {}
    attention = []
    for record in records.values():
        status = record.get("status", "pending")
        by_status[status] = by_status.get(status, 0) + 1
        rule = record.get("rule") or "unclassified"
        bucket = groups.setdefault(rule, {"rule": rule, "total": 0, "done": 0, "pending": 0})
        bucket["total"] += 1
        if status == "done":
            bucket["done"] += 1
        elif status == "pending":
            bucket["pending"] += 1
        if status in ATTENTION_STATUSES:
            item = {"row": record.get("row"), "rule": rule, "status": status}
            if record.get("file"):
                item["file"] = record["file"]
            if record.get("note"):
                item["note"] = record["note"]
            attention.append(item)
    attention.sort(key=lambda item: (ATTENTION_STATUSES.index(item["status"]), item.get("row") or 0))
    return {
        "schemaVersion": MANIFEST_VERSION,
        "sheet": (meta or {}).get("sheet"),
        "total": len(records),
        "done": by_status.get("done", 0),
        "byStatus": by_status,
        "byRule": sorted(groups.values(), key=lambda item: (-item["total"], item["rule"])),
        "attentionTotal": len(attention),
        "attention": attention[:ATTENTION_LIMIT],
    }


def summary_path_beside(path):
    return os.path.join(os.path.dirname(path) or ".", "summary.json")


def refresh_summary(path):
    """Rewrite `summary.json` beside the manifest so the app dock can read progress.

    The manifest is the source of truth; this is a small derived projection kept
    in sync on every mutation (init/mark/compact) so the UI never has to parse
    the append-only log. Tolerant of a missing/empty manifest.
    """
    summary = build_summary(*load_state(path))
    atomic_write_lines(summary_path_beside(path), [json.dumps(summary, ensure_ascii=False, indent=2)])
    return summary


# --- column resolution -------------------------------------------------------


def resolve_column(spec, header):
    """A column spec is a 1-based index or a header text (exact, then substring)."""
    if spec is None:
        return None
    if isinstance(spec, int) or str(spec).isdigit():
        index = int(spec)
        if index < 1:
            fail("column index must be >= 1: %s" % spec)
        return index
    target = str(spec).strip().lower()
    for index, name in enumerate(header, 1):
        if name is None:
            continue
        if str(name).strip().lower() == target:
            return index
    for index, name in enumerate(header, 1):
        if name is not None and target in str(name).strip().lower():
            return index
    fail("no column matches %r; headers: %s" % (spec, header))


def detect_column(header, keys):
    lowered = [str(name).strip().lower() if name is not None else "" for name in header]
    for key in keys:
        for index, name in enumerate(lowered, 1):
            if key in name:
                return index
    return None


def cell(row, index):
    if index is None or index > len(row):
        return None
    value = row[index - 1]
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def resolve_sheet(workbook, ref):
    if ref in workbook.sheetnames:
        return workbook[ref]
    try:
        return workbook.worksheets[int(ref)]
    except (ValueError, IndexError):
        fail("no sheet %r; sheets: %s" % (ref, ", ".join(workbook.sheetnames)))


# --- commands ----------------------------------------------------------------


def command_init(args):
    if openpyxl is None:
        fail("openpyxl is not available in this interpreter; use the bundled Python.")
    path = manifest_path(args)
    if os.path.exists(path) and not args.force:
        fail("%s already exists; refusing to overwrite progress (use --force to reset)" % path)

    if not args.xlsx.lower().endswith(".xlsx"):
        fail("Not an .xlsx file: %s" % args.xlsx)
    workbook = openpyxl.load_workbook(args.xlsx, data_only=True)
    try:
        worksheet = resolve_sheet(workbook, args.sheet)
        sheet_name = worksheet.title
        rows = [[cell_obj.value for cell_obj in row] for row in worksheet.iter_rows()]
        # Merged cells only carry their value on the top-left cell; propagate it
        # so a rule column split across merged cells reads per row.
        for merged in worksheet.merged_cells.ranges:
            top = rows[merged.min_row - 1][merged.min_col - 1]
            for r in range(merged.min_row, merged.max_row + 1):
                for c in range(merged.min_col, merged.max_col + 1):
                    rows[r - 1][c - 1] = top
    finally:
        workbook.close()

    header_row = args.header_row
    if header_row < 1 or header_row > len(rows):
        fail("header row %d is out of range (sheet has %d rows)" % (header_row, len(rows)))
    header = rows[header_row - 1]

    rule_col = resolve_column(args.rule_column, header) or detect_column(header, RULE_KEYS)
    file_col = resolve_column(args.file_column, header) or detect_column(header, FILE_KEYS)
    locator_col = resolve_column(args.locator_column, header) or detect_column(header, LOCATOR_KEYS)
    desc_col = resolve_column(args.desc_column, header) or detect_column(header, DESC_KEYS)

    events = [{
        "t": "meta",
        "version": MANIFEST_VERSION,
        "sheet": sheet_name,
        "xlsx": os.path.abspath(args.xlsx),
        "headerRow": header_row,
        "created": now_iso(),
    }]
    sequence = 0
    counts = {}
    for offset, row in enumerate(rows[header_row:], start=header_row + 1):
        if all(value is None or str(value).strip() == "" for value in row):
            continue
        sequence += 1
        rule = cell(row, rule_col) or "unclassified"
        counts[rule] = counts.get(rule, 0) + 1
        events.append({
            "t": "add",
            "id": "%s%06d" % (args.id_prefix, sequence),
            "row": offset,
            "rule": rule,
            "file": cell(row, file_col),
            "locator": cell(row, locator_col),
            "desc": cell(row, desc_col),
            "status": "pending",
        })

    atomic_write_lines(path, [json.dumps(event, ensure_ascii=False) for event in events])
    refresh_summary(path)
    print(json.dumps({
        "manifest": path,
        "sheet": sheet_name,
        "columns": {"rule": rule_col, "file": file_col, "locator": locator_col, "desc": desc_col},
        "total": sequence,
        "byRule": dict(sorted(counts.items(), key=lambda item: -item[1])),
    }, ensure_ascii=False, indent=2))


def command_next(args):
    _, records = load_state(manifest_path(args))
    statuses = set(args.status) if args.status else {"pending"}
    selected = [
        record for record in records.values()
        if (args.rule is None or record.get("rule") == args.rule)
        and ("all" in statuses or record.get("status") in statuses)
    ]
    selected.sort(key=lambda record: record.get("row", 0))
    if args.limit is not None:
        selected = selected[:args.limit]
    print(json.dumps(selected, ensure_ascii=False, indent=2))


def _apply_status_args(args, records):
    updates = []
    if args.batch:
        with open(args.batch, encoding="utf-8") as handle:
            payload = json.load(handle)
        for item in payload.get("rows", []):
            updates.append(item)
    for spec in args.set or []:
        if "=" not in spec:
            fail("--set expects ID=STATUS, got %r" % spec)
        identifier, status = spec.split("=", 1)
        updates.append({"id": identifier.strip(), "status": status.strip()})

    by_row = {record.get("row"): record["id"] for record in records.values()}
    events = []
    touched = []
    for item in updates:
        identifier = item.get("id")
        if identifier is None and item.get("row") is not None:
            identifier = by_row.get(item["row"])
        if identifier is None or identifier not in records:
            fail("unknown issue reference: %r" % (item,))
        status = item.get("status")
        if status not in VALID_STATUSES:
            fail("invalid status %r (allowed: %s)" % (status, ", ".join(VALID_STATUSES)))
        event = {"t": "set", "id": identifier, "status": status, "ts": now_iso()}
        if item.get("note") is not None:
            event["note"] = item["note"]
        if item.get("attempts") is not None:
            event["attempts"] = item["attempts"]
        events.append(event)
        touched.append(identifier)
    return events, touched


def command_mark(args):
    path = manifest_path(args)
    _, records = load_state(path)
    events, touched = _apply_status_args(args, records)
    if not events:
        fail("nothing to mark: pass --batch or --set")
    append_events(path, events)
    refresh_summary(path)
    print(json.dumps({"updated": len(touched), "ids": touched}, ensure_ascii=False))


def command_stats(args):
    summary = build_summary(*load_state(manifest_path(args)))
    if args.summary_out:
        atomic_write_lines(args.summary_out, [json.dumps(summary, ensure_ascii=False, indent=2)])
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def command_export_statuses(args):
    _, records = load_state(manifest_path(args))
    rows = []
    for record in sorted(records.values(), key=lambda item: item.get("row", 0)):
        if args.only_touched and record.get("status", "pending") == "pending" and not record.get("note"):
            continue
        entry = {"row": record.get("row"), "status": record.get("status", "pending")}
        if record.get("note"):
            entry["note"] = record["note"]
        rows.append(entry)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump({"rows": rows}, handle, ensure_ascii=False, indent=2)
    print("wrote %s (%d rows)" % (args.out, len(rows)))


def command_compact(args):
    path = manifest_path(args)
    meta, records = load_state(path)
    lines = [json.dumps(meta or {"t": "meta", "version": MANIFEST_VERSION, "created": now_iso()},
                        ensure_ascii=False)]
    for record in records.values():
        lines.append(json.dumps({"t": "state", **record}, ensure_ascii=False))
    atomic_write_lines(path, lines)
    refresh_summary(path)
    print(json.dumps({"compacted": path, "records": len(records)}, ensure_ascii=False))


# --- CLI ---------------------------------------------------------------------


def build_parser():
    parser = argparse.ArgumentParser(description="Durable task manifest for large issue workbooks.")
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST, help="manifest path (default %(default)s)")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="build the manifest from the issue workbook")
    init.add_argument("--xlsx", required=True)
    init.add_argument("--sheet", required=True)
    init.add_argument("--rule-column")
    init.add_argument("--file-column")
    init.add_argument("--locator-column")
    init.add_argument("--desc-column")
    init.add_argument("--header-row", type=int, default=1)
    init.add_argument("--id-prefix", default="I")
    init.add_argument("--force", action="store_true")
    init.set_defaults(func=command_init)

    nxt = sub.add_parser("next", help="print the next batch of issues (JSON)")
    nxt.add_argument("--rule")
    nxt.add_argument("--status", action="append", help="status to include (repeatable; default pending)")
    nxt.add_argument("--limit", type=int, default=50)
    nxt.set_defaults(func=command_next)

    mark = sub.add_parser("mark", help="append status updates")
    mark.add_argument("--batch", help="JSON file: {\"rows\":[{\"id\"|\"row\":..., \"status\":..., \"note\":...}]}")
    mark.add_argument("--set", action="append", metavar="ID=STATUS")
    mark.set_defaults(func=command_mark)

    stats = sub.add_parser("stats", help="print progress counts")
    stats.add_argument("--summary-out")
    stats.set_defaults(func=command_stats)

    export = sub.add_parser("export-statuses", help="write rows for write_status.py")
    export.add_argument("--out", required=True)
    export.add_argument("--only-touched", action="store_true")
    export.set_defaults(func=command_export_statuses)

    compact = sub.add_parser("compact", help="rewrite the event log as a snapshot")
    compact.set_defaults(func=command_compact)
    return parser


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
