"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function ReconciliationSubmitButton({
  children,
  pendingLabel = "Processing...",
  ...props
}: ComponentProps<typeof Button> & {
  children: ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button {...props} disabled={pending || props.disabled} type="submit">
      {pending ? pendingLabel : children}
    </Button>
  );
}
