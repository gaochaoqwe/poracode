import { app } from "electron";
import type { AgentEmployeeChannel } from "@/shared/channel";
import type { AgentEmployeeDiagnosticTags, SentryEventLike } from "@/shared/diagnostics/sentryPrivacy";
import {
  readBuildSentryDsn,
  readBuildSentryEnvironment,
  shouldEnableSentryReporting,
} from "@/shared/diagnostics/sentryBuildConfig";
import { prepareMainSentryEvent } from "./mainEvent";

const DISABLED_INTEGRATIONS = new Set([
  "ChildProcess",
  "Console",
  "ContextLines",
  "ElectronBreadcrumbs",
  "ElectronNet",
  "LocalVariables",
  "Screenshots",
]);

type MainSentryModule = typeof import("@sentry/electron/main");

let mainSentry: MainSentryModule | null | undefined;

export type MainSentryOptions = {
  appVersion: string;
  isDev: boolean;
  channel: AgentEmployeeChannel;
};

function loadMainSentry(): MainSentryModule | null {
  if (mainSentry !== undefined) {
    return mainSentry;
  }

  try {
    mainSentry = require("@sentry/electron/main") as MainSentryModule;
  } catch (error) {
    mainSentry = null;
    console.warn(
      "[agentemployee] Sentry main process integration unavailable:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return mainSentry;
}

function readSentryDsn(): string | null {
  const dsn = process.env.SENTRY_DSN || readBuildSentryDsn();
  return dsn && dsn.trim().length > 0 ? dsn.trim() : null;
}

function readSentryEnvironment(options: MainSentryOptions): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    readBuildSentryEnvironment() ||
    (options.isDev ? "development" : "production")
  );
}

function shouldEnableSentry(options: MainSentryOptions): boolean {
  return shouldEnableSentryReporting(readSentryDsn(), options.isDev);
}

function buildBaseTags(options: MainSentryOptions): AgentEmployeeDiagnosticTags {
  return {
    "agentemployee.app_version": options.appVersion,
    "agentemployee.arch": process.arch,
    "agentemployee.channel": options.channel,
    "agentemployee.chrome": process.versions.chrome ?? "unknown",
    "agentemployee.electron": process.versions.electron ?? "unknown",
    "agentemployee.node": process.versions.node,
    "agentemployee.platform": process.platform,
    "agentemployee.process": "main",
  };
}

export function isSentryConfigured(options: MainSentryOptions): boolean {
  return shouldEnableSentry(options);
}

export function initializeMainSentry(options: MainSentryOptions): boolean {
  const dsn = readSentryDsn();
  if (!dsn || !shouldEnableSentry(options)) {
    return false;
  }

  const Sentry = loadMainSentry();
  if (!Sentry) {
    return false;
  }

  Sentry.init({
    dsn,
    release: `agentemployee@${options.appVersion}`,
    environment: readSentryEnvironment(options),
    sendDefaultPii: false,
    enableLogs: false,
    attachScreenshot: false,
    maxBreadcrumbs: 0,
    normalizeDepth: 4,
    tracesSampleRate: 0,
    debug: process.env.SENTRY_DEBUG === "1",
    initialScope: {
      tags: buildBaseTags(options),
    },
    beforeBreadcrumb() {
      return null;
    },
    beforeSend(event) {
      return prepareMainSentryEvent(
        event as unknown as SentryEventLike,
        process.platform,
      ) as unknown as typeof event | null;
    },
    integrations(defaultIntegrations) {
      return defaultIntegrations.filter(
        (integration) => !DISABLED_INTEGRATIONS.has(integration.name),
      );
    },
  });

  Sentry.setContext("agentemployee", {
    appVersion: options.appVersion,
    channel: options.channel,
    packaged: app.isPackaged,
    process: "main",
  });

  return true;
}

export function captureMainException(
  error: unknown,
  tags?: AgentEmployeeDiagnosticTags,
  fingerprint?: string[],
): void {
  const Sentry = loadMainSentry();
  if (!Sentry) return;
  if (!Sentry.isEnabled()) return;
  Sentry.withScope((scope) => {
    if (tags) {
      scope.setTags(tags);
    }
    if (fingerprint) {
      scope.setFingerprint(fingerprint);
    }
    Sentry.captureException(error);
  });
}
