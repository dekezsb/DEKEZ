"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 650;
const MINIMUM_REFRESH_GAP_MS = 2_500;
const RECONCILE_INTERVAL_MS = 5 * 60_000;
const RESUME_STALE_AFTER_MS = 15_000;

const pageTables: Array<{ prefix: string; tables: string[] }> = [
  {
    prefix: "/dashboard",
    tables: [
      "claims",
      "expenses",
      "maintenance_tickets",
      "payment_submissions",
      "payments",
      "profiles",
      "rent_bills",
      "rooms",
      "smart_meter_top_up_requests",
      "tenancies",
      "tenancy_agreements",
    ],
  },
  {
    prefix: "/maintenance",
    tables: [
      "claims",
      "expenses",
      "maintenance_tickets",
      "maintenance_updates",
      "notifications",
    ],
  },
  {
    prefix: "/verification",
    tables: [
      "claims",
      "expenses",
      "profiles",
      "smart_meter_top_up_requests",
      "tenant_applications",
      "tenancy_agreements",
      "tenancies",
      "user_module_permissions",
    ],
  },
  {
    prefix: "/claims",
    tables: ["claims", "expenses", "maintenance_tickets"],
  },
  {
    prefix: "/payments",
    tables: [
      "payment_submissions",
      "payments",
      "rent_bills",
      "tenancies",
      "utility_bills",
    ],
  },
  {
    prefix: "/rent-due-tracker",
    tables: ["payment_submissions", "payments", "rent_bills", "rooms", "tenancies"],
  },
  {
    prefix: "/rental-invoices",
    tables: [
      "payment_submissions",
      "payments",
      "rental_invoice_line_items",
      "rent_bills",
      "smart_meter_top_up_requests",
      "tenancies",
    ],
  },
  {
    prefix: "/tenancy-agreements",
    tables: ["profiles", "tenant_records", "tenancies", "tenancy_agreements"],
  },
  {
    prefix: "/tenant",
    tables: [
      "maintenance_tickets",
      "notifications",
      "payment_submissions",
      "payments",
      "profiles",
      "rent_bills",
      "smart_meter_top_up_requests",
      "tenant_records",
      "tenancies",
      "tenancy_agreements",
      "utility_bills",
    ],
  },
  {
    prefix: "/properties",
    tables: ["properties", "rooms", "tenancies", "tenancy_agreements", "units"],
  },
  {
    prefix: "/admin-setup",
    tables: ["profiles", "properties", "user_module_permissions"],
  },
];

const defaultTables = [
  "claims",
  "expenses",
  "maintenance_tickets",
  "notifications",
  "payment_submissions",
  "payments",
  "profiles",
  "properties",
  "rent_bills",
  "rooms",
  "smart_meter_top_up_requests",
  "tenancies",
  "tenancy_agreements",
  "utility_bills",
];

function relevantTables(pathname: string) {
  return (
    pageTables.find((entry) => pathname.startsWith(entry.prefix))?.tables ??
    defaultTables
  );
}

export function PortalLiveSync() {
  const router = useRouter();
  const pathname = usePathname();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAt = useRef(Date.now());

  useEffect(() => {
    const supabase = createClient();

    const performRefresh = () => {
      if (document.visibilityState !== "visible") return;
      lastRefreshAt.current = Date.now();
      router.refresh();
    };

    const scheduleRefresh = () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }

      const timeSinceRefresh = Date.now() - lastRefreshAt.current;
      const delay = Math.max(
        REFRESH_DEBOUNCE_MS,
        MINIMUM_REFRESH_GAP_MS - timeSinceRefresh,
      );

      refreshTimer.current = setTimeout(() => {
        performRefresh();
        refreshTimer.current = null;
      }, delay);
    };

    const reconcileIfStale = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefreshAt.current >= RESUME_STALE_AFTER_MS
      ) {
        performRefresh();
      }
    };

    let channel = supabase.channel(`dekez-live-${pathname.replace(/\W/g, "-")}`);
    for (const table of relevantTables(pathname)) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh,
      );
    }
    channel.subscribe();

    const reconcileTimer = window.setInterval(performRefresh, RECONCILE_INTERVAL_MS);

    window.addEventListener("online", reconcileIfStale);
    window.addEventListener("focus", reconcileIfStale);
    document.addEventListener("visibilitychange", reconcileIfStale);

    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
      window.clearInterval(reconcileTimer);
      window.removeEventListener("online", reconcileIfStale);
      window.removeEventListener("focus", reconcileIfStale);
      document.removeEventListener("visibilitychange", reconcileIfStale);
      void supabase.removeChannel(channel);
    };
  }, [pathname, router]);

  return null;
}
