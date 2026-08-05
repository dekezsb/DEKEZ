import "server-only";

export type CnyiotConfigStatus = {
  accountId: boolean;
  apiBaseUrl: boolean;
  apiKey: boolean;
  complete: boolean;
};

/**
 * CNYIOT must issue server API credentials before DEKEZ can read or credit a
 * physical meter automatically. Web-account passwords and browser sessions are
 * intentionally not accepted here because the provider login uses CAPTCHA and
 * is not a stable machine-to-machine interface.
 */
export function getCnyiotConfigStatus(): CnyiotConfigStatus {
  const status = {
    accountId: Boolean(process.env.CNYIOT_ACCOUNT_ID),
    apiBaseUrl: Boolean(process.env.CNYIOT_API_BASE_URL),
    apiKey: Boolean(process.env.CNYIOT_API_KEY),
  };

  return {
    ...status,
    complete: status.accountId && status.apiBaseUrl && status.apiKey,
  };
}
