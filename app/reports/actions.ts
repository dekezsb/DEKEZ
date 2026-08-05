"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import {
  dateDistance,
  getBankCandidates,
  bankSourceTypes,
  type BankSourceType,
} from "@/lib/accounting/bank-candidates";
import { parseBankStatementCsv } from "@/lib/accounting/bank-statement";
import { getCurrentUser, getFirstCompany } from "@/lib/data/organization";
import { createAdminClient } from "@/lib/supabase/admin";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));
  return Number.isFinite(value) ? value : 0;
}

function fileValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function reportPath(params: Record<string, string>) {
  const search = new URLSearchParams({ tab: "bank", ...params });
  return `/reports?${search.toString()}`;
}

async function accountingContext() {
  await requireRole(["super_admin", "owner", "admin"], {
    module: "reports",
    level: "manage",
  });
  const [user, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);
  if (!user || !company) redirect(reportPath({ error: "accounting_context" }));
  return { user, company, supabase: createAdminClient() };
}

export async function createBankAccount(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const name = textValue(formData, "name");
  const bankName = textValue(formData, "bankName");
  const accountNumber = textValue(formData, "accountNumber").replace(/\D/g, "");
  const last4 = accountNumber.slice(-4);
  const openingBalance = numberValue(formData, "openingBalance");
  const openingBalanceDate = textValue(formData, "openingBalanceDate") || null;

  if (!name || !bankName || accountNumber.length < 6 || accountNumber.length > 30) {
    redirect(reportPath({ error: "bank_account_details" }));
  }

  const { data: existingAccounts } = await supabase
    .from("accounting_accounts")
    .select("code")
    .eq("company_id", company.id)
    .gte("code", "1010")
    .lte("code", "1099");
  const nextCode = String(
    Math.max(1010, ...(existingAccounts ?? []).map((account) => Number(account.code) || 1010)) + 1,
  );
  const { data: ledgerAccount, error: ledgerError } = await supabase
    .from("accounting_accounts")
    .insert({
      company_id: company.id,
      code: nextCode,
      name,
      account_type: "asset",
      report_group: "current_asset",
      normal_balance: "debit",
      description: `${bankName} bank account`,
      is_system: false,
      sort_order: Number(nextCode),
    })
    .select("id")
    .single();

  if (ledgerError || !ledgerAccount) {
    redirect(reportPath({ error: "bank_account_create" }));
  }

  const { error } = await supabase.from("bank_accounts").insert({
    company_id: company.id,
    accounting_account_id: ledgerAccount.id,
    name,
    bank_name: bankName,
    account_number: accountNumber,
    account_number_last4: last4,
    opening_balance: openingBalance,
    opening_balance_date: openingBalanceDate,
    created_by: user.id,
  });

  if (error) {
    await supabase.from("accounting_accounts").delete().eq("id", ledgerAccount.id);
    redirect(reportPath({ error: "bank_account_create" }));
  }

  revalidatePath("/reports");
  redirect(reportPath({ created: "bank_account" }));
}

export async function importBankStatement(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const bankAccountId = textValue(formData, "bankAccountId");
  const periodStart = textValue(formData, "periodStart");
  const periodEnd = textValue(formData, "periodEnd");
  const statementDate = textValue(formData, "statementDate") || periodEnd;
  const openingBalance = numberValue(formData, "openingBalance");
  const closingBalance = numberValue(formData, "closingBalance");
  const statement = fileValue(formData, "statement");

  if (!bankAccountId || !periodStart || !periodEnd || !statement) {
    redirect(reportPath({ error: "statement_details" }));
  }
  if (statement.size > 10 * 1024 * 1024 || !/\.csv$/i.test(statement.name)) {
    redirect(reportPath({ error: "statement_csv" }));
  }

  const { data: bankAccount } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("id", bankAccountId)
    .eq("company_id", company.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!bankAccount) redirect(reportPath({ error: "bank_account_missing" }));

  let parsedLines;
  try {
    parsedLines = parseBankStatementCsv(await statement.text());
  } catch {
    redirect(reportPath({ error: "statement_format" }));
  }
  if (!parsedLines.length) redirect(reportPath({ error: "statement_empty" }));

  const { data: statementImport, error: importError } = await supabase
    .from("bank_statement_imports")
    .insert({
      bank_account_id: bankAccountId,
      company_id: company.id,
      period_start: periodStart,
      period_end: periodEnd,
      statement_date: statementDate,
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      source_format: "csv",
      original_file_name: statement.name,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (importError || !statementImport) redirect(reportPath({ error: "statement_create" }));

  const safeName = statement.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = `${company.id}/${bankAccountId}/${statementImport.id}/${safeName}`;
  const bytes = Buffer.from(await statement.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("accounting-documents")
    .upload(filePath, bytes, { contentType: statement.type || "text/csv", upsert: false });
  if (uploadError) {
    await supabase.from("bank_statement_imports").delete().eq("id", statementImport.id);
    redirect(reportPath({ error: "statement_upload" }));
  }

  const { error: updateError } = await supabase
    .from("bank_statement_imports")
    .update({ original_file_path: filePath })
    .eq("id", statementImport.id);
  const { error: linesError } = await supabase.from("bank_statement_lines").insert(
    parsedLines.map((line) => ({
      statement_import_id: statementImport.id,
      bank_account_id: bankAccountId,
      transaction_date: line.transactionDate,
      value_date: line.valueDate,
      description: line.description,
      reference_number: line.referenceNumber,
      amount: line.amount,
      external_hash: line.externalHash,
    })),
  );
  if (updateError || linesError) redirect(reportPath({ error: "statement_lines" }));

  revalidatePath("/reports");
  redirect(reportPath({ statement: statementImport.id, imported: String(parsedLines.length) }));
}

async function refreshLineStatus(
  supabase: ReturnType<typeof createAdminClient>,
  lineId: string,
) {
  const [{ data: line }, { data: matches }] = await Promise.all([
    supabase.from("bank_statement_lines").select("amount").eq("id", lineId).single(),
    supabase.from("bank_reconciliation_matches").select("matched_amount, match_method").eq("statement_line_id", lineId),
  ]);
  if (!line) return;
  const matched = (matches ?? []).reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
  const complete = Math.abs(Number(line.amount) - matched) < 0.005;
  const adjusted = (matches ?? []).some((match) => match.match_method === "adjustment");
  await supabase
    .from("bank_statement_lines")
    .update({ status: complete ? (adjusted ? "adjusted" : "matched") : "unmatched", updated_at: new Date().toISOString() })
    .eq("id", lineId);
}

export async function autoMatchStatement(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const statementId = textValue(formData, "statementId");
  const [{ data: statementImport }, { data: lines }, { data: allMatches }, candidates] = await Promise.all([
    supabase.from("bank_statement_imports").select("id, status").eq("id", statementId).eq("company_id", company.id).maybeSingle(),
    supabase.from("bank_statement_lines").select("id, transaction_date, amount, description, reference_number, status").eq("statement_import_id", statementId).eq("status", "unmatched"),
    supabase.from("bank_reconciliation_matches").select("statement_line_id, source_type, source_id, matched_amount"),
    getBankCandidates(supabase, company.id),
  ]);
  if (!statementImport || statementImport.status !== "in_progress") {
    redirect(reportPath({ error: "statement_closed" }));
  }

  const consumed = new Map<string, number>();
  for (const match of allMatches ?? []) {
    const key = `${match.source_type}:${match.source_id}`;
    consumed.set(key, (consumed.get(key) ?? 0) + Math.abs(Number(match.matched_amount ?? 0)));
  }
  let matchedCount = 0;

  for (const line of lines ?? []) {
    const amount = Number(line.amount);
    const available = candidates.filter((candidate) => {
      const key = `${candidate.sourceType}:${candidate.sourceId}`;
      const remaining = Math.abs(candidate.amount) - (consumed.get(key) ?? 0);
      return (
        Math.sign(candidate.amount) === Math.sign(amount) &&
        Math.abs(remaining - Math.abs(amount)) < 0.005 &&
        dateDistance(candidate.date, line.transaction_date) <= 3
      );
    });
    const referenceMatches = available.filter((candidate) => {
      const reference = candidate.referenceNumber?.trim().toLowerCase();
      const bankText = `${line.reference_number ?? ""} ${line.description ?? ""}`.toLowerCase();
      return reference && bankText.includes(reference);
    });
    const match = referenceMatches.length === 1
      ? referenceMatches[0]
      : available.length === 1
        ? available[0]
        : null;
    if (!match) continue;

    const { error } = await supabase.from("bank_reconciliation_matches").insert({
      statement_line_id: line.id,
      source_type: match.sourceType,
      source_id: match.sourceId,
      matched_amount: amount,
      match_method: "automatic",
      created_by: user.id,
    });
    if (!error) {
      const key = `${match.sourceType}:${match.sourceId}`;
      consumed.set(key, (consumed.get(key) ?? 0) + Math.abs(amount));
      await refreshLineStatus(supabase, line.id);
      matchedCount += 1;
    }
  }

  revalidatePath("/reports");
  redirect(reportPath({ statement: statementId, auto_matched: String(matchedCount) }));
}

export async function matchBankLine(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const sourceToken = textValue(formData, "sourceToken");
  const [sourceType, sourceId] = sourceToken.split(":");
  if (
    !lineId ||
    !sourceId ||
    !bankSourceTypes.includes(sourceType as BankSourceType)
  ) {
    redirect(reportPath({ error: "match_details" }));
  }

  const [{ data: line }, candidates, { data: lineMatches }, { data: sourceMatches }] = await Promise.all([
    supabase.from("bank_statement_lines").select("id, statement_import_id, amount, status").eq("id", lineId).single(),
    getBankCandidates(supabase, company.id),
    supabase.from("bank_reconciliation_matches").select("matched_amount").eq("statement_line_id", lineId),
    supabase.from("bank_reconciliation_matches").select("matched_amount").eq("source_type", sourceType).eq("source_id", sourceId),
  ]);
  const candidate = candidates.find((item) => item.sourceType === sourceType && item.sourceId === sourceId);
  if (!line || !candidate || line.status === "ignored") redirect(reportPath({ error: "match_missing" }));
  const lineMatched = (lineMatches ?? []).reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
  const sourceMatched = (sourceMatches ?? []).reduce((total, match) => total + Math.abs(Number(match.matched_amount ?? 0)), 0);
  const lineRemaining = Number(line.amount) - lineMatched;
  const sourceRemaining = Math.abs(candidate.amount) - sourceMatched;
  if (Math.sign(lineRemaining) !== Math.sign(candidate.amount) || sourceRemaining <= 0.005) {
    redirect(reportPath({ error: "match_direction" }));
  }
  const matchedAmount = Math.sign(lineRemaining) * Math.min(Math.abs(lineRemaining), sourceRemaining);
  const { error } = await supabase.from("bank_reconciliation_matches").insert({
    statement_line_id: line.id,
    source_type: sourceType,
    source_id: sourceId,
    matched_amount: matchedAmount,
    match_method: Math.abs(matchedAmount - lineRemaining) < 0.005 ? "manual" : "split",
    created_by: user.id,
  });
  if (error) redirect(reportPath({ statement: line.statement_import_id, error: "match_create" }));
  await refreshLineStatus(supabase, line.id);
  revalidatePath("/reports");
  redirect(reportPath({ statement: line.statement_import_id, matched: "1" }));
}

export async function unmatchBankLine(formData: FormData) {
  const { supabase } = await accountingContext();
  const matchId = textValue(formData, "matchId");
  const { data: match } = await supabase
    .from("bank_reconciliation_matches")
    .select("id, statement_line_id, bank_statement_lines(statement_import_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) redirect(reportPath({ error: "unmatch_missing" }));
  const { error } = await supabase.from("bank_reconciliation_matches").delete().eq("id", match.id);
  if (error) redirect(reportPath({ error: "unmatch_failed" }));
  await refreshLineStatus(supabase, match.statement_line_id);
  const relation = match.bank_statement_lines;
  const line = Array.isArray(relation) ? relation[0] : relation;
  revalidatePath("/reports");
  redirect(reportPath({ statement: line?.statement_import_id ?? "", unmatched: "1" }));
}

export async function createBankAdjustment(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const accountId = textValue(formData, "accountId");
  const description = textValue(formData, "description");
  const [{ data: line }, { data: matches }, { data: account }] = await Promise.all([
    supabase.from("bank_statement_lines").select("id, bank_account_id, statement_import_id, transaction_date, reference_number, amount, status").eq("id", lineId).single(),
    supabase.from("bank_reconciliation_matches").select("matched_amount").eq("statement_line_id", lineId),
    supabase.from("accounting_accounts").select("id, account_type").eq("id", accountId).eq("company_id", company.id).maybeSingle(),
  ]);
  if (!line || !account || !description || !["income", "expense"].includes(account.account_type)) {
    redirect(reportPath({ error: "adjustment_details" }));
  }
  const matched = (matches ?? []).reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
  const remaining = Number(line.amount) - matched;
  if (Math.abs(remaining) < 0.005) redirect(reportPath({ statement: line.statement_import_id, error: "line_complete" }));
  const { data: transaction, error: transactionError } = await supabase
    .from("bank_manual_transactions")
    .insert({
      company_id: company.id,
      bank_account_id: line.bank_account_id,
      offset_account_id: account.id,
      transaction_date: line.transaction_date,
      amount: remaining,
      description,
      reference_number: line.reference_number,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (transactionError || !transaction) redirect(reportPath({ error: "adjustment_create" }));
  const { error } = await supabase.from("bank_reconciliation_matches").insert({
    statement_line_id: line.id,
    source_type: "manual_bank_transaction",
    source_id: transaction.id,
    matched_amount: remaining,
    match_method: "adjustment",
    created_by: user.id,
  });
  if (error) redirect(reportPath({ error: "adjustment_match" }));
  await refreshLineStatus(supabase, line.id);
  revalidatePath("/reports");
  redirect(reportPath({ statement: line.statement_import_id, adjusted: "1" }));
}

export async function ignoreBankLine(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const reason = textValue(formData, "reason");
  const { data: line } = await supabase
    .from("bank_statement_lines")
    .select("id, statement_import_id, bank_statement_imports!inner(company_id, status)")
    .eq("id", lineId)
    .maybeSingle();
  const statementRelation = line?.bank_statement_imports;
  const statement = Array.isArray(statementRelation)
    ? statementRelation[0]
    : statementRelation;
  if (
    !line ||
    statement?.company_id !== company.id ||
    statement?.status !== "in_progress" ||
    !reason
  ) {
    redirect(reportPath({ error: "ignore_details" }));
  }
  const { count } = await supabase
    .from("bank_reconciliation_matches")
    .select("id", { count: "exact", head: true })
    .eq("statement_line_id", line.id);
  if (count) {
    redirect(reportPath({ statement: line.statement_import_id, error: "ignore_matched" }));
  }
  const { error } = await supabase
    .from("bank_statement_lines")
    .update({ status: "ignored", ignored_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", line.id)
    .eq("status", "unmatched");
  if (error) {
    redirect(reportPath({ statement: line.statement_import_id, error: "ignore_failed" }));
  }
  await supabase.from("accounting_audit_logs").insert({
    company_id: company.id,
    entity_type: "bank_statement_line",
    entity_id: line.id,
    action: "ignore_bank_statement_line",
    reason,
    performed_by: user.id,
  });
  revalidatePath("/reports");
  redirect(reportPath({ statement: line.statement_import_id, ignored: "1" }));
}

export async function createTenantPaymentFromBankLine(formData: FormData) {
  const { user, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const rentBillId = textValue(formData, "rentBillId");
  const { error } = await supabase.rpc("record_bank_tenant_payment_and_match", {
    target_statement_line_id: lineId,
    target_rent_bill_id: rentBillId,
    rental_allocation: numberValue(formData, "rentalAmount"),
    deposit_allocation: numberValue(formData, "depositAmount"),
    other_allocation: numberValue(formData, "otherAmount"),
    other_category: textValue(formData, "otherCategory") || "other",
    other_description: textValue(formData, "otherDescription") || null,
    actor_id: user.id,
  });
  if (error) redirect(reportPath({ error: "tenant_payment_match" }));
  revalidatePath("/reports");
  revalidatePath("/payments");
  revalidatePath("/rent-due-tracker");
  revalidatePath("/dashboard");
  redirect(reportPath({ payment_matched: "1" }));
}

export async function finalizeBankReconciliation(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const statementId = textValue(formData, "statementId");
  const [{ data: statementImport }, { data: lines }] = await Promise.all([
    supabase.from("bank_statement_imports").select("id, opening_balance, closing_balance, status").eq("id", statementId).eq("company_id", company.id).single(),
    supabase.from("bank_statement_lines").select("id, amount, status").eq("statement_import_id", statementId),
  ]);
  if (!statementImport || statementImport.status !== "in_progress") redirect(reportPath({ error: "statement_closed" }));
  if ((lines ?? []).some((line) => !["matched", "adjusted", "ignored"].includes(line.status))) {
    redirect(reportPath({ statement: statementId, error: "statement_unmatched" }));
  }
  const movement = (lines ?? []).reduce((total, line) => total + Number(line.amount ?? 0), 0);
  const calculatedClosing = Number(statementImport.opening_balance) + movement;
  if (Math.abs(calculatedClosing - Number(statementImport.closing_balance)) > 0.005) {
    redirect(reportPath({ statement: statementId, error: "statement_balance" }));
  }
  const { error } = await supabase
    .from("bank_statement_imports")
    .update({ status: "reconciled", reconciled_by: user.id, reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", statementId)
    .eq("status", "in_progress");
  if (error) redirect(reportPath({ statement: statementId, error: "statement_finalize" }));
  revalidatePath("/reports");
  redirect(reportPath({ statement: statementId, reconciled: "1" }));
}
