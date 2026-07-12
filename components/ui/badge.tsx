import type * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[#e7f2f0] px-2.5 py-1 text-xs font-semibold text-[#126b5f]",
        className,
      )}
      {...props}
    />
  );
}
