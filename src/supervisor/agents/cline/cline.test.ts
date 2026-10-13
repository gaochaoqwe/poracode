import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ThreadConfig } from "@/shared/contracts";
import { EXTRACTION_PROMPT } from "@/supervisor/contextExtractor";
import { AcpStructuredSession } from "../acp/session";
import { CLINE_AUTO_APPROVE_CONFIG_OPTION_ID } from "./autoApprove";
import { createClineAdapter, CLINE_AGENT_SETTING_KEYS } from "./index";
import { buildClineArgs } from "./argv";
import {
  clineMcpSettingsPath,
  clineMcpWrapperPath,
  persistClineAppControlsMcp,
  persistClineMcpServer,
} from "./config";
import {
  clineComposerModels,
  clineDetectionSpec,
  clineSettingsAuthProbe,
  configuredClineModels,
  defaultClineCapabilities,
  hasCustomClineEndpoint,
  mergeClineModels,
} from "./detection";
import { resolveClineEnv } from "./env";
import { buildClineOneShotArgs, parseClineOneShotOutput } from "./oneShot";
import { detectClineInvalidSessionRef } from "./session";

const BINARY_NAME = process.platform === "win32" ? "cline.exe" : "cline";

/** Write a fake offline install (marker + binary) under `<baseDir>`. */
function writeEmbeddedInstall(baseDir: string): string {
  const installDir = join(baseDir, "embedded-runtimes", "cline");
  mkdirSync(installDir, { recursive: true });
  const binary = join(installDir, BINARY_NAME);
  writeFileSync(binary, "fake");
  writeFileSync(
    join(installDir, ".installed"),
    JSON.stringify({
      package: "cline",
      version: "3.0.65",
      sha256: "deadbeef",
      installedAt: new Date().toISOString(),
      source: "offline-package",
    }),
  );
  return binary;
}

const baseConfig: ThreadConfig = {
  model: "",
  effort: "",
  mode: "agent",
  approvalPolicy: "never",
  sandboxMode: "",
};

describe("cline argv", () => {
  // Cline's ACP session resolves the provider/model from its launch env
  // (`CLINE_PROVIDER`/`CLINE_MODEL`) and its providers.json — both supplied by
  // `baseSpawnEnv` — so the argv is just `--acp` (plus `--id` on resume).
  it("emits --acp on a fresh launch with no provider/model flags", () => {
    expect(buildClineArgs(baseConfig, "hello")).toEqual(["--acp"]);
  });

  it("resumes with --id, the flag Cline actually supports", () => {
    const args = buildClineArgs(baseConfig, "hello", "abc-123");
    expect(args).toEqual(["--acp", "--id", "abc-123"]);
    // `--resume` and `--session-id` are not Cline flags; the CLI rejects them.
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--session-id");
  });
});

describe("cline adapter", () => {
  it("exposes the documented identity", () => {
    const adapter = createClineAdapter();
    expect(adapter.kind).toBe("cline");
    expect(adapter.label).toBe("Cline");
    expect(adapter.binary).toBe("cline");
    expect(adapter.capabilities).toBe(defaultClineCapabilities);
    expect(typeof adapter.buildLaunchArgv).toBe("function");
    expect(typeof adapter.buildResumeArgv).toBe("function");
    expect(typeof adapter.createStructuredSession).toBe("function");
    expect(typeof adapter.detectInstall).toBe("function");
  });

  it("lets Cline assign its own session id from buildLaunchArgv", () => {
    const adapter = createClineAdapter();
    const spec = adapter.buildLaunchArgv({ kind: "posix", path: "/tmp" }, baseConfig, "hello");
    expect(spec.args[0]).toBe("--acp");
    expect(spec.sessionRef).toBeUndefined();
    expect(spec.args).not.toContain("--session-id");
  });

  it("resumes an existing session with --id", () => {
    const adapter = createClineAdapter();
    const spec = adapter.buildResumeArgv({ kind: "posix", path: "/tmp" }, baseConfig, "hello", {
      providerSessionId: "abc-123",
      discoveredAt: new Date().toISOString(),
    });
    expect(spec.args).toContain("--id");
    expect(spec.args).toContain("abc-123");
    expect(spec.args).not.toContain("--session-id");
  });

  it("createInitialSessionRef lets Cline assign its own id", () => {
    const adapter = createClineAdapter();
    expect(adapter.createInitialSessionRef()).toBeUndefined();
  });

  // Cline's `allow_always` permission option is a no-op; its real blanket
  // auto-approval mechanism is a boolean ACP config option. The adapter must
  // hand that option's id to the shared session so the runtime drives it.
  it("drives Cline's auto-approve switch through the shared ACP session", async () => {
    const createSpy = vi
      .spyOn(AcpStructuredSession, "create")
      .mockReturnValue({ sessionId: "session-1" } as unknown as AcpStructuredSession);
    try {
      await createClineAdapter().createStructuredSession?.({
        threadId: "thread-1",
        projectLocation: { kind: "posix", path: "/tmp" },
        config: baseConfig,
      });

      expect(createSpy.mock.calls[0]?.[3]).toMatchObject({
        autoApproveConfigOptionId: CLINE_AUTO_APPROVE_CONFIG_OPTION_ID,
      });
    } finally {
      createSpy.mockRestore();
    }
  });

  it("resolves a non-WSL launch to the offline install under the adapter's base dir", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-adapter-"));
    try {
      const binary = writeEmbeddedInstall(baseDir);
      const adapter = createClineAdapter({ baseDir });

      const spec = adapter.buildLaunchArgv(
        { kind: "windows", path: "C:\\tmp" },
        baseConfig,
        "hello",
      );
      expect(spec.binary).toBe(binary);

      // A different base dir must not see this install — this is the dev
      // (`~/.agentemployee-dev`) vs default (`~/.agentemployee`) divergence that made a
      // successful offline install invisible to detection.
      const elsewhere = createClineAdapter({ baseDir: join(baseDir, "other") });
      expect(
        elsewhere.buildLaunchArgv({ kind: "posix", path: "/tmp" }, baseConfig, "hello").binary,
      ).not.toBe(binary);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps WSL launches on PATH even when an offline install exists", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-adapter-"));
    try {
      const binary = writeEmbeddedInstall(baseDir);
      const adapter = createClineAdapter({ baseDir });
      const spec = adapter.buildLaunchArgv(
        { kind: "wsl", distro: "Ubuntu", linuxPath: "/tmp", uncPath: "\\\\wsl$" },
        baseConfig,
        "hello",
      );
      expect(spec.binary).not.toBe(binary);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  // One-shots (title/commit generation, context extraction) used to hardcode
  // `command: "cline"`, so an offline-installed copy — which is not on PATH —
  // failed to spawn and title generation silently fell through to the next
  // agent (a Codex 401, in the reported case). The one-shot lane resolves its
  // binary through the same helper the context-extraction lane uses.
  it("resolves context-extraction commands to the offline install", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-adapter-"));
    try {
      const binary = writeEmbeddedInstall(baseDir);
      const adapter = createClineAdapter({ baseDir });
      const location = { kind: "posix", path: "/tmp" } as const;

      expect(
        adapter.buildContextExtractionCommand?.(
          { providerSessionId: "abc-123", discoveredAt: new Date().toISOString() },
          location,
          "deepseek-flash",
        )?.command,
      ).toBe(binary);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  // One-shot generation runs through `runOneShot` (Cline's `--json` lane), not
  // `buildOneShotCommand`: the default styled output must never be parsed as an
  // answer. See "cline one-shot output" below.
  it("exposes runOneShot and no buildOneShotCommand", () => {
    const adapter = createClineAdapter();
    expect(typeof adapter.runOneShot).toBe("function");
    expect(adapter.buildOneShotCommand).toBeUndefined();
  });
});

describe("cline one-shot argv", () => {
  const location = { kind: "posix", path: "/tmp" } as const;

  it("resumes extraction with --id and keeps the prompt last", () => {
    const spec = createClineAdapter().buildContextExtractionCommand?.(
      { providerSessionId: "abc-123", discoveredAt: new Date().toISOString() },
      location,
      "deepseek-flash",
    );
    expect(spec?.args).toEqual(["--id", "abc-123", "-m", "deepseek-flash", EXTRACTION_PROMPT]);
  });

  // Cline's usage line is `cline [options] [command] [prompt]`: the prompt is
  // the LAST positional and every flag precedes it. `--json` selects the NDJSON
  // stream rather than the styled TUI output whose ANSI reasoning preamble used
  // to be parsed as the answer. Verified against the real CLI — a bare
  // single-token positional is rejected as "Unknown command or unquoted prompt",
  // so real (multi-word) prompts must follow the flags.
  it("states --json and the model before the positional prompt", () => {
    expect(buildClineOneShotArgs("deepseek-flash", "write a short title")).toEqual([
      "--json",
      "-m",
      "deepseek-flash",
      "write a short title",
    ]);
  });

  it("omits -m entirely when no model is given", () => {
    expect(buildClineOneShotArgs("", "write a short title")).toEqual([
      "--json",
      "write a short title",
    ]);
    expect(buildClineOneShotArgs(undefined, "write a short title")).toEqual([
      "--json",
      "write a short title",
    ]);
  });
});

describe("cline one-shot output", () => {
  // Real `cline --json` NDJSON, trimmed to the events that matter. The final
  // `run_result.text` is the complete assistant message; the `done` event and
  // text `content_end` carry the same assembled text earlier in the stream.
  const ndjson = [
    '{"type":"agent_event","event":{"type":"iteration_start","iteration":1}}',
    '{"type":"agent_event","event":{"type":"content_start","contentType":"reasoning","reasoning":"The user wants a title"}}',
    '{"type":"agent_event","event":{"type":"content_start","contentType":"text","text":"\\u767b\\u5f55"}}',
    '{"type":"agent_event","event":{"type":"content_end","contentType":"text","text":"\\u767b\\u5f55\\u9875\\u9762\\u6309\\u94ae\\u6539\\u4e3a\\u84dd\\u8272"}}',
    '{"type":"agent_event","event":{"type":"content_end","contentType":"reasoning","reasoning":"that is short"}}',
    '{"type":"agent_event","event":{"type":"done","reason":"completed","text":"\\u767b\\u5f55\\u9875\\u9762\\u6309\\u94ae\\u6539\\u4e3a\\u84dd\\u8272"}}',
    '{"type":"run_result","finishReason":"completed","text":"\\u767b\\u5f55\\u9875\\u9762\\u6309\\u94ae\\u6539\\u4e3a\\u84dd\\u8272"}',
  ].join("\n");

  it("returns the final run_result text, never the reasoning preamble", () => {
    const result = parseClineOneShotOutput(ndjson);
    expect(result.text).toBe("登录页面按钮改为蓝色");
    expect(result.text).not.toContain("[thinking]");
    expect(result.error).toBeUndefined();
  });

  it("falls back to the done event then the text content_end", () => {
    expect(
      parseClineOneShotOutput('{"type":"agent_event","event":{"type":"done","text":"done text"}}')
        .text,
    ).toBe("done text");
    expect(
      parseClineOneShotOutput(
        '{"type":"agent_event","event":{"type":"content_end","contentType":"text","text":"content text"}}',
      ).text,
    ).toBe("content text");
  });

  it("skips non-JSON banner lines and survives ANSI before the NDJSON", () => {
    const result = parseClineOneShotOutput(`Welcome to Ubuntu 24.04\n${ndjson}`);
    expect(result.text).toBe("登录页面按钮改为蓝色");
  });

  it("surfaces a CLI error when no answer was produced", () => {
    const result = parseClineOneShotOutput('{"type":"error","message":"auth_required"}');
    expect(result.text).toBeUndefined();
    expect(result.error).toBe("auth_required");
  });

  it("returns no text for an empty or answerless stream", () => {
    expect(parseClineOneShotOutput("").text).toBeUndefined();
    expect(parseClineOneShotOutput("   \n").text).toBeUndefined();
  });
});

describe("cline detection spec", () => {
  it("declares the expected kind, label, and update metadata", () => {
    expect(clineDetectionSpec.kind).toBe("cline");
    expect(clineDetectionSpec.label).toBe("Cline");
    expect(clineDetectionSpec.binary).toBe("cline");
    expect(clineDetectionSpec.loginCommand).toBe("cline auth");
    expect(clineDetectionSpec.update?.npm).toBe("cline");
    expect(clineDetectionSpec.update?.builtIn).toEqual({
      binary: "cline",
      args: ["update"],
    });
    expect(clineDetectionSpec.capabilities).toBe(defaultClineCapabilities);
  });
});

describe("cline settings env", () => {
  // Detection and launch must translate the panel's settings identically —
  // otherwise the ACP probe runs unauthenticated while launch would succeed,
  // and the UI reports "needs login" with an empty model list.
  it("opens the ACP gate with CLINE_API_KEY and pins provider + model", () => {
    expect(
      resolveClineEnv(
        {
          model: "deepseek-flash",
          apiKey: "sk-test",
          baseUrl: "https://api.deepseek.com",
        },
        "/data/cline/providers.json",
      ),
    ).toEqual({
      CLINE_API_KEY: "sk-test",
      CLINE_PROVIDER: "openai-compatible",
      CLINE_MODEL: "deepseek-flash",
      CLINE_PROVIDER_SETTINGS_PATH: "/data/cline/providers.json",
    });
  });

  // The endpoint (base URL) travels in providers.json, not env — Cline has no
  // env var for the LLM endpoint on this provider.
  it("omits the model when blank and ignores a leftover provider value", () => {
    expect(resolveClineEnv({ apiKey: "sk-test" })).toEqual({
      CLINE_API_KEY: "sk-test",
      CLINE_PROVIDER: "openai-compatible",
    });
    expect(resolveClineEnv({ provider: "DeepSeek", apiKey: "sk-test", model: "  " })).toEqual({
      CLINE_API_KEY: "sk-test",
      CLINE_PROVIDER: "openai-compatible",
    });
  });

  it("returns undefined without a key, leaving Cline's own login alone", () => {
    expect(resolveClineEnv({ model: "gpt-4o" })).toBeUndefined();
    expect(resolveClineEnv({ model: "gpt-4o", baseUrl: "https://gw/v1" })).toBeUndefined();
    expect(resolveClineEnv({ apiKey: "   " })).toBeUndefined();
    expect(resolveClineEnv(undefined)).toBeUndefined();
  });
});

describe("cline baseSpawnEnv", () => {
  // The built-in adapter instance is reused across settings refreshes, so the
  // credentials must be read lazily. `baseSpawnEnv` is how every adapter-driven
  // lane the ACP session does not own — one-shots, context extraction, PTY
  // launches, subagent children — gets them; a value captured at construction
  // would go stale after a panel edit and leave those lanes unauthenticated.
  it("opens the ACP gate and persists the endpoint config for every lane", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-env-"));
    try {
      let settings: Record<string, boolean | string> | undefined = {
        model: "deepseek-flash",
        apiKey: "sk-test",
        baseUrl: "https://api.deepseek.com",
      };
      const adapter = createClineAdapter({ baseDir, readAgentSettings: () => settings });

      const providersPath = join(baseDir, "cline", "providers.json");
      expect(adapter.baseSpawnEnv).toEqual({
        CLINE_API_KEY: "sk-test",
        CLINE_PROVIDER: "openai-compatible",
        CLINE_MODEL: "deepseek-flash",
        CLINE_PROVIDER_SETTINGS_PATH: providersPath,
      });

      // The base URL and custom model land in Cline's own config files.
      const providers = JSON.parse(readFileSync(providersPath, "utf8")) as {
        version: number;
        lastUsedProvider: string;
        providers: Record<string, { settings: Record<string, string> }>;
      };
      expect(providers.version).toBe(1);
      expect(providers.lastUsedProvider).toBe("openai-compatible");
      expect(providers.providers["openai-compatible"]?.settings).toEqual({
        provider: "openai-compatible",
        apiKey: "sk-test",
        model: "deepseek-flash",
        baseUrl: "https://api.deepseek.com",
      });
      const models = JSON.parse(readFileSync(join(baseDir, "cline", "models.json"), "utf8")) as {
        providers: Record<string, { models: Record<string, { id: string }> }>;
      };
      expect(models.providers["openai-compatible"]?.models["deepseek-flash"]?.id).toBe(
        "deepseek-flash",
      );

      // A later edit is visible without rebuilding the adapter.
      settings = { apiKey: "sk-rotated" };
      expect(adapter.baseSpawnEnv?.CLINE_API_KEY).toBe("sk-rotated");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("is an empty env (never absent) when nothing is configured", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-env-"));
    try {
      expect(createClineAdapter({ baseDir }).baseSpawnEnv).toEqual({});
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("cline model catalog", () => {
  // The composer builds its model list solely from detected
  // `capabilities.models`, so a custom model typed into Settings must be
  // merged into the probed catalog or it stays invisible in the composer.
  it("surfaces the configured model even when the probe advertises a catalog", () => {
    const merged = mergeClineModels(
      [{ id: "my-gateway-model", label: "My Gateway Model" }],
      [{ id: "anthropic/gdsAgent-sonnet-4.5", label: "GdsAgent Sonnet 4.5" }],
    );
    expect(merged.map((model) => model.id)).toEqual([
      "my-gateway-model",
      "anthropic/gdsAgent-sonnet-4.5",
    ]);
  });

  it("keeps the probe's richer entry when both name the same id", () => {
    const merged = mergeClineModels(
      [{ id: "gpt-4o", label: "Gpt 4o" }],
      [{ id: "gpt-4o", label: "GPT-4o", description: "from probe" }],
    );
    expect(merged).toEqual([{ id: "gpt-4o", label: "GPT-4o", description: "from probe" }]);
  });

  it("returns the probed catalog untouched when no model is configured", () => {
    const probed = [{ id: "gpt-4o", label: "GPT-4o" }];
    expect(mergeClineModels([], probed)).toEqual(probed);
    expect(configuredClineModels({ model: "  " })).toEqual([]);
    expect(configuredClineModels(undefined)).toEqual([]);
  });
});

describe("cline composer model list", () => {
  const probed = [
    { id: "anthropic/gdsAgent-sonnet-4.5", label: "GdsAgent Sonnet 4.5" },
    { id: "anthropic/gdsAgent-opus-4.6", label: "GdsAgent Opus 4.6" },
  ];

  // A custom endpoint serves ONLY the model the user typed; Cline's own
  // catalog (GdsAgent ids, etc.) is not reachable through their gateway, so
  // offering it would list models the endpoint cannot serve.
  it("exposes only the configured model when a custom endpoint is set", () => {
    expect(
      clineComposerModels(
        { model: "deepseek-flash", apiKey: "sk-test", baseUrl: "https://api.deepseek.com" },
        probed,
      ),
    ).toEqual([{ id: "deepseek-flash", label: "Deepseek Flash" }]);
    // Either half of the endpoint config is enough to mean "bring your own".
    expect(clineComposerModels({ model: "deepseek-flash", apiKey: "sk-test" }, probed)).toEqual([
      { id: "deepseek-flash", label: "Deepseek Flash" },
    ]);
    expect(
      clineComposerModels({ model: "deepseek-flash", baseUrl: "https://gw/v1" }, probed),
    ).toEqual([{ id: "deepseek-flash", label: "Deepseek Flash" }]);
  });

  it("merges the probe catalog when no custom endpoint is configured", () => {
    expect(clineComposerModels({ model: "deepseek-flash" }, probed).map((m) => m.id)).toEqual([
      "deepseek-flash",
      "anthropic/gdsAgent-sonnet-4.5",
      "anthropic/gdsAgent-opus-4.6",
    ]);
    expect(clineComposerModels(undefined, probed)).toEqual(probed);
  });

  it("hasCustomClineEndpoint treats blanks as unset", () => {
    expect(hasCustomClineEndpoint({ apiKey: "  ", baseUrl: "" })).toBe(false);
    expect(hasCustomClineEndpoint(undefined)).toBe(false);
    expect(hasCustomClineEndpoint({ apiKey: "sk-1" })).toBe(true);
  });
});

describe("cline settings auth probe", () => {
  it("reports authenticated when the panel saved an API key", async () => {
    await expect(clineSettingsAuthProbe({ agentSettings: { apiKey: "sk-test" } })).resolves.toBe(
      "authenticated",
    );
  });

  it("defers to the other probes when no key is configured", async () => {
    await expect(
      clineSettingsAuthProbe({ agentSettings: { model: "gpt-4o" } }),
    ).resolves.toBeUndefined();
    await expect(clineSettingsAuthProbe({})).resolves.toBeUndefined();
  });

  it("is consulted before the env-var and config-dir heuristics", () => {
    expect(clineDetectionSpec.authProbes?.[0]).toBe(clineSettingsAuthProbe);
  });
});

describe("cline agent setting keys", () => {
  // The Cline settings panel and the supervisor must agree on the exact
  // key spelling — a divergence would silently leave CLINE_* env unset. There
  // is deliberately no `provider` key: the panel models a single
  // OpenAI-compatible endpoint and the supervisor pins the provider id.
  it("matches the keys the settings panel writes", () => {
    expect(CLINE_AGENT_SETTING_KEYS.model).toBe("model");
    expect(CLINE_AGENT_SETTING_KEYS.apiKey).toBe("apiKey");
    expect(CLINE_AGENT_SETTING_KEYS.baseUrl).toBe("baseUrl");
  });
});

describe("cline session heuristic", () => {
  it("matches known invalid-session phrases", () => {
    expect(detectClineInvalidSessionRef("Session not found")).toBe(true);
    expect(detectClineInvalidSessionRef("invalid session id: xyz")).toBe(true);
  });

  it("does not match unrelated output", () => {
    expect(detectClineInvalidSessionRef("Working on it...")).toBe(false);
    expect(detectClineInvalidSessionRef("")).toBe(false);
  });
});

describe("cline app-controls MCP settings", () => {
  it("writes a streamableHttp agentemployee entry and preserves other servers", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-mcp-"));
    try {
      process.env.CLINE_DATA_DIR = baseDir;
      const path = clineMcpSettingsPath();
      mkdirSync(join(baseDir, "settings"), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({
          mcpServers: { everything: { transport: { type: "stdio", command: "npx" } } },
        }),
      );

      persistClineAppControlsMcp(baseDir, {
        command: "agentemployee.exe",
        args: ["/helpers/mcp-filter.mjs"],
        env: { ELECTRON_RUN_AS_NODE: "1", AGENTEMPLOYEE_MCP_FILTER_CONFIG: "abc" },
      });

      const written = JSON.parse(readFileSync(path, "utf8"));
      expect(written.mcpServers.everything).toEqual({
        transport: { type: "stdio", command: "npx" },
      });
      // Cline drops the stdio entry's env, so Windows routes through a cmd
      // wrapper that sets it before launching Electron-as-Node.
      const expectedTransport =
        process.platform === "win32"
          ? { type: "stdio", command: "cmd.exe", args: ["/c", clineMcpWrapperPath(baseDir)] }
          : {
              type: "stdio",
              command: "agentemployee.exe",
              args: ["/helpers/mcp-filter.mjs"],
              env: { ELECTRON_RUN_AS_NODE: "1", AGENTEMPLOYEE_MCP_FILTER_CONFIG: "abc" },
            };
      expect(written.mcpServers.agentemployee.transport).toEqual(expectedTransport);
    } finally {
      delete process.env.CLINE_DATA_DIR;
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")(
    "bakes the env into the cmd wrapper Cline launches",
    () => {
      const baseDir = mkdtempSync(join(tmpdir(), "cline-mcp-"));
      try {
        persistClineAppControlsMcp(baseDir, {
          command: "C:\\electron.exe",
          args: ["C:\\helpers\\mcp-filter.mjs"],
          env: { ELECTRON_RUN_AS_NODE: "1", AGENTEMPLOYEE_MCP_FILTER_CONFIG: "abc" },
        });
        const wrapper = readFileSync(clineMcpWrapperPath(baseDir), "utf8");
        expect(wrapper).toContain('set "ELECTRON_RUN_AS_NODE=1"');
        expect(wrapper).toContain('set "AGENTEMPLOYEE_MCP_FILTER_CONFIG=abc"');
        expect(wrapper).toContain('"C:\\electron.exe" "C:\\helpers\\mcp-filter.mjs"');
      } finally {
        rmSync(baseDir, { recursive: true, force: true });
      }
    },
  );

  it("removes the agentemployee entry when app-controls is unavailable", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-mcp-"));
    try {
      process.env.CLINE_DATA_DIR = baseDir;
      persistClineAppControlsMcp(baseDir, {
        command: "agentemployee.exe",
        args: ["/helpers/mcp-filter.mjs"],
        env: {},
      });
      persistClineAppControlsMcp(baseDir, null);

      const written = JSON.parse(readFileSync(clineMcpSettingsPath(), "utf8"));
      expect(written.mcpServers.agentemployee).toBeUndefined();
    } finally {
      delete process.env.CLINE_DATA_DIR;
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("adds and removes the knowledge base entry without touching app-controls", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-mcp-"));
    try {
      process.env.CLINE_DATA_DIR = baseDir;
      const entry = {
        command: "agentemployee.exe",
        args: ["/helpers/mcp-filter.mjs"],
        env: { ELECTRON_RUN_AS_NODE: "1", AGENTEMPLOYEE_MCP_FILTER_CONFIG: "kb" },
      };
      persistClineAppControlsMcp(baseDir, entry);
      persistClineMcpServer(baseDir, "knowledge", entry);

      let written = JSON.parse(readFileSync(clineMcpSettingsPath(), "utf8"));
      expect(written.mcpServers.knowledge).toBeDefined();
      expect(written.mcpServers.agentemployee).toBeDefined();

      persistClineMcpServer(baseDir, "knowledge", null);
      written = JSON.parse(readFileSync(clineMcpSettingsPath(), "utf8"));
      expect(written.mcpServers.knowledge).toBeUndefined();
      expect(written.mcpServers.agentemployee).toBeDefined();
    } finally {
      delete process.env.CLINE_DATA_DIR;
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("does not create a file when there is nothing to install", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "cline-mcp-"));
    try {
      process.env.CLINE_DATA_DIR = baseDir;
      persistClineAppControlsMcp(baseDir, null);
      expect(existsSync(clineMcpSettingsPath())).toBe(false);
    } finally {
      delete process.env.CLINE_DATA_DIR;
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
