# Verified-payment reconciliation (standing SOP)

This accounting stage only allocates money from bank statements to existing verified payment records. It does not verify the invoice, create a payment, charge electricity, change tenant outstanding or post AR again.

- Payment remaining = verified amount − reconciled amount.
- Bank remaining = original bank amount − allocated amount.
- Each Reconcile click allocates MIN(payment remaining, bank remaining).
- A verified RM480 payment + RM300 bank leaves RM180 payment remaining.
- A RM500 bank + RM380 verified payment leaves RM120 bank remaining for another verified payment.
- Existing RM380 + RM100 portions from the same verified submission appear as one RM480 slip choice, while retaining both original payment IDs/ledger allocations.
- Only a zero remaining balance is complete. Partial bank rows stay in process; full bank rows leave. A full payment disappears from choices; partial payments remain.
- Room/month filtering, bank reference matching, confidence filters and manual review for ambiguous identity remain. A paid invoice/zero outstanding never blocks allocation. Amount equality affects ranking, not eligibility.
- One room/month invoice retains all existing rent, deposit, electricity and other charge details. No invoice restructuring is performed by this change.

## Audited implementation

`bank_reconciliation_matches` remains the allocation ledger. `existing_payment_link` identifies links created by the bounded atomic RPC; uncertain historical allocations are not silently reclassified. Company-level transactional locking serializes all allocation routes. Row locks plus per-bank/per-payment sums prevent over-allocation; duplicate bank signatures and old invoice links still block duplicates. The unique bank/payment pair prevents repeated application of the same allocation. Each MIN allocation exhausts at least one of its two balances.

Internal payment status is RECONCILED only after its verified amount is fully allocated, including across multiple bank transactions. The nullable legacy bank ID is only a convenience for one-bank cases; actual balances come from allocation rows. Multiple payment IDs may share one bank. Bank status stays `unmatched` for any remaining amount, with the amount shown in the page. Audited admin unmatch reverses that bank's links only and recalculates all affected payment balances.

## Conditions found and corrected

1. Frontend `!same` disabled Reconcile; eligibility now uses positive remaining balances.
2. Suggestion equality remains a ranking signal only; one unambiguous identified slip can be selected for partial allocation.
3. Payment loader treated any match as a fully used legacy record; trusted partial links now expose remaining amount.
4. Bank loader and payment-to-bank map hid partially allocated lines; only exhausted bank balances disappear.
5. Old RPC always inserted the full bank amount and marked matched; new RPC uses MIN and recalculates bank status.
6. Trigger enforced exact equality and prohibited another match; new versioned links enforce cumulative bounds instead. Old routes retain their guards.
7. Internal status table's unique bank ID/check forced one-to-one; payment ID remains unique, bank ID can repeat, multi-bank full payments can have a null convenience bank ID.
8. Active credit reconciliation already receives `allInvoiceOptions` including paid invoices. The `invoiceOptions` positive-outstanding list is used elsewhere; it is not an allocation requirement. The historical payment-creation action remains disabled.

## Regression coverage

Release tests execute the actual SQL in disposable PostgreSQL fixtures: both directions of partial matching, combined slips, zero invoice outstanding, duplicate/retry/concurrent requests, wrong room/month/actor, over-allocation guards, atomic rollback, authorized bank-scoped unmatch, private RPC permissions and unchanged financial masters. No production payment is reconciled as a test.

## Follow-up audit: one slip, different existing invoices

The MIN allocation, paid-invoice eligibility, partial bank visibility and non-duplicating posting behaviour were already present on main `5bc6016` and verified against the live RPC. One remaining restriction required every portion of a verified submission to share `invoiceId` (frontend) / `rent_bill_id` (RPC). That contradicted the master SOP's Invoice A + Invoice B example. A read-only production check found no existing verified multi-invoice submission groups at audit time; no historical repair is needed.

The minimal follow-up removes invoice-ID equality only. All portions still belong to the same verified submission, tenant, room and payment date. Existing bank-month scope applies to every child invoice. The UI retains original invoice identifiers and shows each existing allocation; it does not create or restructure any invoice. Legacy invoice-link duplicate checks cover every child, including before a partial allocation.

Changed files:
- `lib/accounting/payment-allocation.ts`: group by verified parent slip, retain every invoice/reference.
- `lib/accounting/tenant-reconciliation.ts`: include original invoice details in display allocations.
- `lib/accounting/bank-room-scope.ts`: check every child invoice's month.
- `components/accounting/tenant-payment-reconciliation.tsx`: display existing cross-invoice allocations.
- `supabase/migrations/20260921095701_verified_slip_multiple_invoice_links.sql`: replace the existing allocation RPC only.
- `tests/payment-allocation.test.cjs` and `tests/payment-allocation-sql.test.cjs`: five additional regression tests.
- `AGENTS.md` and this report: retain the standing rule and evidence.

Database impact: function-body migration only; no new/removed tables, columns, indexes or permissions. No payment, receipt, invoice or journal data migration. Existing links/statuses are unchanged by deployment. Rollback uses the preceding RPC definition and application commit without deleting allocations or rewriting balances; forward correction is preferred if multi-invoice groups have subsequently been used.

Test results: PASS — all 102 release tests; PASS — TypeScript. New coverage includes a single RM480 bank against two paid invoices, RM300 + RM180 against that same slip, unchanged financial masters, child-month validation, legacy duplicate protection and UI visibility. Existing RM500 → RM380 + RM120, concurrency, rollback and completed-queue tests remain passing.

Limitations retained deliberately: existing room/month rules and uncertain historical allocation locks are not removed. No production financial action is submitted as a test. Multi-invoice fixtures are synthetic because the read-only production check found no such groups.
