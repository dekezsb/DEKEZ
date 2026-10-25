# DEKEZ Assistant — local implementation and release gates

Latest integrated review: [25 October review results](../artifacts/chat-automation-review/review-results.md). The older test counts below describe the earlier implementation checkpoint; the integrated branch passed 543 prebuild tests plus 3 UI checks, production build, standalone type checking and the 12-viewport browser suite. Office schedule validation now also rejects missing end times and null weekday entries. Nothing is deployed or enabled.

## Status and boundaries

Implemented locally, disabled by default. No production migration, deployment, live message or paid model request has been performed. This extends the existing shared Admin/Management–Tenant conversation; no new inbox, user identity, contact authorization, accounting integration or WhatsApp integration is created.

The implementation uses two layers: a conservative question classifier and fixed, reviewed database-backed response templates. Optional AI can confirm or veto a permitted intent; it cannot write a response, select a tenant, supply a record ID, invoke tools or mutate source records. Without a configured model, the feature uses the same bounded templates without a model call. It is an automated assistant, not an unrestricted general-purpose chatbot.

## Behavior

- Default wait: 120 seconds after the latest Tenant message, plus the minute worker interval. This gives a human time to reply first. Each invocation processes at most five conversations; backlog adds delay.
- Only active, existing authorized Admin/Management–Tenant relationships are eligible. Maintenance/job-scoped conversations and other role pairs are excluded. Current access is rechecked before delivery.
- Rent answers require exactly one active scoped tenancy and one visible current-month invoice. Outstanding uses the actual invoice amount minus recorded paid amount. Multiple outstanding periods, ambiguous records, conflicting payment state and missing data are escalated, not guessed or silently aggregated.
- Payment confirmation requires an actual confirmed, unreversed payment. Pending verification is labelled pending. A recorded partial payment is not described as a fully settled invoice. Saying “I already paid” does not update any record.
- TA expiry requires one current signed agreement consistent with the tenancy end date. Signing guidance points to the existing E-Tenancy section. No renewal or legal terms are invented.
- Maintenance reads the existing tenant/property/room ticket status. Multiple or unknown active records go to Admin. No maintenance ticket is created or changed.
- Sensitive decisions, complaints, ambiguous questions, unsupported language/phrasing, conflicting model classification and provider failures create a clearly labelled escalation. Multiple unanswered messages also escalate so an earlier complaint is not lost behind a later simple question.
- Escalation sets a persistent Needs Admin Reply flag and pauses the assistant. Reading the conversation does not clear this flag. Manual Admin reply clears it and enters Admin Takeover.
- Any manual Admin reply pauses automation until explicitly re-enabled, including a reply made while automation is globally disabled. Re-enabling does not replay old questions. New Tenant messages may then queue normally.
- Replies display **DEKEZ Assistant** and **Automated Assistant** in the same history, using the existing sequence, preview, unread and scoped signal path. Admin unread state is not silently marked read by the assistant.
- After-hours wording is added at most once per 24 hours, only if actual office days/start/end are configured in Malaysia time. No office hours are assumed. This initial configuration supports a same-day time window, not overnight shifts.
- Welcome remains the preceding once-per-relationship, disabled-by-default new-conversation welcome. It does not run every login, backfill old conversations, create a conversation on account activation or create new contacts.

## Files and schema

New code: `lib/chat/assistant.ts`, `app/api/dekez-chat-assistant/route.ts`, `components/chat/assistant-controls.tsx`. Existing workspace/client/request validators gain assistant source labels, controls and AI Answered filtering. No portal rebuild.

Migration order after the already installed chat foundation:

1. `20261024160904_dekez_chat_tenant_reminders.sql`
2. `20261024164249_dekez_admin_message_center.sql`
3. `20261024170258_dekez_chat_assistant.sql`

New private tables in the assistant migration:

- `assistant_control`: disabled flag, reply delay, optional actual office schedule.
- `assistant_state`: conversation mode, persistent follow-up, answered flag, pending request, short worker lease and after-hours throttle.
- `assistant_deliveries`: unique request/reply ledger with intent, source record reference, delegated Admin identity, result and timestamp.

RLS is enabled; no direct table privileges/policies are granted to ordinary users or the service role. Private helpers are not directly callable. The narrow `dekez_chat_assistant` RPC permits status/pause/resume only for the existing authorized Admin participant; claim/finish requires the trusted service role. The cron endpoint requires the existing server-only secret and two application switches. It never accepts a user-selected body or target.

Delivery locks the conversation, rechecks current membership/access, latest message and lease, then rereads real data. Message, delivery ledger, state and audit are transactional. Unique request IDs and short leases protect retries. Manual takeover, newer messages and closed/revoked relationships invalidate stale replies. Unusable pending entries are removed from the queue without deleting chat history.

The existing inbox signature and permission checks remain. An additive AI Answered filter and persistent escalation condition are applied before bounded pagination. Source labels are trusted backend fields, not client inputs. Automated inserts do not trigger another assistant reply or falsely count as human takeover.

## Configuration required before activation

- Existing server-only `CRON_SECRET` and Supabase server configuration must be present; never expose these in public environment variables.
- `DEKEZ_CHAT_ENABLED=true` and `DEKEZ_CHAT_ASSISTANT_ENABLED=true` are needed by the worker, in addition to private database `assistant_control.enabled=true`. Keep both assistant switches off until approved.
- `DEKEZ_CHAT_ASSISTANT_MODEL` is optional. When absent, no model is called. Before configuring a model, approve the provider/model, gateway credentials or deployment identity, budget and data-processing terms. A configured model receives the Tenant's question, which can contain personal information, but no database rows, documents, financial context or action tools. Review provider logging/retention settings.
- The pinned `ai` package uses structured-choice output, a six-second timeout and no automatic provider retries. Provider failure escalates rather than inventing a reply.
- Confirm actual office days and hours before setting them; otherwise leave them null. Do not infer an Admin is online or unavailable from an invented presence signal.
- `vercel.json` proposes a minute worker. Confirm hosting plan/schedule support and operational cost before deployment. No new subscription or billing was activated.

## Verification and remaining release gates

Tests run against disposable local PostgreSQL-compatible PGlite sources and synthetic identities. They cover actual-value answers, pending versus confirmed payment, missing/ambiguous data, retries, after-hours throttling, persistent escalation, manual takeover, unauthorized control/worker access, closed conversations and unchanged existing chat isolation. Provider output/failure is mocked; this is not a live model evaluation.

The browser harness runs the actual shared React workspace, API handlers and SQL. Transport invalidation is locally injected, so these checks do not prove production Supabase WebSocket delivery, Storage or authentication. No existing customer account, maintenance job or financial record is modified by tests.

Observed final local results, 25 October 2026 Malaysia time:

- 541 regression tests passed through the configured prebuild gate, including 25 focused assistant SQL/worker/classifier tests and the additional request-injection check.
- Production build and standalone `tsc --noEmit` passed. No lint command is configured. `git diff --check` passed.
- Browser suite passed on the final code. Assistant controls were checked for horizontal overflow at 320×568, 375×812, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1024×1366, 1280×800, 1366×768, 1440×900 and 1920×1080. The Tenant assistant exchange was also inspected at 390×844.
- Verified same-thread reply, explicit assistant label, AI Answered filtering, complaint escalation surviving a read, manual pause and explicit re-enable, without portal navigation. The existing chat authorization, attachments, support and closed-job regressions remain in the same suite.
- An earlier browser run timed out waiting for the read badge while a build was running; subsequent standalone runs passed, including after stabilizing the asynchronous assistant-control strip. Retain this timing case for real-environment validation; local transport is not a live-service guarantee.
- One new request-validator test initially compared objects from different JavaScript execution contexts; it was corrected to compare the validated fields, then the complete gate passed. No security assertion was removed.

Evidence: `artifacts/chat-assistant-build.log` and `artifacts/chat-assistant/assistant-admin-{320,820,1440}.png`, plus `assistant-tenant.png`. Screenshots are explicitly labelled synthetic/local, not customer data.

Before production: resolve/review existing dependency security advisories reported by `npm audit` (including the installed Next.js advisory); compare and integrate the current production branch; rerun all regression/build/type/browser checks; apply migrations in an approved isolated environment; verify real authenticated chat and Realtime without broadening permissions; review replies with Admin; request explicit production migration/release and activation approval. Do not describe a local test pass as production readiness.

## Rollback

Disable the application assistant switch and private database enabled flag first. Cancel queued work by leaving the worker off; stale leases cannot send while disabled. Revert the application release if required. Retain message types, sent replies, private delivery/state records and audit history. Do not delete messages or drop tables as a rollback. The previous inbox signatures remain compatible. Financial, tenancy, payment, WhatsApp and existing permission records require no rollback because this feature does not modify them.
