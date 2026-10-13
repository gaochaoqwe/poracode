#!/usr/bin/env python3
"""Render a text-DSL diagram to PNG with the blockdiag family.

Pure-Python rendering (no Graphviz binary, no VC++ runtime):
  kind=blockdiag  block/architecture diagram
  kind=actdiag    activity / process flow
  kind=seqdiag    sequence diagram
  kind=nwdiag     network diagram

blockdiag 3.0 predates Pillow 10 and calls removed APIs (`getsize`,
`textsize`), so this runs its entry point with a `sitecustomize` shim
injected via PYTHONPATH. The agent only writes the DSL.

Rendering goes through `<kind>.command:main` on this interpreter
(`sys.executable`) instead of the packaged `Scripts/<kind>.exe` launcher:
those launchers embed the absolute interpreter path of the machine that
built the Python runtime, so they break on any other install location.

Example:
  python render_diagram.py --kind actdiag --source flow.diag --out flow.png
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

KINDS = ("blockdiag", "actdiag", "seqdiag", "nwdiag")

# A diagram wider than this renders illegibly once inserted at ~14cm in Word.
WIDE_HINT_PX = 900

# blockdiag's own default is grayscale (white nodes / black lines). Inject this
# as `default_node_color` when the DSL sets none, so figures always come out
# colored; nodes with an explicit `color=` still win.
DEFAULT_NODE_COLOR = "lightblue"

# blockdiag rasterizes at 1 pixel per layout unit and has no DPI/scale option,
# so a ~450px figure dropped into a 14cm column lands at ~80 DPI and looks soft
# in Word. We scale the DSL's geometry up so the raster carries enough pixels
# for the insert width, without changing the layout (everything scales).
TARGET_DPI = 300
INSERT_CM = 14.0
MAX_SCALE = 6
SCALE_KEYS = (
    "default_fontsize",
    "fontsize",
    "node_width",
    "node_height",
    "span_width",
    "span_height",
    "node_padding",
    "group_padding",
    "line_spacing",
    "width",
    "height",
)
_SCALE_RE = re.compile(
    r"(?<![\w.])(" + "|".join(SCALE_KEYS) + r")\s*=\s*(\d+(?:\.\d+)?)(?![\w.])"
)

# blockdiag's own size defaults (cellsize=8, BASE_FONTSIZE=11). These drive node
# boxes and the gaps between them; the DSL usually sets none of them, so scaling
# only what the DSL mentions would enlarge nodes but leave the gaps/margins at
# 1x and squash the layout. They ARE settable at diagram level (unlike
# node_padding / line_spacing, which have no diagram attribute), so we inject
# scaled values for whichever ones the DSL omits.
BLOCKDIAG_1X_DEFAULTS = {
    "default_fontsize": 11,
    "node_width": 128,
    "node_height": 40,
    "span_width": 64,
    "span_height": 40,
}


def scale_dsl(dsl: str, factor: int) -> str:
    """Multiply the DSL's size-ish attributes by `factor` (layout-preserving).

    blockdiag has no render-scale knob, so to raise the raster resolution we
    enlarge every geometry attribute by the same factor. The layout is
    identical; only the pixel count changes.
    """
    if factor <= 1:
        return dsl

    def bump(match: re.Match[str]) -> str:
        key, raw = match.group(1), match.group(2)
        value = float(raw) * factor
        text = str(int(value)) if value.is_integer() else f"{value:.2f}"
        return f"{key} = {text}"

    out = _SCALE_RE.sub(bump, dsl)

    # Inject scaled defaults for the size attributes the DSL left out, so node
    # boxes AND the gaps between them scale together (layout-preserving).
    lower = out.lower()
    missing = [
        f"{key} = {base * factor}"
        for key, base in BLOCKDIAG_1X_DEFAULTS.items()
        if not re.search(r"(?<![\w.])" + re.escape(key) + r"\s*=", lower)
    ]
    if missing:
        brace = out.find("{")
        if brace >= 0:
            out = f"{out[: brace + 1]}\n  " + ";\n  ".join(missing) + f";{out[brace + 1 :]}"
    return out


def auto_scale(logical_width: int) -> int:
    """Factor that lifts `logical_width` px to ~TARGET_DPI at INSERT_CM."""
    if logical_width <= 0:
        return 1
    target_px = TARGET_DPI * (INSERT_CM / 2.54)
    return max(1, min(MAX_SCALE, math.ceil(target_px / logical_width)))


def run_blockdiag(kind: str, source: str, out: str, font: str, env: dict[str, str]) -> None:
    Path(out).unlink(missing_ok=True)
    result = subprocess.run(
        [sys.executable, "-c", f"from {kind}.command import main; main()", "-f", font, "-T", "png", "-o", out, source],
        env=env,
        capture_output=True,
        text=True,
    )
    # blockdiag prints "ERROR: ..." and exits 0 without writing a file (e.g. on
    # an unknown attribute), so a return-code check alone would miss the failure.
    if result.returncode != 0 or not Path(out).exists():
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(f"{kind} failed (exit {result.returncode})")


# Single-subprocess two-pass driver. blockdiag costs one interpreter start + one
# import per invocation, and the 1x measure + scaled render used to be two
# separate children. This runs both passes in one child, importing blockdiag
# once. `main(args)` must be called explicitly: blockdiag's `command.main` binds
# `sys.argv[1:]` as its default at import time. `Application.run()` swallows
# errors and returns non-zero, so the driver checks the output file too.
DIAGRAM_DRIVER = """\
import importlib, os, sys
import render_diagram as rd

kind, font, base_source, out, tmp1x, scale_arg = sys.argv[1:7]
explicit = int(scale_arg)
main = importlib.import_module(kind + ".command").main

main(["-f", font, "-T", "png", "-o", tmp1x, base_source])
if not os.path.exists(tmp1x):
    sys.stderr.write("blockdiag did not write %s\\n" % tmp1x)
    sys.exit(2)

logical = rd.png_size(tmp1x)[0]
scale = explicit if explicit > 0 else rd.auto_scale(logical)
if scale > 1:
    scaled = os.path.join(os.path.dirname(tmp1x), "diagram-scaled.diag")
    with open(base_source, "r", encoding="utf-8") as fh:
        text = fh.read()
    with open(scaled, "w", encoding="utf-8") as fh:
        fh.write(rd.scale_dsl(text, scale))
    main(["-f", font, "-T", "png", "-o", out, scaled])
    if not os.path.exists(out):
        sys.stderr.write("blockdiag did not write %s\\n" % out)
        sys.exit(2)
else:
    os.replace(tmp1x, out)

print("DIAGRAM_PASSES logical=%d scale=%d" % (logical, scale))
"""


def run_blockdiag_combined(
    kind: str, base_source: str, out: str, font: str, env: dict[str, str], tmp1x: str, scale: int
) -> tuple[int, int]:
    """Render both passes in one child process. Returns (logical_width, scale)."""
    result = subprocess.run(
        [sys.executable, "-c", DIAGRAM_DRIVER, kind, font, base_source, out, tmp1x, str(scale)],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not Path(out).exists():
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(f"{kind} failed (exit {result.returncode})")

    logical_width = resolved_scale = -1
    for line in result.stdout.splitlines():
        if line.startswith("DIAGRAM_PASSES "):
            fields = dict(part.split("=") for part in line.split()[1:])
            logical_width = int(fields["logical"])
            resolved_scale = int(fields["scale"])
    if logical_width < 0:
        # Driver produced no report; fall back to measuring the written PNG.
        logical_width = png_size(out)[0]
        resolved_scale = scale if scale > 0 else auto_scale(logical_width)
    return logical_width, resolved_scale


def png_size(path: str) -> tuple[int, int]:
    """(width, height) of a PNG, or (0, 0) when it cannot be read."""
    try:
        from PIL import Image

        with Image.open(path) as image:
            return image.size
    except Exception:
        return (0, 0)

# Pillow ≥10 removed these; blockdiag still calls them.
SITECUSTOMIZE = """\
try:
    from PIL import Image, ImageDraw, ImageFont

    # Pillow >=10 removed the module-level resampling constants.
    resampling = getattr(Image, "Resampling", None)
    if resampling is not None:
        for _name, _value in (
            ("ANTIALIAS", resampling.LANCZOS),
            ("LANCZOS", resampling.LANCZOS),
            ("BICUBIC", resampling.BICUBIC),
            ("CUBIC", resampling.BICUBIC),
            ("BILINEAR", resampling.BILINEAR),
            ("LINEAR", resampling.BILINEAR),
            ("NEAREST", resampling.NEAREST),
            ("BOX", resampling.BOX),
            ("HAMMING", resampling.HAMMING),
        ):
            if not hasattr(Image, _name):
                setattr(Image, _name, _value)

    # Pillow's old getsize returned (advance_width, line_height). `getbbox` is
    # the *ink* box instead: its height is much shorter than the line height, so
    # blockdiag sizes edge-label boxes too short and clips the bottom of their
    # glyphs (the visible symptom: a label shows only its top two-thirds). Width
    # from getlength (advance) and height from ascent+descent fixes that.
    def _text_size(font, text):
        ascent, descent = font.getmetrics()
        return (int(font.getlength(text)), int(ascent + descent))

    if not hasattr(ImageFont.FreeTypeFont, "getsize"):
        def _getsize(self, text, *args, **kwargs):
            return _text_size(self, text)
        ImageFont.FreeTypeFont.getsize = _getsize

    if not hasattr(ImageDraw.ImageDraw, "textsize"):
        def _textsize(self, text, font=None, *args, **kwargs):
            target = font or getattr(self, "font", None) or ImageFont.load_default()
            return _text_size(target, text)
        ImageDraw.ImageDraw.textsize = _textsize
except Exception:
    pass
"""


def check_dsl(kind: str, source: str, *, quiet: bool = False) -> int:
    """Parse-only validation: fail fast on DSL syntax errors, no rendering.

    Uses the same parser the renderer does (`<kind>.parser.parse_string`), so a
    bad DSL is rejected *before* anything is drawn -- the "validate first" rule.
    In batch mode `quiet=True` suppresses the success line so the caller can
    print every entry's result in manifest order.
    """
    import importlib

    try:
        text = Path(source).read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit(f"cannot read source: {exc}")
    parser = importlib.import_module(f"{kind}.parser")
    try:
        parser.parse_string(text)
    except Exception as exc:  # parser.ParseException and friends
        sys.stderr.write(f"{kind} DSL syntax error: {exc}\n")
        return 2
    if not quiet:
        print(f"{kind} DSL ok: {source}")
    return 0


def default_font() -> str | None:
    for candidate in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def ensure_default_node_color(dsl: str) -> tuple[str, bool]:
    """Return `(dsl, injected)` -- colored output even when the DSL sets no colors.

    blockdiag's default node fill is white (grayscale output). If the DSL never
    mentions `default_node_color`, inject one right after the diagram's opening
    brace so nodes that lack an explicit `color=` are filled instead of blank;
    nodes that DO set `color=` keep their own color. No-op when a default is
    already present or there is no block to inject into.
    """
    if "default_node_color" in dsl.lower():
        return dsl, False
    brace = dsl.find("{")
    if brace < 0:
        return dsl, False
    injected = f'{dsl[: brace + 1]}\n  default_node_color = "{DEFAULT_NODE_COLOR}";{dsl[brace + 1 :]}'
    return injected, True


def render_one(kind: str, source: str, out: str, font: str, scale: int = 0) -> dict:
    """Render one diagram to `out`; return a result dict.

    Owns its own shim tempdir and env copy, so it is safe to run from worker
    threads: it never mutates os.environ and never shares a temp dir. Prints
    nothing -- the caller formats and emits lines (deterministic under
    parallel execution).
    """
    try:
        dsl = Path(source).read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit(f"cannot read source: {exc}")
    augmented, injected = ensure_default_node_color(dsl)
    had_any_color = "color" in dsl.lower()

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="blockdiag-shim-") as shim_dir:
        Path(shim_dir, "sitecustomize.py").write_text(SITECUSTOMIZE, encoding="utf-8")
        # The single-subprocess driver imports this module by name, so the
        # scripts dir must be importable too.
        scripts_dir = str(Path(__file__).resolve().parent)
        prev_path = os.environ.get("PYTHONPATH", "")
        env = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join(p for p in (scripts_dir, shim_dir, prev_path) if p),
            # The driver imports this module by name; keep the read-only skill
            # dir free of __pycache__.
            "PYTHONDONTWRITEBYTECODE": "1",
        }

        base_source = source
        if injected:
            base_source = str(Path(shim_dir, "diagram.diag"))
            Path(base_source).write_text(augmented, encoding="utf-8")

        if os.environ.get("AGENTEMPLOYEE_DIAGRAM_TWO_PASS") == "1":
            # Legacy path: two child processes. Escape hatch for output-parity
            # debugging; the default collapses both passes into one child.
            run_blockdiag(kind, base_source, out, font, env)
            logical_width, _ = png_size(out)
            resolved_scale = scale if scale > 0 else auto_scale(logical_width)
            if resolved_scale > 1:
                scaled_source = str(Path(shim_dir, "diagram-scaled.diag"))
                Path(scaled_source).write_text(scale_dsl(augmented, resolved_scale), encoding="utf-8")
                run_blockdiag(kind, scaled_source, out, font, env)
        else:
            # One child does both passes, so blockdiag imports once instead of twice.
            logical_width, resolved_scale = run_blockdiag_combined(
                kind, base_source, out, font, env, str(Path(shim_dir, "diagram-1x.png")), scale
            )

    width, height = png_size(out)
    return {
        "kind": kind,
        "source": source,
        "out": out,
        "width": width,
        "height": height,
        "scale": resolved_scale,
        "logical_width": logical_width,
        "injected": injected,
        "had_color": had_any_color,
    }


def format_result(result: dict) -> list[str]:
    lines = [
        f"diagram written: {result['out']} "
        f"({result['width']}x{result['height']} px, {result['scale']}x raster)"
    ]
    if result["injected"] and not result["had_color"]:
        lines.append(
            f'note: DSL set no colors -- injected default_node_color = "{DEFAULT_NODE_COLOR}" '
            f"so the figure is not grayscale. Use color= per node for a role palette."
        )
    if result["logical_width"] > WIDE_HINT_PX:
        lines.append(
            f"hint: layout is {result['logical_width']}px wide (1x) -- too wide for a ~14cm Word "
            f"insert, so labels render tiny. Aim for <=750px: fewer nodes/columns, "
            f"shorter edge labels, or a different --kind."
        )
    return lines


def _run_entry(
    index: int,
    entry: dict,
    default_font_path: str | None,
    default_scale: int,
    force_check: bool,
) -> tuple[int, list[str], str | None]:
    """Worker for one manifest entry. Never prints; returns (index, lines, error)."""
    kind = entry["kind"]
    source = entry["source"]
    try:
        if force_check or entry.get("check"):
            if check_dsl(kind, source, quiet=True) != 0:
                return (index, [], f"{kind} DSL syntax error: {source}")
            return (index, [f"{kind} DSL ok: {source}"], None)
        result = render_one(
            kind,
            source,
            entry["out"],
            entry.get("font") or default_font_path,
            entry.get("scale", default_scale),
        )
        return (index, format_result(result), None)
    except BaseException as exc:  # noqa: BLE001 - report the failing entry, keep siblings
        return (index, [], f"{kind} {source}: {exc}")


def _reject_duplicate_outs(entries: list[tuple[int, str]]) -> None:
    seen: dict[str, int] = {}
    for index, out in entries:
        key = os.path.abspath(out)
        if key in seen:
            raise SystemExit(
                f"manifest entries {seen[key]} and {index} share the same output: {out}"
            )
        seen[key] = index


def run_single(args) -> int:
    if not args.kind:
        raise SystemExit("--kind is required (or use --manifest)")
    if not args.source:
        raise SystemExit("--source is required (or use --manifest)")
    if args.check:
        return check_dsl(args.kind, args.source)
    if not args.out:
        raise SystemExit("--out is required")
    font = args.font or default_font()
    if not font:
        raise SystemExit("no CJK font found; pass --font <path-to-ttf/ttc>")
    result = render_one(args.kind, args.source, args.out, font, args.scale)
    for line in format_result(result):
        print(line)
    return 0


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
    diagrams = manifest.get("diagrams")
    if not isinstance(diagrams, list) or not diagrams:
        raise SystemExit("manifest requires a non-empty 'diagrams' list")

    force_check = bool(args.check)
    default_scale = manifest.get("scale", 0)
    if not isinstance(default_scale, int):
        raise SystemExit("manifest 'scale' must be an integer")

    render_outs: list[tuple[int, str]] = []
    for index, entry in enumerate(diagrams):
        if not isinstance(entry, dict):
            raise SystemExit(f"manifest diagram[{index}] must be an object")
        if entry.get("kind") not in KINDS:
            raise SystemExit(f"manifest diagram[{index}] has invalid 'kind': {entry.get('kind')!r}")
        source = entry.get("source")
        if not isinstance(source, str) or not source:
            raise SystemExit(f"manifest diagram[{index}] requires 'source'")
        if force_check or entry.get("check"):
            continue
        out = entry.get("out")
        if not isinstance(out, str) or not out:
            raise SystemExit(f"manifest diagram[{index}] requires 'out' (or set check)")
        render_outs.append((index, out))
    _reject_duplicate_outs(render_outs)

    default_font_path = manifest.get("font") or args.font or default_font()
    if render_outs and not default_font_path:
        raise SystemExit("no CJK font found; pass --font <path-to-ttf/ttc>")

    # Each render blocks on 1-2 CPU-bound child processes, so cpu_count is the
    # natural ceiling; --jobs 1 forces the sequential path.
    workers = args.jobs if args.jobs > 0 else min(os.cpu_count() or 1, len(diagrams))
    workers = max(1, workers)

    results: list[tuple[int, list[str], str | None]] = []
    if workers <= 1:
        results = [
            _run_entry(index, entry, default_font_path, default_scale, force_check)
            for index, entry in enumerate(diagrams)
        ]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [
                pool.submit(
                    _run_entry, index, entry, default_font_path, default_scale, force_check
                )
                for index, entry in enumerate(diagrams)
            ]
            for future in as_completed(futures):
                results.append(future.result())

    # Emit in manifest order regardless of thread completion order.
    results.sort(key=lambda item: item[0])
    errors = [error for _, _, error in results if error]
    for _, lines, _ in results:
        for line in lines:
            print(line)
    for error in errors:
        sys.stderr.write(error + "\n")
    if errors:
        raise SystemExit(1)
    print(f"{len(diagrams)} diagrams processed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render blockdiag-family diagram(s) to PNG")
    parser.add_argument("--manifest", default="", help="Batch: JSON manifest of diagrams")
    parser.add_argument(
        "--jobs", type=int, default=0, help="Batch parallel workers; 0 = CPU count, 1 = sequential"
    )
    parser.add_argument("--kind", choices=KINDS)
    parser.add_argument("--source", help="Path to the DSL text file")
    parser.add_argument("--out", default="", help="Output PNG path (required unless --check)")
    parser.add_argument("--check", action="store_true", help="Parse the DSL and exit without rendering")
    parser.add_argument("--font", default="", help="CJK font file; defaults to a Windows CJK font")
    parser.add_argument(
        "--scale",
        type=int,
        default=0,
        help="Raster scale factor; 0 = auto (aim for ~300dpi at a 14cm insert)",
    )
    args = parser.parse_args(argv)

    if args.manifest:
        if args.kind or args.source:
            raise SystemExit("--manifest cannot be combined with --kind/--source")
        return run_manifest(args)
    return run_single(args)


if __name__ == "__main__":
    sys.exit(main())
