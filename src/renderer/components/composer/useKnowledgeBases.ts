import { useEffect, useState } from "react";
import type { KnowledgeBaseMeta } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

/**
 * Knowledge bases for the composer picker. Lists the machine-wide bases once
 * and caches them; call {@link invalidateKnowledgeBases} after create/rename/
 * delete so the next composer reads the fresh list. Failures degrade to an
 * empty list (the picker simply offers nothing) rather than crashing the
 * composer.
 */
let cache: KnowledgeBaseMeta[] | null = null;

export function invalidateKnowledgeBases(): void {
  cache = null;
}

export function useKnowledgeBases(): readonly KnowledgeBaseMeta[] {
  const [bases, setBases] = useState<readonly KnowledgeBaseMeta[]>(cache ?? []);
  useEffect(() => {
    // Initial state already reflects the cache; only fetch on a cold cache.
    if (cache) return undefined;
    let active = true;
    void Promise.resolve()
      .then(() => readBridge().knowledgeListBases())
      .then((result) => result.bases)
      .catch(() => [] as KnowledgeBaseMeta[])
      .then((next) => {
        cache = next;
        if (active) setBases(next);
      });
    return () => {
      active = false;
    };
  }, []);
  return bases;
}
