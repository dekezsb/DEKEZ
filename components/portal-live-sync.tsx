"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 350;
const RECONCILE_INTERVAL_MS = 60_000;

export function PortalLiveSync() {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const refresh = () => {
      if (document.visibilityState !== "visible") return;

      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }

      refreshTimer.current = setTimeout(() => {
        router.refresh();
        refreshTimer.current = null;
      }, REFRESH_DEBOUNCE_MS);
    };

    const refreshImmediately = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const channel = supabase
      .channel("dekez-portal-live-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        refresh,
      )
      .subscribe();

    const reconcileTimer = window.setInterval(
      refreshImmediately,
      RECONCILE_INTERVAL_MS,
    );

    window.addEventListener("online", refreshImmediately);
    window.addEventListener("focus", refreshImmediately);
    document.addEventListener("visibilitychange", refreshImmediately);

    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
      window.clearInterval(reconcileTimer);
      window.removeEventListener("online", refreshImmediately);
      window.removeEventListener("focus", refreshImmediately);
      document.removeEventListener("visibilitychange", refreshImmediately);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
