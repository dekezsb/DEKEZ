# Renovation quotations, invoices and verified receipts

## Saved PDF translations

Malay and Chinese wording can be saved from PDF preview after review. Reuse the
append-only `accounting_audit_logs` with entity type `renovation_translation` and
action `export_translation_saved`; do not update original documents or journals.
Each entry is scoped to company, document, version and language, records its actor,
and stores source/text pairs. Manage permission is required to save. Reject
missing fields, stale source wording, extra keys and altered protected numbers or
specifications. Load only the latest valid entry for that exact version/language.
Saved wording remains ready after reload; edits require another review/save.
No schema migration or external translation service is required.

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
6. An authorized admin's renovation bank-in upload records/accepts the receipt
   immediately and reduces outstanding once. It does not enter Payment
   Verification. Store the bank reference or fill a missing reference later.
   Non-admin submissions that require verification remain pending until approved
   in the central Payment Verification workspace. Rental/reservation flows are
   unchanged; pre-check-in receipts remain separate.
7. Match the verified receipt to an imported same-bank money-in transaction
   in **Bank Reconciliation → Money in → Renovation**. The renovation Reports
   page shows payment records only, with no reconciliation status, bank-matched
   amounts, matching controls or reconciliation links. Partial
   and multiple allocations consume only the remaining amounts.

The list and invoice show renovation outstanding, verified receipts and pending
proof separately. A pending slip is not a paid invoice. Bank matching does not
subtract the payment a second time. Copy an existing document for a new job;
the copy starts as a fresh draft of the same type with new dates, no selected
customer and no payment history.

Reports → Renovation Quotes & Invoices includes customer/project, original amount,
discount, tax when applicable, final amount, slip, received amount, outstanding,
payment date/status and bank reference. A missing admin-receipt reference can be
saved on the same payment; this does not re-record or re-verify it. No rental,
tenant or bank reconciliation logic is changed by this display separation.

After conversion, the approved quotation leaves the active list. **Client folders**
retain all that client's quotations, revisions and invoices with unchanged IDs and
history. Open the folder from the main list or any document. Folder searches stay
within that client; outstanding counts issued invoices only, never quotations.

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
- Issued invoices and verified history cannot be changed through general
  accounting correction screens. The controlled renovation correction flow
  requires a reason and optimistic version, preserves the original snapshot and
  journal, and posts only the financial difference on an open adjustment date.
  Invoice ID/number and receipt/match IDs stay unchanged. The original issue date
  stays fixed; due dates/customer details/items/discounts may be corrected. The
  new total cannot fall below received payments. An invoice with receipts cannot
  be reassigned to another client or voided. Voiding an unpaid invoice reverses
  its current net balance once. Credit notes/refunds are not implemented here.
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

## Editor, library and multilingual export upgrade

The existing editor supports draft reopening, document-specific customer details,
row insertion/deletion/duplication/reordering, RM/percentage discounts and optional
tax. A target-total comparison only shows the difference; it never changes rates.
Tax requires an existing active company liability account selected by management.
Payment-stage percentages must total exactly 100%; cent rounding is deterministic.

`/renovation/items` manages the existing catalogue with item code, category, unit,
selling price, optional cost, active status and EN/MS/ZH descriptions. Inserting an
item snapshots its description/price/translations into the document. Changing a
line does not update the library. Saving/updating a library item is explicit and
version-checked. Updates never rewrite existing documents.

The main workspace lists client folders only, avoiding duplicate document cards.
Folders contain searchable quotation/invoice history with date, type, project and
status filters. Sent/accepted are presentation labels for existing quotation
statuses; partially paid/paid are derived from existing verified receipts.

The PDF panel previews the actual downloadable PDF, then enables Download and
Print. English, Bahasa Melayu and Simplified Chinese use identical saved amounts.
Standard labels/terms and available item translations are provided. Custom text
has editable per-export translation fields; there is no external machine-
translation service. Missing, stale or numerically unsafe translations retain
original text with warnings. The user reviews non-English wording before preview.
These per-export edits are not persisted to the document or shared library.
Names, company/site addresses, codes, units and monetary fields are not translated.
The static Noto Sans SC font is fully embedded for reliable Chinese glyphs; PDFs
are approximately 6.5 MB. See `public/fonts/README.md` for license/provenance.

Document saves/corrections reuse full before/after snapshots in
`accounting_audit_logs`, with actor, time and reason. The document page offers
historical-version previews. Older documents without historical snapshots remain
accessible, but history from before this upgrade is not invented.

Additional verification: `tests/renovation-pdf.test.cjs` exports fictional
three-language multipage documents and verifies numeric invariance/font mappings;
`tests/inspect-renovation-pdfs.py` checks extracted amounts/specifications with
pypdf. Render and inspect all pages too: successful font embedding alone cannot
prove Chinese glyphs are visually correct. Browser fixtures exercise actual editor
and preview components with mocked server actions; PGlite separately tests the
real migrations/RPCs. Production end-to-end testing awaits approved release.

## Approval gate

The existing foundation migration is `20261019084438_renovation_documents.sql`.
Local pending migrations are `20261019163235_renovation_admin_receipts.sql` and
`20261019164832_renovation_editor_multilingual.sql`. Neither was applied to
production during this upgrade. Obtain explicit approval before applying or
deploying, compare current main/production before integration, and run the full
release regression suite plus TypeScript checks. Do not deploy unrelated
unfinished WhatsApp changes or modify rental/tenant operations.
