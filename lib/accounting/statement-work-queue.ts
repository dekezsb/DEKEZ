import type { SupabaseClient } from '@supabase/supabase-js';
import { allReportRows } from './report-data';

// Workspace visibility is not statement finalisation. Never modify statement
// status, balances, matches or ledger records just to remove a finished card.
export async function loadWorkingStatementIds(db: SupabaseClient, companyId: string) {
  const result = await allReportRows(db.from('bank_statement_lines')
    .select('id,statement_import_id,bank_statement_imports!inner(company_id,status)')
    .eq('bank_statement_imports.company_id', companyId)
    .neq('bank_statement_imports.status', 'void')
    .not('status', 'in', '(matched,adjusted,ignored)')
    .neq('amount', 0));
  if (result.error) throw new Error('Unable to check remaining bank reconciliation work. Please retry; completed statements have not been assumed.');
  return new Set(result.data.map(line => line.statement_import_id));
}

export function workingStatements<T extends { id: string }>(statements: T[], workingIds: Set<string>) {
  return statements.filter(statement => workingIds.has(statement.id));
}

export function selectedWorkingStatement<T extends { id: string }>(statements: T[], requested?: string) {
  return statements.find(statement => statement.id === requested) ?? statements[0] ?? null;
}
