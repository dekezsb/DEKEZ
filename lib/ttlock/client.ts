import "server-only";

import { createHash } from "node:crypto";
import { pickSafeLockDetail } from "@/lib/ttlock/lock-version";

const defaultBaseUrl = "https://api.sciener.com";

type TTLockConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

type TTLockTokenResponse = {
  access_token?: string;
  errcode?: number;
  errmsg?: string;
};

export type TTLockDevice = {
  lockId: number;
  lockName?: string;
  lockAlias?: string;
  electricQuantity?: number;
  hasGateway?: number;
  groupId?: number;
  groupName?: string;
  keyboardPwdVersion?: number;
  specialValue?: number;
};

type TTLockListResponse = {
  list?: TTLockDevice[];
  errcode?: number;
  errmsg?: string;
};

type TTLockPasscodeResponse = {
  keyboardPwdId?: number | string;
  errcode?: number;
  errmsg?: string;
};

type TTLockFingerprintListResponse = {
  list?: TTLockFingerprint[];
  pages?: number;
  pageNo?: number;
  pageSize?: number;
  total?: number;
  errcode?: number;
  errmsg?: string;
};

export type TTLockFingerprint = {
  fingerprintId: number;
  lockId: number;
  fingerprintNumber: string;
  fingerprintType: number;
  fingerprintName?: string;
  startDate?: number;
  endDate?: number;
  createDate?: number;
  status?: number;
  senderUsername?: string;
};

export function getTTLockConfigStatus() {
  const fields = {
    clientId: Boolean(process.env.TTLOCK_CLIENT_ID),
    clientSecret: Boolean(process.env.TTLOCK_CLIENT_SECRET),
    username: Boolean(process.env.TTLOCK_USERNAME),
    password: Boolean(process.env.TTLOCK_PASSWORD),
  };

  return {
    ...fields,
    complete: Object.values(fields).every(Boolean),
  };
}

function getTTLockConfig(): TTLockConfig {
  const config = {
    baseUrl: (process.env.TTLOCK_API_BASE_URL ?? defaultBaseUrl).replace(/\/$/, ""),
    clientId: process.env.TTLOCK_CLIENT_ID ?? "",
    clientSecret: process.env.TTLOCK_CLIENT_SECRET ?? "",
    username: process.env.TTLOCK_USERNAME ?? "",
    password: process.env.TTLOCK_PASSWORD ?? "",
  };

  if (!config.clientId || !config.clientSecret || !config.username || !config.password) {
    throw new Error("TTLock API credentials are not configured.");
  }

  return config;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { errcode?: number; errmsg?: string };

  if (!response.ok || (payload.errcode !== undefined && payload.errcode !== 0)) {
    throw Object.assign(
      new Error(payload.errmsg || `TTLock request failed (${response.status}).`),
      { errcode: payload.errcode },
    );
  }

  return payload;
}

async function getAccessToken(config: TTLockConfig) {
  const passwordHash = createHash("md5")
    .update(config.password)
    .digest("hex")
    .toLowerCase();
  const response = await fetch(`${config.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      username: config.username,
      password: passwordHash,
    }),
    cache: "no-store",
  });
  const payload = await responseJson<TTLockTokenResponse>(response);

  if (!payload.access_token) {
    throw new Error("TTLock did not return an access token.");
  }

  return payload.access_token;
}

async function authenticatedPost<T>(
  path: string,
  fields: Record<string, string>,
) {
  const config = getTTLockConfig();
  const accessToken = await getAccessToken(config);
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      clientId: config.clientId,
      accessToken,
      ...fields,
      date: Date.now().toString(),
    }),
    cache: "no-store",
  });

  return responseJson<T>(response);
}

async function authenticatedGet<T>(
  path: string,
  fields: Record<string, string>,
) {
  const config = getTTLockConfig();
  const accessToken = await getAccessToken(config);
  const query = new URLSearchParams({
    clientId: config.clientId,
    accessToken,
    ...fields,
    date: Date.now().toString(),
  });
  const response = await fetch(`${config.baseUrl}${path}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  return responseJson<T>(response);
}

export async function listTTLockDevices() {
  const payload = await authenticatedPost<TTLockListResponse>(
    "/v3/lock/list",
    {
      pageNo: "1",
      pageSize: "10000",
    },
  );
  return payload.list ?? [];
}

export async function getTTLockLockDetail(lockId: number) {
  const payload = await authenticatedPost<Record<string, unknown>>(
    "/v3/lock/detail",
    { lockId: String(lockId) },
  );
  return pickSafeLockDetail(payload);
}

export async function addTTLockPasscode(input: {
  lockId: number;
  passcode: string;
  name: string;
  validFrom: Date;
  validUntil: Date;
}) {
  const payload = await authenticatedPost<TTLockPasscodeResponse>(
    "/v3/keyboardPwd/add",
    {
      lockId: String(input.lockId),
      keyboardPwd: input.passcode,
      keyboardPwdName: input.name,
      startDate: String(input.validFrom.getTime()),
      endDate: String(input.validUntil.getTime()),
      addType: "2",
    },
  );
  const keyboardPwdId = Number(payload.keyboardPwdId);
  if (!Number.isSafeInteger(keyboardPwdId) || keyboardPwdId <= 0) {
    throw new Error("TTLock did not return a valid passcode ID.");
  }
  return keyboardPwdId;
}

export async function changeTTLockPasscode(input: {
  lockId: number;
  keyboardPwdId: number;
  passcode: string;
  name: string;
  validFrom: Date;
  validUntil: Date;
}) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/keyboardPwd/change",
    {
      lockId: String(input.lockId),
      keyboardPwdId: String(input.keyboardPwdId),
      keyboardPwdName: input.name,
      newKeyboardPwd: input.passcode,
      startDate: String(input.validFrom.getTime()),
      endDate: String(input.validUntil.getTime()),
      changeType: "2",
    },
  );
}

export async function deleteTTLockPasscode(input: {
  lockId: number;
  keyboardPwdId: number;
}) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/keyboardPwd/delete",
    {
      lockId: String(input.lockId),
      keyboardPwdId: String(input.keyboardPwdId),
      deleteType: "2",
    },
  );
}

export async function listTTLockFingerprints(lockId: number) {
  const fingerprints: TTLockFingerprint[] = [];
  const pageSize = 100;

  for (let pageNo = 1; pageNo <= 100; pageNo += 1) {
    const payload = await authenticatedPost<TTLockFingerprintListResponse>(
      "/v3/fingerprint/list",
      {
        lockId: String(lockId),
        pageNo: String(pageNo),
        pageSize: String(pageSize),
      },
    );
    const page = payload.list ?? [];
    fingerprints.push(...page);

    const lastPage = payload.pages
      ? pageNo >= payload.pages
      : page.length < pageSize || fingerprints.length >= Number(payload.total ?? Infinity);
    if (lastPage) break;
  }

  return fingerprints;
}

export async function changeTTLockFingerprintPeriod(input: {
  lockId: number;
  fingerprintId: number;
  validFrom: Date;
  validUntil: Date;
}) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/fingerprint/changePeriod",
    {
      lockId: String(input.lockId),
      fingerprintId: String(input.fingerprintId),
      startDate: String(input.validFrom.getTime()),
      endDate: String(input.validUntil.getTime()),
      changeType: "2",
    },
  );
}

export async function deleteTTLockFingerprint(input: {
  lockId: number;
  fingerprintId: number;
}) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/fingerprint/delete",
    {
      lockId: String(input.lockId),
      fingerprintId: String(input.fingerprintId),
      deleteType: "2",
    },
  );
}

export type TTLockElectricMeter = {
  electricMeterId: number;
  name?: string;
  number?: string;
  online?: number;
  rssi?: number;
  onOff?: number;
  payMode?: number;
  totalKwh?: string;
  remainderKwh?: string;
  price?: string;
  groupId?: number;
  groupName?: string;
};

type TTLockElectricMeterListResponse = {
  list?: TTLockElectricMeter[];
  total?: number;
  errcode?: number;
  errmsg?: string;
};

/**
 * Official Sciener/TTLock cloud APIs (same paths on api.sciener.com,
 * euapi.ttlock.com and euapi.sciener.com; this client uses TTLOCK_API_BASE_URL
 * or https://api.sciener.com):
 *   POST /v3/electricMeter/list
 *   POST /v3/electricMeter/detail
 *   POST /v3/electricMeter/syncState
 *   POST /v3/electricMeter/recharge        (admin prepaid top-up)
 *   POST /v3/electricMeter/controlOnOff
 *   POST /v3/electricMeter/listOperationRecords
 *   POST /v3/electricMeter/add
 *   POST /v3/electricMeter/rename
 *   POST /v3/electricMeter/updatePrice
 *   POST /v3/electricMeter/updatePayMode
 *   POST /v3/electricMeterUser/recharge
 *   POST /v3/electricMeterUser/listRecharge
 */
export async function listTTLockElectricMeters() {
  const payload = await authenticatedPost<TTLockElectricMeterListResponse>(
    "/v3/electricMeter/list",
    {
      pageNo: "1",
      pageSize: "1000",
    },
  );
  return payload.list ?? [];
}

export async function rechargeTTLockElectricMeter(input: {
  electricMeterId: string | number;
  rechargeAmount: number;
  rechargeKwh: number;
}) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/electricMeter/recharge",
    {
      electricMeterId: String(input.electricMeterId),
      rechargeAmount: input.rechargeAmount.toFixed(2),
      rechargeKwh: input.rechargeKwh.toFixed(3),
    },
  );
}

export async function syncTTLockElectricMeterState(electricMeterId: string | number) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/electricMeter/syncState",
    { electricMeterId: String(electricMeterId) },
  );
}

export type TTLockElectricMeterDetail = TTLockElectricMeter & {
  mac?: string;
  modelNum?: string;
  hardwareRevision?: string;
  firmwareRevision?: string;
  syncKwhDate?: number | string;
  maxPower?: string;
  featureValue?: string;
};

/** Read-only: POST /v3/electricMeter/detail */
export async function getTTLockElectricMeterDetail(electricMeterId: string | number) {
  const payload = await authenticatedPost<TTLockElectricMeterDetail & {
    errcode?: number;
    errmsg?: string;
  }>("/v3/electricMeter/detail", { electricMeterId: String(electricMeterId) });
  // Strip anything that is not a plain reading/status field.
  return {
    electricMeterId: payload.electricMeterId ?? Number(electricMeterId),
    name: payload.name,
    number: payload.number,
    online: payload.online,
    rssi: payload.rssi,
    onOff: payload.onOff,
    payMode: payload.payMode,
    totalKwh: payload.totalKwh,
    remainderKwh: payload.remainderKwh,
    price: payload.price,
    maxPower: payload.maxPower,
    modelNum: payload.modelNum,
    firmwareRevision: payload.firmwareRevision,
    syncKwhDate: payload.syncKwhDate,
    groupId: payload.groupId,
    groupName: payload.groupName,
  } satisfies TTLockElectricMeterDetail;
}

/**
 * POST /v3/electricMeter/controlOnOff — onOff 1 switches the relay on,
 * 0 cuts power. Requires the meter to be online through its gateway/4G.
 */
export async function controlTTLockElectricMeterPower(input: {
  electricMeterId: string | number;
  on: boolean;
}) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/electricMeter/controlOnOff",
    {
      electricMeterId: String(input.electricMeterId),
      onOff: input.on ? "1" : "0",
    },
  );
}

export type TTLockElectricMeterUsageRecord = {
  dateType?: number;
  usedKwh?: string;
  createDate?: string;
};

/**
 * Read-only: POST /v3/electricMeter/listRecords. dateType 0 = by day
 * (dateStr YYYY-MM-DD), 1 = by month (YYYY-MM), 2 = by year (YYYY).
 */
export async function listTTLockElectricMeterUsage(input: {
  electricMeterId: string | number;
  dateType: 0 | 1 | 2;
  dateStr: string;
}) {
  const payload = await authenticatedPost<{
    list?: TTLockElectricMeterUsageRecord[];
    errcode?: number;
    errmsg?: string;
  }>("/v3/electricMeter/listRecords", {
    electricMeterId: String(input.electricMeterId),
    dateType: String(input.dateType),
    dateStr: input.dateStr,
  });
  return payload.list ?? [];
}

export type TTLockElectricMeterOperationRecord = {
  id?: number;
  recordType?: number | string;
  title?: string;
  content?: string;
  date?: string;
};

/** Read-only: POST /v3/electricMeter/listOperationRecords */
export async function listTTLockElectricMeterOperationRecords(input: {
  electricMeterId: string | number;
  pageNo?: number;
  pageSize?: number;
}) {
  const payload = await authenticatedPost<{
    list?: TTLockElectricMeterOperationRecord[];
    total?: number;
    errcode?: number;
    errmsg?: string;
  }>("/v3/electricMeter/listOperationRecords", {
    electricMeterId: String(input.electricMeterId),
    pageNo: String(input.pageNo ?? 1),
    pageSize: String(Math.min(input.pageSize ?? 50, 1000)),
  });
  return (payload.list ?? []).map((record) => ({
    id: record.id,
    recordType: record.recordType,
    title: record.title,
    content: record.content,
    date: record.date,
  }));
}

/*
 * eKeys ("Unlock with APP"). Official Sciener/TTLock cloud API:
 *   POST /v3/key/send          lockId, receiverUsername, keyName, startDate, endDate, remarks, keyRight, createUser
 *   GET  /v3/lock/listKey      lockId, pageNo, pageSize (max 200), orderBy
 *   POST /v3/key/delete        keyId
 *   POST /v3/key/freeze        keyId
 *   POST /v3/key/unfreeze      keyId
 *   POST /v3/key/changePeriod  keyId, startDate, endDate
 * keyStatus 110401 = normal, 110405 = frozen.
 */
export type TTLockEKey = {
  keyId: number;
  lockId: number;
  username?: string;
  keyName?: string;
  keyStatus?: string;
  startDate?: number;
  endDate?: number;
  keyRight?: number;
  remoteEnable?: number;
  senderUsername?: string;
  remarks?: string;
  date?: number;
};

export async function sendTTLockEKey(input: {
  lockId: number;
  receiverUsername: string;
  keyName: string;
  validFrom: Date;
  validUntil: Date;
  remarks?: string;
}) {
  const payload = await authenticatedPost<{
    keyId?: number | string;
    errcode?: number;
    errmsg?: string;
  }>("/v3/key/send", {
    lockId: String(input.lockId),
    receiverUsername: input.receiverUsername,
    keyName: input.keyName,
    startDate: String(input.validFrom.getTime()),
    endDate: String(input.validUntil.getTime()),
    ...(input.remarks ? { remarks: input.remarks } : {}),
    // Never an admin (authorized) key, and never auto-create an account with
    // the guessable "last six characters" default password.
    keyRight: "0",
    createUser: "2",
  });
  const keyId = Number(payload.keyId);
  if (!Number.isSafeInteger(keyId) || keyId <= 0) {
    throw new Error("TTLock did not return a valid eKey ID.");
  }
  return keyId;
}

export async function listTTLockLockEKeys(lockId: number) {
  const keys: TTLockEKey[] = [];
  const pageSize = 200;
  for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
    const payload = await authenticatedGet<{
      list?: TTLockEKey[];
      pages?: number;
      total?: number;
      errcode?: number;
      errmsg?: string;
    }>("/v3/lock/listKey", {
      lockId: String(lockId),
      pageNo: String(pageNo),
      pageSize: String(pageSize),
      orderBy: "1",
    });
    const page = payload.list ?? [];
    keys.push(...page);
    const lastPage = payload.pages
      ? pageNo >= payload.pages
      : page.length < pageSize || keys.length >= Number(payload.total ?? Infinity);
    if (lastPage) break;
  }
  return keys;
}

export async function deleteTTLockEKey(keyId: number) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/key/delete",
    { keyId: String(keyId) },
  );
}

export async function freezeTTLockEKey(keyId: number) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/key/freeze",
    { keyId: String(keyId) },
  );
}

export async function unfreezeTTLockEKey(keyId: number) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/key/unfreeze",
    { keyId: String(keyId) },
  );
}

export async function changeTTLockEKeyPeriod(input: {
  keyId: number;
  validFrom: Date;
  validUntil: Date;
}) {
  await authenticatedPost<{ errcode?: number; errmsg?: string }>(
    "/v3/key/changePeriod",
    {
      keyId: String(input.keyId),
      startDate: String(input.validFrom.getTime()),
      endDate: String(input.validUntil.getTime()),
    },
  );
}
