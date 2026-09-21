# Bank reference restoration

Bank transaction reference / code is an editable text field in every Admin verification confirmation, before the slip preview. It is separate from Super Admin payment corrections. Monthly rent, deposits, Rent + Deposit and booking fees retain their existing allocation paths.

The server validates the code before writes, preserves leading zeroes, and leaves an existing code unchanged on blank, omitted or rejection forms. Normal verification saves it on the existing submission; the existing payment allocation copies it to its payment rows. Normal verification audit notes record a changed code. No new receipt/payment procedure is introduced.

Booking verification uses the additive `verify_booking_fee_allocation_with_reference` wrapper. It locks the submission, saves the reference and calls the existing protected allocator in one transaction. Exceptions roll everything back; retries do not alter verified records. Only the server service role can call this security-invoker wrapper. The original allocator remains unchanged for older deployments. Apply the new migration before deploying the application; do not publish application-only and break booking verification.

Reconciliation accepts a complete saved bank-code token, including harmless spaces, slashes and hyphens. It rejects code substrings and generic non-numeric references. Exact code plus amount takes precedence over weaker suggestions, while exact room/month scope, duplicate, amount and already-used guards remain. Suggestions never reconcile automatically. Split-bank-to-aggregate-payment support remains separate outstanding work.

`tests/verification-bank-reference.test.cjs` covers rendered modal variants, mocked server-action writes/RPC arguments, preservation, validation, matching and protective guards. It is part of the mandatory prebuild gate with the existing confidence-filter, room-scope, reservation and other regressions. Tests never submit real payments. Full database execution and live UI verification require the release step; local tests must not be described as live verification.

Two earlier assertions forbidding all reference-only suggestions were updated to the user's explicit bank-code matching requirement. Amount/date-only and substring-code cases remain manual review.
