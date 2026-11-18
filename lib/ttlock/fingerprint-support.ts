export const FINGERPRINT_FEATURE_BIT = 2;

export function specialValueFromProviderData(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>).specialValue;
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** True when TTLock specialValue bit 2 (fingerprint hardware) is set. */
export function lockSupportsFingerprint(specialValue: string | number | null | undefined) {
  if (specialValue == null || specialValue === "") return false;
  const value = Number(specialValue);
  if (!Number.isFinite(value) || value <= 0) return false;
  return (Math.trunc(value) & (1 << FINGERPRINT_FEATURE_BIT)) !== 0;
}

export function hasFingerprintEnrollmentAccess(devices: Array<{
  access_scope?: string | null;
  sync_status?: string | null;
  provider?: string | null;
  specialValue?: string | number | null;
  provider_data?: unknown;
}>) {
  return devices.some((device) => {
    const provider = device.provider?.trim().toLowerCase() ?? "ttlock";
    if (provider !== "ttlock") return false;
    if (device.access_scope !== "room_entry") return false;
    if (device.sync_status && device.sync_status !== "connected") return false;
    const specialValue = device.specialValue ?? specialValueFromProviderData(device.provider_data);
    return lockSupportsFingerprint(specialValue);
  });
}

export function fingerprintStatusLabel(state: string) {
  switch (state) {
    case "pending_enrollment":
      return "Requested";
    case "active":
      return "Active";
    case "revoke_pending":
      return "Updating";
    case "revoked":
      return "Revoked";
    case "error":
      return "Needs review";
    default:
      return "Requested";
  }
}
