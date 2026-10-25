# Whapi daily reporting — final pre-merge preparation

Result: **PASS for review/merge readiness, subject to release approval**.
Checked on 25 October 2026 for Draft PR #17:
https://github.com/dekezsb/DEKEZ/pull/17.

## Migration reconciliation

Production project: `palhkdkmfroqvrjutffc` (Dekez Sdn Bhd).
Production history contains exactly one reporting migration, version
`20261025083739`, name `whapi_management_reports`.

The source file was renamed, without changing SQL, from
`supabase/migrations/20261025055210_whapi_management_reports.sql` to
`supabase/migrations/20261025083739_whapi_management_reports.sql`.
There is only one reporting migration file; the old filename is removed.
This aligns the CLI's version-based migration identity with production history.
No migration repair, rerun, database DDL/DML or production-history write occurred
during this preparation. This is not a full reconciliation of unrelated migrations.

The approved SQL at commit `e5f5295`, renamed source file and production's stored
migration statement all match: **15,218 bytes**, SHA-256
`3dd63a191dc0a0901dde637c3b8e4a51beccfc5a2658a184d1466ea9356c0b75`.
A new regression test requires the canonical version exactly once and checks the
approved SQL hash (normalizing checkout line endings on Windows).

**Production must skip this already-applied migration. Do not reapply the old file.**
Retire any local deployment checkout that still contains the old filename before
running a future migration command. Review a migration dry run before any later
approved database release; unrelated pending migrations are not authorized here.

## Security and compatibility

Fresh read-only production checks confirmed:

- Both reporting tables have RLS and FORCE RLS enabled.
- `anon`, `authenticated` and `service_role` have no direct table privileges.
- Three public reporting entrypoints are SECURITY INVOKER with restricted EXECUTE.
- Two private SECURITY DEFINER implementations retain the restricted executor,
  empty search path, row security and timeout settings.
- Report and delivery-attempt counts remain **0 / 0**.

Earlier post-installation permission-denial probes, read-only snapshot execution,
and unchanged operational-data/policy fingerprints are recorded in
`production-migration-result.md`; no operational records were modified in this
pre-merge preparation. The independent final PR review found no merge-blocking
runtime, UI, SQL or authorization issue. No existing rental/accounting/payment,
tenancy, maintenance, Meta WhatsApp or in-app chat workflow code is changed.

The base was re-fetched and reviewed at `origin/main`
`fc5a3a366e90ce61fe4c9a3f9fa9ab9c607dfd92`. Reconciliation changes only the migration
filename, test references/hash regression and release evidence/documentation.
It does not change the approved SQL or reporting runtime behavior.

## Sending and schedule remain disabled

Vercel project `dekez` (`prj_YkRkOBkodAdGUErZMYsoIwjqaFiQ`) environment metadata was
read without decrypting secrets. It reported zero hidden production variables.
All three enable flags are absent:

- `DEKEZ_REPORT_SEND_ENABLED`
- `DEKEZ_REPORT_TEST_ENABLED`
- `DEKEZ_REPORT_SCHEDULE_ENABLED`

`WHAPI_TOKEN`, `WHAPI_REPORT_TO` and `DEKEZ_REPORT_COMPANY_ID` are also absent.
The code requires explicit `true` gates and valid configuration before sending;
the current configuration cannot send a Whapi report. No environment value changed.

All **six** existing Vercel cron definitions are exactly equal to main. The report
cron is not registered; it remains only in the pending configuration file. The
feature branch's automatic-deployment guard remains `false`.

**That feature-branch guard does not disable main auto-deployment.** Before merging,
obtain the user's approval for the resulting production release, or a separately
approved deployment hold. This review does not authorize or perform either action.
Recheck environment metadata before release and keep all report gates absent/false.

## Checks actually executed

| Check | Result |
| --- | --- |
| All configured prebuild automated suites | 582 passed; 0 failed/skipped/cancelled |
| Reporting tests within that total | 39 passed |
| Existing regression tests within that total | 543 passed |
| Optimized Next.js production build | PASS, exit 0; 52 static pages generated |
| Separate `npx tsc --noEmit` | PASS, exit 0 |
| `git diff --check` | PASS |
| Approved source vs renamed SQL byte comparison | Identical |
| Production history SQL hash/length comparison | Identical |
| Existing cron-array comparison | Identical, 6 entries |
| Reporting private access/configuration checks | PASS |

Tests used disposable local databases, synthetic records and mocked delivery;
they did not send WhatsApp or insert production report runs. The production build
was additionally run directly with the installed Next.js executable and completed
successfully. Prior responsive screenshots remain historical evidence, not a new
browser test claim for this filename-only update.

## Remaining boundaries / next action

No code merge, application deployment, migration execution, real provider request,
test message, schedule activation or production configuration change was performed.
Live provider delivery, HTTP gateway integration, actual scheduler execution and
multi-worker load/latency tests remain unperformed and approval-gated. Local PGlite
tests exercise duplicate protection, not production-scale concurrency.

The database migration needs **no further production application**. Review this
updated draft, then explicitly approve merge/release when ready. Keep reporting
disabled for that release. Enabling a real test send or the daily schedule requires
separate approval and the configuration/verification steps in
`docs/whapi-management-report.md`.
