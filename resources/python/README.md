# Bundled Python runtime

AgentEmployee ships a CPython interpreter here so agents can run Python (document
image insertion, plotting) with **no user install and no network**. At runtime
the interpreter's directory is prepended to the agent's `PATH`, so a bare
`python` resolves to it.

## Expected layout

Drop an **extracted** `python-build-standalone` CPython distribution per
platform under a `<platform>-<arch>` subdirectory (the current bundle uses
**3.10**; 3.11/3.12 are fine too — the code only resolves `python.exe`):

```
resources/python/
  win32-x64/
    python.exe            ← interpreter at the root (Windows standalone)
    python312.dll
    Lib/site-packages/    ← python-docx, lxml, Pillow, matplotlib, …
    ...
```

`<platform>-<arch>` matches Node's `process.platform`/`process.arch`
(e.g. `win32-x64`). Only Windows is shipped for now; macOS/Linux and WSL are
later work.

## Pre-installed packages

The interpreter must already contain these in `Lib/site-packages` (they are
**not** installed at runtime):

- `python-docx` — read/write `.docx`, insert images
- `lxml` — python-docx's XML backend (C extension: build per platform/ABI)
- `Pillow` — image handling
- `matplotlib` — data charts (self-contained; includes numpy)
- `openpyxl` — read/write `.xlsx` workbooks (pure Python; depends on `et_xmlfile`)
- `blockdiag` / `actdiag` / `seqdiag` / `nwdiag` — pure-Python structure/flow/sequence/network diagrams
- `setuptools<81` — blockdiag 3.0 still imports `pkg_resources`, removed in setuptools 81+

Install them with the bundled interpreter's own pip:

```
python -m pip install python-docx lxml Pillow matplotlib openpyxl blockdiag actdiag seqdiag nwdiag "setuptools<81"
```

then verify `python -c "import docx, lxml, PIL, matplotlib, openpyxl; import pkg_resources; print('py-ok')"`.

> Diagram rendering pins `setuptools<81` on purpose: newer setuptools no longer
> ships `pkg_resources`, and blockdiag 3.0 (last release) still imports it.

## Build / verification

- These binaries are git-ignored (`resources/python/*`, except this README);
  each build machine supplies its own copy.
- Packaging copies this tree to the app's `python` resources dir via
  `scripts/build-desktop-artifact.mjs` (`extraResources`).
- The interpreter runs read-only from resources: the supervisor sets
  `PYTHONDONTWRITEBYTECODE=1` and `PYTHONPYCACHEPREFIX` so no bytecode is
  written back into the app.
- License: CPython is PSF-licensed; ship the distribution's `LICENSE.txt`
  alongside it (part of the standalone archive).
