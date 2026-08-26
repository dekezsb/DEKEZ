"use server";

import { createHash } from "node:crypto";
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
import { bankDescriptionKey } from "@/lib/accounting/bank-description";
import { recurringDescriptionForMonth } from "@/lib/accounting/recurring-description";
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

function accountingTabPath(tab: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams({ tab, ...params });
  return `/reports?${search.toString()}`;
}

function bankFlowValue(formData: FormData, fallback: "credit" | "debit" = "credit") {
  const value = textValue(formData, "bankFlow");
  return value === "credit" || value === "debit" ? value : fallback;
}

function bankActionPath(
  formData: FormData,
  params: Record<string, string>,
  fallback: "credit" | "debit" = "credit",
) {
  return reportPath({ bankFlow: bankFlowValue(formData, fallback), ...params });
}

function statementImportPath(params: Record<string, string>) {
  return `${reportPath(params)}#bank-import`;
}

function bankLocationToken(value: string) {
  const match = value.toUpperCase().match(/\b(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*(?:ROOM\s*)?([A-Z]?\d+)\b/);
  return match ? `${match[1]}:${match[2].replace(/^0+/, "") || "0"}` : null;
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

const accountingReportGroups = {
  asset: ["current_asset", "non_current_asset"],
  liability: ["current_liability", "non_current_liability"],
  equity: ["equity"],
  income: ["revenue", "other_income"],
  expense: ["cost_of_sales", "operating_expense", "other_expense"],
} as const;

function normalBalanceForAccountType(accountType: string) {
  return accountType === "asset" || accountType === "expense" ? "debit" : "credit";
}

export async function createAccountingAccount(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const code = textValue(formData, "code");
  const name = textValue(formData, "name");
  const [accountTypeValue, reportGroup = ""] = textValue(formData, "classification").split(":");
  const accountType = accountTypeValue as keyof typeof accountingReportGroups;
  const description = textValue(formData, "description");
  const allowedGroups = accountingReportGroups[accountType] as readonly string[] | undefined;

  if (
    !/^\d{4,6}$/.test(code) ||
    name.length < 2 ||
    name.length > 100 ||
    description.length > 500 ||
    !allowedGroups?.includes(reportGroup)
  ) {
    redirect(accountingTabPath("ledger", { error: "account_details" }));
  }

  const { data: account, error } = await supabase
    .from("accounting_accounts")
    .insert({
      company_id: company.id,
      code,
      name,
      account_type: accountType,
      report_group: reportGroup,
      normal_balance: normalBalanceForAccountType(accountType),
      description: description || null,
      is_system: false,
      sort_order: Number(code),
    })
    .select("id, code, name, account_type, report_group, normal_balance, description, is_system")
    .single();

  if (error || !account) {
    const errorCode = error?.code === "23505" ? "account_duplicate" : "account_create";
    redirect(accountingTabPath("ledger", { error: errorCode }));
  }

  await supabase.from("accounting_audit_logs").insert({
    company_id: company.id,
    entity_type: "accounting_account",
    entity_id: account.id,
    action: "created",
    after_data: account,
    reason: "Created from Chart of Accounts",
    performed_by: user.id,
  });

  revalidatePath("/reports");
  redirect(accountingTabPath("ledger", { account_created: account.id }));
}

export async function updateAccountingAccountWording(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const accountId = textValue(formData, "accountId");
  const name = textValue(formData, "name");
  const description = textValue(formData, "description");

  if (!accountId || name.length < 2 || name.length > 100 || description.length > 500) {
    redirect(accountingTabPath("ledger", { error: "account_wording" }));
  }

  const { data: beforeAccount } = await supabase
    .from("accounting_accounts")
    .select("id, code, name, account_type, report_group, normal_balance, description, is_system")
    .eq("id", accountId)
    .eq("company_id", company.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!beforeAccount) redirect(accountingTabPath("ledger", { error: "account_missing" }));

  const { data: account, error } = await supabase
    .from("accounting_accounts")
    .update({ name, description: description || null, updated_at: new Date().toISOString() })
    .eq("id", beforeAccount.id)
    .eq("company_id", company.id)
    .select("id, code, name, account_type, report_group, normal_balance, description, is_system")
    .single();

  if (error || !account) redirect(accountingTabPath("ledger", { error: "account_update" }));

  await supabase.from("accounting_audit_logs").insert({
    company_id: company.id,
    entity_type: "accounting_account",
    entity_id: account.id,
    action: "wording_updated",
    before_data: beforeAccount,
    after_data: account,
    reason: "Updated from Chart of Accounts",
    performed_by: user.id,
  });

  revalidatePath("/reports");
  redirect(accountingTabPath("ledger", { account_updated: account.id }));
}

export async function postManualJournalEntry(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const entryDate = textValue(formData, "entryDate");
  const referenceNumber = textValue(formData, "referenceNumber");
  const description = textValue(formData, "description");
  const linesJson = textValue(formData, "linesJson");
  let lines: Array<{
    account_id?: string;
    property_id?: string | null;
    description?: string | null;
    debit?: number;
    credit?: number;
  }> = [];
  try {
    const parsed = JSON.parse(linesJson);
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    redirect(accountingTabPath("journal", { error: "journal_lines" }));
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || !description || lines.length < 2 || lines.length > 100) {
    redirect(accountingTabPath("journal", { error: "journal_details" }));
  }
  const normalizedLines = lines.map((line) => ({
    account_id: String(line.account_id ?? ""),
    property_id: line.property_id ? String(line.property_id) : null,
    description: line.description ? String(line.description).slice(0, 300) : null,
    debit: Math.max(Number(line.debit) || 0, 0),
    credit: Math.max(Number(line.credit) || 0, 0),
  }));
  const validLines = normalizedLines.every((line) =>
    line.account_id && ((line.debit > 0 && line.credit === 0) || (line.credit > 0 && line.debit === 0)),
  );
  const debitTotal = normalizedLines.reduce((total, line) => total + line.debit, 0);
  const creditTotal = normalizedLines.reduce((total, line) => total + line.credit, 0);
  if (!validLines || debitTotal <= 0 || Math.abs(debitTotal - creditTotal) > 0.005) {
    redirect(accountingTabPath("journal", { error: "journal_balance" }));
  }

  const { data: entryId, error } = await supabase.rpc("post_manual_journal_entry", {
    target_company_id: company.id,
    target_entry_date: entryDate,
    target_reference_number: referenceNumber || null,
    target_description: description,
    target_lines: normalizedLines,
    target_created_by: user.id,
  });
  if (error || !entryId) {
    console.error("[accounting] manual journal post failed", {
      code: error?.code,
      message: error?.message,
    });
    const errorCode = error?.message?.includes("journal_period_locked")
      ? "journal_period"
      : error?.message?.includes("journal_not_balanced")
        ? "journal_balance"
        : "journal_post";
    redirect(accountingTabPath("journal", { error: errorCode }));
  }

  revalidatePath("/reports");
  redirect(accountingTabPath("journal", { journal_posted: String(entryId) }));
}

export async function createBankAccount(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const name = textValue(formData, "name");
  const bankName = textValue(formData, "bankName");
  const accountKind = textValue(formData, "accountKind") || "bank";
  const accountNumber = textValue(formData, "accountNumber").replace(/\D/g, "");
  const last4 = accountNumber.slice(-4);
  const openingBalance = numberValue(formData, "openingBalance");
  const openingBalanceDate = textValue(formData, "openingBalanceDate") || null;

  if (
    !name ||
    !bankName ||
    !["bank", "prepaid_card", "company_card"].includes(accountKind) ||
    accountNumber.length < 6 ||
    accountNumber.length > 30
  ) {
    redirect(reportPath({ error: "bank_account_details" }));
  }

  const isLiabilityCard = accountKind === "company_card";
  const codeFloor = isLiabilityCard ? 2400 : 1010;
  const codeCeiling = isLiabilityCard ? 2499 : 1099;
  const { data: existingAccounts } = await supabase
    .from("accounting_accounts")
    .select("code")
    .eq("company_id", company.id)
    .gte("code", String(codeFloor))
    .lte("code", String(codeCeiling));
  const nextCode = String(
    Math.max(codeFloor, ...(existingAccounts ?? []).map((account) => Number(account.code) || codeFloor)) + 1,
  );
  const { data: ledgerAccount, error: ledgerError } = await supabase
    .from("accounting_accounts")
    .insert({
      company_id: company.id,
      code: nextCode,
      name,
      account_type: isLiabilityCard ? "liability" : "asset",
      report_group: isLiabilityCard ? "current_liability" : "current_asset",
      normal_balance: isLiabilityCard ? "credit" : "debit",
      description: `${bankName} ${accountKind === "company_card" ? "company credit card payable" : accountKind === "prepaid_card" ? "prepaid top-up card asset" : "bank account"}`,
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
    redirect(statementImportPath({ error: "statement_details" }));
  }
  if (statement.size > 10 * 1024 * 1024 || !/\.csv$/i.test(statement.name)) {
    redirect(statementImportPath({ error: "statement_csv" }));
  }

  const { data: bankAccount } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("id", bankAccountId)
    .eq("company_id", company.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!bankAccount) redirect(statementImportPath({ error: "bank_account_missing" }));

  const bytes = Buffer.from(await statement.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const { data: existingImport } = await supabase
    .from("bank_statement_imports")
    .select("id")
    .eq("bank_account_id", bankAccountId)
    .eq("original_file_hash", fileHash)
    .neq("status", "void")
    .maybeSingle();
  if (existingImport) {
    redirect(reportPath({ statement: existingImport.id, error: "statement_duplicate" }));
  }

  let parsedLines;
  try {
    parsedLines = parseBankStatementCsv(bytes.toString("utf8"));
  } catch (error) {
    console.error("[bank-statement] parse failed", {
      bankAccountId,
      fileName: statement.name,
      fileSize: statement.size,
      reason: error instanceof Error ? error.message : "unknown",
    });
    redirect(statementImportPath({ error: "statement_format" }));
  }
  if (!parsedLines.length) redirect(statementImportPath({ error: "statement_empty" }));

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
      original_file_hash: fileHash,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (importError || !statementImport) {
    console.error("[bank-statement] import header failed", {
      bankAccountId,
      fileName: statement.name,
      code: importError?.code,
      message: importError?.message,
    });
    if (importError?.code === "23505") {
      const { data: duplicate } = await supabase
        .from("bank_statement_imports")
        .select("id")
        .eq("bank_account_id", bankAccountId)
        .eq("original_file_hash", fileHash)
        .neq("status", "void")
        .maybeSingle();
      if (duplicate) redirect(reportPath({ statement: duplicate.id, error: "statement_duplicate" }));
    }
    redirect(statementImportPath({ error: "statement_create" }));
  }

  const safeName = statement.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = `${company.id}/${bankAccountId}/${statementImport.id}/${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("accounting-documents")
    .upload(filePath, bytes, { contentType: statement.type || "text/csv", upsert: false });
  if (uploadError) {
    console.error("[bank-statement] source upload failed", {
      statementImportId: statementImport.id,
      code: uploadError.name,
      message: uploadError.message,
    });
    await supabase.from("bank_statement_imports").delete().eq("id", statementImport.id);
    redirect(statementImportPath({ error: "statement_upload" }));
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
  if (updateError || linesError) {
    console.error("[bank-statement] line import failed", {
      statementImportId: statementImport.id,
      updateError: updateError?.message,
      linesError: linesError?.message,
      parsedLineCount: parsedLines.length,
    });
    redirect(statementImportPath({ error: "statement_lines" }));
  }

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

function uniqueFormIds(formData: FormData, key: string) {
  return [
    ...new Set(
      formData
        .getAll(key)
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value),
        ),
    ),
  ];
}

function singleRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function retainedStatementManifest({
  bucket,
  companyId,
  line,
  path,
  selectedIds,
  sourceType,
  statement,
  supabase,
}: {
  bucket: "expense-payment-proofs" | "reimbursement-proofs";
  companyId: string;
  line: {
    id: string;
    transaction_date: string;
    amount: number | string;
    description: string;
    reference_number: string | null;
  };
  path: string;
  selectedIds: string[];
  sourceType: "company_expense_batch" | "staff_reimbursement_payout";
  statement: {
    id: string;
    original_bucket_name: string;
    original_file_path: string | null;
    original_file_name: string | null;
  };
  supabase: ReturnType<typeof createAdminClient>;
}) {
  const manifest = Buffer.from(
    JSON.stringify(
      {
        audit_type: sourceType,
        company_id: companyId,
        statement_import_id: statement.id,
        statement_source: {
          bucket: statement.original_bucket_name,
          path: statement.original_file_path,
          file_name: statement.original_file_name,
        },
        statement_line: {
          id: line.id,
          date: line.transaction_date,
          amount: Number(line.amount),
          description: line.description,
          reference: line.reference_number,
        },
        selected_record_ids: selectedIds,
        retained_at: new Date().toISOString(),
        note: "The original imported statement and every selected receipt remain retained in DEKEZ.",
      },
      null,
      2,
    ),
    "utf8",
  );
  return supabase.storage.from(bucket).upload(path, manifest, {
    contentType: "application/json",
    upsert: false,
  });
}

async function loadOpenBankLine(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string,
  lineId: string,
) {
  const [{ data: line }, { data: matches }] = await Promise.all([
    supabase
      .from("bank_statement_lines")
      .select(
        "id, statement_import_id, transaction_date, amount, description, reference_number, status, bank_statement_imports!inner(id, company_id, status, original_bucket_name, original_file_path, original_file_name)",
      )
      .eq("id", lineId)
      .maybeSingle(),
    supabase
      .from("bank_reconciliation_matches")
      .select("matched_amount")
      .eq("statement_line_id", lineId),
  ]);
  const statement = singleRelation(line?.bank_statement_imports);
  const matched = (matches ?? []).reduce(
    (total, match) => total + Number(match.matched_amount ?? 0),
    0,
  );
  const remaining = Number(line?.amount ?? 0) - matched;
  if (
    !line ||
    !statement ||
    statement.company_id !== companyId ||
    statement.status !== "in_progress" ||
    line.status === "ignored" ||
    remaining >= -0.005
  ) {
    return null;
  }
  return { line, statement, remaining };
}

export async function reconcileCompanyExpenseBatchFromBankLine(
  formData: FormData,
) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const paymentMethod = textValue(formData, "paymentMethod");
  const expenseIds = uniqueFormIds(formData, "expenseIds");
  if (
    !lineId ||
    !expenseIds.length ||
    !["company_bank", "company_card"].includes(paymentMethod)
  ) {
    redirect(bankActionPath(formData, { error: "expense_batch_details" }, "debit"));
  }

  const context = await loadOpenBankLine(supabase, company.id, lineId);
  if (!context) redirect(bankActionPath(formData, { error: "expense_batch_line" }, "debit"));
  const { line, statement, remaining } = context;
  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, amount")
    .in("id", expenseIds)
    .eq("company_id", company.id)
    .eq("status", "verified")
    .eq("payment_status", "unpaid")
    .in("funding_source", ["company_cash", "company_bank"]);
  const selectedTotal = (expenses ?? []).reduce(
    (total, expense) => total + Number(expense.amount ?? 0),
    0,
  );
  if (
    (expenses ?? []).length !== expenseIds.length ||
    Math.abs(selectedTotal - Math.abs(remaining)) > 0.005
  ) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "expense_batch_total",
      }),
    );
  }

  const proofPath = `${company.id}/bank-reconciliation/${line.id}/${Date.now()}-expense-batch.json`;
  const { error: proofError } = await retainedStatementManifest({
    bucket: "expense-payment-proofs",
    companyId: company.id,
    line,
    path: proofPath,
    selectedIds: expenseIds,
    sourceType: "company_expense_batch",
    statement,
    supabase,
  });
  if (proofError) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "expense_batch_proof",
      }),
    );
  }

  const { data: batchId, error: batchError } = await supabase.rpc(
    "record_expense_payment_batch",
    {
      target_expense_ids: expenseIds,
      batch_payment_method: paymentMethod,
      batch_paid_on: line.transaction_date,
      batch_reference: line.reference_number || `BANK-${line.id.slice(0, 8)}`,
      batch_notes: `Created from bank reconciliation. Statement line: ${line.description}`,
      batch_proof_bucket: "expense-payment-proofs",
      batch_proof_path: proofPath,
      batch_proof_file_name: `statement-line-${line.id}.json`,
      batch_proof_content_type: "application/json",
      batch_recorded_by: user.id,
    },
  );
  if (batchError || !batchId) {
    await supabase.storage.from("expense-payment-proofs").remove([proofPath]);
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "expense_batch_create",
      }),
    );
  }

  const { error: matchError } = await supabase
    .from("bank_reconciliation_matches")
    .insert({
      statement_line_id: line.id,
      source_type: "expense_payment_batch",
      source_id: batchId,
      matched_amount: remaining,
      match_method: expenseIds.length > 1 ? "merge" : "manual",
      created_by: user.id,
    });
  if (matchError) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "expense_batch_match",
      }),
    );
  }
  await supabase.from("accounting_audit_logs").insert({
    company_id: company.id,
    entity_type: "bank_statement_line",
    entity_id: line.id,
    action: "reconcile_multiple_expense_receipts",
    after_data: {
      expense_payment_batch_id: batchId,
      expense_ids: expenseIds,
      payment_method: paymentMethod,
      amount: Math.abs(remaining),
    },
    reason: "One bank/card statement payment settled multiple retained expense receipts.",
    performed_by: user.id,
  });
  await refreshLineStatus(supabase, line.id);
  revalidatePath("/reports");
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  redirect(
    bankActionPath(formData, {
      statement: line.statement_import_id,
      expense_batch_reconciled: String(expenseIds.length),
    }),
  );
}

export async function reconcilePaidCompanyExpensesFromBankLine(
  formData: FormData,
) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const expenseIds = uniqueFormIds(formData, "expenseIds");
  if (!lineId || !expenseIds.length) {
    redirect(bankActionPath(formData, { error: "paid_receipts_details" }, "debit"));
  }

  const context = await loadOpenBankLine(supabase, company.id, lineId);
  if (!context) redirect(bankActionPath(formData, { error: "paid_receipts_line" }, "debit"));
  const { line, remaining } = context;
  const [{ data: expenses }, { data: existingMatches }, { data: allocations }] =
    await Promise.all([
      supabase
        .from("expenses")
        .select("id, amount")
        .in("id", expenseIds)
        .eq("company_id", company.id)
        .eq("funding_source", "company_bank")
        .eq("payment_status", "paid")
        .in("status", ["verified", "reimbursed"]),
      supabase
        .from("bank_reconciliation_matches")
        .select("source_id, matched_amount")
        .eq("source_type", "expense")
        .in("source_id", expenseIds),
      supabase
        .from("expense_payment_allocations")
        .select("expense_id")
        .in("expense_id", expenseIds),
    ]);
  const alreadyMatched = new Map<string, number>();
  for (const match of existingMatches ?? []) {
    alreadyMatched.set(
      match.source_id,
      (alreadyMatched.get(match.source_id) ?? 0) +
        Math.abs(Number(match.matched_amount ?? 0)),
    );
  }
  const allocatedIds = new Set((allocations ?? []).map((item) => item.expense_id));
  const selectedTotal = (expenses ?? []).reduce(
    (total, expense) => total + Number(expense.amount ?? 0),
    0,
  );
  const hasPreviouslyUsedReceipt = (expenses ?? []).some(
    (expense) =>
      allocatedIds.has(expense.id) ||
      (alreadyMatched.get(expense.id) ?? 0) > 0.005,
  );
  if (
    (expenses ?? []).length !== expenseIds.length ||
    hasPreviouslyUsedReceipt ||
    Math.abs(selectedTotal - Math.abs(remaining)) > 0.005
  ) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "paid_receipts_total",
      }),
    );
  }

  const { error: matchError } = await supabase
    .from("bank_reconciliation_matches")
    .insert(
      (expenses ?? []).map((expense) => ({
        statement_line_id: line.id,
        source_type: "expense",
        source_id: expense.id,
        matched_amount: -Math.abs(Number(expense.amount ?? 0)),
        match_method: expenseIds.length > 1 ? "merge" : "manual",
        created_by: user.id,
      })),
    );
  if (matchError) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "paid_receipts_match",
      }),
    );
  }
  await supabase.from("accounting_audit_logs").insert({
    company_id: company.id,
    entity_type: "bank_statement_line",
    entity_id: line.id,
    action: "match_multiple_paid_company_receipts",
    after_data: {
      expense_ids: expenseIds,
      amount: Math.abs(remaining),
    },
    reason:
      "One bank/company-card statement charge was matched to several existing expense receipts without reposting the expense.",
    performed_by: user.id,
  });
  await refreshLineStatus(supabase, line.id);
  revalidatePath("/reports");
  revalidatePath("/expenses");
  redirect(
    bankActionPath(formData, {
      statement: line.statement_import_id,
      paid_receipts_reconciled: String(expenseIds.length),
    }),
  );
}

export async function reconcileStaffPayoutFromBankLine(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const staffId = textValue(formData, "staffId");
  const liabilityIds = uniqueFormIds(formData, "liabilityIds");
  if (!lineId || !staffId || !liabilityIds.length) {
    redirect(bankActionPath(formData, { error: "staff_batch_details" }, "debit"));
  }

  const context = await loadOpenBankLine(supabase, company.id, lineId);
  if (!context) redirect(bankActionPath(formData, { error: "staff_batch_line" }, "debit"));
  const { line, statement, remaining } = context;
  const { data: liabilities } = await supabase
    .from("staff_reimbursement_liabilities")
    .select("id, expense_id, amount")
    .in("id", liabilityIds)
    .eq("staff_id", staffId)
    .eq("status", "owed")
    .is("payout_id", null);
  const expenseIds = (liabilities ?? []).map((item) => item.expense_id);
  const { data: companyExpenses } = expenseIds.length
    ? await supabase
        .from("expenses")
        .select("id")
        .in("id", expenseIds)
        .eq("company_id", company.id)
    : { data: [] };
  const selectedTotal = (liabilities ?? []).reduce(
    (total, liability) => total + Number(liability.amount ?? 0),
    0,
  );
  if (
    (liabilities ?? []).length !== liabilityIds.length ||
    (companyExpenses ?? []).length !== liabilityIds.length ||
    Math.abs(selectedTotal - Math.abs(remaining)) > 0.005
  ) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "staff_batch_total",
      }),
    );
  }

  const proofPath = `${staffId}/bank-reconciliation/${line.id}/${Date.now()}-staff-payout.json`;
  const { error: proofError } = await retainedStatementManifest({
    bucket: "reimbursement-proofs",
    companyId: company.id,
    line,
    path: proofPath,
    selectedIds: liabilityIds,
    sourceType: "staff_reimbursement_payout",
    statement,
    supabase,
  });
  if (proofError) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "staff_batch_proof",
      }),
    );
  }

  const { data: payoutId, error: payoutError } = await supabase.rpc(
    "record_staff_reimbursement_payout",
    {
      target_staff_id: staffId,
      liability_ids: liabilityIds,
      payout_source: "company_bank",
      payout_date: line.transaction_date,
      payout_reference: line.reference_number || `BANK-${line.id.slice(0, 8)}`,
      payout_notes: `Created from bank reconciliation. Statement line: ${line.description}`,
      payout_proof_bucket: "reimbursement-proofs",
      payout_proof_path: proofPath,
      payout_proof_content_type: "application/json",
      payout_recorded_by: user.id,
    },
  );
  if (payoutError || !payoutId) {
    await supabase.storage.from("reimbursement-proofs").remove([proofPath]);
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "staff_batch_create",
      }),
    );
  }

  const { error: matchError } = await supabase
    .from("bank_reconciliation_matches")
    .insert({
      statement_line_id: line.id,
      source_type: "staff_reimbursement_payout",
      source_id: payoutId,
      matched_amount: remaining,
      match_method: liabilityIds.length > 1 ? "merge" : "manual",
      created_by: user.id,
    });
  if (matchError) {
    redirect(
      bankActionPath(formData, {
        statement: line.statement_import_id,
        error: "staff_batch_match",
      }),
    );
  }
  await supabase.from("accounting_audit_logs").insert({
    company_id: company.id,
    entity_type: "bank_statement_line",
    entity_id: line.id,
    action: "reconcile_multiple_staff_claims",
    after_data: {
      staff_reimbursement_payout_id: payoutId,
      staff_id: staffId,
      liability_ids: liabilityIds,
      amount: Math.abs(remaining),
    },
    reason: "One bank transfer reimbursed multiple retained staff claim receipts.",
    performed_by: user.id,
  });
  await refreshLineStatus(supabase, line.id);
  revalidatePath("/reports");
  revalidatePath("/expenses");
  revalidatePath("/claims");
  revalidatePath("/dashboard");
  redirect(
    bankActionPath(formData, {
      statement: line.statement_import_id,
      staff_batch_reconciled: String(liabilityIds.length),
    }),
  );
}

export async function autoMatchStatement(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const statementId = textValue(formData, "statementId");
  const bankFlow = bankFlowValue(formData);
  const [{ data: statementImport }, { data: lines }, { data: allMatches }, candidates] = await Promise.all([
    supabase.from("bank_statement_imports").select("id, period_start, period_end, status").eq("id", statementId).eq("company_id", company.id).maybeSingle(),
    supabase.from("bank_statement_lines").select("id, transaction_date, amount, description, reference_number, status").eq("statement_import_id", statementId).eq("status", "unmatched"),
    supabase.from("bank_reconciliation_matches").select("statement_line_id, source_type, source_id, matched_amount"),
    getBankCandidates(supabase, company.id),
  ]);
  if (!statementImport || statementImport.status !== "in_progress") {
    redirect(bankActionPath(formData, { error: "statement_closed" }));
  }

  const consumed = new Map<string, number>();
  for (const match of allMatches ?? []) {
    const key = `${match.source_type}:${match.source_id}`;
    consumed.set(key, (consumed.get(key) ?? 0) + Math.abs(Number(match.matched_amount ?? 0)));
  }
  let matchedCount = 0;
  const statementRentalMonth = statementImport.period_start.slice(0, 7);

  for (const line of (lines ?? []).filter((item) =>
    bankFlow === "credit" ? Number(item.amount) > 0 : Number(item.amount) < 0,
  )) {
    const amount = Number(line.amount);
    const available = candidates.filter((candidate) => {
      const key = `${candidate.sourceType}:${candidate.sourceId}`;
      const remaining = Math.abs(candidate.amount) - (consumed.get(key) ?? 0);
      const sameHistoricalRoom = candidate.sourceType === "rent_bill"
        && line.transaction_date.slice(0, 7) === candidate.date.slice(0, 7)
        && bankLocationToken(line.description) !== null
        && bankLocationToken(line.description) === bankLocationToken(candidate.description);
      const correctRentalMonth = !candidate.isRental
        || candidate.invoiceMonth?.slice(0, 7) === statementRentalMonth;
      const lineLocation = bankLocationToken(line.description);
      const candidateLocation = bankLocationToken(candidate.description);
      const correctRentalLocation = !candidate.isRental
        || !lineLocation
        || candidateLocation === lineLocation;
      return (
        Math.sign(candidate.amount) === Math.sign(amount) &&
        Math.abs(remaining - Math.abs(amount)) < 0.005 &&
        correctRentalMonth &&
        candidate.date.slice(0, 7) === statementRentalMonth &&
        correctRentalLocation &&
        (dateDistance(candidate.date, line.transaction_date) <= 3 || sameHistoricalRoom)
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
  redirect(bankActionPath(formData, { statement: statementId, auto_matched: String(matchedCount) }));
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
    redirect(bankActionPath(formData, { error: "match_details" }));
  }

  const [{ data: line }, candidates, { data: lineMatches }, { data: sourceMatches }] = await Promise.all([
    supabase.from("bank_statement_lines").select("id, bank_account_id, statement_import_id, transaction_date, description, reference_number, amount, status, bank_statement_imports!inner(company_id, period_start, status)").eq("id", lineId).single(),
    getBankCandidates(supabase, company.id),
    supabase.from("bank_reconciliation_matches").select("matched_amount").eq("statement_line_id", lineId),
    supabase.from("bank_reconciliation_matches").select("matched_amount").eq("source_type", sourceType).eq("source_id", sourceId),
  ]);
  const lineMatched = (lineMatches ?? []).reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
  const lineRemaining = Number(line?.amount ?? 0) - lineMatched;
  if (line && Math.abs(lineRemaining) < 0.005) {
    await refreshLineStatus(supabase, line.id);
    revalidatePath("/reports");
    redirect(bankActionPath(formData, { statement: line.statement_import_id, already_reconciled: "1" }));
  }
  const candidate = candidates.find((item) => item.sourceType === sourceType && item.sourceId === sourceId);
  if (!line || !candidate || line.status === "ignored") redirect(bankActionPath(formData, { error: "match_missing" }));
  const statement = singleRelation(line.bank_statement_imports);
  const statementRentalMonth = statement?.period_start?.slice(0, 7);
  if (
    !statement ||
    statement.company_id !== company.id ||
    statement.status !== "in_progress" ||
    (candidate.isRental && candidate.invoiceMonth?.slice(0, 7) !== statementRentalMonth)
  ) {
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "match_rental_month" }));
  }
  const sourceMatched = (sourceMatches ?? []).reduce((total, match) => total + Math.abs(Number(match.matched_amount ?? 0)), 0);
  const sourceRemaining = Math.abs(candidate.amount) - sourceMatched;
  if (Math.sign(lineRemaining) !== Math.sign(candidate.amount)) {
    redirect(bankActionPath(formData, { error: "match_direction" }));
  }
  const recurringManualTemplate = sourceType === "manual_bank_transaction"
    && candidate.date.slice(0, 7) !== statementRentalMonth;
  if (!recurringManualTemplate && candidate.date.slice(0, 7) !== statementRentalMonth) {
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "match_source_month" }));
  }
  const lineLocation = bankLocationToken(line.description);
  const candidateLocation = bankLocationToken(candidate.description);
  if (candidate.isRental && lineLocation && candidateLocation !== lineLocation) {
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "match_location" }));
  }
  if (recurringManualTemplate) {
    const { data: template } = await supabase
      .from("bank_manual_transactions")
      .select("id, company_id, bank_account_id, offset_account_id, property_id, transaction_date, amount, description")
      .eq("id", sourceId)
      .eq("company_id", company.id)
      .maybeSingle();
    const currentMonth = statement.period_start.slice(0, 7);
    const templateMonth = template?.transaction_date?.slice(0, 7);
    if (
      !template ||
      !template.offset_account_id ||
      template.bank_account_id !== line.bank_account_id ||
      templateMonth === currentMonth ||
      Math.sign(Number(template.amount)) !== Math.sign(lineRemaining)
    ) {
      redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "match_used" }));
    }

    const recurringAmount = Math.sign(lineRemaining) * Math.min(Math.abs(lineRemaining), Math.abs(Number(template.amount)));
    const recurringDescription = recurringDescriptionForMonth(template.description, currentMonth);
    const { data: recurringTransaction, error: recurringError } = await supabase
      .from("bank_manual_transactions")
      .insert({
        company_id: company.id,
        bank_account_id: line.bank_account_id,
        offset_account_id: template.offset_account_id,
        property_id: template.property_id,
        transaction_date: line.transaction_date,
        amount: recurringAmount,
        description: recurringDescription,
        reference_number: line.reference_number,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (recurringError || !recurringTransaction) {
      console.error("[accounting] recurring bank entry create failed", {
        code: recurringError?.code,
        message: recurringError?.message,
        lineId: line.id,
        templateId: template.id,
      });
      redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "recurring_create" }));
    }

    const { error: recurringMatchError } = await supabase.from("bank_reconciliation_matches").insert({
      statement_line_id: line.id,
      source_type: "manual_bank_transaction",
      source_id: recurringTransaction.id,
      matched_amount: recurringAmount,
      match_method: "adjustment",
      created_by: user.id,
    });
    if (recurringMatchError) {
      await supabase.from("bank_manual_transactions").delete().eq("id", recurringTransaction.id).eq("company_id", company.id);
      console.error("[accounting] recurring bank entry match failed", {
        code: recurringMatchError.code,
        message: recurringMatchError.message,
        lineId: line.id,
        transactionId: recurringTransaction.id,
      });
      redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "recurring_match" }));
    }

    const ruleKey = bankDescriptionKey(line.description);
    if (ruleKey) {
      await supabase.from("bank_reconciliation_rules").upsert({
        company_id: company.id,
        bank_account_id: line.bank_account_id,
        direction: recurringAmount > 0 ? "credit" : "debit",
        bank_description_key: ruleKey,
        accounting_account_id: template.offset_account_id,
        property_id: template.property_id,
        default_description: template.description,
        last_used_at: new Date().toISOString(),
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,bank_account_id,direction,bank_description_key" });
    }
    await supabase.from("accounting_audit_logs").insert({
      company_id: company.id,
      entity_type: "bank_manual_transaction",
      entity_id: recurringTransaction.id,
      action: "created_from_recurring_month",
      after_data: {
        statement_line_id: line.id,
        template_transaction_id: template.id,
        accounting_month: currentMonth,
        description: recurringDescription,
        amount: recurringAmount,
      },
      reason: `Created a separate ${currentMonth} entry from the earlier recurring pattern.`,
      performed_by: user.id,
    });
    await refreshLineStatus(supabase, line.id);
    revalidatePath("/reports");
    redirect(bankActionPath(formData, { statement: line.statement_import_id, recurring_matched: currentMonth }));
  }
  if (sourceRemaining <= 0.005) {
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "match_used" }));
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
  if (error) {
    console.error("[accounting] bank line match failed", {
      code: error.code,
      message: error.message,
      lineId: line.id,
      sourceType,
      sourceId,
    });
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "match_create" }));
  }
  await refreshLineStatus(supabase, line.id);
  revalidatePath("/reports");
  redirect(bankActionPath(formData, { statement: line.statement_import_id, matched: "1" }));
}

export async function matchOwnAccountTransfer(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const counterpartLineId = textValue(formData, "counterpartLineId");
  if (!lineId || !counterpartLineId || lineId === counterpartLineId) {
    redirect(bankActionPath(formData, { error: "bank_transfer_details" }));
  }

  const { data: transferId, error } = await supabase.rpc("match_bank_account_transfer", {
    target_company_id: company.id,
    target_line_id: lineId,
    target_counterpart_line_id: counterpartLineId,
    target_created_by: user.id,
  });
  if (error || !transferId) {
    const { data: currentLine } = await supabase
      .from("bank_statement_lines")
      .select("id, statement_import_id, status")
      .eq("id", lineId)
      .maybeSingle();
    if (currentLine && currentLine.status !== "unmatched") {
      revalidatePath("/reports");
      redirect(bankActionPath(formData, { statement: currentLine.statement_import_id, already_reconciled: "1" }));
    }
    console.error("[accounting] own-account transfer match failed", {
      code: error?.code,
      message: error?.message,
    });
    redirect(bankActionPath(formData, { error: "bank_transfer_match" }));
  }

  revalidatePath("/reports");
  redirect(bankActionPath(formData, { transfer_matched: "1" }));
}

export async function unmatchBankLine(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const matchId = textValue(formData, "matchId");
  const { data: match } = await supabase
    .from("bank_reconciliation_matches")
    .select("id, statement_line_id, source_type, source_id, bank_statement_lines(statement_import_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) redirect(bankActionPath(formData, { error: "unmatch_missing" }));
  if (match.source_type === "bank_account_transfer") {
    const { data: linkedMatches } = await supabase
      .from("bank_reconciliation_matches")
      .select("id, statement_line_id")
      .eq("source_type", "bank_account_transfer")
      .eq("source_id", match.source_id);
    const linkedLineIds = (linkedMatches ?? []).map((item) => item.statement_line_id);
    const { error: linkedDeleteError } = await supabase
      .from("bank_reconciliation_matches")
      .delete()
      .eq("source_type", "bank_account_transfer")
      .eq("source_id", match.source_id);
    if (linkedDeleteError) redirect(bankActionPath(formData, { error: "unmatch_failed" }));
    for (const linkedLineId of linkedLineIds) await refreshLineStatus(supabase, linkedLineId);
    await supabase.from("bank_account_transfers").delete().eq("id", match.source_id).eq("company_id", company.id);
    await supabase.from("accounting_audit_logs").insert({
      company_id: company.id,
      entity_type: "bank_account_transfer",
      entity_id: match.source_id,
      action: "unmatch_own_account_transfer",
      before_data: { statement_line_ids: linkedLineIds },
      reason: "Admin unlinked both sides of an own-account transfer for correction.",
      performed_by: user.id,
    });
    revalidatePath("/reports");
    redirect(bankActionPath(formData, { transfer_unmatched: "1" }));
  }
  const { error } = await supabase.from("bank_reconciliation_matches").delete().eq("id", match.id);
  if (error) redirect(bankActionPath(formData, { error: "unmatch_failed" }));
  await refreshLineStatus(supabase, match.statement_line_id);
  const relation = match.bank_statement_lines;
  const line = Array.isArray(relation) ? relation[0] : relation;
  revalidatePath("/reports");
  redirect(bankActionPath(formData, { statement: line?.statement_import_id ?? "", unmatched: "1" }));
}

export async function createBankAdjustment(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const accountId = textValue(formData, "accountId");
  const propertyId = textValue(formData, "propertyId") || null;
  const description = textValue(formData, "description");
  const rememberRule = textValue(formData, "rememberRule") === "1";
  const [{ data: line }, { data: matches }, { data: account }, { data: property }] = await Promise.all([
    supabase.from("bank_statement_lines").select("id, bank_account_id, statement_import_id, transaction_date, description, reference_number, amount, status").eq("id", lineId).single(),
    supabase.from("bank_reconciliation_matches").select("matched_amount").eq("statement_line_id", lineId),
    supabase.from("accounting_accounts").select("id, account_type, system_key").eq("id", accountId).eq("company_id", company.id).maybeSingle(),
    propertyId
      ? supabase.from("properties").select("id").eq("id", propertyId).eq("company_id", company.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!line || !account || !description || (propertyId && !property)) {
    redirect(bankActionPath(formData, { error: "adjustment_details" }));
  }
  if (account.system_key === "property_rental_cost" && !propertyId) {
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "adjustment_property" }));
  }
  const matched = (matches ?? []).reduce((total, match) => total + Number(match.matched_amount ?? 0), 0);
  const remaining = Number(line.amount) - matched;
  if (Math.abs(remaining) < 0.005) {
    await refreshLineStatus(supabase, line.id);
    revalidatePath("/reports");
    redirect(bankActionPath(formData, { statement: line.statement_import_id, already_reconciled: "1" }));
  }
  const { data: transaction, error: transactionError } = await supabase
    .from("bank_manual_transactions")
    .insert({
      company_id: company.id,
      bank_account_id: line.bank_account_id,
      offset_account_id: account.id,
      property_id: propertyId,
      transaction_date: line.transaction_date,
      amount: remaining,
      description,
      reference_number: line.reference_number,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (transactionError || !transaction) {
    console.error("[accounting] bank adjustment create failed", {
      code: transactionError?.code,
      message: transactionError?.message,
      lineId: line.id,
      accountId: account.id,
    });
    redirect(bankActionPath(formData, { error: "adjustment_create" }));
  }
  const { error } = await supabase.from("bank_reconciliation_matches").insert({
    statement_line_id: line.id,
    source_type: "manual_bank_transaction",
    source_id: transaction.id,
    matched_amount: remaining,
    match_method: "adjustment",
    created_by: user.id,
  });
  if (error) {
    console.error("[accounting] bank adjustment match failed", {
      code: error.code,
      message: error.message,
      lineId: line.id,
      transactionId: transaction.id,
    });
    redirect(bankActionPath(formData, { error: "adjustment_match" }));
  }
  const ruleKey = bankDescriptionKey(line.description);
  if (rememberRule && ruleKey) {
    await supabase.from("bank_reconciliation_rules").upsert({
      company_id: company.id,
      bank_account_id: line.bank_account_id,
      direction: remaining > 0 ? "credit" : "debit",
      bank_description_key: ruleKey,
      accounting_account_id: account.id,
      property_id: propertyId,
      default_description: description,
      last_used_at: new Date().toISOString(),
      created_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,bank_account_id,direction,bank_description_key" });
  }
  await refreshLineStatus(supabase, line.id);
  revalidatePath("/reports");
  redirect(bankActionPath(formData, { statement: line.statement_import_id, adjusted: "1" }));
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
    redirect(bankActionPath(formData, { error: "ignore_details" }));
  }
  const { count } = await supabase
    .from("bank_reconciliation_matches")
    .select("id", { count: "exact", head: true })
    .eq("statement_line_id", line.id);
  if (count) {
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "ignore_matched" }));
  }
  const { error } = await supabase
    .from("bank_statement_lines")
    .update({ status: "ignored", ignored_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", line.id)
    .eq("status", "unmatched");
  if (error) {
    redirect(bankActionPath(formData, { statement: line.statement_import_id, error: "ignore_failed" }));
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
  redirect(bankActionPath(formData, { statement: line.statement_import_id, ignored: "1" }));
}

export async function createTenantPaymentFromBankLine(formData: FormData) {
  const { user, company, supabase } = await accountingContext();
  const lineId = textValue(formData, "lineId");
  const rentBillId = textValue(formData, "rentBillId");
  const [{ data: line }, { data: rentBill }] = await Promise.all([
    supabase
      .from("bank_statement_lines")
      .select("id, statement_import_id, description, bank_statement_imports!inner(company_id, period_start, status)")
      .eq("id", lineId)
      .maybeSingle(),
    supabase
      .from("rent_bills")
      .select("id, bill_month, property_id, room_id, properties!inner(company_id, property_code), rooms!inner(name, room_number)")
      .eq("id", rentBillId)
      .maybeSingle(),
  ]);
  const statement = singleRelation(line?.bank_statement_imports);
  const property = singleRelation(rentBill?.properties);
  const room = singleRelation(rentBill?.rooms);
  const lineLocation = bankLocationToken(line?.description ?? "");
  const invoiceLocation = bankLocationToken(
    `${property?.property_code ?? ""} ${room?.name || room?.room_number || ""}`,
  );
  if (
    !line ||
    !rentBill ||
    !statement ||
    !property ||
    statement.company_id !== company.id ||
    property.company_id !== company.id ||
    statement.status !== "in_progress" ||
    rentBill.bill_month.slice(0, 7) !== statement.period_start.slice(0, 7) ||
    (lineLocation !== null && invoiceLocation !== lineLocation)
  ) {
    redirect(reportPath({ statement: line?.statement_import_id ?? "", error: "tenant_payment_month" }));
  }
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
