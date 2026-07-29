import { createSign } from "node:crypto";
import {
  archiveRootForYear,
  getDriveArchiveConfig,
  type DriveArchiveConfig,
} from "@/lib/archive/config";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type DriveFile = {
  id: string;
  name?: string;
  parents?: string[];
  webViewLink?: string;
};

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
const folderCache = new Map<string, string>();

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function serviceAccountAssertion(config: DriveArchiveConfig) {
  if (config.auth.kind !== "service_account") {
    throw new Error("Google Drive service-account credentials are unavailable.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: config.auth.serviceAccountEmail,
      scope: DRIVE_SCOPE,
      aud: TOKEN_AUDIENCE,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(config.auth.privateKey));
  return `${unsigned}.${signature}`;
}

async function accessToken(config: DriveArchiveConfig) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const tokenRequest = new URLSearchParams();
  if (config.auth.kind === "oauth") {
    tokenRequest.set("grant_type", "refresh_token");
    tokenRequest.set("client_id", config.auth.clientId);
    tokenRequest.set("client_secret", config.auth.clientSecret);
    tokenRequest.set("refresh_token", config.auth.refreshToken);
  } else {
    tokenRequest.set(
      "grant_type",
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    tokenRequest.set("assertion", serviceAccountAssertion(config));
  }
  const response = await fetch(TOKEN_AUDIENCE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequest,
    cache: "no-store",
  });
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ?? "Unable to authenticate with Google Drive.",
    );
  }

  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

function driveQueryValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function driveRequest<T>(
  config: DriveArchiveConfig,
  url: string,
  init: RequestInit = {},
) {
  const token = await accessToken(config);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Drive request failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

async function findFolder(
  config: DriveArchiveConfig,
  parentId: string,
  name: string,
) {
  const params = new URLSearchParams({
    q: [
      `'${driveQueryValue(parentId)}' in parents`,
      `name = '${driveQueryValue(name)}'`,
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false",
    ].join(" and "),
    fields: "files(id,name)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const result = await driveRequest<{ files?: DriveFile[] }>(
    config,
    `https://www.googleapis.com/drive/v3/files?${params}`,
  );
  return result.files?.[0]?.id ?? null;
}

async function createFolder(
  config: DriveArchiveConfig,
  parentId: string,
  name: string,
) {
  const folder = await driveRequest<DriveFile>(
    config,
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentId],
      }),
    },
  );
  return folder.id;
}

async function ensureFolder(
  config: DriveArchiveConfig,
  parentId: string,
  name: string,
) {
  const cacheKey = `${parentId}:${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const id =
    (await findFolder(config, parentId, name)) ??
    (await createFolder(config, parentId, name));
  folderCache.set(cacheKey, id);
  return id;
}

async function ensureFolderPath(
  config: DriveArchiveConfig,
  rootId: string,
  path: string[],
) {
  let parentId = rootId;
  for (const part of path) {
    parentId = await ensureFolder(config, parentId, part);
  }
  return parentId;
}

async function createPdf(
  config: DriveArchiveConfig,
  folderId: string,
  name: string,
  bytes: Uint8Array,
) {
  const token = await accessToken(config);
  const boundary = `dekez_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = Buffer.from(
    JSON.stringify({
      name,
      mimeType: "application/pdf",
      parents: [folderId],
    }),
  );
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    ),
    metadata,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,parents",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(
      `Google Drive upload failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  return (await response.json()) as DriveFile;
}

async function updatePdf(
  config: DriveArchiveConfig,
  fileId: string,
  folderId: string,
  name: string,
  bytes: Uint8Array,
) {
  const current = await driveRequest<DriveFile>(
    config,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents&supportsAllDrives=true`,
  );
  const currentParents = current.parents ?? [];
  const metadataParams = new URLSearchParams({
    supportsAllDrives: "true",
    fields: "id,name,webViewLink,parents",
  });
  if (!currentParents.includes(folderId)) {
    metadataParams.set("addParents", folderId);
    if (currentParents.length) {
      metadataParams.set("removeParents", currentParents.join(","));
    }
  }
  const updated = await driveRequest<DriveFile>(
    config,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${metadataParams}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  await driveRequest(
    config,
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/pdf" },
      body: Buffer.from(bytes),
    },
  );
  return updated;
}

export async function archivePdfToDrive(input: {
  archiveYear: number;
  path: string[];
  name: string;
  bytes: Uint8Array;
  existingFileId?: string | null;
}) {
  const config = getDriveArchiveConfig();
  const rootId = archiveRootForYear(config, input.archiveYear);
  const folderId = await ensureFolderPath(config, rootId, input.path);
  const file = input.existingFileId
    ? await updatePdf(
        config,
        input.existingFileId,
        folderId,
        input.name,
        input.bytes,
      )
    : await createPdf(config, folderId, input.name, input.bytes);

  return {
    fileId: file.id,
    url:
      file.webViewLink ??
      `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
    path: [...input.path, input.name].join("/"),
  };
}
