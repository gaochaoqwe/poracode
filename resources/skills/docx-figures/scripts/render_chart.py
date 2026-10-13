#!/usr/bin/env python3
"""Render a chart to PNG with matplotlib (aggregate backend, no display).

Reads a small JSON spec and writes a PNG. Kept intentionally narrow so the
agent never hand-writes plotting code.

Single-chart mode: `--spec <json> --out <png>`.

Batch mode (`--manifest <json>`): reads a manifest of charts, imports matplotlib
once, and renders each in-process -- so N charts cost one interpreter start and
one matplotlib import instead of N. Each chart's `spec` may be a path string (as
in single mode) or an inline spec object.

Spec:
{
  "kind": "line" | "bar" | "pie" | "scatter",
  "title": "可选",
  "xlabel": "可选", "ylabel": "可选",
  "categories": ["A", "B"],                 // line/bar/pie
  "series": [ {"name": "S1", "values": [1,2,3]} ],   // scatter: values are y, categories are x
  "figsize": [8, 4.5], "dpi": 200,
  "grid": true
}
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# CJK-safe defaults: prefer common Windows CJK fonts, fall back silently.
plt.rcParams["font.sans-serif"] = [
    "Microsoft YaHei",
    "SimHei",
    "Noto Sans CJK SC",
    "DejaVu Sans",
]
plt.rcParams["axes.unicode_minus"] = False

# A chart wider than this renders too small once inserted at ~14cm in Word;
# prefer a narrower figsize and >=10pt fonts.
WIDE_HINT_PX = 1400


def png_size(path: str) -> tuple[int, int]:
    """(width, height) of a PNG, or (0, 0) when it cannot be read."""
    try:
        from PIL import Image

        with Image.open(path) as image:
            return image.size
    except Exception:
        return (0, 0)


def load_spec(spec) -> dict:
    """A chart spec is either a path to a JSON file or an inline JSON object."""
    if isinstance(spec, dict):
        return spec
    if isinstance(spec, str):
        with open(spec, "r", encoding="utf-8") as handle:
            return json.load(handle)
    raise SystemExit("chart 'spec' must be a path string or an inline object")


def ensure_parent(out: str) -> None:
    parent = os.path.dirname(os.path.abspath(out))
    if parent:
        os.makedirs(parent, exist_ok=True)


def render_chart_one(spec: dict, out: str) -> tuple[int, int]:
    """Render one spec to `out`; return (width, height) px.

    The figure is always closed, so a batch loop does not leak figures.
    """
    kind = spec.get("kind", "line")
    figsize = tuple(spec.get("figsize", [8, 4.5]))
    dpi = int(spec.get("dpi", 200))
    categories = spec.get("categories", [])
    series = spec.get("series", [])

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    try:
        if kind == "line":
            for entry in series:
                ax.plot(categories, entry.get("values", []), marker="o", label=entry.get("name"))
        elif kind == "bar":
            width = 0.8 / max(len(series), 1)
            for index, entry in enumerate(series):
                offsets = [i + index * width for i in range(len(entry.get("values", [])))]
                ax.bar(offsets, entry.get("values", []), width=width, label=entry.get("name"))
            ax.set_xticks(range(len(categories)))
            ax.set_xticklabels(categories)
        elif kind == "pie":
            values = series[0].get("values", []) if series else []
            ax.pie(values, labels=categories, autopct="%1.1f%%")
        elif kind == "scatter":
            for entry in series:
                ax.scatter(categories, entry.get("values", []), label=entry.get("name"))
        else:
            raise SystemExit(f"unsupported chart kind: {kind}")

        if spec.get("title"):
            ax.set_title(spec["title"])
        if spec.get("xlabel"):
            ax.set_xlabel(spec["xlabel"])
        if spec.get("ylabel"):
            ax.set_ylabel(spec["ylabel"])
        if spec.get("grid", kind in ("line", "bar", "scatter")):
            ax.grid(True, linestyle="--", alpha=0.4)
        if kind != "pie" and any(entry.get("name") for entry in series):
            ax.legend()

        fig.tight_layout()
        ensure_parent(out)
        fig.savefig(out, bbox_inches="tight")
    finally:
        plt.close(fig)

    size = png_size(out)
    width = size[0]
    print(f"chart written: {out} ({width}x{size[1]} px)")
    if width > WIDE_HINT_PX:
        print(
            f"hint: {width}px wide is wide for a ~14cm Word insert -- text renders "
            f"small. Lower figsize width (e.g. [5, 3]) or raise font sizes."
        )
    return size


def run_single(args) -> int:
    if not args.spec:
        raise SystemExit("--spec is required (or use --manifest)")
    if not args.out:
        raise SystemExit("--out is required (or use --manifest)")
    render_chart_one(load_spec(args.spec), args.out)
    return 0


def _reject_duplicate_outs(outs) -> None:
    seen: dict[str, int] = {}
    for index, out in enumerate(outs):
        key = os.path.abspath(out)
        if key in seen:
            raise SystemExit(
                f"manifest entries {seen[key]} and {index} share the same output: {out}"
            )
        seen[key] = index


def run_manifest(args) -> int:
    try:
        with open(args.manifest, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except OSError as exc:
        raise SystemExit(f"cannot read manifest: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"manifest is not valid JSON: {exc}") from exc

    if not isinstance(manifest, dict):
        raise SystemExit("manifest must be a JSON object")
    charts = manifest.get("charts")
    if not isinstance(charts, list) or not charts:
        raise SystemExit("manifest requires a non-empty 'charts' list")

    outs: list[str] = []
    for index, item in enumerate(charts):
        if not isinstance(item, dict):
            raise SystemExit(f"manifest chart[{index}] must be an object")
        out = item.get("out")
        if not isinstance(out, str) or not out:
            raise SystemExit(f"manifest chart[{index}] requires 'out'")
        if "spec" not in item:
            raise SystemExit(f"manifest chart[{index}] requires 'spec'")
        outs.append(out)
    _reject_duplicate_outs(outs)

    for item in charts:
        render_chart_one(load_spec(item["spec"]), item["out"])
    print(f"{len(charts)} charts written")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render chart(s) to PNG")
    parser.add_argument("--manifest", default="", help="Batch: JSON manifest of charts")
    parser.add_argument("--spec", default="", help="Path to a JSON spec file")
    parser.add_argument("--out", default="", help="Output PNG path")
    args = parser.parse_args(argv)

    if args.manifest:
        if args.spec or args.out:
            raise SystemExit("--manifest cannot be combined with --spec/--out")
        return run_manifest(args)
    return run_single(args)


if __name__ == "__main__":
    sys.exit(main())
