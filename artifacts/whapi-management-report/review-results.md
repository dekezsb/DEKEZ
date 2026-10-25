# Whapi management report — implementation review

Historical implementation/security review at commit e5f5295. The later approved
production migration and source-version reconciliation supersede the pre-migration
status statements below; see `production-migration-result.md` and
`pre-merge-results.md` in this directory for current status.

Date: 25 October 2026. Review branch: `feature/whapi-report-review-20261025`.
Based on current production main `fc5a3a366e90ce61fe4c9a3f9fa9ab9c607dfd92`.

## Safety status

- No production deployment, migration, configuration change, real WhatsApp send,
  or production data write.
- New cron is pending only; all six existing cron definitions are unchanged.
- `vercel.json` disables automatic deployment for this review branch only; main
  and other branches retain their existing deployment behavior.
- All three report sending/test/schedule switches default off.
- Existing Meta WhatsApp, chat, accounting, financial records, permissions and
  business workflows unchanged. Existing unrelated local release-result file preserved.

## Tests actually run

| Check | Result |
| --- | --- |
| New report unit / local SQL / UI tests | 38 passed, 0 failed |
| Existing mandatory prebuild suites | 543 passed, 0 failed |
| Production application build | Passed; both new routes compiled |
| TypeScript `npx tsc --noEmit` | Passed |
| `git diff --check` | Passed |
| Actual report page HTML + existing built CSS in Chromium | Passed at 320×568, 390×844, 820×1180, 1024×768, 1440×900 |
| Disabled Send Test Report, browser errors, horizontal overflow | Passed at all five sizes; no browser errors or external requests |

The security-fix build reran all 543 existing tests plus all 38 reporting tests
(581 total), then completed the production build successfully.
TypeScript and whitespace checks also passed on the review branch.

Coverage includes: confirmed/partial allocated receipts counted once; deposit,
pending, reversed, future-date and other-company exclusions; extra invoice lines;
distinct overdue tenant identity; actual room and maintenance statuses; Malaysia
midnight/month/year/leap-day boundaries; null/missing data labels; Admin, unauthenticated,
ordinary database-role denial; fresh profile checks; default-off configuration;
claim concurrency; duplicate prevention; rejection cooldown/limit; uncertain send
and failed-finalization suppression; unchanged source records; self-number payload.

The actual service and migration ran together against disposable PGlite. All
Whapi HTTP responses were mocked, with dummy credentials only. Concurrent claims
were queued through PGlite's connection; real production multi-connection stress
and latency benchmarking are still required before activation.

Browser screenshots use the real new page/Card/Button HTML and built CSS, synthetic
authentication and aggregate fixture values. They verify layout and disabled controls,
not a live Supabase session or actual Next.js browser Server Action round-trip.

The only build warning was the existing module-type warning in accounting report
tests. No unrelated module/package changes were made to suppress it. No lint script
is configured; no lint success is claimed.

## Exact implementation files

Modified existing files:

- `app/admin-setup/page.tsx` — one link to the new report control.
- `package.json` — new test script and mandatory prebuild inclusion.
- `vercel.json` — review-branch-only automatic deployment suppression; cron array unchanged.

New runtime/UI files:

- `lib/management-report/model.ts`
- `lib/management-report/config.ts`
- `lib/management-report/authorization.ts`
- `lib/management-report/whapi.ts`
- `lib/management-report/service.ts`
- `app/api/management-report/route.ts`
- `app/admin-setup/management-report/page.tsx`
- `app/admin-setup/management-report/actions.ts`
- `app/admin-setup/management-report/test-control.tsx`

New migration/config/documentation:

- `supabase/migrations/20261025083739_whapi_management_reports.sql` (canonical filename after production-version reconciliation; SQL unchanged)
- `config/management-report-cron.pending.json`
- `docs/whapi-management-report.md`

New test files:

- `tests/fixtures/management-report.cjs`
- `tests/management-report-sql.test.cjs`
- `tests/management-report.test.cjs`
- `tests/management-report-ui.test.cjs`
- `tests/management-report-browser.cjs`

Evidence included in the PR: this review and five `admin-report-*.png` screenshots
in this directory. The earlier local build log is not committed.

## PR preparation review

Reviewed all 20 original implementation/evidence text files. One additional
configuration file (`vercel.json`) adds the review-branch deployment guard. With
five synthetic screenshot artifacts, the PR contains 26 changed files. The two
unrelated/local-only artifacts remain uncommitted.

Security review: server-only credentials, fixed HTTPS destination, fresh approved
Super Admin authorization, constant-time cron secret comparison, no caller scope
overrides, RLS plus revoked ordinary-user and service-role direct table access,
service-only invoker RPCs backed by narrowly owned private definers,
transactional claim/unique-key duplicate protection, sanitized failure logging,
and conservative unknown-outcome handling were checked. No blocking finding.

Migration review: creates one private schema, two tables, constraints/indexes and
three new RPCs, two private functions, six new executor-only policies and one
non-login executor role; operational tables are read-only sources. No existing policy,
function, tenant, rental or payment record is modified. Existing accounting,
Meta WhatsApp, chat, lockfile and cron definitions remain unchanged. Read-only
fetch confirmed the branch base exactly matches current origin/main.

The review-branch deployment guard follows Vercel's documented
`git.deploymentEnabled` branch map; it does not disable main or other branches.
https://vercel.com/docs/project-configuration/git-configuration

## Final function-only security correction — PASS

The earlier service-role direct SELECT/INSERT/UPDATE finding is corrected.
`service_role` has no table privileges on report_runs or delivery_attempts and no
membership in the internal executor. Only the dedicated executor has narrowly
scoped SELECT/INSERT/UPDATE; it cannot log in, bypass RLS, inherit other roles,
DELETE/TRUNCATE reporting records or access operational source tables. Both new
tables FORCE RLS and remain owned by the migration administrator, not the executor.

Audited every reporting SECURITY DEFINER function (private claim and finish):
fixed empty search_path, fully qualified references, row_security=on, bounded
timeout, no dynamic SQL, actual database-role check and explicit service-only
EXECUTE. No public SECURITY DEFINER functions are added. Runtime callers cannot
SET ROLE to the executor; forged JWT role metadata cannot bypass the guard.
The three public RPC signatures and application code remain unchanged.

New executable regression coverage proves direct table access is rejected while
daily/test delivery tracking, idempotency and finalization continue working. The
whole migration runs atomically in disposable PostgreSQL/PGlite. A non-superuser
fixture additionally tests ownership/grants and policies; only its schema creation
uses a bootstrap workaround for PGlite's template1 CREATE-privilege limitation.
Production installation has not been executed. Database administrators remain
trusted administrators, not a role this function-only boundary can restrict.

Read-only production compatibility recheck (25 October 2026):

- Executor role, private schema and all three RPC names are absent; migration is
  not installed. No collision or accidental replacement of existing functions.
- All 12 source tables exist, have RLS enabled, and retain service-role SELECT.
  No PUBLIC table grants on those sources would leak access to the new executor.
- Existing postgres migration role has CREATEROLE, database/public-schema CREATE
  and companies/profiles REFERENCES; UUID dependency exists. Public default
  function grants are explicitly revoked for ordinary API roles by this migration.
- Read-only EXPLAIN of the snapshot under service_role succeeds against live
  source columns and types (estimated total cost 605.12; not a runtime benchmark).
- Existing gateway pre-request hooks allow the service-role reporting RPC paths;
  no hook, existing policy, source record or production configuration was changed.
- Refetched origin/main still matches the reviewed base. All six existing cron
  definitions and default-off sending switches remain unchanged.

Recommendation: approve this corrected additive migration as a separate controlled
step, subject to rechecking schema drift at application time. Migration approval is
not approval to merge, deploy, activate schedules or send messages. Keep the private
schema unexposed. Preserve audit history on rollback; stop sending and roll back
application code instead of deleting reporting data or using broad CASCADE cleanup.

## Not yet verified / approval gates

Production schema installation, authenticated live gateway RPCs, production data
comparison/query latency, configured Whapi channel/token, real self-number delivery
and real Vercel scheduled invocation have NOT been tested. The verified provider
schema documents `sent` and `message.id`; acceptance is not proof of delivery.
Unknown outcomes remain blocked for operator reconciliation, not blind retry.

Required environment variables, privacy/metric definitions, migration permissions,
retry limitations, release steps and non-destructive rollback are in
`docs/whapi-management-report.md`. Next step is review—not automatic deployment.
