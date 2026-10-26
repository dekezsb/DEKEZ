# Whapi reporting commands

This addition lets the approved personal WhatsApp account request read-only DEKEZ company summaries from the existing business channel. It is a predefined command handler, not an AI agent. It does not change financial records, Meta WhatsApp, in-app chat, the daily report or any existing cron schedule.

Implementation is prepared for review only. No production migration, deployment, webhook update or live message is part of this change.

## Commands and report scope

Send one of these phrases from `60198894911` to the existing DEKEZ AI MANAGER business account `60168173911`:

- `Today's due and overdue`
- `Today's rental collection`
- `Monthly rental report`
- `Vacant rooms`
- `Maintenance report`
- `Full management report`
- `Help`

The prefix `Send me ` is accepted, including `Send me today's due and overdue`. Matching ignores case, repeated spaces, curly apostrophes and one final punctuation mark. Other instructions, dates, recipients, SQL, quoted-message instructions and free-form requests are ignored. There is no unrestricted user directory or AI query generation.

All reports use the server-configured `DEKEZ_REPORT_COMPANY_ID` and current Malaysia date. Monthly collections mean month-to-date, not a completed future month. Outstanding figures cover current issued invoices across periods and are labelled accordingly. Room and maintenance responses contain company totals, not tenant names, phone numbers, identity documents, bank details or internal notes.

The existing `dekez_management_report_snapshot` and `sendWhapiReport` are reused unchanged. The new `dekez_report_due_snapshot` copies the reviewed invoice eligibility, billed-extra balance and canonical tenant identity expressions exactly: removed/draft/cancelled/waived/unissued/future bills are excluded, balance is floored at zero, and the separate security-deposit amount is excluded. A paid-status bill with remaining billed extras is not incorrectly dropped. Due today (`due_date = Malaysia date`) and overdue (`due_date < Malaysia date`) are disjoint invoice groups. Each group has distinct tenant counts; the combined count is distinct across both groups, not their sum. Missing source context makes affected metrics unavailable rather than zero.

## Security and failure behavior

`POST /api/webhooks/whapi-reporting` is separate from the existing Meta webhook. It requires a dedicated secret in the `Authorization: Bearer <secret>` header, then checks authenticated provider metadata:

- Channel exactly `FALCON-D9NS9`.
- Event `messages.post`, expressed as `event.type = messages`, `event.event = post`.
- Text message, `from_me = false`.
- `from = 60198894911` and `chat_id = 60198894911@s.whatsapp.net`.
- Timestamp no older than 15 minutes and no more than 60 seconds ahead.
- Bounded message ID, text, batch (50) and HTTP body (64 KiB).

Names, body text, quoted content and webhook-supplied company/recipient values never authorize a sender. Groups, broadcasts, statuses, outgoing echoes and LID-only identities fail closed. Secret authentication is checked before reading/parsing the body. Provider documentation supports custom headers, not a fabricated signature mechanism. The secret must be independently generated, 32–256 base64url characters; never reuse `WHAPI_TOKEN`, `CRON_SECRET` or an existing Meta secret.

`DEKEZ_REPORT_COMMANDS_ENABLED` defaults to false. The handler additionally requires the existing send gate, valid company configuration, approved recipient and Whapi token. The test and schedule gates do not authorize incoming commands. This does not alter the existing active daily-report environment settings.

The database permanently deduplicates `(channel_id, incoming_message_id)`. One short transaction serializes the rolling rate limit: **6 accepted commands per minute and 30 per hour**. Failed/uncertain reservations consume capacity; repeated delivery of the same ID does not. Rate-limited events are recorded without sending a reply. A second, one-shot preparation transaction saves the exact aggregate snapshot and outgoing text before the network request. Only the winner can send.

There are no automatic outbound retries, including definite rejection. A network timeout, ambiguous provider response, lost finish response or interrupted worker is never permission to resend. `accepted` means the provider accepted the message; it is not proof of handset delivery. A stale `processing` row, especially with `prepared_at`, requires manual reconciliation and must not be reset. If data cannot be verified, no financial reply is sent; the audit records a sanitized failure. The user may send a new command later. Never include raw request bodies, secret headers or provider/database errors in logs.

## Migration and access

Review-only migration: `supabase/migrations/20261026115436_whapi_reporting_commands.sql`.

It adds one table, `dekez_reports_private.command_requests`, indexes, forced RLS and these service-only entry points:

- `dekez_report_command_claim`
- `dekez_report_command_prepare`
- `dekez_report_command_finish`
- `dekez_report_due_snapshot` (read-only)

Private privileged implementations run under the existing NOLOGIN, NOINHERIT, NOBYPASSRLS reporting executor with empty `search_path`, actual server-role checks and explicit grants. Public entry points use SECURITY INVOKER. Ordinary portal users and direct service-role table queries have no access. No existing rental, payment, tenant, tenancy, maintenance or report-run records are updated by the migration. Prior migrations and existing policies/functions remain unchanged. A five-second lock timeout aborts rather than forcing through locks.

Read-only production inspection on 26 October 2026 found no new-object conflicts, all three required reporting migrations installed, the restricted executor present, and the existing snapshot function body matching the reviewed source (`md5 = 2408c9020c9474333d34659d22bff316`). Live Whapi Settings showed DEKEZ AI MANAGER / FALCON-D9NS9 with an empty incoming webhook URL. Nothing was saved.

## Verification

Executed locally with synthetic data and mocked HTTP:

- Complete automated suite: **732 passed, 0 failed**.
- New command tests: **26 passed**; new SQL tests: **19 passed**.
- Native PostgreSQL 17.11, independent sessions: **7 passed**. Duplicate claim race used backend PIDs 26604 and 23100; only one committed claim. Seven distinct concurrent caller sessions produced six claims and one rate-limit result. Concurrent preparation allowed only one winner. A held lock failed closed after 5,017 ms. No deadlocks or source-record changes.
- Production build passed; TypeScript and dependency audit are included in release evidence.
- Dependency audit: **zero known vulnerabilities**, including development dependencies.
- Independent static security review: no blocking findings.

Run the repeatable tests with `npm run test:management-report`. The optional native concurrency runner is `tests/fixtures/management-report-commands-native.cjs`; it requires explicit `--pg-bin` and `--output-dir`, creates a fresh localhost-only database and accepts no remote database connection. It shuts down its cluster after testing. Local proof is not a live webhook delivery test.

## Approval required before activation

1. Review and approve the Draft PR and migration. Refresh production compatibility and backup checks before applying only the new migration transaction; do not reapply the three prior migrations.
2. Deploy approved code through the existing workflow with commands still disabled. The feature branch is marked deployment-disabled so this Draft PR does not create an automatic preview deployment.
3. Configure a new server-only `WHAPI_REPORT_WEBHOOK_SECRET` as a production secret. Preserve `WHAPI_TOKEN`, `WHAPI_REPORT_TO=60198894911`, company ID and all existing daily-report settings. Do not put secrets in URLs, source, screenshots, logs or PRs.
4. With separate approval, set `DEKEZ_REPORT_COMMANDS_ENABLED=true` and redeploy. Existing seven cron entries (six earlier jobs plus the daily `0 12 * * *` report) remain byte-equivalent; no new cron is needed.
5. Configure a dedicated Whapi callback to `https://dekez.vercel.app/api/webhooks/whapi-reporting`, `mode: body`, only `messages.post`, with the dedicated Authorization header. The visible dashboard did not expose header controls; use the documented settings API or provider-supported header setup, never an unauthenticated workaround. First read and preserve existing settings/webhooks; omitted settings may reset to defaults. Do not modify the Meta callback or outgoing channel identity. Set a suitable maximum webhook age (900 seconds); stale/replayed events remain denied server-side.
6. After approval, send one real command from the authorized personal account and compare its audited result with DEKEZ. Verify delivery, replay behavior and outgoing echo rejection. This live test has **not** been performed.

For rollback, disable only the new incoming webhook immediately, then disable the commands flag and redeploy if needed. Do not change the shared Whapi token or daily-report switches. Retain the private ledger for audit and deduplication; do not delete/reset reservations. An already dispatched request may still complete, so check its audit rather than resend. The additive schema can remain with commands disabled; dropping functions/table requires a separate reviewed rollback and retained audit backup.

## Provider documentation

- [Incoming message format](https://support.whapi.cloud/help-desk/receiving/webhooks/incoming-webhooks-format/incoming-message)
- [Webhook settings and retry behavior](https://support.whapi.cloud/help-desk/receiving/webhooks/detailed-webhook-settings)
- [Settings API and custom webhook headers](https://whapi.readme.io/reference/updatechannelsettings)
- [Webhook test schema](https://whapi.readme.io/reference/webhooktest)
