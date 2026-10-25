# Tenant reminders through DEKEZ chat

Latest integrated review: [25 October review results](../artifacts/chat-automation-review/review-results.md). Source counts and earlier test totals below are historical audit/checkpoint results, not fresh production observations. The integrated assistant/reminder branch passed 543 prebuild tests plus 3 UI checks, build, type checking and 12-viewport browser tests; no live sending was enabled.

Local implementation; NOT installed, deployed or enabled in production. No real reminders sent.

## Boundaries

Separate `/api/dekez-chat-reminders` worker. The existing WhatsApp/TTLock reminder endpoint, accounting, payment verification, agreements, tenancy dates and chat permission functions are unchanged. The worker reads authoritative business records and writes only its own operational tracking plus new chat messages/counters through the existing send function. No enrollment, grants, conversations, profiles, rental invoices, payments, renewals or agreements are created by this worker.

Messages use the existing approved Super Admin participant in the existing Admin–Tenant property/company chat. A database-only `system_label` displays **DEKEZ Admin** for these automated messages; ordinary messages retain their normal names. No user/profile is renamed. Admin can reply normally in the same conversation. Delivery uses normal unread counters and user-scoped Realtime signals; it does not refresh the portal.

## Schedule and stopping

- Date basis: database time in `Asia/Kuala_Lumpur`.
- Saved deadline minus today: 7, 3, 1, 0 days. Missed pre-deadline stages are not backfilled together.
- Overdue: one action-required reminder per source, not daily spam. First eligible run after deadline sends it, including existing overdue sources at activation; review this initial catch-up before enabling sends.
- Unique `(tenant_id, source_key, stage)` ledger; source key includes reminder type and invoice/agreement ID. A changed deadline cannot accidentally resend the same stage. If future policy requires re-notification after an amended deadline, that needs explicit approval, not ledger deletion.
- Recheck after locking source records immediately before delivery. Stop for paid/zero-balance/hidden/removed/cancelled/waived bills, pending payment verification, checkout/inactive tenancy, signed/rejected/replaced TA, or completed cycle-specific renewal decision. A prepared unsigned next term is NOT completed renewal consent.
- Partial bills show saved invoice amount and remaining unpaid amount. Confirmed payments exceeding the stored paid balance suppress reminders until the existing payment workflow has synchronized; the worker never repairs financial data.
- Missing canonical tenancy/profile linkage or a missing/closed/revoked existing Admin conversation: skip, never guess or create one. Source authorization is rechecked by the unmodified chat send function.
- 50 candidates per bounded batch, persistent keyset cursor. Scheduler checks every ten minutes, offset from the existing jobs. It advances past skipped/failed candidates and revisits them on a subsequent pass. Existing 60/minute per-sender rate limit remains; rate-limited deliveries roll back and retry on a later pass.

## Actual sources and limits found in the read-only audit

- Rental: `rent_bills.due_date`, `amount`, `paid_amount`, `status`, `tenant_facing`, canonical `tenancy_id`/`tenant_id`/property/room. Payment submissions and confirmed linked payments are read-only suppression checks. Audit: 101 of 105 visible open bills had canonical tenancy links; unlinked legacy bills are intentionally not guessed.
- Expiry: the saved signed agreement's `term_end_date`, matching the tenancy's saved current end, not a newly calculated date. Completed decisions/signatures for the next cycle stop renewal/expiry action reminders.
- `agreement_notifications.due_at` is populated with the dispatch time. It is NOT a signing deadline. The current schema has no authoritative structured TA signing deadline or notice/auto-renew deadline.
- Saved agreements inspected contained “Renewal is not automatic.” No automatic-renewal warning is generated from that language or from template defaults.
- Audit found **zero existing Super Admin–Tenant chat conversations**. The worker is deliberately unable to deliver until an already-authorized conversation is opened through the existing chat workflow. This implementation does not change access setup.

For a real contract with a signing/notice/auto-renew deadline, the private `agreement_reminder_deadlines` register can record a reviewed extraction: agreement ID, type, actual deadline, exact source clause, agreement fingerprint, reviewer and review time. It is empty on installation and has no ordinary-user write endpoint. A database operator must only import facts reviewed against that specific agreement, with approval. No generic terms or guessed signing deadlines are seeded. The exact clause/fingerprint are validated, auto-renewal wording is required, contradictory non-automatic wording is rejected, and edited agreements invalidate the extraction until reviewed again. The fingerprint is a change detector, not a signature or authorization mechanism.

Until those actual facts exist, **unsigned-TA and contractual notice/auto-renew schedules are not operational for affected agreements**. Safe skipping is not full data readiness.

## Security and reliability

New private tables: `reminder_control`, `agreement_reminder_deadlines`, `reminder_deliveries`, `reminder_runs`, all RLS-enabled with no public/client access. Public change: nullable `dekez_messages.system_label` only. Existing chat RLS/publication/permission functions unchanged.

Only the service-role scheduler can invoke `dekez_chat_reminders(p_preview)`. It accepts no recipient, sender, body, conversation or date. It delegates locally to the existing Admin participant for the normal authorization/send function, restoring request identity after success/failure. The helper accepting a date is private and not executable by client or service roles. Message + delivery ledger + counters + realtime signal are transactional; a failed send leaves no partial delivery. Existing source row/FK locks serialize with status changes; failures are retried rather than modifying business data. An advisory lock prevents overlapping worker batches; durable uniqueness also prevents duplicates after retries.

`CRON_SECRET` is mandatory and compared safely. Missing/incorrect secret fails closed. Errors do not return raw SQL or private records. Aggregate run results and private audit SQLSTATE entries support diagnosis without logging message bodies. Existing role-based gateway remains unchanged.

## Tests and preview

Run `npm run test:dekez-chat`, `npm run test:dekez-chat-browser`, `npm run build`, and `npx tsc --noEmit`.

Offline tests use synthetic identities and a disposable PostgreSQL-compatible PGlite database. They cover stage dates/leap day, paid-before-next-stage, partial payment, pending proof, checkout, unsigned/signed TA, actual expiry, renewal completion, clause validation, duplicate/retry/rollback, batching, permission denial, unread/preview/signal update and Admin reply. Browser uses actual React/API/SQL with a synthetic invalidation event; it is **not proof of live Supabase WebSocket delivery or multi-session PostgreSQL concurrency**. No real financial test submissions.

Validated locally 25 October 2026 (Malaysia): full prebuild **504/504 passed**, production build passed, standalone TypeScript passed, focused reminder suite **29/29 passed** after final fail-closed hardening. Existing chat browser suite passed at 320×568, 375×812, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1024×1366, 1280×800, 1366×768, 1440×900 and 1920×1080. New reminder-specific browser assertions verified unread badge, latest preview, trusted sender label, manual Admin reply and no navigation reload; reminder screenshots checked at 390×844, 820×1180 and 1440×900. See `artifacts/tenant-reminders/`, `artifacts/tenant-reminders-build.log` and `artifacts/tenant-reminders-focused.log` locally. No lint command is configured.

## Approval-gated rollout

1. Fetch and compare current main/production; integrate safely and rerun the release gate. Do not overwrite newer production work.
2. Review/approve the additive migration `20261024160904_dekez_chat_tenant_reminders.sql`. Do not replay earlier local migrations whose production timestamps differ. Apply only this reviewed migration after approval; it starts disabled.
3. Deploy app with `DEKEZ_CHAT_REMINDERS_ENABLED=false`, `DEKEZ_CHAT_REMINDERS_SEND=false`; retain existing chat settings and existing secrets. Do not overwrite `CRON_SECRET` or service credentials. No new realtime publication/configuration is needed.
4. With approval, enable only `DEKEZ_CHAT_REMINDERS_ENABLED=true` for authenticated dry-run previews; keep SEND false and database control disabled. Preview reports at most the first 50 candidates and does not write tracking or messages. Resolve missing authorized conversations and reviewed real deadlines through existing/approved workflows—never silently provision them.
5. Review the due/overdue catch-up, then explicitly approve actual automatic messaging. Set database `reminder_control.enabled=true` and deployment `DEKEZ_CHAT_REMINDERS_SEND=true`. The real message scheduler will then run. Confirm one authorized tenant receives the reminder without reload, unread/preview update, Admin reply works, and a second run sends no duplicate.
6. Monitor `reminder_runs` / private audit for failures and skipped candidates, plus Vercel cron logs. Recheck live two-session delivery and source-status races before describing them as production-tested.

## Rollback / emergency stop

Set the reminder-specific database control to disabled first (waits for an in-flight transaction), and set `DEKEZ_CHAT_REMINDERS_SEND=false` or `DEKEZ_CHAT_REMINDERS_ENABLED=false`. This does not disable normal chat or other cron jobs. Revert only the new route/cron/UI-label deployment if necessary. Keep delivery ledger, sent messages and audit history; deleting them would break deduplication/audit. Leave additive schema dormant rather than dropping columns/functions underneath existing clients. Do not alter WhatsApp, accounting or tenancy state during rollback.

Cron security/concurrency reference: https://vercel.com/docs/cron-jobs/manage-cron-jobs
