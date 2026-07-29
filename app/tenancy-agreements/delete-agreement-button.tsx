"use client";

import { Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { deleteWrongUnsignedAgreement } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      className="text-red-600 hover:bg-red-50 hover:text-red-700"
      disabled={pending}
      size="sm"
      type="submit"
      variant="ghost"
    >
      <Trash2 className="h-4 w-4" />
      {pending ? "Deleting..." : "Delete wrong agreement"}
    </Button>
  );
}

export function DeleteAgreementButton({
  agreementId,
  agreementLabel,
}: {
  agreementId: string;
  agreementLabel: string;
}) {
  return (
    <form
      action={deleteWrongUnsignedAgreement}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Delete this wrong unsigned agreement?\n\n${agreementLabel}\n\nIt will immediately disappear from the tenant portal.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="agreementId" type="hidden" value={agreementId} />
      <input
        name="reason"
        type="hidden"
        value="Wrong unsigned agreement removed by Admin"
      />
      <SubmitButton />
    </form>
  );
}
