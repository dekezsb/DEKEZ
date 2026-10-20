# Tenant self-registration continuation

This fixes the public `/register` flow, not staff-assisted registration.

Previously an interrupted check-in signup retained its phone-login profile and
draft application, but only reservation drafts could resume. The next attempt
therefore stopped at the duplicate-phone error.

The duplicate warning now offers in-page PIN/password sign-in using the existing
rate-limited sign-in endpoint. It does not navigate away, discard file selections,
automatically sign in using knowledge of the number, or display another person's
record. After signing in, the tenant presses Continue registration again.

The server permits continuation only for the exact authenticated profile's
unfinished, pending-verification, same-mode draft. Saved identity must agree
(apart from an explicitly pending identity placeholder). Any payment submission,
canonical tenant profile, linked tenancy, completed registration, rejected
profile or lookup error prevents reset. Submitted applications return their
existing status.

Continuation updates the existing draft with an updated-at concurrency check.
It neither overwrites the existing profile nor creates/deletes an Auth user or
resets its credentials. It reuses the existing application ID for new upload
paths. The existing completion and admin verification workflow remains unchanged.
The status page distinguishes an unfinished draft from a submitted application.

Wrongly entered numbers belonging to a different identity still require Admin
review. No public override or staff phone-correction workflow is included in this
change. No production data cleanup or schema migration is required.

Verification: request-handler tests and server-rendered form checks in
`tests/single-slip-reservation.test.cjs`, full release regressions and TypeScript.
No real tenant registration or financial submission is used as a test.
