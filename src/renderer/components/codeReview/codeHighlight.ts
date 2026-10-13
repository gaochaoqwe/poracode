/**
 * Lightweight, dependency-free syntax tokenizer for the code-review dark code
 * view. Mirrors the reference `requirement_extractor` function-codemap source
 * view's token coloring (VS Code Dark+ palette) so the review panel "还原"
 * the original look while staying self-contained and fast (no shiki/wasm load
 * inside the review panel, and no HTML injection — segments render as text).
 *
 * Token classes (colors live in the component's stylesheet):
 *   keyword      #c586c0   control/declaration keywords
 *   type         #4ec9b0   language types / built-ins
 *   string       #ce9178   string & char literals
 *   comment      #6a9955   comments
 *   number       #b5cea8   numeric literals
 *   function     #dcdcaa   identifier followed by `(`
 *   preprocessor #9cdcfe   #include/#define ... and shell/python shebang-ish
 *   plain        default
 *
 * The tokenizer walks the full text once (so block comments and multi-line
 * strings carry state across lines), then groups the emitted tokens back by
 * line. All returned text is rendered by React as text nodes — never as HTML.
 */

export interface CodeSeg {
  text: string;
  cls: string;
}

export type CodeHighlightLine = readonly CodeSeg[];

type TokenClass = "keyword" | "type" | "string" | "comment" | "number" | "function" | "preprocessor" | "plain";

interface Emitted {
  line: number;
  text: string;
  cls: TokenClass;
}

const KEYWORDS_C: ReadonlySet<string> = new Set([
  "auto", "break", "case", "char", "const", "continue", "default", "do",
  "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline",
  "int", "long", "register", "restrict", "return", "short", "signed", "sizeof",
  "static", "struct", "switch", "typedef", "union", "unsigned", "void",
  "volatile", "while", "_Bool", "_Complex", "_Imaginary", "bool", "true",
  "false", "nullptr", "class", "namespace", "template", "typename", "public",
  "private", "protected", "virtual", "override", "final", "explicit",
  "operator", "friend", "using", "try", "catch", "throw", "new", "delete",
  "this", "constexpr", "const_cast", "static_cast", "dynamic_cast",
  "reinterpret_cast", "decltype", "alignof", "alignas", "noexcept", "thread_local",
]);

const TYPES_C: ReadonlySet<string> = new Set([
  "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t",
  "uint64_t", "size_t", "ssize_t", "ptrdiff_t", "intptr_t", "uintptr_t", "bool",
  "byte", "wchar_t", "char16_t", "char32_t", "int", "long", "short", "char",
  "double", "float", "void", "unsigned", "signed", "size_t", "string",
  "vector", "map", "set", "list", "queue", "stack", "deque", "pair", "tuple",
  "unique_ptr", "shared_ptr", "weak_ptr", "array", "initializer_list",
]);

const KEYWORDS_VERILOG: ReadonlySet<string> = new Set([
  "module", "endmodule", "input", "output", "inout", "wire", "reg", "parameter",
  "localparam", "assign", "always", "initial", "begin", "end", "if", "else",
  "case", "endcase", "for", "while", "repeat", "forever", "posedge", "negedge",
  "or", "and", "not", "xor", "nand", "nor", "xnor", "buf", "bufif0", "bufif1",
  "notif0", "notif1", "pullup", "pulldown", "cmos", "rcmos", "nmos", "pmos",
  "rnmos", "rpmos", "tran", "tranif0", "tranif1", "rtran", "rtranif0", "rtranif1",
  "function", "endfunction", "task", "endtask", "generate", "endgenerate",
  "genvar", "integer", "real", "time", "tri", "supply0", "supply1",
]);

const KEYWORDS_VHDL: ReadonlySet<string> = new Set([
  "entity", "architecture", "component", "configuration", "library", "use",
  "package", "is", "of", "begin", "end", "signal", "variable", "constant",
  "type", "subtype", "port", "generic", "map", "in", "out", "inout", "buffer",
  "linkage", "process", "if", "then", "else", "elsif", "case", "when", "others",
  "for", "while", "loop", "next", "exit", "wait", "until", "after", "return",
  "and", "or", "not", "xor", "nand", "nor", "xnor", "sll", "srl", "sla", "sra",
  "rol", "ror", "to", "downto", "range", "open", "all", "body",
]);

const KEYWORDS_TS: ReadonlySet<string> = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
  "finally", "for", "from", "function", "get", "if", "implements", "import",
  "in", "instanceof", "interface", "let", "new", "null", "of", "package",
  "private", "protected", "public", "return", "set", "static", "super",
  "switch", "this", "throw", "try", "typeof", "undefined", "var", "void",
  "while", "with", "yield", "true", "false", "abstract", "readonly", "override",
]);

const TYPES_TS: ReadonlySet<string> = new Set([
  "string", "number", "boolean", "any", "unknown", "never", "void", "object",
  "symbol", "bigint", "undefined", "null", "Array", "Record", "Partial",
  "Readonly", "Promise", "Map", "Set", "Error", "Date", "RegExp", "Buffer",
  "HTMLElement", "Element", "Node", "Window", "Document",
]);

const KEYWORDS_PY: ReadonlySet<string> = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
  "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
  "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield", "True", "False", "None", "self",
  "match", "case",
]);

const KEYWORDS_GO: ReadonlySet<string> = new Set([
  "break", "default", "func", "interface", "select", "case", "defer", "go",
  "map", "struct", "chan", "else", "goto", "package", "switch", "const",
  "fallthrough", "if", "range", "type", "continue", "for", "import", "return",
  "var", "true", "false", "nil", "make", "new", "append", "len", "cap", "panic",
  "recover", "go", "defer",
]);

const KEYWORDS_RUST: ReadonlySet<string> = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
  "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
  "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
  "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
  "where", "while",
]);

const KEYWORDS_SHELL: ReadonlySet<string> = new Set([
  "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done",
  "case", "esac", "function", "in", "select", "time", "export", "local",
  "return", "break", "continue", "set", "unset", "readonly", "shift", "exit",
]);

type Lang = "c" | "cpp" | "verilog" | "vhdl" | "js" | "ts" | "py" | "go" | "rs" | "shell" | "generic";

interface LangSpec {
  keywords: ReadonlySet<string>;
  types?: ReadonlySet<string>;
  lineComment: string | null;
  blockComment: boolean;
  hashPragma: boolean;
  /** true → `#` toggles comment for the rest of the line (python, shell). */
  hashComment: boolean;
  templateString: boolean;
}

const LANG_SPECS: Record<Lang, LangSpec> = {
  c: { keywords: KEYWORDS_C, types: TYPES_C, lineComment: "//", blockComment: true, hashPragma: true, hashComment: false, templateString: false },
  cpp: { keywords: KEYWORDS_C, types: TYPES_C, lineComment: "//", blockComment: true, hashPragma: true, hashComment: false, templateString: false },
  verilog: { keywords: KEYWORDS_VERILOG, lineComment: "//", blockComment: true, hashPragma: false, hashComment: false, templateString: false },
  vhdl: { keywords: KEYWORDS_VHDL, lineComment: "--", blockComment: false, hashPragma: false, hashComment: false, templateString: false },
  js: { keywords: KEYWORDS_TS, types: TYPES_TS, lineComment: "//", blockComment: true, hashPragma: false, hashComment: false, templateString: true },
  ts: { keywords: KEYWORDS_TS, types: TYPES_TS, lineComment: "//", blockComment: true, hashPragma: false, hashComment: false, templateString: true },
  py: { keywords: KEYWORDS_PY, lineComment: "#", blockComment: false, hashPragma: false, hashComment: false, templateString: false },
  go: { keywords: KEYWORDS_GO, lineComment: "//", blockComment: true, hashPragma: false, hashComment: false, templateString: false },
  rs: { keywords: KEYWORDS_RUST, lineComment: "//", blockComment: true, hashPragma: false, hashComment: false, templateString: false },
  shell: { keywords: KEYWORDS_SHELL, lineComment: "#", blockComment: false, hashPragma: false, hashComment: false, templateString: false },
  generic: { keywords: KEYWORDS_TS, types: TYPES_TS, lineComment: "//", blockComment: true, hashPragma: false, hashComment: true, templateString: false },
};

/** Pick the tokenizer spec for a file path (extension based). */
export function getLangForPath(filePath: string): Lang {
  const name = (filePath.split("/").pop() ?? "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : name;
  switch (ext) {
    case "c": case "h": return "c";
    case "cpp": case "cc": case "cxx": case "c++": case "hpp": case "hh": case "hxx": case "h++": return "cpp";
    case "v": case "vh": case "sv": case "svh": return "verilog";
    case "vhd": case "vhdl": return "vhdl";
    case "js": case "jsx": case "mjs": case "cjs": return "js";
    case "ts": case "tsx": case "mts": case "cts": return "ts";
    case "py": return "py";
    case "go": return "go";
    case "rs": return "rs";
    case "sh": case "bash": case "zsh": case "fish": return "shell";
    default: return "generic";
  }
}

const isIdentStart = (ch: string): boolean => /[A-Za-z_$]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch: string): boolean => /[0-9]/.test(ch);

/**
 * Tokenize the whole file. Returns an array indexed by line (0-based); each
 * entry is the list of segments for that line. Handles block comments and
 * template strings that span lines.
 */
export function highlightCode(text: string, langInput: Lang = "generic"): CodeHighlightLine[] {
  const spec = LANG_SPECS[langInput] ?? LANG_SPECS.generic;
  const lines: CodeHighlightLine[] = [];
  const emitted: Emitted[] = [];

  let line = 0;
  let i = 0;
  let inBlockComment = false;
  let inTemplate = false;
  const n = text.length;

  /**
   * Emit a token spanning [start, end). Splits multi-line slices so every piece
   * carries its true line number (block comments / template strings), and drops
   * the newline characters themselves (they belong to the line layout, not the
   * token stream). `line` is advanced by the number of newlines consumed.
   */
  const emit = (cls: TokenClass, start: number, end: number): void => {
    let p = start;
    while (p < end) {
      const nl = text.indexOf("\n", p);
      const segEnd = nl === -1 || nl >= end ? end : nl;
      if (segEnd > p) emitted.push({ line, text: text.slice(p, segEnd), cls });
      if (segEnd === end) break;
      line += 1;
      p = nl + 1;
    }
  };

  // Precompute per-line start indexes so `isLineStart` (preprocessor / python
  // comment) can be decided cheaply.
  const lineStarts: number[] = [0];
  for (let k = 0; k < n; k++) {
    if (text.charAt(k) === "\n") lineStarts.push(k + 1);
  }
  const lineCount = lineStarts.length;

  while (i < n) {
    const ch = text.charAt(i);
    const two = text.slice(i, i + 2);
    const isLineStart = i === lineStarts[line] && line < lineCount;

    // Block comment continuation state.
    if (inBlockComment) {
      const close = text.indexOf("*/", i);
      if (close === -1) {
        emit("comment", i, n);
        i = n;
      } else {
        emit("comment", i, close + 2);
        i = close + 2;
        inBlockComment = false;
      }
      continue;
    }

    // Template string continuation state (js/ts).
    if (inTemplate) {
      if (ch === "`") {
        emit("string", i, i + 1);
        inTemplate = false;
        i += 1;
      } else {
        const end = text.indexOf("`", i);
        if (end === -1) {
          emit("string", i, n);
          i = n;
        } else {
          emit("string", i, end + 1);
          i = end + 1;
          inTemplate = false;
        }
      }
      continue;
    }

    // Line comment.
    const lc = spec.lineComment;
    if (lc && text.startsWith(lc, i)) {
      const nl = text.indexOf("\n", i);
      emit("comment", i, nl === -1 ? n : nl);
      i = nl === -1 ? n : nl;
      continue;
    }

    // Block comment open.
    if (spec.blockComment && two === "/*") {
      const close = text.indexOf("*/", i + 2);
      if (close === -1) {
        emit("comment", i, n);
        i = n;
      } else {
        emit("comment", i, close + 2);
        i = close + 2;
      }
      continue;
    }

    // Preprocessor / pragma lines (C-family `#include`, `#define`, etc.).
    if (spec.hashPragma && isLineStart && ch === "#") {
      const nl = text.indexOf("\n", i);
      emit("preprocessor", i, nl === -1 ? n : nl);
      i = nl === -1 ? n : nl;
      continue;
    }

    // Python/shell-style `#` comment.
    if (spec.hashComment && ch === "#" && (i === lineStarts[line] || /^\s/.test(text.charAt(i - 1)))) {
      const nl = text.indexOf("\n", i);
      emit("comment", i, nl === -1 ? n : nl);
      i = nl === -1 ? n : nl;
      continue;
    }

    // Whitespace.
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(text.charAt(j))) j += 1;
      emit("plain", i, j);
      i = j;
      continue;
    }

    // String literals.
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (text.charAt(j) === "\\") { j += 2; continue; }
        if (text.charAt(j) === ch) { j += 1; break; }
        if (text.charAt(j) === "\n") break;
        j += 1;
      }
      emit("string", i, j);
      i = j;
      continue;
    }

    // Template string (js/ts) — backtick opener.
    if (spec.templateString && ch === "`") {
      emit("string", i, i + 1);
      inTemplate = true;
      i += 1;
      continue;
    }

    // Numbers (int, float, hex, binary, size'd Verilog literals).
    if (isDigit(ch) || (ch === "." && /[0-9]/.test(text.charAt(i + 1)))) {
      let j = i;
      // Verilog sized literal: <width>'<base>...
      const sized = /^\d+'\s*[bBoOdDhH]/i.test(text.slice(i, i + 8));
      if (sized) {
        let k = i;
        while (k < n && /[0-9]/.test(text.charAt(k))) k += 1;
        if (text.charAt(k) === "'") k += 1;
        while (k < n && /\s/.test(text.charAt(k))) k += 1;
        if (/[bBoOdDhH]/.test(text.charAt(k))) {
          k += 1;
          while (k < n && /[0-9a-fA-FxzXZ_?]/.test(text.charAt(k))) k += 1;
        }
        emit("number", i, k);
        i = k;
        continue;
      }
      if (text.startsWith("0x", i) || text.startsWith("0X", i)) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F_]/.test(text.charAt(j))) j += 1;
      } else {
        while (j < n && /[0-9_]/.test(text.charAt(j))) j += 1;
        if (text.charAt(j) === "." && /[0-9]/.test(text.charAt(j + 1))) {
          j += 1;
          while (j < n && /[0-9_]/.test(text.charAt(j))) j += 1;
        }
        if (/[eE]/.test(text.charAt(j)) && /[0-9+-]/.test(text.charAt(j + 1))) {
          j += 1;
          if (text.charAt(j) === "+" || text.charAt(j) === "-") j += 1;
          while (j < n && /[0-9_]/.test(text.charAt(j))) j += 1;
        }
        if (/[fFlLuU]/.test(text.charAt(j))) j += 1;
      }
      emit("number", i, j);
      i = j;
      continue;
    }

    // Identifiers.
    if (isIdentStart(ch)) {
      let j = i;
      while (j < n && isIdentPart(text.charAt(j))) j += 1;
      const word = text.slice(i, j);
      const next = text.charAt(j);
      let cls: TokenClass = "plain";
      if (spec.keywords.has(word)) cls = "keyword";
      else if (spec.types?.has(word)) cls = "type";
      else if (next === "(") cls = "function";
      emit(cls, i, j);
      i = j;
      continue;
    }

    // Operators & punctuation — collect a run for fewer segments.
    const isRunStop = (p: number): boolean => {
      if (p >= n) return true;
      const c = text.charAt(p);
      if (/\s/.test(c) || isIdentStart(c) || isDigit(c)) return true;
      if (c === '"' || c === "'" || c === "`") return true;
      if (spec.blockComment && text.startsWith("/*", p)) return true;
      if (lc && text.startsWith(lc, p)) return true;
      return false;
    };
    let j = i;
    while (!isRunStop(j)) {
      j += 1;
    }
    if (j === i) j = i + 1;
    emit("plain", i, j);
    i = j;
  }

  // Group emitted tokens by line.
  for (let l = 0; l < lineCount; l++) {
    lines.push(emitted.filter((e) => e.line === l).map((e) => ({ text: e.text, cls: e.cls })));
  }
  return lines;
}

/** Convenience: tokenize a whole file into per-line segments for the panel. */
export function highlightCodeForPath(text: string, filePath: string): CodeHighlightLine[] {
  return highlightCode(text, getLangForPath(filePath));
}
