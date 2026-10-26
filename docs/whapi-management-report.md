# DEKEZ daily management report — controlled daily activation

## Status and boundaries

The original reporting implementation has been released. The approved migration was applied
to production on 25 October 2026; source version is now aligned with production
history at `20261025083739`. No daily report cron was activated by that release.
The single-use test mechanism is also released. The personal-recipient migration
is applied and released; the old recipient's existing reporting history is preserved.
After confirming the personal-recipient `[TEST]` report arrived, the user approved
daily activation on 26 October 2026. This change registers the 20:00 Malaysia cron;
production must use SEND=true, SCHEDULE=true and TEST=false. Local/example defaults
remain false, and deployment/configuration must be verified before claiming it active.
No additional manual test, authorization or cron invocation is part of this release.
See [single-use test design and release prerequisites](whapi-single-use-test.md).
Existing Meta WhatsApp, in-app chat, accounting, tenancy and payment code stays
unchanged. Reporting reads source rows; only the new private delivery tables are
written. The new Admin page is `/admin-setup/management-report`, linked from Admin
Setup, and uses existing Card/Button styling.

## Vercel configuration (enter privately in the dashboard)

| Variable | Approved production value / purpose |
| --- | --- |
| `WHAPI_TOKEN` | Sensitive channel token for FALCON-D9NS9; never put in code, chat, logs, PRs or a NEXT_PUBLIC variable. |
| `WHAPI_REPORT_TO` | `60198894911` (approved personal recipient, international digits without +; exact-match restriction). |
| `DEKEZ_REPORT_COMPANY_ID` | Verified existing DEKEZ company UUID. Required; never inferred from the first row or request parameters. |
| `DEKEZ_REPORT_SEND_ENABLED` | `true` — approved daily sender; source/example default remains `false`. |
| `DEKEZ_REPORT_TEST_ENABLED` | `false` — ordinary manual test switch, independent of schedule. |
| `DEKEZ_REPORT_SCHEDULE_ENABLED` | `true` — approved daily worker; source/example default remains `false`. |
| `CRON_SECRET` | Preserve existing secret used by other cron jobs. Missing/wrong secret is denied. |

Uses existing server-side Supabase URL/service role configuration. No new provider
SDK or runtime dependency. Never copy production tokens into local test fixtures
or preview environments that do not need to send. All switches require exactly
`true`; presence of a token alone enables nothing. The one-time path
requires a fresh Admin authorization and explicit confirmation instead of toggling
SEND/TEST, and refuses to run while SCHEDULE is enabled. The recipient is separate
from the unchanged DEKEZ Whapi business sender/channel and token. A different
configured number fails closed; it is not an arbitrary-destination messaging API.

## Metrics and scope

- One database statement creates an internally consistent snapshot. Postgres
  aggregates rows without frontend row limits or full-table downloads.
- `payments`: company-scoped, `monthly_rent`, `confirmed`, no `reversed_at`.
  Today and MTD use actual `payment_date`, not invoice month/verification date.
  Multiple legitimate allocations of a parent slip contribute their amounts once;
  the parent submission, bank line and journal are not added again. Deposits,
  electricity, other categories and unverified submissions are not collections.
  Conflicting non-null property-company links are excluded.
- `rent_bills` + `rental_invoice_line_items`: issued and not future-dated, removed,
  draft, cancelled or waived. Per-invoice balance is max(amount + extra charges -
  paid_amount, 0), matching existing report invoice balance logic. Security deposit
  amount is excluded. This is **rental invoice outstanding including billed extra
  charges**, not an invented rent-only allocation of mixed payments.
- Overdue means actual due date before Malaysia today with positive balance.
  Count distinct identities through existing tenancy/tenant/profile and imported
  tenant links, not bills. Missing due date/identity/amount makes affected metrics
  unavailable. Paid bills may have outstanding extras under existing rules; do not
  blindly drop all status=paid rows. Checked-out debt is not silently written off.
- Pending verification: distinct `payment_submissions` rows for scoped properties,
  `pending_verification`, with count/amount; not added to confirmed collections.
- Rooms: actual occupied/vacant/reserved/maintenance statuses for company properties.
- Maintenance/repair: submitted, assigned, in_progress, waiting_for_parts; urgent
  follows actual urgency=urgent. Completed/rejected/closed and cleaning excluded.
- No names, room identifiers, phone numbers, bank details, receipts, descriptions
  or tenant IDs enter the message. Empty valid populations are zero; missing fields
  render Unavailable. A failed query blocks sending instead of manufacturing zeros.
- Snapshot is explicitly "as of" Malaysia local time. This is not a final daily
  ledger or historical reconstruction. Later receipts and late verification can
  change subsequent reports; old sent snapshots never get silently rewritten.

## Migration and authorization

Canonical file: `supabase/migrations/20261025083739_whapi_management_reports.sql`.
The original reviewed filename was `20261025055210_whapi_management_reports.sql`.
Only its filename changed after Supabase recorded execution version `20261025083739`;
the SQL is byte-identical to approved commit `e5f5295` and the production history
statement (SHA-256 `3dd63a191dc0a0901dde637c3b8e4a51beccfc5a2658a184d1466ea9356c0b75`).
The old filename is removed, not duplicated. No production history repair or SQL
rerun was needed. This migration is already applied; do not apply it again.
Creates only:

- `dekez_reports_private.report_runs`: immutable report snapshot/body, scope/date/
  recipient/kind unique key, actor, state and timestamps.
- `dekez_reports_private.delivery_attempts`: at most three attempts per run,
  provider ID, HTTP status, sanitized outcome, actor and timestamps.
- Three new public RPC entrypoints: `dekez_management_report_snapshot`,
  `dekez_management_report_claim`, `dekez_management_report_finish`.

Private schema and tables deny PUBLIC/anon/authenticated access. **service_role
has no direct table privileges either**: it can only call reporting functions.
The three public RPCs remain SECURITY INVOKER with empty search_path and EXECUTE
granted only to service_role. Claim/finish delegate to two private SECURITY DEFINER
functions owned by a dedicated `dekez_report_executor` role. That role cannot log
in, inherit roles, bypass RLS, create roles/databases, or access operational tables.
It receives SELECT/INSERT/UPDATE on the two new tables only, with six corresponding
executor-only RLS policies. Both tables FORCE RLS; the executor is not their owner
and cannot DELETE/TRUNCATE them. No existing table policies or functions change.

The private definers have empty search_path, fully qualified table references,
row_security=on, bounded statement timeout, no dynamic SQL, and explicit service-only
EXECUTE grants. They verify PostgreSQL's actual SET ROLE, not JWT metadata. The
public claim wrapper checks approved Super Admin identity for test mode using the
server's existing profile-read access; the executor does not read profiles.
The private schema must remain outside the exposed Data API schemas.

Migration role ownership-transfer privileges are temporary: executor schema CREATE
and the creator's SET/INHERIT membership are removed before commit. The creator
retains role administration only. Runtime roles have no executor membership. Like
all database controls, this boundary does not restrict privileged database
administrators who can intentionally change ownership/grants. Migration installation
requires the existing postgres migration role's CREATEROLE, database/schema CREATE
and companies/profiles REFERENCES privileges. A pre-existing executor/schema/function
name fails safely rather than reusing an unknown object. Installation is transactional
with a 5-second lock timeout and 30-second statement timeout.

Report Admin UI/actions require the existing super_admin role/admin_setup manage
permission plus fresh getUser and approved profile checks; other portal roles are
denied. Super Admin's existing all-company authorization is narrowed to the one
configured report company. Server actions ignore any client-supplied recipient,
body, company or actor; normal Next.js server-action origin protections apply.

## Delivery and retry safety

The sender uses POST `https://gate.whapi.cloud/messages/text`, bearer token,
`{to, body, no_link_preview:true}`, no redirects, no cache, 15-second timeout.
Whapi response `sent:true` plus valid message ID is **accepted**, not a claim that
WhatsApp delivered/read it. Real delivery must be checked during approved testing.

Atomic unique-key insertion + row lock + attempt reservation occur before HTTP.
No database transaction holds a lock during network IO. Same date/scope/recipient/
kind cannot send concurrently. Test and daily reports have separate keys and test
messages are visibly labeled. Test click spam cannot make arbitrary extra reports.

- Accepted: never resend automatically.
- Documented 400/401/402/403/413/429 rejection: sanitized rejection recorded;
  authorized re-invocation after 5 minutes can retry, maximum 3 attempts. Fix the
  underlying configuration/limit first; there is no background retry loop.
- Network timeout, 5xx, redirect, malformed success, missing provider ID: uncertain;
  never automatically retry, because provider acceptance may already have happened.
- Process crash / failed completion write: reservation blocks immediate reuse;
  next claim after 5 minutes marks the abandoned attempt uncertain, without resending.
- Do not delete a run to force resend or reset uncertain state. Check the Whapi
  channel/provider records and approved-recipient WhatsApp history. Any reconciliation or
  exceptional resend needs explicit operator review; no unrestricted reset UI.
- Vercel does not retry failed cron invocations. A missed daily report is a visible
  operational failure, not silently resent the next day. Error logs contain only
  run IDs/states, never provider bodies, message bodies, financial totals or secrets.

## Approved daily schedule and release verification

All six existing `vercel.json` cron entries and their schedules are unchanged.
The seventh entry is `/api/management-report` at `0 12 * * *` (12:00 UTC = 20:00
Asia/Kuala_Lumpur, UTC+08:00). The old unconsumed pending JSON has been retired;
`vercel.json` is the only deployed cron definition. Existing branch-specific
deployment guards are preserved. The worker also checks the Malaysia 20:00–20:59
window and ignores URL date/recipient overrides. Test and daily run keys are separate,
so an earlier `[TEST]` does not suppress the first approved daily report.

For this user-approved activation:

1. Re-fetch/review latest production main. Run all existing release tests and build.
2. Inspect actual source schema/permissions and benchmark the read-only aggregate
   against production-like data. Existing payment/company indexes are reused;
   do not add source-table indexes without measured need. Confirm missing identity
   links and mixed-charge labels meet operational expectations.
3. Verify the prior accepted test attempt, provider message ID and confirmed arrival
   at `60198894911`. Preserve the existing Whapi business channel/token and company.
4. Verify the three already-applied reporting migrations and current function-only
   access. **No migration is needed for activation; do not rerun any applied SQL.**
5. Confirm the Vercel plan supports seven cron jobs and within-minute daily execution;
   stop on any platform limit. Preserve the existing `CRON_SECRET` and all six jobs.
6. Set production SEND=true and SCHEDULE=true only; keep TEST=false. Do not change
   recipient, company, sender/token, other settings or source defaults. Existing
   deployments retain their environment snapshot, so use the normal Git/Vercel
   production workflow for the reviewed activation commit.
7. Verify Ready production deployment, the seventh registered cron, live Admin
   configuration and denied unauthorized access. Do not manually invoke the cron,
   request a test authorization or send another message during verification.
8. Confirm no new send/run/attempt occurred during the release and report the next
   scheduled 20:00 Malaysia run. Inspect scheduled results through existing private
   logs; failure reconciliation requires review, never a blind retry or deletion.

Rollback/stop: set SEND=false and SCHEDULE=false, deploy; disable/remove only the
new report cron. Existing cron schedules remain. Preserve report/attempt history
for audit. Roll back the additive UI/API if necessary; do not drop tables, source
records or existing policies. A Vercel code rollback alone may not remove cron
configuration—verify it separately. Before any later schema cleanup, export and
review the report audit history and obtain explicit approval.
Keep the executor and private functions while retaining the reporting tables.
If permanent removal is later approved, first preserve audit data, remove only the
three reporting entrypoints and two private implementations, revoke their specific
grants/policies and remove the now-unused role after checking dependencies. Do not
use broad DROP OWNED/CASCADE cleanup or change existing operational policies.

## Verification

`npm run test:management-report` executes the actual new SQL migration in disposable
PGlite with synthetic source records, and the real TypeScript sender/service/API
against a mocked provider. It never connects to production or sends WhatsApp.
The complete unmodified migration runs atomically under PGlite's bootstrap role.
A second fixture verifies role creation, ownership transfer, all table/function DDL
and grants under a non-superuser migration role. PGlite's template1 database cannot
grant database CREATE reliably, so only schema creation in that fixture is bootstrapped
with the same owner; the real production migration role's database CREATE privilege
is separately inspected read-only. This is not a claim of a production installation.
Security regression tests deny direct service-role table operations, executor role
assumption, ordinary-user RPCs, forged JWT elevation and search-path poisoning while
exercising successful daily/test claim/finalization and duplicate/retry protection.
`npm run build` includes these tests and all existing prebuild gates. Type checking
is `npx tsc --noEmit`. Production catalog/role checks and a read-only snapshot RPC
passed after migration. The personal-recipient live test was confirmed before daily
activation approval. The first real scheduled invocation remains pending until its
normal scheduled time; local tests do not claim scheduler delivery or load testing.

## Historical base-PR deployment check

At the original PR review, Vercel project `dekez` environment metadata was inspected without decrypting any
secrets: the three `DEKEZ_REPORT_*_ENABLED` variables and `WHAPI_TOKEN` are absent,
with zero hidden production environment variables reported. That historical check
is not current production-configuration evidence; credentials were configured later.
No settings were changed during that check. Recheck privately before a later approved release. Do not configure any
enable flag as true until separately approved.

The review branch deployment guard does **not** disable main auto-deployments.
Merging into main can trigger deployment. Do not merge until the user approves that
release consequence, or separately approves arranging a deployment hold. This PR
preparation neither merges nor changes deployment settings.
