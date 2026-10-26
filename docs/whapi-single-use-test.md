# Whapi single-use Admin test — controlled personal-recipient release

## Scope and release hold

The original single-use mechanism is deployed and its migration is already applied.
The personal-recipient migration below was applied under explicit production
approval on 26 October 2026; its matching code is the controlled release in this
change. Do not rerun any of the three applied reporting migrations. A real test
authorization/send still requires separate approval; all reporting flags stay false.
The feature branch `feature/whapi-single-use-test-20261025` has automatic Vercel
deployment disabled in `vercel.json`. The six existing cron entries are unchanged;
the proposed management-report schedule remains in the unconsumed pending file.

The previously released report generator, snapshot calculations, ordinary sender,
Whapi client, authentication and existing reporting migration are unchanged. The
new flow writes only private reporting authorizations and existing report/attempt
logs. It does not write rental, payment, tenant, maintenance or Meta WhatsApp data.

## Admin workflow

1. In Admin Setup → Daily Management Report, select **Request one-time test**.
   This authenticates the approved Super Admin, reads the existing company-scoped
   report snapshot and stores a five-minute authorization. No message is sent.
2. Review the exact frozen `[TEST]` message, Malaysia report date, recipient and
   expiry shown. After the recipient update, only `60198894911` is allowed, and it
   must match server configuration. The existing business channel/token is unchanged.
3. Tick the explicit confirmation and select **Send one [TEST] report**. Authentication
   is checked again. The server never accepts a recipient, company, actor, date or
   message body from the browser. Only the authorization ID and explicit confirmation
   are inputs. Next.js server-action origin/session protections remain in place.
4. The database consumes the authorization and reserves a delivery atomically before
   any provider request. The Admin sees accepted, rejected or uncertain status.
   There is no automatic retry and no send-again button.
5. **Cancel authorization** revokes an unused authorization immediately. Unused
   authorizations expire without a cleanup job. Requests after expiry are denied.

The three existing switches remain `false` (also their defaults):
`DEKEZ_REPORT_SEND_ENABLED`, `DEKEZ_REPORT_TEST_ENABLED`,
`DEKEZ_REPORT_SCHEDULE_ENABLED`. This new narrowly scoped path intentionally bypasses
only SEND/TEST and additionally refuses to operate if SCHEDULE is enabled. A token
alone cannot send: a fresh Admin session, a database grant and explicit confirmation
are required. No new environment variables or runtime dependencies are introduced.

## Migration and function-only security

Already-applied migration (do not rerun):
`supabase/migrations/20261025145221_whapi_single_use_test_authorization.sql`.
It depends on the already-applied `20261025083739_whapi_management_reports.sql`;
that original file must not run again and remains byte-identical.

The new table is `dekez_reports_private.test_authorizations`, containing the
approving Admin, company, fixed recipient, Malaysia date, exact snapshot/body,
issue/expiry/consumption/revocation times and links to the existing run/attempt.
It has forced RLS. PUBLIC, anon, authenticated and service_role have **no direct
table privileges**. The existing NOLOGIN/NOINHERIT/NOBYPASSRLS reporting executor
receives only SELECT/INSERT/UPDATE on this table, with executor-only policies.
No existing source-table grants or policies change.

Three service-role-only SECURITY INVOKER public RPCs check approved Super Admin
status afresh: `dekez_management_report_authorize_test`,
`dekez_management_report_consume_test`, `dekez_management_report_revoke_test`.
Their corresponding private implementations are SECURITY DEFINER, owned by the
restricted executor, with empty search paths, qualified table names, bounded
timeouts and actual PostgreSQL role checks rather than JWT metadata. They do not
execute dynamic SQL or expose a general-purpose table executor. The private schema
must remain outside the exposed Data API schemas. Ordinary users cannot invoke
either layer even by guessing an ID or forging role metadata.

The installation is transactional with 5-second lock and 30-second statement
timeouts. It creates one new table, one index, three policies and six functions.
It temporarily restores the migration role's SET membership and executor schema
CREATE for ownership transfers, then removes those capabilities before commit.
It fails if the existing executor has broadened attributes. Installation requires
the same role-administration/ownership and REFERENCES privileges as the reviewed
base migration. No existing function is replaced and no source records are changed.

## Consumption, duplicate prevention and failure handling

- Authorization is bound to its original Admin, configured company, recipient,
  exact report and date; it is not a bearer credential usable by other Admins.
- Database wall-clock expiry is at most five minutes, capped at Malaysia midnight.
  Expiry is checked after acquiring the authorization lock and again after report
  reservation if a unique-key wait occurred. Client clocks are not authoritative.
- The authorization row is locked; consumption, new report run and its first attempt
  commit together. The existing unique company/date/recipient/test key arbitrates
  different grants and different Admins. No DB lock is held over provider HTTP.
- This path refuses **any** existing test run that day, including accepted, sending,
  rejected or uncertain. It never uses the older ordinary sender's rejection-retry
  facility. Re-requesting an authorization cannot reset or delete a delivery record.
- The existing Whapi client sends once, with a 15-second timeout and no redirects
  or retry loop. `[TEST]` is part of the stored, approved body. Finish logging uses
  the existing restricted function and sanitized provider state/message ID.
- A lost consume response causes zero HTTP calls. A crash after consumption can
  likewise mean no message was sent, but reuse is still blocked. A lost provider
  response or failed final log requires reconciliation, never automatic retry.

The guarantee is **at most one attempted send per authorized test/date**, not
guaranteed delivery or exactly-once behavior inside the external provider. An
accepted API response is not proof of WhatsApp delivery. Do not delete audit rows
or manually reset consumption to force a resend.

## Tests and limitations

Local verification on 25 October 2026: **677/677 automated tests passed**, including
**80/80 reporting tests**; production build (with mandatory prebuild gates),
TypeScript and diff checks passed. Dependency audit: **zero known vulnerabilities**.
Both static page and interactive control browser checks passed at all five widths
below, without external requests or browser errors. Independent security review
found no blocking issue in the reviewed change. These are local checks, not a
production installation or live provider-delivery claim.

- `npm run test:management-report`: actual SQL in disposable PGlite, real TypeScript
  services and mocked Whapi HTTP, plus authorization/actions/rendering checks.
- Complete repository test suite, mandatory prebuild gates, production build,
  TypeScript checks and dependency audit remain required.
- `node tests/management-report-single-use-browser.cjs`: local interactive component
  with mock server actions, no external requests; request/review/confirm, pending
  double-click guard, cancellation, expiry and uncertain/no-retry at
  320, 390, 820, 1024 and 1440px.

Tests cover ordinary-user and forged-JWT denial; private ACLs/definer ownership;
wrong actor/company/recipient; expired/revoked grants; changed Admin status;
simultaneous requests and competing grants; accepted/rejected/uncertain duplicates;
lost DB response; failed final logging; and exact approved content. Fixture writes
are exclusively synthetic in-memory records, never production.

PGlite has one serialized PostgreSQL connection. The concurrent application tests
overlap send requests and prove one mocked provider invocation, but do not represent
native multi-session PostgreSQL lock-contention or production HTTP/session testing.
Those remain isolated-staging/release verification requirements. No live provider
send, live grant, live configuration check or production migration is part of this PR.

## Approval-gated deployment prerequisites

1. Reconfirm current main/production code and unchanged six cron entries. Review
   the full PR and this migration; do not assume PR approval also authorizes sending.
2. On an isolated PostgreSQL/Supabase environment, check name conflicts, executor
   attributes/membership, migration-role privileges and Data API accessibility;
   test simultaneous transactions, expiry while blocked, real session authorization
   and failure recovery with a mock provider. No production credentials are needed.
3. Before an approved production migration, confirm a recoverable backup, record
   object/privilege baselines and apply **only** the new reviewed migration inside
   its transaction. Never rerun the existing report migration. Verify forced RLS,
   function owners, EXECUTE grants and denial of direct service-role table access.
4. Before an approved code release, privately confirm existing `WHAPI_TOKEN`,
   `WHAPI_REPORT_TO=60198894911`, the verified `DEKEZ_REPORT_COMPANY_ID` and existing
   Supabase server configuration. Keep all three report switches false. No repeated
   environment toggles or redeployments are required for subsequent one-time tests.
5. After the approved release, verify authorized Admin page access and denied
   ordinary-user access without creating a grant. The scheduled endpoint remains
   disabled and no management-report cron is added.
6. Obtain separate permission for one real test. Request/review/confirm it in the
   Admin UI, record provider ID and attempt outcome, and check the approved personal
   WhatsApp recipient for arrival.
   On any uncertainty stop and reconcile; never retry automatically.

## Rollback / emergency stop

Before any approval is consumed, the originating Admin can cancel it without
changing deployment environment variables. All other unused grants expire promptly.
For an approved emergency DB stop, revoke service_role EXECUTE on the three new
public RPCs **and** their private implementations; this blocks issuance/consumption
immediately for future calls, including old deployments. Do not revoke the original
finish function, which may still need to record an in-flight result. A transaction
already committed and a provider request already in flight cannot be recalled.
Roll back the UI/application separately if needed. Keep authorization, run and
attempt history intact. Do not drop the shared executor, use CASCADE/DROP OWNED,
remove the base reporting objects or alter unrelated policies.

## Personal-recipient cutover — 26 October 2026

Applied migration:
`supabase/migrations/20261026023135_whapi_report_personal_recipient.sql`.
The reviewed local filename was `20261026015919_whapi_report_personal_recipient.sql`;
only the filename was reconciled to the recorded production version. SQL content
is byte-identical (SHA-256
`bca2117fb006c600c9408b8540ed18d33ee279a74a5209105d86af90a1816ba3`).
Production history stores exactly the reviewed SQL. No history repair or reapplication.
It replaces the three private authorization functions and ordinary claim function
without changing their signatures, owners, grants, RLS, company/Admin checks,
five-minute expiry or duplicate protections. Only the approved new number can
obtain a delivery reservation. Old-number grants cannot be consumed or retargeted.
The shared application recipient policy is also restricted to that number.

The authorization table's CHECK accepts the old and new numbers **for historical
storage only**. This is not a two-number send allowlist: existing old-number
authorizations, accepted runs and attempts are preserved without any row rewrite.
No rental, payment, tenancy, maintenance or other WhatsApp data is modified.
The two already-applied SQL files remain byte-identical.

Read-only Vercel inspection found `WHAPI_REPORT_TO=60198894911` already configured;
this task did not change it. SEND, TEST and SCHEDULE were all false. The sender
token metadata was unchanged and its value was not retrieved. Existing deployments
retain their environment snapshot, so a new application deployment is still needed.
The user approved this controlled migration, PR and release on 26 October 2026.
The existing Git/Vercel workflow may build the feature branch and deploy merged
main. No report authorization, real test or schedule activation is part of that approval.

After separate migration/release approval:

1. Reconfirm production identity, backup, applied migration history and no in-flight
   report send. Leave all three switches false and all six existing cron jobs unchanged.
2. Production already has the recipient migration: skip it. New isolated environments
   apply its transaction (5-second lock timeout); stop on failure.
   Temporary migration-role inheritance is removed before commit. No runtime role
   receives new privileges. Verify function-only access and preserved history.
3. Release the matching code with the configured new recipient. Old code against
   the new restriction fails closed; do not attempt sending during mixed versions.
4. After separate approval for **one** real test, request a fresh authorization,
   review its new-recipient preview and confirm once. An older preview/grant must
   not be reused. The unique company/date/recipient/test key is unchanged: a past
   report to the old number is historical, not a send to the new number.

Rollback must preserve both-number historical storage and every audit row. Do not
restore old-recipient sending automatically or shrink the CHECK after new rows
exist. Keep sending disabled and review a forward correction. A committed/in-flight
provider request cannot be recalled by a database or application rollback.

Fresh recipient verification includes disposable PostgreSQL 17.11 with independent
sessions: 15/15 scenarios passed, including simultaneous same/different grants,
post-lock expiry, replay, rollback recovery, old-recipient denial and byte-identical
historical rows. Production is Supabase PostgreSQL 17.6; this is a local same-major
test, not a claim that a message was delivered. Production post-migration checks
also confirmed unchanged source/history row fingerprints, policies, grants and
function identities, with no authorization or attempt created.
