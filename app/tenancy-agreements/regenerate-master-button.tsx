"use client";

import { RefreshCw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { regenerateMasterAgreementArchive } from "./actions";

function RegenerateSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Regenerating agreements..." : "Regenerate unsigned agreements"}
    </Button>
  );
}

export function RegenerateMasterButton() {
  return (
    <form
      action={regenerateMasterAgreementArchive}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Replace the wording in every unsigned and expired agreement with the latest DEKEZ master agreement? Signed agreements will not be changed.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <RegenerateSubmitButton />
    </form>
  );
}
