import "server-only";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { allReportRows } from "@/lib/accounting/report-data";
import type { RenovationClient, CatalogueItem, RenovationDocument } from "./model";

export async function renovationContext(manage = false) {
  await requireRole(["super_admin", "admin", "owner"], { module: "reports", level: manage ? "manage" : "view" });
  const [user, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);
  if (!user || !company) redirect("/dashboard?error=access_denied");
  return { user, company, db: createAdminClient() };
}
export async function renovationLists() {
  const { db, company } = await renovationContext();
  const results = await Promise.all([
    allReportRows(db.from("renovation_clients").select("id,name,phone,email,address").eq("company_id", company.id)),
    allReportRows(db.from("renovation_catalogue").select("id,description,unit,rate").eq("company_id", company.id)),
  ]);
  if (results.some((r) => r.error)) throw new Error("Renovation data unavailable. The renovation database migration must be installed before using this section.");
  return { clients: results[0].data as RenovationClient[], catalogue: results[1].data as CatalogueItem[] };
}
export async function renovationDocument(id: string) {
  const { db, company } = await renovationContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db.from("renovation_documents").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (error) throw new Error("Unable to load renovation document.");
  return data as RenovationDocument | null;
}
