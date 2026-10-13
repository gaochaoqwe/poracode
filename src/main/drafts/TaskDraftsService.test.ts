import { describe, expect, it } from "vitest";
import type { TaskDraft, TaskDraftInput } from "@/shared/contracts";
import { TaskDraftsService, type TaskDraftStore } from "./TaskDraftsService";

function memoryStore(): TaskDraftStore {
  const drafts = new Map<string, TaskDraft>();
  return {
    list: () => [...drafts.values()],
    get: (id) => drafts.get(id) ?? null,
    upsert: (draft) => drafts.set(draft.id, draft),
    delete: (id) => {
      drafts.delete(id);
    },
    setSortOrders: (entries) => {
      for (const entry of entries) {
        const current = drafts.get(entry.id);
        if (current) drafts.set(entry.id, { ...current, sortOrder: entry.sortOrder });
      }
    },
  };
}

const input: TaskDraftInput = { title: "Idea", note: "Worth a look", projectId: "p1" };

function service(store: TaskDraftStore, now = () => new Date(2026, 6, 6, 7, 0).getTime()) {
  return new TaskDraftsService({ store, now });
}

describe("TaskDraftsService", () => {
  it("creates a draft at the top of its project's lane", () => {
    const store = memoryStore();
    const svc = service(store);
    const first = svc.create(input);
    const second = svc.create({ ...input, title: "Another" });
    const otherProject = svc.create({ ...input, title: "Elsewhere", projectId: "p2" });

    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(-1);
    expect(otherProject.sortOrder).toBe(0);
    expect(first.note).toBe("Worth a look");
  });

  it("normalizes an omitted note to null", () => {
    const created = service(memoryStore()).create({ title: "Bare idea" });
    expect(created.note).toBeNull();
    expect(created.projectId).toBeNull();
  });

  it("updates content while preserving id, sortOrder and createdAt", () => {
    const store = memoryStore();
    const svc = service(store);
    const created = svc.create(input);
    const updated = svc.update(created.id, { title: "Renamed", note: null, projectId: "p2" });

    expect(updated.id).toBe(created.id);
    expect(updated.sortOrder).toBe(created.sortOrder);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.title).toBe("Renamed");
    expect(updated.note).toBeNull();
    expect(updated.projectId).toBe("p2");
  });

  it("persists a project's lane densely without touching updatedAt", () => {
    const store = memoryStore();
    const svc = service(store);
    const a = svc.create(input);
    const b = svc.create({ ...input, title: "B" });
    const c = svc.create({ ...input, title: "C" });
    const updatedAt = store.get(a.id)?.updatedAt;

    svc.reorder("p1", [c.id, a.id, b.id]);

    expect(store.get(c.id)?.sortOrder).toBe(0);
    expect(store.get(a.id)?.sortOrder).toBe(1);
    expect(store.get(b.id)?.sortOrder).toBe(2);
    expect(store.get(a.id)?.updatedAt).toBe(updatedAt);
  });

  it("rejects a reorder that doesn't match the project's drafts", () => {
    const store = memoryStore();
    const svc = service(store);
    const a = svc.create(input);
    const b = svc.create({ ...input, title: "B" });
    const other = svc.create({ ...input, title: "Other", projectId: "p2" });

    expect(() => svc.reorder("p1", [a.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [a.id, other.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [a.id, a.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [a.id, b.id, other.id])).toThrow(/changed/i);
    expect(() => svc.reorder("p1", [b.id, a.id])).not.toThrow();
  });

  it("deletes a draft and reports a missing one", () => {
    const store = memoryStore();
    const svc = service(store);
    const created = svc.create(input);
    svc.delete(created.id);
    expect(store.get(created.id)).toBeNull();
    expect(() => svc.update(created.id, input)).toThrow(/not found/i);
  });
});
