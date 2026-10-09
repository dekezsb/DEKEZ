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

type GroupableStatement = {
  id: string; bank_account_id: string; period_start: string; period_end: string; status: string;
  merged_into_statement_id?: string | null; created_at?: string | null;
};
export type StatementGroup<T> = { key: string; root: T; statements: T[] };

// Display-only grouping: one chip per bank account and month. Linked statements
// follow their merged_into chain to its root; unlinked legacy statements group
// by the calendar month of period_end. No statement is changed or hidden.
export function groupStatements<T extends GroupableStatement>(statements: T[]): StatementGroup<T>[] {
  const byId = new Map(statements.map(statement => [statement.id, statement]));
  const chainRoot = (statement: T) => {
    const seen = new Set<string>();
    let current = statement;
    while (current.merged_into_statement_id && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.merged_into_statement_id);
      if (!parent) break; // Voided or out-of-scope parent: this statement stands alone.
      current = parent;
    }
    return current;
  };
  const groups = new Map<string, { key: string; roots: T[]; statements: T[] }>();
  for (const statement of statements) {
    const root = chainRoot(statement);
    const key = `${root.bank_account_id}:${root.period_end.slice(0, 7)}`;
    const group = groups.get(key) ?? { key, roots: [], statements: [] };
    group.statements.push(statement);
    if (root === statement) group.roots.push(statement);
    groups.set(key, group);
  }
  // The widest period is the month's statement; ties go to the latest upload.
  const widest = (left: T, right: T) => right.period_end.localeCompare(left.period_end)
    || left.period_start.localeCompare(right.period_start)
    || String(right.created_at ?? '').localeCompare(String(left.created_at ?? ''));
  return [...groups.values()]
    .map(group => ({ key: group.key, root: [...(group.roots.length ? group.roots : group.statements)].sort(widest)[0], statements: group.statements }))
    .sort((left, right) => widest(left.root, right.root) || left.key.localeCompare(right.key));
}

export function workingStatementGroups<T extends { id: string }>(groups: StatementGroup<T>[], workingIds: Set<string>) {
  return groups.filter(group => group.statements.some(statement => workingIds.has(statement.id)));
}

export function selectedStatementGroup<T extends { id: string }>(groups: StatementGroup<T>[], requested?: string) {
  return groups.find(group => group.statements.some(statement => statement.id === requested)) ?? groups[0] ?? null;
}

// A group is in progress while any of its statements still has open bank-line work.
export function statementGroupStatus<T extends { id: string; status: string }>(group: StatementGroup<T>, workingIds: Set<string>) {
  return group.statements.some(statement => workingIds.has(statement.id)) ? 'in_progress' : group.root.status;
}

// A transaction appears once per statement that contains it. Keep one row per
// transaction, preferring its original statement's row (is_reused = false).
export function dedupeStatementLines<T extends { id: string; is_reused: boolean | null }>(rows: T[]) {
  const byId = new Map<string, T>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || (existing.is_reused && !row.is_reused)) byId.set(row.id, row);
  }
  return [...byId.values()];
}
