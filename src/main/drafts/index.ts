import {
  dbDeleteTaskDraft,
  dbGetTaskDraft,
  dbGetTaskDrafts,
  dbSetTaskDraftSortOrders,
  dbUpsertTaskDraft,
} from "../db";
import { TaskDraftsService } from "./TaskDraftsService";

export function createDeviceTaskDraftsService(): TaskDraftsService {
  return new TaskDraftsService({
    store: {
      list: dbGetTaskDrafts,
      get: dbGetTaskDraft,
      upsert: dbUpsertTaskDraft,
      delete: dbDeleteTaskDraft,
      setSortOrders: dbSetTaskDraftSortOrders,
    },
  });
}

export { TaskDraftsService, type TaskDraftStore } from "./TaskDraftsService";
