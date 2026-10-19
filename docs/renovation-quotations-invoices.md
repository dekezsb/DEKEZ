# Renovation quotations, invoices and verified receipts

This module is independent of rental invoices, tenant payments, reservations,
Rent Due Tracker and rental reminders. Open **Renovation Quotations & Invoices**
from the sidebar (`/renovation`). It uses the existing reports view/manage
permissions; all financial mutations are server-side and company-scoped.

## Staff workflow

1. Add a client once. Save frequently used work descriptions, units and prices.
2. Create a quotation or direct invoice. Click work items to add them, then edit
   quantities/prices. Starter descriptions have zero prices and must be reviewed.
3. Set an RM or percentage discount, payment stages totalling 100%, and terms.
   Save a draft, review it, then explicitly issue it. Print / Save PDF uses the
   DEKEZ letterhead, item table, consistent totals, payment stages and terms.
4. If the client negotiates an issued quotation, choose **Revise quotation /
   discount**. Issuing the revision preserves and supersedes the previous quote.
5. After actual client acceptance, record the approving client's name and evidence
   (for example, signed quotation or dated message), and confirm conversion.
   The approved quote automatically creates one invoice, retaining the quote.
   This records staff-provided evidence; it is not an online client signature.
6. Upload each bank-in slip against the renovation invoice. It remains pending
   and does not reduce outstanding until an authorized manager verifies it.
7. Match the verified receipt to an imported same-bank money-in transaction,
   from the invoice or existing accounting reconciliation workspace. Partial
   and multiple allocations consume only the remaining amounts.

The list and invoice show renovation outstanding, verified receipts and pending
proof separately. A pending slip is not a paid invoice. Bank matching does not
subtract the payment a second time. Copy an existing document for a new job;
the copy starts as a fresh quotation with new dates and no payment history.

## Accounting and preservation rules

- Drafts and issued quotations post no money.
- Issued invoices post one journal: debit Renovation Client Receivables (1185),
  credit the existing Renovation Service Income (4050). General-company income
  appears in P&L, separately from rental income. Code 1185 must be available;
  the invoice transaction fails rather than repurposing an occupied account code.
- Verified receipts reuse `bank_manual_transactions`, offsetting renovation AR.
  They do not post another income journal. Pending/rejected slips post nothing.
- Matching reuses `bank_reconciliation_matches`; it never creates another
  receipt, invoice or journal. Renovation receipts cannot become recurring
  transaction templates. Cross-month settlement is allowed within the same bank.
- Original rental matching rules and duplicate-import protections remain intact.
- Client approval, issuance, verification and matching are atomic and audited.
  Repeated calls return the existing invoice/receipt/match. Overpayments and
  duplicate proofs/references are blocked. Private proof files use signed URLs.
- Issued invoices, verified receipt history and related journal postings cannot
  be changed through general accounting correction screens. V1 does not provide
  credit notes, post-issue discounts or invoice cancellation: do not edit the
  ledger directly to simulate these. Negotiate/revise before invoice issuance.
- Renovation tables are RLS-enabled and unavailable to browser database roles.
  Service-role RPC access is reserved for authenticated, authorized server actions.

## Database additions

`renovation_clients`, `renovation_catalogue`, `renovation_documents`, and
`renovation_payment_submissions` store only the new renovation-specific records.
Existing accounts, journal posting, bank receipts, matches, audit logs and
financial reports are reused. No historical rental/financial data is migrated.

## Verification

- `tests/renovation.test.cjs`: totals, discount/stage rounding, outstanding and
  prevention of recurring receipt duplication.
- `tests/renovation-sql.test.cjs`: real PostgreSQL-compatible migration/functions,
  original bank guard, permission checks, approval/verification retry safety,
  ledger preservation, partial/multiple allocation and overpayment rejection.
- `tests/accounting/report-data.test.mjs`: renovation income once, AR receipts
  excluded from income, rental property reports unaffected.
- `tests/renovation-browser.cjs`: local fictional fixtures for actual editor
  components, mobile overflow and printable quotation. Set `PLAYWRIGHT_MODULE`
  and `CHROME_PATH` if needed. Optional `RENOVATION_PDF_QA=1` renders a QA PDF.
  The browser harness has mocked server actions; SQL tests separately exercise
  the real database functions. Never submit fictional financial records live.

Release requires the additive migration `20261019084438_renovation_documents.sql`
and tested application code. Do not deploy unrelated unfinished WhatsApp changes.
