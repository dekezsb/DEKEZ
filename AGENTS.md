# Preserve existing DEKEZ requirements

New requests are additive unless the user explicitly replaces an earlier rule. Do not remove existing features to deliver another feature.

Before a release, retrieve current production/main source and compare it with the working branch. Never publish a stale standalone worktree over newer production changes. Preserve both histories through reviewed integration. Run `npm run test:release-regressions` and TypeScript checks; do not delete or bypass the prebuild tests to make a release pass.

Standing requirements:
- Keep the editable bank transaction reference/code in every admin verification confirmation, including booking fees and Rent + Deposit. Save it to the existing submission/payment and use exact reference tokens in matching. Preserve leading zeroes, existing values on blank/old/rejection forms, room/month constraints and duplicate guards. Keep `tests/verification-bank-reference.test.cjs` in the mandatory release gate. Booking reference saving and allocation must succeed or roll back together.
- Keep reconciliation confidence filters (All, Exact / High, Possible, Manual Review, Unmatched), counts, search and highest-confidence-first ordering.
- A bank property/room reference must constrain the actual payment dropdown to that property, room and bank month, not merely add a warning. Show the room's same-month invoices (including paid invoices) on the row. Never fall back to all tenants when no exact-room record exists. Keep `tests/bank-room-scope.test.cjs` in the release gate.
- Completed reconciliation items leave the working queue. Completed records remain in the ledger, not a duplicate history page. Hide completed statements only when both money-in and money-out work is done.
- Statement buttons, selection and pending-statement counts must use remaining bank-line work, not the import's `in_progress` status or balance difference. A finished statement must not reappear from an old URL. Keep all statement records/balances for accounting and keep `tests/statement-work-queue.test.cjs` in the mandatory release gate.
- Keep existing tenant uploads, receipts, payment statuses and outstanding logic unchanged during accounting-only work. Existing verified payments remain the master records; never duplicate receipts, payments or AR postings.
- Keep all chart account types available in every payment voucher line, including assets and liabilities.
- Preserve reservation navigation, monthly check-in/check-out navigation, single-slip booking registration and protected booking-fee allocation.
- Preserve current-tenancy deposit scoping; historical tenant accounting records must remain intact.
- Retain the requested daily imports/deduplication, bank reference entry, QR room/month invoice matching, paid-invoice reconciliation and audited ledger corrections when integrating their implementations. Do not claim any is present merely because an older branch contained it.
- Reconciliation is allocation against ALREADY verified payments, never invoice verification. Use payment remaining = verified amount minus linked amount and bank remaining = bank amount minus allocated amount. Allocate MIN of those balances, never require bank/payment/invoice totals to equal or invoice outstanding to be positive. Support one bank to multiple payments, one payment to multiple banks, and grouped portions of one verified slip. Partial banks/payments stay available; only exhausted balances leave the queue. Preserve duplicate, room/month, permission and audit protections. Keep `tests/payment-allocation.test.cjs` and `tests/payment-allocation-sql.test.cjs` in the mandatory release gate.
- Keep one room/month invoice containing the existing rent, deposit, electricity top-up and other charge lines. Reconciliation must never create a second invoice, payment, receipt, charge or AR posting, reopen a paid invoice, or alter tenant outstanding.

Release reports must distinguish tested/restored features from outstanding integration work. No real financial submissions during UI verification.

One verified parent slip may have existing allocations to different invoices. Group by the verified submission, not invoice equality; display all linked invoice allocations. Preserve existing tenant/room/month and duplicate protections. Do not restructure invoices or create new ones to reconcile such a group.
