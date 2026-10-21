# September 2026 — fixed leftover credit exception

## Inspection before implementation

Read-only inspection on 22 October 2026 MYT found 37 canonical positive lines with RM10,944 remaining across the Public Bank September statement group. Money Out has no remaining work. Normal matching still uses identity/reference, duplicate, scope and candidate checks in `rankExistingPayments`, `directReconciliationPayment` and the reconciliation component; the existing historical SQL and `historicalStatementRange` deliberately end before September.

An initial one-payment/full-amount check found four existing payments. The complete grouped-receipt check supersedes that preliminary result:

| Treatment | Bank lines | Remaining bank amount |
| --- | ---: | ---: |
| New missing-offset classification to 1100 | 29 | RM6,700 |
| Existing confirmed accounting — no second posting | 8 | RM4,244 |
| Total unresolved bank queue | 37 | RM10,944 |

The eight include confirmed rent, security deposit, utility and damage records. Confirmed rent already affects invoice paid amounts/operational AR, and confirmed security deposit already feeds liability reporting, even without a journal. Some are grouped receipts or have different payment/bank dates, different totals or overlapping records. Consequently linking these records needs explicit direction; they must not receive another AR credit. Current implementation preserves them.

## Bounded implementation

- Private immutable `september_credit_cleanup_scope` contains only the 37 audited source IDs, with original snapshots and capped audited remaining amounts. Installing its migration captures scope only; it does not execute a financial cleanup.
- Completed sources at installation are not enrolled. New imports, backdated future imports, other bank accounts and previously completed transactions cannot enter this manifest.
- Separate preview/confirm RPCs reuse the existing immutable bank-offset table and report pipeline. March–August functions and future matching remain unchanged.
- Server actions derive company/actor from authenticated reports/manage context. Table/RPC access is service-only; application/service roles cannot enlarge or edit the manifest.
- Live status, allocations, existing recorded transfers, manual offsets, journals and confirmed payment groups are rechecked. Existing paid records are accounting evidence to preserve, not a prerequisite for unidentified lines.
- Missing tenant, invoice, receipt, room, code or confidence does not exclude a genuinely unresolved line.
- Same-run retries are idempotent; fresh snapshot hashes, current-period checks, advisory/table/row locks, unique source keys and source-immutability guards prevent a second posting or stale execution.
- Only new offset rows, their audit trail and positive source status are changed on confirmation. No new Bank, income, journal, invoice, payment or receipt is created.
- The existing completion/history code hides a month only when both sides have zero remaining work. Preserved unresolved-but-recorded sources are not silently marked completed; this version alone cannot reduce all 37 to zero.

## Verification and release boundary

Disposable PostgreSQL tests cover fixed scope, grouped receipts, partial allocations, stale previews, current-date locks, immutable history, role denial, idempotency, future imports and untouched debit/tenant/payment data. Existing March–August and report tests remain mandatory.

Management approved installing/deploying the control only and explicitly declined linking the four initially identified existing payments. All eight accounted bank lines remain protected. Executing the financial batch still requires confirmation of its fresh displayed preview.

The schema and frozen 37-source manifest are installed. The live read-only preview confirms 29 ready / RM6,700 and 8 preserved / RM4,244, with current allowed date 22 October 2026. Before/after September bank-line and reconciliation hashes agree exactly; journal/payment/classification counts remain 32 / 693 / 468. No financial execution or linking occurred.

All 328 release tests and the production build passed before deployment (294 release regressions, 28 historical SQL/report tests, 6 PDF tests). The database security advisor reports only the expected new informational notice for a private RLS table without browser policies; public/authenticated access is revoked and service access is SELECT-only. See [Supabase private-table policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
