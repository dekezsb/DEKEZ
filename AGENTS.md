# Preserve existing DEKEZ requirements

New requests are additive unless the user explicitly replaces an earlier rule. Do not remove existing features to deliver another feature.

Before a release, retrieve current production/main source and compare it with the working branch. Never publish a stale standalone worktree over newer production changes. Preserve both histories through reviewed integration. Run `npm run test:release-regressions` and TypeScript checks; do not delete or bypass the prebuild tests to make a release pass.

Standing requirements:
- Keep reconciliation confidence filters (All, Exact / High, Possible, Manual Review, Unmatched), counts, search and highest-confidence-first ordering.
- Completed reconciliation items leave the working queue. Completed records remain in the ledger, not a duplicate history page. Hide completed statements only when both money-in and money-out work is done.
- Keep existing tenant uploads, receipts, payment statuses and outstanding logic unchanged during accounting-only work. Existing verified payments remain the master records; never duplicate receipts, payments or AR postings.
- Keep all chart account types available in every payment voucher line, including assets and liabilities.
- Preserve reservation navigation, monthly check-in/check-out navigation, single-slip booking registration and protected booking-fee allocation.
- Preserve current-tenancy deposit scoping; historical tenant accounting records must remain intact.
- Retain the requested daily imports/deduplication, bank reference entry, QR room/month invoice matching, paid-invoice reconciliation and audited ledger corrections when integrating their implementations. Do not claim any is present merely because an older branch contained it.
- Split-bank matching against an existing aggregate verified payment remains a separate unresolved task. Do not substitute another payment or invoice charge for that correction.

Release reports must distinguish tested/restored features from outstanding integration work. No real financial submissions during UI verification.
