import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function MarketplaceLayout({ children }: { children: ReactNode }) {
  // Management page retains its own Super Admin gate; pilot can only view preview.
  await requireRole(["super_admin", "contractor_preview"]);
  return children;
}
