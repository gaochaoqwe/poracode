import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginFixture, seedBuiltInPlugins } from "@/renderer/testUtils/plugins";
import { useSharedSettings, waitForPendingSharedSettings } from "./sharedSettingsStore";

const originalAgentEmployeeBridge = window.agentemployee;

describe("sharedSettingsStore", () => {
  afterEach(() => {
    if (originalAgentEmployeeBridge) window.agentemployee = originalAgentEmployeeBridge;
    else Reflect.deleteProperty(window, "agentemployee");
  });

  beforeEach(() => {
    localStorage.clear();
    seedBuiltInPlugins();
    useSharedSettings.setState({
      themeMode: "dark",
      staleThreadUnloadMinutes: 20,
      followUpBehavior: "steer",
      audio: {
        showVoiceInputButton: true,
        microphoneDeviceId: "",
        transcriptionLanguage: "en",
        transcriptionModel: "tiny",
        useWebGpu: true,
      },
      providerConfigs: {},
      providerModelPreferences: {},
      agentInstances: {},
      hiddenModels: {},
      agentSettings: {},
      lastPresentationModeByAgent: {},
      disabledAgents: [],
      favoriteModels: [],
      recentModels: [],
      agentSelectionUsage: [],
      crossagentSelectionUsage: [],
      crossagentRoutingOverrides: [],
      providerOrder: [],
      threadDocksOrder: ["goal", "plan", "agents", "backgroundTasks", "images"],
      sidebarShortcutOrder: ["pullRequests", "githubActions", "schedules"],
      lastUsedProjectDirs: {},
      enabledMcpServers: {},
      installedPlugins: {},
    });
  });

  it("defaults theme to dark", () => {
    expect(useSharedSettings.getState().themeMode).toBe("dark");
  });

  it("switches theme mode", () => {
    useSharedSettings.getState().setThemeMode("light");
    expect(useSharedSettings.getState().themeMode).toBe("light");
  });

  it("updates the Windows shell path and arguments", () => {
    useSharedSettings.getState().setWindowsShellPath("C:\\Tools\\pwsh.exe");
    useSharedSettings.getState().setWindowsInternalShellPath("C:\\Tools\\pwsh-preview.exe");
    useSharedSettings.getState().setWindowsShellArguments("-NoProfile");

    expect(useSharedSettings.getState()).toMatchObject({
      windowsShellPath: "C:\\Tools\\pwsh.exe",
      windowsInternalShellPath: "C:\\Tools\\pwsh-preview.exe",
      windowsShellArguments: "-NoProfile",
    });
  });

  it("clamps Windows shell arguments to the shared settings maximum", () => {
    useSharedSettings.getState().setWindowsShellArguments("x".repeat(8_193));
    expect(useSharedSettings.getState().windowsShellArguments).toHaveLength(8_192);
  });

  it("exposes pending settings persistence as a launch barrier", async () => {
    let finishWrite!: () => void;
    const setSharedSettings = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    window.agentemployee = { setSharedSettings } as unknown as typeof window.agentemployee;

    useSharedSettings.getState().setThemeMode("dark");
    let barrierFinished = false;
    const barrier = waitForPendingSharedSettings().then(() => {
      barrierFinished = true;
    });
    await Promise.resolve();

    expect(setSharedSettings).toHaveBeenCalledOnce();
    expect(barrierFinished).toBe(false);
    finishWrite();
    await barrier;
    expect(barrierFinished).toBe(true);
  });

  it("updates the stale thread unload timing", () => {
    useSharedSettings.getState().setStaleThreadUnloadMinutes(30);
    expect(useSharedSettings.getState().staleThreadUnloadMinutes).toBe(30);
  });

  it("updates and persists follow-up behavior", () => {
    useSharedSettings.getState().setFollowUpBehavior("queue");

    expect(useSharedSettings.getState().followUpBehavior).toBe("queue");
    expect(JSON.parse(localStorage.getItem("agentemployee-shared-settings") ?? "null")).toMatchObject({
      followUpBehavior: "queue",
    });
  });

  it("shows and hides sidebar shortcuts", () => {
    useSharedSettings.setState({ sidebarHiddenShortcuts: ["githubActions"] });

    useSharedSettings.getState().setSidebarShortcutVisible("githubActions", true);
    expect(useSharedSettings.getState().sidebarHiddenShortcuts).toEqual([]);

    useSharedSettings.getState().setSidebarShortcutVisible("schedules", false);
    expect(useSharedSettings.getState().sidebarHiddenShortcuts).toEqual(["schedules"]);
  });

  it("reorders sidebar shortcuts and keeps every supported shortcut", () => {
    useSharedSettings.getState().setSidebarShortcutOrder(["tasks", "pullRequests"]);

    expect(useSharedSettings.getState().sidebarShortcutOrder).toEqual([
      "tasks",
      "pullRequests",
      "githubActions",
      "schedules",
    ]);
  });

  it("reorders thread docks and keeps every supported dock", () => {
    useSharedSettings.getState().setThreadDocksOrder(["backgroundTasks", "plan"]);

    expect(useSharedSettings.getState().threadDocksOrder).toEqual([
      "backgroundTasks",
      "plan",
      "goal",
      "agents",
      "images",
    ]);
  });

  it("updates audio settings", () => {
    useSharedSettings.getState().setAudioSetting("transcriptionLanguage", "es");
    expect(useSharedSettings.getState().audio.transcriptionLanguage).toBe("es");
  });

  it("counts repeated normal composer selections for Crossagents fallback ranking", () => {
    const state = useSharedSettings.getState();
    state.pushRecentModel("kimi", "k3", "gui", "max", false);
    state.pushRecentModel("kimi", "k3", "gui", "max", false);

    expect(useSharedSettings.getState().agentSelectionUsage).toEqual([
      expect.objectContaining({
        agentKind: "kimi",
        modelId: "k3",
        effort: "max",
        fast: false,
        count: 2,
      }),
    ]);
  });

  it("updates provider config when only context size, fast, and thinking change", () => {
    useSharedSettings.getState().setProviderConfig("gdsAgent", {
      model: "gdsAgent-opus-4-7",
      effort: "high",
      contextSize: "1m",
      mode: "agent",
      approvalPolicy: "auto",
    });

    useSharedSettings.getState().setProviderConfig("gdsAgent", {
      model: "gdsAgent-opus-4-7",
      effort: "high",
      contextSize: "200k",
      fast: true,
      thinking: true,
      mode: "agent",
      approvalPolicy: "auto",
    });

    expect(useSharedSettings.getState().providerConfigs.gdsAgent).toMatchObject({
      contextSize: "200k",
      fast: true,
      thinking: true,
    });
  });

  it("keeps effort and Fast preferences independent for subprovider model ids", () => {
    const state = useSharedSettings.getState();
    state.setProviderModelPreference("opencode", "openai/gpt-5.6-sol", {
      effort: "high",
      fast: false,
    });
    state.setProviderModelPreference("opencode", "openai/gpt-5.6-luna", {
      effort: "max",
      fast: true,
    });
    state.setProviderModelPreference("opencode", "github-copilot/gpt-5.6-luna", {
      effort: "medium",
      fast: false,
    });
    state.setProviderModelPreference("codex", "openai/gpt-5.6-luna", {
      effort: "low",
      fast: false,
    });

    expect(useSharedSettings.getState().providerModelPreferences.opencode).toEqual({
      "openai/gpt-5.6-sol": { effort: "high", fast: false },
      "openai/gpt-5.6-luna": { effort: "max", fast: true },
      "github-copilot/gpt-5.6-luna": { effort: "medium", fast: false },
    });
    expect(useSharedSettings.getState().providerModelPreferences.codex).toEqual({
      "openai/gpt-5.6-luna": { effort: "low", fast: false },
    });
  });

  it("preserves the last experiment judge configuration", () => {
    useSharedSettings
      .getState()
      .setExperimentJudgeConfig("gdsAgent", "gdsAgent-opus-4-8", "high", true);

    expect(useSharedSettings.getState()).toMatchObject({
      experimentJudgeProvider: "gdsAgent",
      experimentJudgeModel: "gdsAgent-opus-4-8",
      experimentJudgeEffort: "high",
      experimentJudgeFast: true,
    });
  });

  it("records the last-used project directory per runtime key", () => {
    useSharedSettings.getState().setLastUsedProjectDir("native", "/Users/me/code");
    useSharedSettings.getState().setLastUsedProjectDir("Ubuntu", "\\\\wsl.localhost\\Ubuntu\\home");

    expect(useSharedSettings.getState().lastUsedProjectDirs).toEqual({
      native: "/Users/me/code",
      Ubuntu: "\\\\wsl.localhost\\Ubuntu\\home",
    });
  });

  it("overwrites the directory for an existing runtime key", () => {
    useSharedSettings.getState().setLastUsedProjectDir("native", "/Users/me/a");
    useSharedSettings.getState().setLastUsedProjectDir("native", "/Users/me/b");

    expect(useSharedSettings.getState().lastUsedProjectDirs.native).toBe("/Users/me/b");
  });

  it("persists plugin lifecycle and contribution mutations", () => {
    const persistedPlugins = () =>
      JSON.parse(localStorage.getItem("agentemployee-shared-settings") ?? "null").installedPlugins;

    useSharedSettings.getState().installPlugin(pluginFixture("browser-tools"));
    expect(persistedPlugins()).toEqual({
      "browser-tools": {
        version: pluginFixture("browser-tools").manifest.version,
        enabled: true,
        disabledSkillIds: [],
        disabledMcpServerNames: [],
      },
    });

    useSharedSettings.getState().setPluginEnabled(pluginFixture("browser-tools"), false);
    useSharedSettings
      .getState()
      .setPluginSkillEnabled(pluginFixture("browser-tools"), "browser-control", false);
    expect(persistedPlugins()["browser-tools"]).toEqual({
      version: pluginFixture("browser-tools").manifest.version,
      enabled: false,
      disabledSkillIds: ["browser-control"],
      disabledMcpServerNames: [],
    });

    useSharedSettings.getState().uninstallPlugin(pluginFixture("browser-tools"));
    expect(useSharedSettings.getState().installedPlugins).toEqual({});
    expect(persistedPlugins()).toEqual({});
  });

  describe("toggleFavoriteModelAnyMode", () => {
    it("adds a favorite under the fallback mode when none exists", () => {
      const nowFavorite = useSharedSettings
        .getState()
        .toggleFavoriteModelAnyMode("gdsAgent", "sonnet", "gui");

      expect(nowFavorite).toBe(true);
      expect(useSharedSettings.getState().favoriteModels).toEqual([
        { agentKind: "gdsAgent", modelId: "sonnet", presentationMode: "gui" },
      ]);
    });

    it("removes the favorite when it already exists", () => {
      useSharedSettings.setState({
        favoriteModels: [{ agentKind: "gdsAgent", modelId: "sonnet", presentationMode: "terminal" }],
      });

      const nowFavorite = useSharedSettings
        .getState()
        .toggleFavoriteModelAnyMode("gdsAgent", "sonnet", "terminal");

      expect(nowFavorite).toBe(false);
      expect(useSharedSettings.getState().favoriteModels).toEqual([]);
    });

    it("removes every stored mode for the model regardless of the fallback mode", () => {
      useSharedSettings.setState({
        favoriteModels: [
          { agentKind: "gdsAgent", modelId: "sonnet", presentationMode: "terminal" },
          { agentKind: "gdsAgent", modelId: "sonnet", presentationMode: "gui" },
          { agentKind: "codex", modelId: "gpt-5", presentationMode: "terminal" },
        ],
      });

      const nowFavorite = useSharedSettings
        .getState()
        .toggleFavoriteModelAnyMode("gdsAgent", "sonnet", "gui");

      expect(nowFavorite).toBe(false);
      expect(useSharedSettings.getState().favoriteModels).toEqual([
        { agentKind: "codex", modelId: "gpt-5", presentationMode: "terminal" },
      ]);
    });
  });

  it("adds and removes GdsAgent profile instances with their profile-scoped settings", () => {
    useSharedSettings.getState().setAgentInstance({
      id: "work",
      driver: "gdsAgent",
      displayName: "Work",
      config: { configDir: "~/.agentemployee/gdsAgent-profiles/work" },
    });
    useSharedSettings.setState({
      providerConfigs: {
        gdsAgent: { model: "sonnet" },
        "gdsAgent:work": { model: "haiku" },
      },
      hiddenModels: { "gdsAgent:work": ["sonnet"] },
      agentSettings: { "gdsAgent:work": { noFlicker: true } },
      lastPresentationModeByAgent: { "gdsAgent:work": "gui" },
      disabledAgents: ["gdsAgent:work"],
      favoriteModels: [{ agentKind: "gdsAgent:work", modelId: "haiku", presentationMode: "gui" }],
      recentModels: [{ agentKind: "gdsAgent:work", modelId: "sonnet", presentationMode: "gui" }],
      providerOrder: ["gdsAgent", "gdsAgent:work"],
    });

    expect(useSharedSettings.getState().agentInstances.work?.displayName).toBe("Work");

    useSharedSettings.getState().removeAgentInstance("work");

    const state = useSharedSettings.getState();
    expect(state.agentInstances.work).toBeUndefined();
    expect(state.providerConfigs.gdsAgent).toEqual({ model: "sonnet" });
    expect(state.providerConfigs["gdsAgent:work"]).toBeUndefined();
    expect(state.hiddenModels["gdsAgent:work"]).toBeUndefined();
    expect(state.agentSettings["gdsAgent:work"]).toBeUndefined();
    expect(state.lastPresentationModeByAgent["gdsAgent:work"]).toBeUndefined();
    expect(state.disabledAgents).not.toContain("gdsAgent:work");
    expect(state.favoriteModels).toEqual([]);
    expect(state.recentModels).toEqual([]);
    expect(state.providerOrder).toEqual(["gdsAgent"]);
  });

  it("removes Cursor profile-scoped settings with the profile instance", () => {
    useSharedSettings.getState().setAgentInstance({
      id: "work",
      driver: "cursor",
      displayName: "Work",
    });
    useSharedSettings.setState({
      agentSettings: { "cursor:work": { structuredRuntime: "sdk" } },
      providerOrder: ["cursor", "cursor:work"],
    });

    useSharedSettings.getState().removeAgentInstance("work");

    expect(useSharedSettings.getState().agentSettings["cursor:work"]).toBeUndefined();
    expect(useSharedSettings.getState().providerOrder).toEqual(["cursor"]);
  });
});

describe("workspace scenario fields", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({
      workspaces: [
        { id: "w1", name: "Work", createdAt: "2026-01-01T00:00:00.000Z", icon: "briefcase" },
      ],
    });
  });

  it("sets and clears a workspace domain", () => {
    useSharedSettings.getState().setWorkspaceCategory("w1", "docs");
    expect(useSharedSettings.getState().workspaces[0]?.category).toBe("docs");

    // Clearing must drop the key rather than store `undefined`, so the
    // persisted payload stays free of the field.
    useSharedSettings.getState().setWorkspaceCategory("w1", undefined);
    expect(useSharedSettings.getState().workspaces[0]).not.toHaveProperty("category");
  });

  it("sets and clears default scenarios", () => {
    useSharedSettings.getState().setWorkspaceDefaultScenarios("w1", ["write-requirements"]);
    expect(useSharedSettings.getState().workspaces[0]?.defaultScenarioIds).toEqual([
      "write-requirements",
    ]);

    useSharedSettings.getState().setWorkspaceDefaultScenarios("w1", undefined);
    expect(useSharedSettings.getState().workspaces[0]).not.toHaveProperty("defaultScenarioIds");
  });

  it("ignores an unknown workspace id", () => {
    useSharedSettings.getState().setWorkspaceCategory("gone", "docs");
    useSharedSettings.getState().setWorkspaceDefaultScenarios("gone", ["x"]);
    useSharedSettings.getState().updateWorkspaceProfile("gone", { persona: "x" });

    const workspaces = useSharedSettings.getState().workspaces;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).not.toHaveProperty("category");
    expect(workspaces[0]).not.toHaveProperty("defaultScenarioIds");
    expect(workspaces[0]).not.toHaveProperty("persona");
  });
});

describe("workspace employee profile fields", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({
      workspaces: [
        { id: "w1", name: "Work", createdAt: "2026-01-01T00:00:00.000Z", icon: "briefcase" },
        { id: "w2", name: "Docs", createdAt: "2026-01-01T00:00:00.000Z", icon: "palette" },
      ],
    });
  });

  it("updates only the patched employee fields on the target workspace", () => {
    useSharedSettings
      .getState()
      .updateWorkspaceProfile("w1", {
        persona: "我是文档编写员工",
        responsibilities: ["需求文档"],
        capabilityTags: ["文档"],
        agentKind: "codex",
        defaultThreadConfig: { model: "gpt-5" },
        permissions: { requireApproval: true },
      });

    const workspaces = useSharedSettings.getState().workspaces;
    expect(workspaces[0]).toMatchObject({
      id: "w1",
      persona: "我是文档编写员工",
      responsibilities: ["需求文档"],
      capabilityTags: ["文档"],
      agentKind: "codex",
      defaultThreadConfig: { model: "gpt-5" },
      permissions: { requireApproval: true },
    });
    // Sibling workspace and its own identity fields are untouched.
    expect(workspaces[1]).not.toHaveProperty("persona");
    expect(workspaces[0]?.name).toBe("Work");
  });

  it("clears a field when patched with undefined", () => {
    useSharedSettings.getState().updateWorkspaceProfile("w1", { persona: "临时" });
    expect(useSharedSettings.getState().workspaces[0]?.persona).toBe("临时");

    useSharedSettings.getState().updateWorkspaceProfile("w1", { persona: undefined });
    expect(useSharedSettings.getState().workspaces[0]).not.toHaveProperty("persona");
  });

  it("duplicates a workspace with all employee fields but a fresh id", () => {
    useSharedSettings
      .getState()
      .updateWorkspaceProfile("w1", {
        persona: "我是文档编写员工",
        responsibilities: ["需求文档"],
        capabilityTags: ["文档"],
        agentKind: "codex",
        agentInstanceId: "my-codex",
        defaultThreadConfig: { model: "gpt-5" },
        permissions: { requireApproval: true },
      });

    const copy = useSharedSettings.getState().duplicateWorkspace("w1", "文档编写岗（副本）");
    const workspaces = useSharedSettings.getState().workspaces;

    expect(copy).not.toBeNull();
    expect(workspaces).toHaveLength(3);
    const target = workspaces.find((w) => w.id === copy!.id)!;
    expect(target).toMatchObject({
      name: "文档编写岗（副本）",
      persona: "我是文档编写员工",
      responsibilities: ["需求文档"],
      capabilityTags: ["文档"],
      agentKind: "codex",
      agentInstanceId: "my-codex",
      defaultThreadConfig: { model: "gpt-5" },
      permissions: { requireApproval: true },
    });
    expect(target.id).not.toBe("w1");
    // The source is untouched.
    expect(workspaces[0]?.name).toBe("Work");
  });

  it("duplicate is a no-op for a blank name or unknown source", () => {
    expect(useSharedSettings.getState().duplicateWorkspace("w1", "   ")).toBeNull();
    expect(useSharedSettings.getState().duplicateWorkspace("gone", "X")).toBeNull();
    expect(useSharedSettings.getState().workspaces).toHaveLength(2);
  });
});

describe("team management", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({ teams: [] });
  });

  it("adds a team with members and a default round-robin policy", () => {
    const team = useSharedSettings.getState().addTeam("交付团队", ["w1", "w2"]);
    expect(team.id).toBeTruthy();
    expect(team.name).toBe("交付团队");
    expect(team.memberEmployeeIds).toEqual(["w1", "w2"]);
    expect(team.dispatchPolicy).toBe("round-robin");
    expect(useSharedSettings.getState().teams).toHaveLength(1);
  });

  it("patches a team's dispatch policy and members", () => {
    const team = useSharedSettings.getState().addTeam("交付团队", ["w1"]);
    useSharedSettings.getState().updateTeam(team.id, {
      dispatchPolicy: "manager-assigns",
      managerEmployeeId: "w2",
      memberEmployeeIds: ["w1", "w2"],
    });
    const updated = useSharedSettings.getState().teams[0];
    expect(updated?.dispatchPolicy).toBe("manager-assigns");
    expect(updated?.managerEmployeeId).toBe("w2");
    expect(updated?.memberEmployeeIds).toEqual(["w1", "w2"]);
  });

  it("ignores updates to an unknown team", () => {
    useSharedSettings.getState().updateTeam("gone", { name: "X" });
    expect(useSharedSettings.getState().teams).toHaveLength(0);
  });

  it("removes a team and ignores unknown ids", () => {
    const team = useSharedSettings.getState().addTeam("团队");
    useSharedSettings.getState().removeTeam("gone");
    expect(useSharedSettings.getState().teams).toHaveLength(1);
    useSharedSettings.getState().removeTeam(team.id);
    expect(useSharedSettings.getState().teams).toHaveLength(0);
  });
});
