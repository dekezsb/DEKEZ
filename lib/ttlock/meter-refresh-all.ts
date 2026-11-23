import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { refreshTTLockMeter } from "@/lib/ttlock/meter-control";

/** Two meters at a time, with a pause between calls, keeps us well inside TTLock's rate limits. */
export const METER_REFRESH_CONCURRENCY = 2;
export const METER_REFRESH_DELAY_MS = 400;
/** Stop starting new meters after this long so the run ends before the 300s function limit. */
export const METER_REFRESH_BUDGET_MS = 240_000;

export type MeterRefreshSummary = {
  total: number;
  refreshed: number;
  failed: number;
  deferred: number;
  errors: { meterId: string; error: string }[];
};

type Options = {
  concurrency?: number;
  delayMs?: number;
  budgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Hourly job: refresh every active TTLock electricity meter that is linked to
 * a room. The least recently synced meters go first, so if a run is cut short
 * the next run picks up the rest. One meter failing never stops the others;
 * refreshTTLockMeter already stores the error on the meter ("Needs attention").
 */
export async function refreshAllTTLockMeters(options: Options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? METER_REFRESH_CONCURRENCY);
  const delayMs = options.delayMs ?? METER_REFRESH_DELAY_MS;
  const budgetMs = options.budgetMs ?? METER_REFRESH_BUDGET_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  const { data, error } = await createAdminClient()
    .from("smart_meters")
    .select("id,last_synced_at")
    .eq("provider", "ttlock")
    .eq("meter_type", "electricity")
    .eq("status", "active")
    .not("provider_meter_id", "is", null)
    .not("room_id", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true });
  if (error) throw error;

  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  const summary: MeterRefreshSummary = {
    total: ids.length,
    refreshed: 0,
    failed: 0,
    deferred: 0,
    errors: [],
  };
  const startedAt = now();
  let next = 0;

  async function worker() {
    while (next < ids.length) {
      if (now() - startedAt >= budgetMs) return;
      const meterId = ids[next++];
      try {
        await refreshTTLockMeter(meterId);
        summary.refreshed += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({
          meterId,
          error: err instanceof Error ? err.message.slice(0, 300) : "Meter refresh failed.",
        });
      }
      if (next < ids.length && delayMs > 0) await sleep(delayMs);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()),
  );
  summary.deferred = ids.length - summary.refreshed - summary.failed;
  return summary;
}
