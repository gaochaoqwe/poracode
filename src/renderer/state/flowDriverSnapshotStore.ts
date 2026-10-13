import { create } from "zustand";
import { readBridge } from "@/renderer/bridge";
import type { FlowDriverSnapshot } from "@/shared/digitalEmployee/flowSnapshot";

/**
 * Latest authoritative snapshot of the supervisor's digital-employee file-system
 * driver: which test projects are in flight and where each P0~P14 node stands.
 * Populated by the main-window bridge subscription (`installFlowDriverSnapshotSync`);
 * the project board reads it through a narrow selector.
 */
interface FlowDriverSnapshotState {
  snapshot: FlowDriverSnapshot | null;
  set: (snapshot: FlowDriverSnapshot) => void;
  reset: () => void;
}

export const useFlowDriverSnapshotStore = create<FlowDriverSnapshotState>((set) => ({
  snapshot: null,
  set: (snapshot) => set({ snapshot }),
  reset: () => set({ snapshot: null }),
}));

/**
 * Tolerant subscription to the supervisor's `onFlowDriverSnapshot` broadcast.
 * The channel may not exist on the bridge type yet; the listener registers
 * optimistically and becomes a direct typed call once it ships.
 */
export function installFlowDriverSnapshotSync(): () => void {
  const bridge = readBridge() as {
    onFlowDriverSnapshot?: (listener: (snapshot: FlowDriverSnapshot) => void) => () => void;
  };
  return (
    bridge.onFlowDriverSnapshot?.((snapshot) => {
      useFlowDriverSnapshotStore.getState().set(snapshot);
    }) ?? (() => undefined)
  );
}
