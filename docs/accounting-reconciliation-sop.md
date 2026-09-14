# Tenant payment bank reconciliation — accounting only

The existing payment is the master. Reconciliation only links it to one bank statement transaction. It does not create or update tenant payments, receipts, payment submissions, invoices, payment status, outstanding balances, AR postings or journals.

## Use

1. Open Reports → Bank reconciliation → Credit / Money In and select the statement.
2. Review the payment on the left against the bank entry on the right. Open the original slip, receipt details and AR invoice reference when needed.
3. Select Suggested Match or use Manual Match to choose an existing payment. Suggestions do not select or reconcile themselves.
4. Click Reconcile only after checking the tenant, property/room, amount, date and references. Unequal amounts remain for review; they are never silently adjusted.
5. Reconciled payments and bank entries are locked. Only an authorized admin can Unmatch, with a reason recorded in the accounting audit log.

Statement import refreshes internal suggestions. Refresh match suggestions can be used for an older statement or after normal tenant payment verification. The internal statuses are PENDING, MATCH_SUGGESTED, RECONCILED, UNMATCHED and MANUAL_REVIEW; they are separate from tenant payment status.

## Safeguards

- Exact amount plus close date, payment reference, tenant name or invoice/receipt number produces suggestions in that priority order. Similar amounts and conflicting or ambiguous identities require manual review.
- Never reconcile on amount alone. Matching property/room references must be checked, especially where several tenants pay the same amount.
- A bank transaction and an existing payment can each be linked once. A serialized database guard also checks prior invoice links and repeated amount/date/reference combinations.
- Possible duplicates display “Possible duplicate transaction. Please review.” No automatic reconciliation runs for tenant payments.
- Unmatched bank entries offer existing-payment selection, not receipt creation.
- Slips without a confirmed payment master remain visible but read-only. Use the unchanged tenant payment-verification workflow; this page never converts a slip into another payment.
- Older split or invoice-only allocations are marked for review. Admins can inspect their recorded links and explicitly unmatch them with an audit reason. Do not silently reinterpret these as one-to-one payments.
- Money-out payment vouchers and existing tenant portal controls are outside this change.

## Verification

Automated tests cover matching priorities, ambiguous equal amounts, conflicting room references, duplicate flags, locked records, paginated payment loading, read-only pending slips, internal-status-only writes and UI metadata. Database rollback tests confirm one-to-one and duplicate-combination protection, admin authorization, audited unmatching, and unchanged payment/receipt/invoice/journal records. No test reconciliation was committed.

The internal state table intentionally has no tenant-facing access. RLS is enabled; only the service-side accounting actions can access it after checking accounting permissions.
