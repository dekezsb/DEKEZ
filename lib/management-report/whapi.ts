import "server-only";

export type DeliveryOutcome = {
  state: "accepted" | "rejected" | "uncertain";
  providerId: string | null;
  httpStatus: number | null;
  errorCode: "provider_rejected" | "delivery_uncertain" | null;
};

// Only this fixed HTTPS origin ever receives the token. No redirects/retry loop.
export async function sendWhapiReport(token: string, to: string, body: string): Promise<DeliveryOutcome> {
  if (!token || !/^[1-9][0-9]{8,14}$/.test(to) || !body || body.length > 4000) {
    throw new Error("Report configuration is invalid.");
  }
  let httpStatus: number | null = null;
  try {
    const response = await fetch("https://gate.whapi.cloud/messages/text", {
      method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, body, no_link_preview: true }),
    });
    httpStatus = response.status;
    // Documented rejection responses do not establish a successful send.
    if ([400, 401, 402, 403, 413, 429].includes(httpStatus)) {
      return { state: "rejected", providerId: null, httpStatus, errorCode: "provider_rejected" };
    }
    if (response.ok) {
      const payload = await response.json();
      const id = payload?.message?.id;
      if (payload?.sent === true && typeof id === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(id)) {
        return { state: "accepted", providerId: id, httpStatus, errorCode: null };
      }
    }
  } catch {
    // A network failure can occur after provider acceptance. Never blind-retry.
  }
  return { state: "uncertain", providerId: null, httpStatus, errorCode: "delivery_uncertain" };
}
