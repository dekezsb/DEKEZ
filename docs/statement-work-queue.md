# Reconciliation shows unfinished work only

The statement buttons and pending count use nonzero bank lines not yet marked matched, adjusted or ignored, across both credit and debit. The query is company-scoped, excludes void imports and reads all result pages. An error stops rendering rather than treating missing data as zero work.

When no money-in or money-out work remains, the statement disappears from the workspace regardless of its import status or opening/closing difference. Its summary and reconciliation panel disappear too. A stale URL falls back to the next working statement, or shows the empty-workspace message. The existing refresh after reconciliation updates the list. An authorized unmatch makes a statement eligible to reappear.

This is read-only filtering. It does not delete statements, matches, payments, receipts or journal entries; does not change balances; and does not finalise an unbalanced statement. Full statement imports remain available to existing accounting calculations. No separate history page is added.

Read-only live check on 21 September 2026 confirmed the 17 September import had zero unfinished credits and debits while still `in_progress`. The 16 September import had 55 unfinished credits, so it should remain. These counts are observations, not hard-coded behavior.

Six release-gate tests protect completion on both sides, zero-money rows, stale URLs, unmatching, pagination, read failures, company scope and page wiring. The complete gate also protects the pending bank-reference and room-matching fixes, confidence filters and reservation features.

This change requires only an application release. The combined pending bank-reference release separately requires its additive booking-reference migration first. Do not claim local tests are a live deployment.
