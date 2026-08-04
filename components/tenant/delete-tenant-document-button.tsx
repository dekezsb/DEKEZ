"use client";

import { Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { deleteTenantDocument } from "@/app/tenants/[id]/actions";
import { Button } from "@/components/ui/button";

function DeleteButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      className="text-red-600 hover:bg-red-50 hover:text-red-700"
      disabled={pending}
      size="sm"
      type="submit"
      variant="outline"
    >
      <Trash2 aria-hidden="true" className="h-4 w-4" />
      {pending ? "Deleting..." : "Delete document"}
    </Button>
  );
}

export function DeleteTenantDocumentButton({
  documentId,
  documentLabel,
  propertyId,
  returnView,
  roomId,
  tenantKey,
}: {
  documentId: string;
  documentLabel: string;
  propertyId: string;
  returnView: "tenant" | "room";
  roomId: string;
  tenantKey: string;
}) {
  return (
    <form
      action={deleteTenantDocument}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Delete this tenant document?\n\n${documentLabel}\n\nThis permanently removes the uploaded file and cannot be undone.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="documentId" type="hidden" value={documentId} />
      <input name="tenantKey" type="hidden" value={tenantKey} />
      <input name="propertyId" type="hidden" value={propertyId} />
      <input name="roomId" type="hidden" value={roomId} />
      <input name="returnView" type="hidden" value={returnView} />
      <DeleteButton />
    </form>
  );
}
