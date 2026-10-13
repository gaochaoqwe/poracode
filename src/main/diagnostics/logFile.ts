import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/** Shift `path` → `path.1` → `path.2` … once it reaches `maxBytes`, keeping `keep` files. */
export function rotateLogFile(path: string, maxBytes: number, keep: number): void {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return; // No file yet.
  }
  if (size < maxBytes) return;

  try {
    for (let index = keep - 1; index >= 1; index -= 1) {
      try {
        renameSync(`${path}.${index}`, `${path}.${index + 1}`);
      } catch {
        // The older slot does not exist yet.
      }
    }
    renameSync(path, `${path}.1`);
  } catch {
    return;
  }
  try {
    unlinkSync(`${path}.${keep + 1}`);
  } catch {
    // No overflow file to drop.
  }
}

export interface InstallLogFileOptions {
  maxBytes?: number;
  keep?: number;
}

const patchedStreams = new WeakSet<object>();

/**
 * Tee the main process's stdout/stderr to a rotating log file.
 *
 * A packaged Windows build has no attached console, so every `console.*` line —
 * and the supervisor's output, which is piped into the parent's stdio — is
 * otherwise lost; that is exactly the trace needed to attribute a crash. We
 * patch `write` rather than `console.*` so raw chunks the supervisor pipeline
 * writes are captured too. Purely best-effort: a logging failure must never
 * affect the app, and nothing here adds new log content of its own.
 */
export function installMainLogFile(path: string, options: InstallLogFileOptions = {}): void {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const keep = options.keep ?? 3;

  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    return;
  }

  let written = 0;
  const append = (chunk: unknown): void => {
    let text = "";
    if (typeof chunk === "string") text = chunk;
    else if (chunk instanceof Uint8Array) text = Buffer.from(chunk).toString("utf8");
    if (text.length === 0) return;

    written += Buffer.byteLength(text);
    if (written >= maxBytes) {
      written = 0;
      rotateLogFile(path, maxBytes, keep);
    }
    try {
      appendFileSync(path, text, "utf8");
    } catch {
      // Best effort.
    }
  };

  const install = (stream: NodeJS.WriteStream | undefined): void => {
    if (!stream || patchedStreams.has(stream) || typeof stream.write !== "function") return;
    patchedStreams.add(stream);
    const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    (stream as { write: (...args: unknown[]) => boolean }).write = (...args: unknown[]) => {
      append(args[0]);
      return original(...args);
    };
  };

  install(process.stdout);
  install(process.stderr);
}
