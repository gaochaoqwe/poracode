# Bundled Graphviz

The Python `graphviz` package shells out to the `dot` executable. To keep
diagram rendering offline and install-free, AgentEmployee ships the Graphviz
binaries here; at runtime their `bin` dir is prepended to the agent's `PATH`
and `GVBINDIR` points at this tree.

## Expected layout

Drop a **Windows x64** Graphviz distribution (the official zip, or copied from a
conda `Library/`) under the `<platform>-<arch>` subdirectory:

```
resources/graphviz/
  win32-x64/
    bin/            dot.exe, gvplugin_*.dll, cgraph.dll, gvc.dll, …
    lib/
    share/graphviz/ config6, plugin configs
```

`<platform>-<arch>` matches Node's `process.platform`/`process.arch`
(e.g. `win32-x64`). Windows only for now.

## Python package

The interpreter in `resources/python` must also have the wrapper installed:

```
python -m pip install graphviz
```

(the wrapper is pure Python; the binaries above do the rendering).

## Verification

```
dot -V
python -c "import graphviz, shutil; print(graphviz.__version__, shutil.which('dot'))"
```

## Build

These binaries are git-ignored (`resources/graphviz/*`, except this README).
Packaging copies this tree to the app's `graphviz` resources dir via
`scripts/build-desktop-artifact.mjs` (`extraResources`). Graphviz is licensed
under the EPL-1.0 — ship its `LICENSE` alongside.
