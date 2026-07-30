"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function PaymentFlashNotice({
  kind,
  message,
}: {
  kind: "error" | "success";
  message: string;
}) {
  const [visible, setVisible] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("error");
    nextParams.delete("uploaded");
    const nextUrl = nextParams.size
      ? `${pathname}?${nextParams.toString()}`
      : pathname;
    router.replace(nextUrl, { scroll: false });

    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [pathname, router, searchParams]);

  if (!visible) return null;

  return (
    <div
      className={
        kind === "success"
          ? "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          : "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
      }
      role={kind === "error" ? "alert" : "status"}
    >
      <div className="flex items-start justify-between gap-4">
        <span>{message}</span>
        <button
          aria-label="Dismiss message"
          className="shrink-0 text-lg leading-none opacity-70 hover:opacity-100"
          onClick={() => setVisible(false)}
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}
