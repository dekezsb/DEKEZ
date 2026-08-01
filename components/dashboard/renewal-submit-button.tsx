"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function RenewalSubmitButton({
  children,
  label,
  pendingLabel = "Saving...",
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} disabled={pending || props.disabled} type="submit">
      {pending ? null : children}
      {pending ? pendingLabel : label}
    </Button>
  );
}
