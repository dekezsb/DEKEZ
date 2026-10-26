import "server-only";
import { reportConfig } from "../config";

export function commandConfig() {
  const report = reportConfig();
  const secret = process.env.WHAPI_REPORT_WEBHOOK_SECRET ?? "";
  // A separate opt-in: enabling the existing daily report never enables commands.
  const enabled = process.env.DEKEZ_REPORT_COMMANDS_ENABLED === "true";
  return { ...report, secret, enabled,
    ready: enabled && report.sendEnabled && report.configured && /^[A-Za-z0-9_-]{32,256}$/.test(secret) };
}
