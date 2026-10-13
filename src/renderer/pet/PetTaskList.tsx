import { useEffect } from "react";
import { Button } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import { readBridge } from "@/renderer/bridge";
import { useTasksStore } from "@/renderer/state/tasksStore";

const ACTIVE_TASK_STATUSES = new Set(["todo", "in_progress", "awaiting_input"]);

/**
 * A compact read of the task board for the pet. The board itself lives in the
 * main window; this is just a glanceable list plus a button that asks main to
 * reveal the full surface.
 */
export function PetTaskList() {
  const tasks = useTasksStore((state) => state.tasks);
  const loading = useTasksStore((state) => state.loading);
  const refresh = useTasksStore((state) => state.refresh);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const active = tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).slice(0, 6);

  return (
    <section className="pet-panel pet-panel-tasks">
      <div className="pet-panel-header">
        <span className="pet-panel-title">
          <Trans>Tasks</Trans>
        </span>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => void readBridge().petNavigateMain({ target: "tasks" })}
        >
          <Trans>Open board</Trans>
        </Button>
      </div>
      {loading && active.length === 0 ? (
        <p className="pet-empty">
          <Trans>Loading…</Trans>
        </p>
      ) : active.length === 0 ? (
        <p className="pet-empty">
          <Trans>No active tasks.</Trans>
        </p>
      ) : (
        <ul className="pet-task-list">
          {active.map((task) => (
            <li key={task.id} className={`pet-task pet-task-${task.status}`}>
              <span className="pet-task-title">{task.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
