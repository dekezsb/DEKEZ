import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getFirstCompany, getProperties } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VoucherAccount } from "@/components/accounting/voucher-form";

/** Shared loader for the voucher pages: role check, company, accounts and properties. */
export async function voucherPageContext() {
  await requireRole(["super_admin", "owner", "admin"], { module: "reports", level: "view" });
  const company = await getFirstCompany();
  if (!company) redirect("/reports");
  // Voucher tables are service-role only; the role check above gates access.
  const supabase = createAdminClient();
  const [accountsResult, banksResult, properties] = await Promise.all([
    supabase.from("accounting_accounts").select("id, code, name, account_type, system_key").eq("company_id", company.id).eq("is_active", true).order("code"),
    supabase.from("bank_accounts").select("id, name, accounting_account_id, is_active").eq("company_id", company.id),
    getProperties(),
  ]);
  if (accountsResult.error || banksResult.error) throw new Error("Unable to load the chart of accounts.");
  const bankLedgerIds = new Set((banksResult.data ?? []).filter((bank) => bank.is_active).map((bank) => bank.accounting_account_id));
  const accounts: VoucherAccount[] = (accountsResult.data ?? []).map((account) => ({ id: account.id, code: account.code, name: account.name, accountType: account.account_type }));
  const paymentAccounts = (accountsResult.data ?? [])
    .filter((account) => ["cash_on_hand", "company_bank"].includes(account.system_key ?? "") || bankLedgerIds.has(account.id) || (account.account_type === "asset" && /^10\d{2}$/.test(account.code)))
    .map((account) => ({ id: account.id, code: account.code, name: account.name, accountType: account.account_type }));
  const companyProperties = properties.filter((property) => property.company_id === company.id).map((property) => ({ id: property.id, name: property.name }));
  return { company, supabase, accounts, paymentAccounts, properties: companyProperties, banks: banksResult.data ?? [] };
}
