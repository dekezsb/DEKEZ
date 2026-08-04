import "server-only";

import { createHash } from "node:crypto";

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
    throw new Error(payload.errmsg || `TTLock request failed (${response.status}).`);
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
