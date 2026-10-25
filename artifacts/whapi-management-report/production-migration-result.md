# Whapi reporting migration execution — PASS

Applied on 25 October 2026 to **Dekez Sdn Bhd**, production/main,
project `palhkdkmfroqvrjutffc` (Singapore; PostgreSQL 17.6.1.141).

## Approved artifact and recovery prerequisite

- Approved PR: https://github.com/dekezsb/DEKEZ/pull/17 (remains draft/unmerged).
- Approved commit: `e5f5295dd25d2d98d34c993927415b58eb765199`.
- Approved file: `supabase/migrations/20261025055210_whapi_management_reports.sql`.
- Size: 15,218 bytes.
- SHA-256: `3dd63a191dc0a0901dde637c3b8e4a51beccfc5a2658a184d1466ea9356c0b75`.
- Working file, approved Git commit and SQL stored in production migration history
  all match this hash.
- Supabase dashboard confirmed the correct production project and an available
  PHYSICAL backup with enabled Restore action, dated **24 October 2026 23:54:08 UTC**
  (**25 October 2026 07:54:08 MYT**), approximately nine hours before execution.
  No restore was performed. A daily recovery point does not cover changes made
  after its timestamp; restore requires an explicit recovery decision and downtime.
- Dashboard: https://supabase.com/dashboard/project/palhkdkmfroqvrjutffc/database/backups/scheduled

## Execution

The Supabase migration tool received only the exact approved SQL and returned
`success: true`. The SQL uses BEGIN/COMMIT, 5-second lock timeout and 30-second
statement timeout. No unreviewed SQL was appended; no operational data DML,
cron registration or external message send was executed.

Supabase assigned execution version **20261025083739**, name
**whapi_management_reports**, rather than reusing the source filename timestamp.
There is exactly one history entry, containing the exact approved SQL (one stored
statement, 15,218 bytes, matching SHA-256 above). This maps source version
`20261025055210` to production execution version `20261025083739`.

**Before any future CLI database push, reconcile this version mapping through an
approved migration-history/source alignment step. Do not attempt to apply the file
again merely because its original filename version is absent.** No history repair,
file rename, PR change or additional migration was performed in this execution.

Subsequent approved pre-merge preparation completed the source-only alignment:
the canonical file is now `20261025083739_whapi_management_reports.sql`, byte-identical
to the original approved SQL, and the original filename is removed. Production
history and database objects were not altered or rerun. See `pre-merge-results.md`.

## Post-migration security verification

- New tables: `dekez_reports_private.report_runs` and `delivery_attempts`.
  Both owned by postgres; RLS enabled and FORCE RLS enabled.
- PUBLIC/anon/authenticated/service_role have no direct table grants. Actual
  SELECT attempts as anon, authenticated and service_role were rejected with
  SQLSTATE 42501. Catalog checks cover both tables and all table privilege types.
- Ordinary authenticated API users (including tenants, owners and contractors)
  have no private schema access or EXECUTE on any of the five reporting functions.
  Actual anon/authenticated snapshot RPC attempts were rejected with SQLSTATE 42501.
- Three public entrypoints remain SECURITY INVOKER and executable by service_role.
- Private claim/finish are SECURITY DEFINER, owned by dekez_report_executor, with
  empty search_path, row_security=on and 10-second statement timeout.
- Executor: no login, inheritance, superuser, CREATEROLE, CREATEDB, replication or
  BYPASSRLS. No runtime-role membership and no CREATE on private schema. Its
  SELECT/INSERT/UPDATE privileges and six policies apply only to the two new tables;
  no DELETE/TRUNCATE or access to the 12 operational source tables.
- Migration administrator retains role administration but no SET/INHERIT membership.
  Privileged database administrators remain trusted administrators.
- Read-only snapshot RPC executed successfully as service_role: valid JSON object,
  correct Malaysia-local report date, expected metric keys. No totals/PII copied
  into this evidence report and no delivery functions invoked.
- Final table counts: **0 report runs, 0 delivery attempts**.
- Security Advisor before/after results are identical after excluding observation
  timestamps; no finding refers to the new reporting objects. Existing unrelated
  findings remain: [18 private RLS/no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
  [3 mutable search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
  [20 anon-executable definers](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
  [26 authenticated-executable definers](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
  and [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
  This migration does not claim to resolve those pre-existing findings.

## Existing data and access unchanged

Before/after ordered full-row content fingerprints and counts match for all 12
tables below. The baseline was captured at 08:36:53 UTC and after-check at
08:38:33 UTC. No raw tenant or financial records were exported.

| Existing table | Rows before = after |
| --- | ---: |
| companies | 1 |
| profiles | 176 |
| properties | 10 |
| payments | 699 |
| rent_bills | 1,030 |
| rental_invoice_line_items | 36 |
| tenancies | 165 |
| tenants | 160 |
| tenant_records | 171 |
| payment_submissions | 514 |
| rooms | 150 |
| maintenance_tickets | 61 |

Existing public function bodies/settings/owners/grants, public RLS policy
definitions and public table ownership/grants/RLS settings also have identical
before/after fingerprints. The new reporting functions are excluded from the
existing-function comparison. Existing workflows, accounting and WhatsApp code
were not changed.

## Restrictions preserved and diagnostics

No PR merge, application deployment, Vercel configuration change, scheduled report
activation or WhatsApp send. The code's SEND/TEST/SCHEDULE flags still default off;
no environment variables were changed. The new cron remains pending only, and
the review-branch deployment guard is unchanged. Application runtime settings were
not changed or independently reconfigured during this database-only execution.

No migration execution error. One preliminary read-only evidence query needed an
explicit catalog type cast, and one local result parser needed correction; both
were resolved without data/schema writes. Expected permission-denial probes are
successful negative tests, not migration failures.

Future live delivery and scheduler testing remain unapproved and unperformed.
Rollback preference is to keep sending disabled and retain private audit structures;
do not delete operational records or restore the entire production database without
an explicit recovery plan.
