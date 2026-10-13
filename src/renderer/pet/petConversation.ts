import { isHomeProject } from "@/shared/homeScope";
import { assistantDisplayText } from "@/shared/assistantMessageText";
import {
  DEFAULT_TERMINAL_SIZE,
  normalizeTaskCategory,
  type Task,
  type TaskInput,
  type Thread,
  type ThreadConfig,
} from "@/shared/contracts";
import type { EmployeeBinding } from "@/renderer/views/TasksView/employeeBinding";
import { readBridge } from "@/renderer/bridge";
import { useAppStore, type AppStoreState } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useTasksStore } from "@/renderer/state/tasksStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";

/**
 * Reads `settings.chiefStewardWorkspaceId` tolerantly. The parallel main-side
 * change may not have landed on the `SharedSettings` type yet; when it has, this
 * read stays correct (it just becomes a typed field). Until then an absent key
 * degrades to `undefined` and the pet shows its setup hint rather than crashing.
 */
export function getChiefStewardWorkspaceId(): string | undefined {
  const settings = useSharedSettings.getState() as { chiefStewardWorkspaceId?: unknown };
  const value = settings.chiefStewardWorkspaceId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Reactive selector form of {@link getChiefStewardWorkspaceId} (primitive return). */
export function selectChiefStewardWorkspaceId(
  state: ReturnType<typeof useSharedSettings.getState>,
): string | undefined {
  const value = (state as { chiefStewardWorkspaceId?: unknown }).chiefStewardWorkspaceId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The pet's live conversation = the most recent non-archived thread in this role. */
export function findChiefStewardThread(
  threads: readonly Thread[],
  workspaceId: string | undefined,
): Thread | undefined {
  if (!workspaceId) return undefined;
  return threads.find((thread) => !thread.archived && thread.workspaceId === workspaceId);
}

export interface PetTranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function readContentTextBlocks(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { kind?: unknown; text?: unknown };
    if (record.kind === "text" && typeof record.text === "string") texts.push(record.text);
  }
  return texts;
}

function readUserMessageText(item: RuntimeChatItem): string {
  const blocks = readContentTextBlocks(item.payload);
  if (blocks.length > 0) return blocks.join("\n");
  return item.streams.assistant_text ?? "";
}

/**
 * Extracts the visible user/assistant rows for the transcript panel. Deliberately
 * minimal — the pet is a small floating window, so it renders plain text rather
 * than the full rich timeline. Pure over the thread's ordered item ids + item map
 * so a component can subscribe to both narrowly and render derived rows.
 */
export function buildPetTranscript(
  itemIds: readonly string[] | undefined,
  items: Record<string, RuntimeChatItem> | undefined,
): PetTranscriptEntry[] {
  if (!itemIds || !items) return [];
  const entries: PetTranscriptEntry[] = [];
  for (const id of itemIds) {
    const item = items[id];
    if (!item) continue;
    if (item.type === "user_message") {
      const text = readUserMessageText(item).trim();
      if (text) entries.push({ id: item.id, role: "user", text });
    } else if (item.type === "assistant_message") {
      const text = assistantDisplayText(item).trim();
      if (text) entries.push({ id: item.id, role: "assistant", text });
    }
  }
  return entries;
}

export type SendChiefMessageResult =
  | { status: "sent"; threadId: string; started: boolean }
  | { status: "not-configured" }
  | { status: "not-ready"; reason: "no-home-project" | "no-agent-kind" | "no-model" };

/**
 * Sends one line to the chief steward. Reuses the supervisor thread mechanism:
 * a follow-up on the existing role thread via `sendThreadInput`, or a fresh
 * `startThread` when the role has no live thread yet.
 */
export async function sendChiefStewardMessage(prompt: string): Promise<SendChiefMessageResult> {
  const trimmed = prompt.trim();
  const workspaceId = getChiefStewardWorkspaceId();
  if (!workspaceId) return { status: "not-configured" };

  const store = useAppStore.getState();
  const existing = findChiefStewardThread(store.threads, workspaceId);
  const bridge = readBridge();

  if (existing) {
    await bridge.sendThreadInput({
      threadId: existing.id,
      prompt: trimmed,
      config: existing.config,
    });
    return { status: "sent", threadId: existing.id, started: false };
  }

  // No live thread for this role yet — resolve the launch inputs from the home
  // project and the role's own defaults, then create the row + launch.
  const homeProject = store.projects.find((project) => isHomeProject(project));
  if (!homeProject) return { status: "not-ready", reason: "no-home-project" };

  const workspace = useSharedSettings
    .getState()
    .workspaces?.find((candidate) => candidate.id === workspaceId);
  const agentKind = workspace?.agentKind;
  if (!agentKind) return { status: "not-ready", reason: "no-agent-kind" };

  const config: ThreadConfig | undefined = workspace?.defaultThreadConfig;
  if (!config?.model) return { status: "not-ready", reason: "no-model" };

  const threadId = crypto.randomUUID();
  // Add the row without stealing a view — the pet window owns no main view.
  store.createThread({
    threadId,
    projectId: homeProject.id,
    workspaceId,
    agentKind,
    config,
    prompt: trimmed,
    focus: false,
  });
  await bridge.startThread({
    threadId,
    projectLocation: homeProject.location,
    agentKind,
    config,
    workspaceId,
    prompt: trimmed,
    initialSize: DEFAULT_TERMINAL_SIZE,
  });
  return { status: "sent", threadId, started: true };
}

/** The live chief thread row from the store (reactive). */
export function selectChiefThread(
  state: AppStoreState,
  workspaceId: string | undefined,
): Thread | undefined {
  return findChiefStewardThread(state.threads, workspaceId);
}

/**
 * Where a pasted inbox task came from. The token (not the localized label) is what
 * goes into the delivery prompt so the chief steward's routing tool can branch on a
 * stable, machine-readable source.
 */
export type TaskDeliverySource = "oa" | "mxt" | "boss" | "other";

/**
 * Wraps pasted task content in a parseable delivery envelope. The chief steward
 * receives this as a single message and routes by the `source=` token.
 */
export function buildDeliveryPrompt(source: TaskDeliverySource, content: string): string {
  return `[task-delivery source=${source}]\n${content.trim()}`;
}

/** Same envelope for a file dropped into the watched inbox directory. */
export function buildInboxDeliveryPrompt(fileName: string, text: string): string {
  return `[task-delivery source=inbox file=${fileName}]\n${text.trim()}`;
}

/**
 * The pet's quick-create fields. Deliberately small — the floating window has no
 * room for the full board editor, so it only asks for what a run cannot do
 * without: a title, the work itself, and the employee that owns the provider.
 */
export interface PetTaskForm {
  title: string;
  /** Free-form category label; `""` means uncategorized. */
  category: string;
  prompt: string;
  /** The employee the task is handed to; `""` means nothing picked yet. */
  employeeId: string;
}

export function newPetTaskForm(employeeId = ""): PetTaskForm {
  return { title: "", category: "", prompt: "", employeeId };
}

/**
 * Default the title from the first line of the pasted work, so pasting an inbox
 * item and hitting create produces a readable card without a second edit.
 * Returns `""` when there is nothing usable, which keeps the create button off.
 */
export function derivePetTaskTitle(prompt: string): string {
  const firstLine = prompt
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "";
  return firstLine.length > MAX_PET_TASK_TITLE_LENGTH
    ? firstLine.slice(0, MAX_PET_TASK_TITLE_LENGTH)
    : firstLine;
}

/** Mirrors the contract's title cap so the derived title always validates. */
export const MAX_PET_TASK_TITLE_LENGTH = 120;

/**
 * Pet form → `TaskInput`. The employee supplies the agent and model (same rule
 * as the board editor), so this is the single place the pet decides what the
 * run will actually use. Returns `null` when the form is not runnable, so
 * callers gate submission with {@link petTaskFormIsValid} rather than guessing.
 */
export function petTaskFormInput(
  form: PetTaskForm,
  employees: ReadonlyMap<string, EmployeeBinding>,
): TaskInput | null {
  if (!petTaskFormIsValid(form, employees)) return null;
  const employee = employees.get(form.employeeId);
  if (!employee) return null;
  return {
    title: form.title.trim(),
    prompt: form.prompt.trim(),
    employeeId: form.employeeId,
    agentKind: employee.agentKind,
    config: {
      model: employee.model,
      ...(employee.effort ? { effort: employee.effort } : {}),
      ...(employee.fast ? { fast: true } : {}),
    },
    category: normalizeTaskCategory(form.category),
    // The pet creates a plain one-off task; scheduling stays on the full board.
    projectId: null,
    isolation: "project",
    recurrence: null,
    scheduleEnabled: false,
  };
}

/** A pet task needs a title, the work, and an employee that resolves a provider. */
export function petTaskFormIsValid(
  form: PetTaskForm,
  employees: ReadonlyMap<string, EmployeeBinding>,
): boolean {
  return Boolean(form.title.trim() && form.prompt.trim() && employees.has(form.employeeId));
}

/**
 * Creates the board task behind the pet's quick-create form. Fire-and-refetch
 * like every other board mutation: main owns the scheduler, so the caller
 * refreshes the store afterwards rather than optimistically inserting a row.
 */
export async function createPetTask(
  form: PetTaskForm,
  employees: ReadonlyMap<string, EmployeeBinding>,
): Promise<Task | null> {
  const input = petTaskFormInput(form, employees);
  if (!input) return null;
  const task = await readBridge().createTask(input);
  await useTasksStore.getState().refresh();
  return task;
}
