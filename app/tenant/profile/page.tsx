import { TenantProfile } from "@/components/tenant/tenant-portal";
import { requireRole } from "@/lib/auth/session";
import { getTenantPortalData } from "@/lib/data/tenant-portal";

export default async function TenantProfilePage() {
  await requireRole(["tenant"]);
  const data = await getTenantPortalData();

  return data ? <TenantProfile data={data} /> : null;
}
