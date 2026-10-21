# March–August historical bank classification — corrected 21 October 2026

## Scope and authority

Management superseded the original evidence-gated cleanup. Positive bank lines dated 2026-03-01 through 2026-08-31 default to 1100 without tenant/payment/invoice/receipt/reference evidence. Completed/accounted sources and existing known non-rental categories remain untouched. “Deposit” in free text is not proof of security-deposit liability. September onward and Money Out retain their current workflow.

The user approved deployment of the corrected control, not execution. Executing a financial batch requires confirmation of its fresh preview. Installing the migration executes no cleanup.

## Previous zero preview

The original preview_historical_rental_credits required proven payment/offset evidence and reset ready to zero for any exclusion. Live: 430 missing sources, 16 deposit keyword/category exclusions, 5 fuzzy duplicates, 5 unproven settlements, 5 ambiguous matches, 4 existing allocations, 2 non-rental keyword checks, 1 location conflict: 468 total. That release executed zero batches.

## Corrected flow

The portal uses preview_historical_credit_classification and clear_historical_credit_classification (v2). There is no tenant/name/room/payment matching. Known duplicate import aliases are omitted; distinct similar lines are not fuzzy-excluded.

1. Completed statuses, exhausted allocations and existing classifications are skipped.
2. Closed statements are not reopened. Recorded whole-source offsets, posted bank-source journals, origin-linked confirmed payments and recorded transfer/security categories remain unchanged. Prior partial allocations are never rewritten; their category does not classify the unallocated remainder of a mixed receipt. The follow-up migration preserves those portions while clearing only the remainder.
3. Every other unresolved positive line is ready for its full unallocated remainder. Missing supporting evidence is not examined.
4. Confirmation rechecks preview hash, permissions, current Malaysia date, periods, amounts and idempotency within one transaction.
5. Each remainder gets exactly one historical_bank_credit_classifications row and its bank line becomes adjusted. No Bank entry, manual bank voucher, journal, tenant payment, receipt or invoice is created.
6. A touched statement finalizes only when both sides have no remaining work and original movement arithmetic agrees. Workspace filtering hides completed months without deleting them.

## Accounting representation

Bank already comes from imported statement closing balances. The new table is an immutable offset classification on that existing source, NOT a one-sided journal. Reports subtract the classified amount once from company-level 1100, effective on the current allowed classification date. It is not backdated, allocated to an invented property/tenant, or passed through P&L. Balance Sheet drilldown preserves original bank date/reference/description/source ID. Trial Balance and PDFs use the same report data. Existing difference/basis warnings remain; no balancing plug is added.

Known accounting is skipped, not reclassified. This includes legacy 1190 offsets: changing an already recorded category is outside this corrected batch.

## Audit and access

Original source snapshot, bank date/month/reference, actor, run UUID and effective date are retained. Offset/source records cannot be edited or deleted after classification. Further reconciliation of that source is rejected. Unique bank-line keys prevent duplicate offsets. Same-run retries return the previous result; stale previews fail atomically. Server actions enforce reports/manage and derive actor/company from authenticated context. Private RLS table/RPCs are service-only; report reads follow reports/view authorization and explicit company/date scoping.

## Tests

historical-classification-sql.test.cjs runs real migrations in disposable PostgreSQL: no-evidence default, RM18,360 example, completed/partial protection, recorded categories, misleading deposit text, duplicates, locks, cutoff, unchanged tenant/debit data, source immutability and retries.

historical-classification-report.test.cjs checks the reporting contract and current-date AR-only effect. Original migration tests remain for its preserved legacy functions, not the active v2 portal path. All are release build gates. No live financial submissions during verification.

## Release verification

The corrected read-only production preview identifies all 468 remaining credits (RM214,937.19) as ready, including July's RM18,360. Previously completed credits and all prior partial allocations remain unchanged. Both schema updates are installed with no financial execution. Deployment is user-approved; confirmation is still required to actually clear these amounts.
