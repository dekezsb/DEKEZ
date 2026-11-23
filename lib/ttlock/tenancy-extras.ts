import "server-only";

import { reconcileEKeyAccessForTenancy } from "@/lib/ttlock/ekey";
import { prepareRoomMeterForTenancy } from "@/lib/ttlock/meter-control";

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.slice(0, 500) : fallback;
}

/**
 * Runs next to reconcileSmartLockAccessForTenancy on move-in, application
 * conversion, contract changes and renewal: sends or extends TTLock eKeys
 * and prepares the room's TTLock meter. Never throws, so tenancy flows
 * finish; failures are logged and also stay on the grant/meter rows for the
 * Smart Devices "needs attention" lists.
 */
export async function reconcileEKeyAndMeterForTenancy(tenancyId: string) {
  const ekey = await reconcileEKeyAccessForTenancy(tenancyId).catch((error) => ({
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [message(error, "TTLock eKey request failed.")],
  }));
  const meter = await prepareRoomMeterForTenancy(tenancyId).catch((error) => ({
    linked: 0,
    restored: 0,
    errors: [message(error, "TTLock meter update failed.")],
  }));
  const errors = [...ekey.errors, ...meter.errors];
  if (errors.length) {
    console.error("TTLock eKey/meter tenancy sync needs attention.", { tenancyId, errors });
  }
  return { ekey, meter, errors };
}
