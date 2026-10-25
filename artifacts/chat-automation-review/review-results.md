# Chat automation review — 25 October 2026

Local implementation integrated onto production UI base `5b26e24` in the isolated `feature/chat-automation-review-20261025` branch. Nothing was pushed, migrated, deployed or enabled in production in this turn. No live customer messages or paid model calls.

## Implementation

- Existing shared chat workspace gains trusted source labels, Admin filters, persistent Needs Admin Reply, assistant pause/resume and manual takeover. No new portal or inbox.
- Dedicated server-only reminder and assistant workers; existing WhatsApp/accounting workers and schedules retain their original code/settings.
- Reminders use Malaysia calendar dates, 7/3/1/deadline/one-overdue stages, current status rechecks and a unique delivery ledger. Already paid, pending verification, signed, completed renewal, checked-out or unauthorized sources are skipped. Real agreement clauses are required for contractual deadlines.
- Assistant waits 120 seconds plus the worker interval, answers only conservative supported intents from unambiguous authorized data, and escalates sensitive/unclear cases. Manual reply pauses until explicitly resumed. Actual payment recording, not a user's claim, governs payment confirmation.
- Optional model can only confirm/veto an intent. It cannot produce financial figures, choose records, call action tools or change business records. Tested default mode is deterministic, not a live generative-model evaluation.
- Tightened office-hours validation: missing end times, null day entries, invalid weekdays and unsupported overnight windows are rejected rather than partially accepted.

## Additive schema, unapplied

Ordered migrations:

1. `20261024160904_dekez_chat_tenant_reminders.sql`
2. `20261024164249_dekez_admin_message_center.sql`
3. `20261024170258_dekez_chat_assistant.sql`

New private RLS-enabled tables: `reminder_control`, `agreement_reminder_deadlines`, `reminder_deliveries`, `reminder_runs`, `welcome_control`, `welcome_deliveries`, `assistant_control`, `assistant_state`, `assistant_deliveries`.

Existing messages gain nullable source metadata. Existing message history is not backfilled or rewritten. Private helpers have restricted execution; ordinary clients cannot configure automation, forge source labels, invoke workers or change delivery records. Existing participant/job checks remain authoritative. Support scope and Owner–Tenant blocking are unchanged.

## Tests actually run on this review branch

- `npm run test:dekez-chat`: initial 128 passed; final configured gate 130 passed after two extra regression tests.
- `node --test tests/dekez-chat-assistant.test.cjs`: 21 passed.
- `npm run build`: passed; mandatory prebuild 543 tests passed, zero failures.
- `node --test tests/portal-consistency.test.cjs`: 3 passed.
- Browser suite passed against actual React components, API handlers and migrated PGlite SQL. Covered unread/preview updates, same-thread reminder/reply/assistant/manual response, assistant labels, takeover, escalation, controls, access isolation and existing chat attachment/support regressions.
- 12 viewports: 320×568, 375×812, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1024×1366, 1280×800, 1366×768, 1440×900, 1920×1080. No page-level horizontal overflow or browser exceptions.
- Added complete automation-flow test with rejecting write triggers on every synthetic business-source table (profiles, properties, rooms, tenancies, tenants, ownership/settings, company scope, maintenance, invoices, payments, submissions, agreements and renewals). Flow passed without any source write or new conversation.
- Standalone `npx tsc --noEmit` and diff whitespace checks passed. No lint command is configured.

These are disposable synthetic tests. Local invalidation events stand in for Supabase Realtime transport. They do not establish production WebSocket delivery, real-user authentication, multi-connection lock behavior or a live model's quality. Existing SQL tests simulate source status transitions; no real invoice or payment was submitted.

## Remaining activation gates

1. Show this review and obtain approval before any production migration/release/activation. User has explicitly withheld that approval for this task.
2. Apply and validate only these reviewed additive migrations in an approved isolated environment, including actual auth, scoped Supabase Realtime and concurrent workers. Do not blindly replay unrelated migrations.
3. Keep new application and database enabled flags off. Review current source eligibility in preview mode, including legacy overdue backlog and missing authorized conversations. The earlier source audit in the feature docs is historical, not a fresh production count.
4. Actual signing/notice/auto-renewal deadlines are not available as authoritative structured fields in the inspected implementation. Reviewed exact-clause/fingerprint extraction is required; until present, those affected schedules intentionally do not send. No generic terms, new dates or automatic renewals are introduced.
5. Optional provider/model, data-processing terms and budget require configuration and evaluation. No provider credentials invented; no paid call made. Office days/hours remain unset unless supplied. Same-day office windows only.
6. Confirm scheduling plan/capacity and existing server-only secrets. Proposed cron additions affect only the new in-app workers; no existing schedule changed. No new subscription charges authorized or incurred.
7. Review the pre-existing dependency security advisories noted in the feature documentation (including the pinned existing Next.js version) before production. This task did not upgrade the framework or modify unrelated dependencies.

## Release and rollback after approval

Use the existing branch/PR workflow; compare current production again. Apply reviewed additive migrations disabled, deploy with automation flags disabled, validate approved end-to-end accounts, inspect dry-run candidates, then separately enable controlled sending after approval. Monitor aggregate run counts, errors, duplicate skips and queues.

Rollback is disable-first: turn off the new worker switches and private enabled flags, then revert application release if necessary. Preserve messages, delivery ledgers and audit history; do not drop tables or delete sent messages. No rental, accounting, WhatsApp, tenancy or permission record requires reversal because none is modified by this feature.
