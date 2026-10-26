"use server";

import { runSetup, type SetupState } from "@/lib/management-report/temporary-whapi-setup";

export async function temporarySetupAction(_previous: SetupState, form: FormData): Promise<SetupState> {
  const intent = form.get("intent");
  if (intent !== "preview" && intent !== "apply" && intent !== "verify") {
    return { phase: "blocked", message: "Invalid setup operation. Nothing was changed." };
  }
  if (intent === "apply" && form.get("confirm") !== "configure-callback-only") {
    return { phase: "blocked", message: "Explicit callback configuration confirmation is required." };
  }
  const ticket = form.get("ticket");
  return runSetup(intent, typeof ticket === "string" ? ticket : undefined);
}
