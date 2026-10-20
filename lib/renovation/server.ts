import "server-only";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { allReportRows } from "@/lib/accounting/report-data";
import type { RenovationClient, CatalogueItem, RenovationDocument } from "./model";
import { validateTranslationReview, type SavedTranslations } from './saved-translations';

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
    allReportRows(db.from("renovation_catalogue").select("*").eq("company_id", company.id)),
    allReportRows(db.from("accounting_accounts").select("id,code,name").eq("company_id",company.id).eq("account_type","liability").eq("is_active",true)),
  ]);
  if (results.some((r) => r.error)) throw new Error("Renovation data unavailable. The renovation database migration must be installed before using this section.");
  return { clients: results[0].data as RenovationClient[], catalogue: results[1].data as CatalogueItem[], taxAccounts:results[2].data as {id:string;code:string;name:string}[] };
}
export async function renovationDocument(id: string) {
  const { db, company } = await renovationContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db.from("renovation_documents").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (error) throw new Error("Unable to load renovation document.");
  return data as RenovationDocument | null;
}

export async function renovationSavedTranslations(document: RenovationDocument): Promise<SavedTranslations> {
  const { db, company } = await renovationContext();
  if (document.company_id !== company.id) return {};
  const result: SavedTranslations = {};
  await Promise.all((['ms', 'zh'] as const).map(async language => {
    const { data, error } = await db.from('accounting_audit_logs').select('after_data')
      .eq('company_id', company.id).eq('entity_type', 'renovation_translation').eq('entity_id', document.id)
      .eq('action', 'export_translation_saved').eq('after_data->>document_version', String(document.version))
      .eq('after_data->>language', language).order('performed_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error('Could not load saved PDF translations. Please retry.');
    if (data) {
      try { result[language] = validateTranslationReview(document, data.after_data?.review); }
      catch { /* A stale or unsafe translation must never replace original wording. */ }
    }
  }));
  return result;
}
