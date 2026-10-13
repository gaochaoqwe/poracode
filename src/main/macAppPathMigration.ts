import { lstatSync, realpathSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AgentEmployeeChannel } from "@/shared/channel";

interface MacAppPathMigrationOptions {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  executablePath?: string;
}

type MacAppPathMigrationResult = "created" | "skipped" | "failed";

function appNamesFor(channel: AgentEmployeeChannel): { current: string; legacy: string } {
  return channel === "nightly"
    ? { current: "AgentEmployee Nightly.app", legacy: "Lightcode Nightly.app" }
    : { current: "AgentEmployee.app", legacy: "Lightcode.app" };
}

function bundlePathFromExecutable(executablePath: string): string {
  return dirname(dirname(dirname(executablePath)));
}

/**
 * Keep the pre-rebrand application path usable after Squirrel renames the
 * installed bundle. macOS Dock items retain that path, so removing it leaves a
 * dead tile even though the renamed AgentEmployee bundle launches normally.
 *
 * The relative symlink is deliberately best-effort and never replaces an
 * existing file. Squirrel resolves the running application's canonical path
 * before preparing later updates, so installs continue targeting AgentEmployee.
 */
export function repairLegacyMacAppPath(
  channel: AgentEmployeeChannel,
  options: MacAppPathMigrationOptions = {},
): MacAppPathMigrationResult {
  const platform = options.platform ?? process.platform;
  const isPackaged = options.isPackaged ?? false;
  if (platform !== "darwin" || !isPackaged) return "skipped";

  try {
    const executablePath = realpathSync(options.executablePath ?? process.execPath);
    const currentBundlePath = bundlePathFromExecutable(executablePath);
    const names = appNamesFor(channel);
    if (basename(currentBundlePath) !== names.current) return "skipped";

    const legacyBundlePath = join(dirname(currentBundlePath), names.legacy);
    try {
      lstatSync(legacyBundlePath);
      return "skipped";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    symlinkSync(names.current, legacyBundlePath, "dir");
    console.info(`[agentemployee] restored legacy macOS app path at ${legacyBundlePath}`);
    return "created";
  } catch (error) {
    // The app remains launchable from its canonical AgentEmployee path if the
    // install directory is read-only or a filesystem policy rejects symlinks.
    console.warn("[agentemployee] failed to restore legacy macOS app path", error);
    return "failed";
  }
}
