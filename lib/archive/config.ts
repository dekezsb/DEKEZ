export type DriveArchiveConfig = {
  auth:
    | {
        kind: "oauth";
        clientId: string;
        clientSecret: string;
        refreshToken: string;
      }
    | {
        kind: "service_account";
        serviceAccountEmail: string;
        privateKey: string;
      };
  rootsByYear: Map<number, string>;
};

export function getDriveArchiveConfig(): DriveArchiveConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  const serviceAccountEmail =
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();
  const rootsByYear = new Map<number, string>();

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^GOOGLE_DRIVE_ARCHIVE_ROOT_(\d{4})$/);
    if (match && value?.trim()) {
      rootsByYear.set(Number(match[1]), value.trim());
    }
  }

  const auth =
    clientId && clientSecret && refreshToken
      ? {
          kind: "oauth" as const,
          clientId,
          clientSecret,
          refreshToken,
        }
      : serviceAccountEmail && privateKey
        ? {
            kind: "service_account" as const,
            serviceAccountEmail,
            privateKey,
          }
        : null;

  if (!auth) {
    throw new Error(
      "Google Drive archive credentials are not configured. Add OAuth credentials or a service account.",
    );
  }

  return {
    auth,
    rootsByYear,
  };
}

export function archiveRootForYear(
  config: DriveArchiveConfig,
  archiveYear: number,
) {
  const rootId = config.rootsByYear.get(archiveYear);
  if (!rootId) {
    throw new Error(
      `Google Drive archive root is not configured for ${archiveYear}.`,
    );
  }
  return rootId;
}
