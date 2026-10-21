# March–August 2026 historical Money In cleanup

Release authorization: user explicitly requested production deployment on 21 October 2026. Database migration installed; application release follows the tested commit. No financial cleanup has been executed.

## Scope and important limitation

One preview/confirm action covers 2026-03-01 inclusive through 2026-09-01 exclusive for the selected company/bank. The destination is the existing **1100 Rental Receivables**, never a second tenant receivable. Normal historical rental matching controls are replaced by the batch preview for statements fully within this range. September onward retains its existing controls. Separate renovation reconciliation is retained; it is not swept into this batch.

This is **not** an implementation that blindly credits every imported bank line to AR. The permanent governance rules require proof of the existing accounting representation and prohibit duplicate AR settlement and invented counter-entries. The batch automates the proven subset and reports protected exclusions. It cannot yet safely clear all remaining historical credits. Approval to deploy is distinct from confirmation of actual preview totals.

## Read-only inspection (21 October 2026)

- Reports use the latest imported bank closing balance as the Bank asset. Importing a bank line does not, by itself, establish a balanced receipt journal or a suspense credit.
- Rental AR is report-derived from rental bills/extra charges less `paid_amount`, plus manual/journal Rental Receivable balances. An invoice with an existing payment can already have its AR reduced without an AR journal. Absence of a journal is not proof that settlement is missing.
- Main 1100 Rental Receivables: `b181822e-21f5-4e08-91f8-65b32c75b72b`.
- 1190 Other Tenant Receivables: `b5c70ebd-e982-4cdf-b96a-3b7b29d3c875`.
- 2200 Tenant Security Deposits: `c3936cf8-c8c5-48d8-8701-1689ee5779d7`.
- No posted journal lines or manual bank offsets to 1100/1190 were found in this inspection. These are not a populated suspense account that can be assumed to fund a blanket reclassification. 2200 has existing journal/offset history and must be preserved.
- `accounting_periods` was empty at inspection; that is not permission to backdate. Any new adjustment uses the current Malaysia date and checks current locks again during execution.
- Historical unresolved lines: March 32 / RM29,340.88; April 98 / RM45,068.51; May 108 / RM49,885.00; June 136 / RM56,858.00; July 44 / RM18,360.00; August 50 / RM15,424.80. Total 468 lines / RM214,937.19 remaining. Existing partial allocations RM3,405 must be retained. Figures are an inspection snapshot, not approved posting totals.
- Known exclusions include account-closure transfers and descriptions combining rent with deposits. Existing completed Money In also exists and is skipped. These amounts must not be presented as all ready to clear.

Live read-only preview after migration: 192 completed credits skipped; all 468 remaining credits excluded, **zero ready / zero new AR credit**. Reasons: 430 missing accounting sources (RM181,169.80); 5 ambiguous settlements (RM1,350); 1 conflicting location (RM350); 4 existing accounting allocations (RM180); 5 possible bank duplicates (RM1,750); 5 unestablished receivable settlements (RM1,430); 16 security/mixed deposits (RM11,163); 2 transfers/non-rental (RM17,544.39). Deploying the controls is not completion of these financial records. Do not bypass the checks or claim these months cleared.

## Three supported accounting paths

1. **Existing confirmed rental payment with established invoice settlement:** allocate available bank money to that same payment using the existing guarded RPC. No payment/invoice/receipt/journal writes, no second AR credit. An existing bank reference is optional: provenance, full tenant name or property/room evidence can identify the source automatically. No manual selection is required.
2. **Existing bank manual offset already against 1100:** link it to the bank line, no new accounting.
3. **Proven existing 1190 bank offset:** preserve it, post balanced current-date DR1190 / CR1100, link the same offset and retain original bank date, description, reference, statement month, actor, old/new account and run ID in the audit trail. No Bank or Income line.

No established source, ambiguous sources, missing settlement evidence, mixed/deposit payments, transfers and non-rental offsets stay unresolved. The application does not invent a suspense account, create a one-sided credit, or falsely mark these completed. The 1190 path is tested but no live eligible 1190 offsets were identified. Additional accounting investigation/approved treatment is required to clear standalone receipts without a proven opposite-side balance.

## Controls

- Company/bank/actor validation; authenticated reports-manage server actions; service-only private invoker RPCs; run table RLS with no public policies.
- Preview includes all six months, counts, original Money In, prior completed/allocated amount, ready amount, actual *new* 1100 credit and excluded/remaining amount.
- Confirmation hash is recomputed inside the transaction. Changed sources, mapping or adjustment date require a fresh preview.
- Shared company reconciliation advisory lock, deterministic row locking and stable source-table snapshot. Five-second lock timeout fails rather than waiting indefinitely. A single transaction commits or rolls back all links, journals, audit and completion statuses.
- Durable run UUID replays its recorded result. Existing matched sources, source usage and previous journals block a second allocation/posting. The same source cannot fund two bank rows in one preview.
- Original payment, receipt, tenant, tenancy, rental invoice and manual bank source records are not written. No Money Out row/allocation changes.
- Source statements complete only when every Money In/Out row is finished and bank movement agrees. Existing work-queue logic removes finished months only after all grouped files have no unresolved rows; history remains available. A protected exclusion keeps its month open.
- Reclassification reversal is not part of this feature. Do not delete its links/journal to undo it; a separately approved audited correction is required.

## Verification / release

`tests/historical-credit-sql.test.cjs` executes the actual staged SQL and existing allocation/duplicate guards in disposable PGlite PostgreSQL fixtures. Covers existing AR links, current-date balanced reclassification, prior/current locks, deposits, transfers, missing evidence, duplicate sources, retries, partial balances, rollback, protected tenant/debit snapshots, permissions and cutoff boundaries. `tests/historical-credit.test.cjs` covers exact preview sums, bounded UI scope and confirmation controls. Both are in the release regression gate.

Before any production release: obtain explicit approval, recheck current production/main and migration ordering, validate schema/security/trigger compatibility in staging, run regression and TypeScript/build gates. Applying the migration creates only functions/run storage, not financial postings. Actual cleanup requires a fresh live preview and explicit confirmation of that preview; never perform a real financial test submission.
