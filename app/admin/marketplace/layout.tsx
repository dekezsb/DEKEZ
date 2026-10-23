import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function MarketplaceLayout({ children }: { children: ReactNode }) {
  // Foundation previews are restricted to the existing Super Admin role.
  // No contractor identities or broader staff permissions are enabled here.
  await requireRole(["super_admin"]);
  return children;
}
