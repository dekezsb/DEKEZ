export type LockVersionSource = {
  keyboardPwdVersion?: number | null;
  keyboardPasswordVersion?: number | null;
} | null | undefined;

export type SafeLockDetail = {
  lockId: number;
  lockName?: string;
  lockAlias?: string;
  electricQuantity?: number | null;
  hasGateway?: number | null;
  keyboardPwdVersion?: number | null;
  specialValue?: number | null;
};

const SENSITIVE_DETAIL_KEYS = [
  "noKeyPwd",
  "adminPwd",
  "lockKey",
  "aesKeyStr",
  "deletePwd",
] as const;

export function needsLockDetail(version: unknown): boolean {
  if (version === null || version === undefined || version === "") return true;
  const value = Number(version);
  return !Number.isFinite(value) || value <= 0;
}

export function readKeyboardPwdVersion(source: LockVersionSource | Record<string, unknown> | null | undefined): number | null {
  if (!source || typeof source !== "object") return null;
  const raw =
    ("keyboardPwdVersion" in source ? source.keyboardPwdVersion : undefined)
    ?? ("keyboardPasswordVersion" in source ? source.keyboardPasswordVersion : undefined);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function pickSafeLockDetail(payload: Record<string, unknown>): SafeLockDetail {
  const lockId = Number(payload.lockId);
  for (const key of SENSITIVE_DETAIL_KEYS) {
    if (key in payload) {
      // Intentionally ignored; never persist admin or keypad secrets.
    }
  }
  return {
    lockId: Number.isSafeInteger(lockId) ? lockId : 0,
    lockName: typeof payload.lockName === "string" ? payload.lockName : undefined,
    lockAlias: typeof payload.lockAlias === "string" ? payload.lockAlias : undefined,
    electricQuantity:
      payload.electricQuantity == null ? null : Number(payload.electricQuantity),
    hasGateway: payload.hasGateway == null ? null : Number(payload.hasGateway),
    keyboardPwdVersion: readKeyboardPwdVersion(payload),
    specialValue: payload.specialValue == null ? null : Number(payload.specialValue),
  };
}

export function applyLockDetailToLive<T extends {
  lockId: number;
  keyboardPwdVersion?: number | null;
  specialValue?: number | null;
  hasGateway?: number | null;
  electricQuantity?: number | null;
}>(live: T, detail: SafeLockDetail): T {
  return {
    ...live,
    keyboardPwdVersion: readKeyboardPwdVersion(live) ?? detail.keyboardPwdVersion ?? null,
    specialValue: live.specialValue ?? detail.specialValue ?? null,
    hasGateway: live.hasGateway ?? detail.hasGateway ?? null,
    electricQuantity: live.electricQuantity ?? detail.electricQuantity ?? null,
  };
}

export function applyLockDetailToProviderData(
  existing: Record<string, unknown> | null | undefined,
  detail: SafeLockDetail,
) {
  return {
    ...(existing ?? {}),
    keyboardPasswordVersion:
      detail.keyboardPwdVersion
      ?? readKeyboardPwdVersion(existing)
      ?? null,
    specialValue: detail.specialValue ?? existing?.specialValue ?? null,
  };
}

export async function fillMissingLockVersions<T extends {
  lockId: number;
  keyboardPwdVersion?: number | null;
  specialValue?: number | null;
  hasGateway?: number | null;
  electricQuantity?: number | null;
}>(
  locks: T[],
  getDetail: (lockId: number) => Promise<SafeLockDetail>,
): Promise<T[]> {
  const enriched: T[] = [];
  for (const lock of locks) {
    if (!needsLockDetail(lock.keyboardPwdVersion)) {
      enriched.push(lock);
      continue;
    }
    try {
      const detail = await getDetail(lock.lockId);
      enriched.push(applyLockDetailToLive(lock, detail));
    } catch {
      enriched.push(lock);
    }
  }
  return enriched;
}
