"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/data/organization";
import { getTTLockConfigStatus } from "@/lib/ttlock/client";
import {
  deleteEKeyGrant,
  extendEKeyGrant,
  reconcileEKeyAccessForTenancy,
  saveTenantTTLockUsername,
  setEKeyFrozen,
} from "@/lib/ttlock/ekey";
import { refreshTTLockMeter, setTTLockMeterPower } from "@/lib/ttlock/meter-control";
import { reconcileEKeyAndMeterForTenancy } from "@/lib/ttlock/tenancy-extras";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Only return to pages inside the staff app. */
function safeReturnTo(formData: FormData) {
  const value = textValue(formData, "returnTo");
  if (/^\/(smart-devices|properties\/[0-9a-f-]+\/rooms\/[0-9a-f-]+)(\?.*)?$/i.test(value)) {
    return value.split("?")[0];
  }
  return "/smart-devices";
}

function withParams(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  return `${path}?${query.toString()}`;
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message.slice(0, 300) : fallback;
}

async function staff() {
  await requireRole(["super_admin", "admin"], { module: "properties", level: "manage" });
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

function requireTTLock(returnTo: string) {
  if (!getTTLockConfigStatus().complete) {
    redirect(withParams(returnTo, { ttlockError: "TTLock API credentials are not configured." }));
  }
}

function refresh(returnTo: string) {
  revalidatePath("/smart-devices");
  if (returnTo !== "/smart-devices") revalidatePath(returnTo);
}

/** Save the tenant's TTLock app account, then send/extend their eKeys. */
export async function saveTenantTTLockAccount(formData: FormData) {
  await staff();
  const returnTo = safeReturnTo(formData);
  const tenantId = textValue(formData, "tenantId");
  const tenancyId = textValue(formData, "tenancyId");
  if (!tenantId) redirect(withParams(returnTo, { ttlockError: "The tenant record is missing." }));

  let saved: string | null = null;
  try {
    saved = await saveTenantTTLockUsername({
      tenantId,
      username: textValue(formData, "ttlockUsername"),
    });
  } catch (error) {
    redirect(withParams(returnTo, { ttlockError: message(error, "The TTLock account could not be saved.") }));
  }

  let summary = saved ? "TTLock account saved." : "TTLock account removed.";
  if (saved && tenancyId && getTTLockConfigStatus().complete) {
    const result = await reconcileEKeyAndMeterForTenancy(tenancyId);
    summary = `TTLock account saved. eKeys sent ${result.ekey.created}, updated ${result.ekey.updated}, unchanged ${result.ekey.unchanged}.`;
    if (result.errors.length) {
      refresh(returnTo);
      redirect(withParams(returnTo, { ttlockNotice: summary, ttlockError: result.errors.join(" ") }));
    }
  }
  refresh(returnTo);
  redirect(withParams(returnTo, { ttlockNotice: summary }));
}

/** Send any missing eKeys or bring their period in line with the contract. */
export async function sendTenancyEKeys(formData: FormData) {
  await staff();
  const returnTo = safeReturnTo(formData);
  const tenancyId = textValue(formData, "tenancyId");
  requireTTLock(returnTo);
  if (!tenancyId) redirect(withParams(returnTo, { ttlockError: "The tenancy is missing." }));

  let result;
  try {
    result = await reconcileEKeyAccessForTenancy(tenancyId);
  } catch (error) {
    redirect(withParams(returnTo, { ttlockError: message(error, "eKeys could not be sent.") }));
  }
  refresh(returnTo);
  const notice = `eKeys sent ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}${result.skipped ? ", skipped (no TTLock account or no connected lock)" : ""}.`;
  redirect(
    withParams(returnTo, result.errors.length
      ? { ttlockNotice: notice, ttlockError: result.errors.join(" ") }
      : { ttlockNotice: notice }),
  );
}

async function grantAction(
  formData: FormData,
  run: (grantId: string, performedBy: string) => Promise<string>,
) {
  const user = await staff();
  const returnTo = safeReturnTo(formData);
  const grantId = textValue(formData, "grantId");
  requireTTLock(returnTo);
  if (!grantId) redirect(withParams(returnTo, { ttlockError: "The eKey is missing." }));
  let notice = "";
  try {
    notice = await run(grantId, user.id);
  } catch (error) {
    refresh(returnTo);
    redirect(withParams(returnTo, { ttlockError: message(error, "The eKey could not be updated.") }));
  }
  refresh(returnTo);
  redirect(withParams(returnTo, { ttlockNotice: notice }));
}

export async function freezeEKey(formData: FormData) {
  await grantAction(formData, async (grantId, performedBy) => {
    await setEKeyFrozen({ grantId, frozen: true, performedBy });
    return "eKey frozen. The tenant cannot unlock with the app until it is unfrozen.";
  });
}

export async function unfreezeEKey(formData: FormData) {
  await grantAction(formData, async (grantId, performedBy) => {
    await setEKeyFrozen({ grantId, frozen: false, performedBy });
    return "eKey unfrozen.";
  });
}

export async function extendEKey(formData: FormData) {
  await grantAction(formData, async (grantId, performedBy) => {
    const result = await extendEKeyGrant({ grantId, performedBy });
    return result.extended
      ? "eKey extended by 30 days (capped at the contract end)."
      : "eKey already runs to the contract end.";
  });
}

export async function deleteEKey(formData: FormData) {
  await grantAction(formData, async (grantId, performedBy) => {
    await deleteEKeyGrant({ grantId, performedBy });
    return "eKey deleted.";
  });
}

export async function refreshMeter(formData: FormData) {
  await staff();
  const returnTo = safeReturnTo(formData);
  const meterId = textValue(formData, "meterId");
  requireTTLock(returnTo);
  if (!meterId) redirect(withParams(returnTo, { ttlockError: "The meter is missing." }));
  let reading;
  try {
    reading = await refreshTTLockMeter(meterId);
  } catch (error) {
    refresh(returnTo);
    redirect(withParams(returnTo, { ttlockError: `Meter refresh failed: ${message(error, "TTLock error.")}` }));
  }
  refresh(returnTo);
  redirect(withParams(returnTo, {
    ttlockNotice: `Meter refreshed: ${reading.remainingKwh ?? "?"} kWh left, ${reading.totalKwh ?? "?"} kWh used in total, ${reading.online ? "online" : "offline"}, power ${reading.powerOn ? "on" : "off"}.`,
  }));
}

export async function switchMeterPower(formData: FormData) {
  const user = await staff();
  const returnTo = safeReturnTo(formData);
  const meterId = textValue(formData, "meterId");
  const on = textValue(formData, "power") === "on";
  requireTTLock(returnTo);
  if (!meterId) redirect(withParams(returnTo, { ttlockError: "The meter is missing." }));
  try {
    await setTTLockMeterPower({ meterId, on, reason: "staff", performedBy: user.id });
  } catch (error) {
    refresh(returnTo);
    redirect(withParams(returnTo, { ttlockError: `Meter power ${on ? "on" : "off"} failed: ${message(error, "TTLock error.")}` }));
  }
  refresh(returnTo);
  redirect(withParams(returnTo, { ttlockNotice: `Meter power switched ${on ? "on" : "off"}.` }));
}
