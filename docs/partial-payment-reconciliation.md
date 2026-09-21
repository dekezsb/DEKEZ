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
