/**
 * P2-11 — task-source poll scheduler.
 *
 * Runs inside the supervisor process (no renderer window needed — as long as
 * main + supervisor are alive, the inbox keeps getting checked on a timer).
 * Each tick asks the chief steward thread to run its collection skills
 * (oa-jprjcp-collect / mxt-collect) and route anything new through the
 * existing route_inbox_task → dispatch_team_task chain.
 *
 * The scheduler itself is deliberately dumb: it only fires the prompt on the
 * configured interval. Duplicate detection (what counts as "new") and all
 * dispatch decisions live in the steward thread.
 */

export interface TaskPollSchedulerSettings {
  taskPollEnabled?: boolean | undefined;
  taskPollIntervalMinutes?: number | undefined;
}

export interface TaskPollSchedulerDeps {
  getSettings: () => TaskPollSchedulerSettings;
  getChiefStewardThreadId: () => string | undefined;
  sendThreadInput: (payload: { threadId: string; prompt: string }) => void | Promise<void>;
  /** Skip this round when the steward thread is mid-turn (no interrupt). */
  isThreadBusy?: (threadId: string) => boolean;
  log?: (...args: unknown[]) => void;
}

export interface TaskPollScheduler {
  start: () => void;
  stop: () => void;
  tickNow: () => void;
}

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 1;

export const STEWARD_POLL_PROMPT =
  "定时巡检任务来源：执行 oa-jprjcp-collect 与 mxt-collect 采集新任务；" +
  "发现新任务后按 route_inbox_task 分流（测试语义→测试主管、OA 语义→办公主管、含糊→向提出者追问），" +
  "确认后调 dispatch_team_task 派发。只采集与投递，危险操作仍走审批，不自动绕过。";

export function createTaskPollScheduler(deps: TaskPollSchedulerDeps): TaskPollScheduler {
  let timer: ReturnType<typeof setInterval> | undefined;
  let scheduledIntervalMinutes = Number.NaN;

  const log = deps.log ?? (() => {});

  function applyTimer(intervalMinutes: number): void {
    if (timer !== undefined) clearInterval(timer);
    scheduledIntervalMinutes = intervalMinutes;
    timer = setInterval(() => {
      try {
        tick();
      } catch (error) {
        log("[task-poll] tick failed:", error);
      }
    }, intervalMinutes * 60_000);
    // Unref so the poller never keeps the process alive on its own.
    timer.unref?.();
  }

  function tick(): void {
    let settings: TaskPollSchedulerSettings;
    try {
      settings = deps.getSettings();
    } catch (error) {
      log("[task-poll] settings read failed:", error);
      return;
    }

    if (settings.taskPollEnabled === false) {
      log("[task-poll] disabled by settings — skipping");
      return;
    }

    const intervalMinutes =
      settings.taskPollIntervalMinutes && settings.taskPollIntervalMinutes >= MIN_INTERVAL_MINUTES
        ? Math.floor(settings.taskPollIntervalMinutes)
        : DEFAULT_INTERVAL_MINUTES;
    if (timer !== undefined && intervalMinutes !== scheduledIntervalMinutes) {
      log(`[task-poll] interval changed to ${intervalMinutes}m — rescheduling`);
      applyTimer(intervalMinutes);
    }

    const threadId = deps.getChiefStewardThreadId();
    if (!threadId) {
      log("[task-poll] no chief steward thread — skipping this round");
      return;
    }
    if (deps.isThreadBusy?.(threadId)) {
      log("[task-poll] steward thread busy — skipping this round");
      return;
    }
    try {
      void Promise.resolve(deps.sendThreadInput({ threadId, prompt: STEWARD_POLL_PROMPT })).catch(
        (error) => log("[task-poll] sendThreadInput failed:", error),
      );
    } catch (error) {
      log("[task-poll] sendThreadInput threw:", error);
    }
  }

  return {
    start(): void {
      if (timer !== undefined) return;
      const intervalMinutes =
        deps.getSettings().taskPollIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
      applyTimer(Math.max(intervalMinutes, MIN_INTERVAL_MINUTES));
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    tickNow(): void {
      tick();
    },
  };
}
