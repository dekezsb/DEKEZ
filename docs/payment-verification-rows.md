# Payment Verification: slip rows and reference-only saving

## Required behaviour

Each slip is one row, including old verified slips selected by the existing filters. A usable existing reference is shown directly. Missing references have an inline text input and Save; text preserves leading zeroes. A generic QR label is not a transaction reference. Pending slips can carry the typed reference into normal verification without another reference field or page navigation.

Save on a verified slip is **not verification**. The authenticated, property-scoped action calls only `save_payment_bank_reference`. The database updates the existing submission reference and its existing linked payment references and records an audit event. Verification status, payment amounts, invoice balances, receipts and journal entries are unchanged. Concurrent changes fail with a refresh message instead of silently overwriting.

## Duplicate policy preserved

Use the existing normalized reference scope: same invoice, tenancy or tenant record; also company/date/amount/reference across confirmed payments. Ignore rejected competing submissions and sibling allocations of the same submission. Do not introduce global uniqueness for QR identifiers. Conflicting existing linked payment references are not overwritten silently.

## Verification evidence (26 September 2026)

- Mandatory release suite: 139 passed, zero failed.
- TypeScript: passed.
- Production build: `npm run build -- --webpack` passed. The default Turbopack build rejects this isolated worktree's external node_modules junction; no production configuration was changed to bypass that local constraint.
- Disposable PostgreSQL tests: verified backfill, unchanged financial records, leading zeroes, scoped duplicates, legitimate shared references, linked-reference conflict, stale writes, authorization, private RPC permissions, and atomic folder verification rollback.
- Browser: actual row components with fictional data and mocked actions. Save on a verified row called only Save and retained Verified; existing QR code displayed; missing code blocked Verify inline; duplicate error retained typed input; pending Verify carried the entered code; no navigation or console errors.
- Browser harness: `node tests/payment-verification-browser.cjs`, localhost only. It has no credentials or financial data access. Database and server actions are tested separately; this is not a claim of a live end-to-end financial submission.

## Release sequence

Obtain publishing approval. Fetch current main again and integrate any newer changes without replacing them. Re-run release tests and TypeScript on the integrated result. Apply `20260926132857_payment_slip_inline_bank_reference.sql` before releasing the UI. It installs reference validation/save functions and triggers; it does not backfill or modify payment rows during installation. Publish the matching application version and check the authenticated live page read-only. Do not submit real payments as a deployment test.

Publishing approved 26 September 2026. Migration installed successfully as version `20260926132857`; all four new functions confirmed security-invoker and service-role-only. Existing unrelated security advisories are unchanged (legacy function permissions/search paths and disabled leaked-password protection); no authorization policies were broadened for this release.

## Same-page receipt preview follow-up

Receipt thumbnails and the full-receipt control open a native modal on the current page. Images and PDFs use the existing authorized receipt URL. Close or Escape returns focus to the row without navigating, saving, verifying, or clearing an unsaved bank reference. Other document pages are unchanged.

The 140-check release suite and TypeScript passed. Browser checks with fictional slips confirmed the visible overlay, Close and Escape dismissal, unchanged page URL, restored trigger focus, and preservation of an unsaved leading-zero bank code. No production payment was submitted during testing.
