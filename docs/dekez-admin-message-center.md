# Authorized Admin message center

## Scope and status

Local implementation; NOT migrated, deployed or enabled in production. This is an extension of the existing shared DEKEZ chat, not a second inbox or a WhatsApp integration. It depends on the pending tenant-reminder migration and retains all existing participant, scope, job-closure and support-evidence authorization.

The shared Messages workspace is used by all portals. Admin/Management gain a simple inbox filter in the existing `/messages` route. The existing chat launcher still supplies the total unread badge from authorized per-participant counters, independently of the selected filter.

## Changes

- Existing `dekez_messages` gains nullable `message_type`: `MANUAL_ADMIN`, `USER_MESSAGE`, `AUTO_REMINDER`, `WELCOME_MESSAGE`, `SYSTEM_NOTICE`. No old messages are backfilled, rewritten or relabelled by inference.
- New manual messages are classified by the backend from the enrolled sender role. Clients cannot supply source labels. Trusted reminder deliveries stamp `AUTO_REMINDER` and `DEKEZ Admin` atomically with their original message.
- The same send path supplies sequence numbers, unread counters, latest preview and user-scoped Realtime signals. There is no separate automated-message queue for replies.
- Inbox overload adds contact role, scoped property/job context, source type, actual last-message time and Needs Reply. It retains the original participant check and adds no staff surveillance rights.
- Filters: All, Unread, Tenant, Owner, Contractor, Automated Reminder, Needs Reply. Filtering occurs before the bounded 25-row cursor page. The reminder filter includes a thread with an earlier automatic reminder even after the user replies.
- Needs Reply means the latest message is an incoming user message and that participant has unread messages. Reading it clears this marker; replying also removes it because the latest message is no longer incoming. This is not a support-case SLA or separate work queue.
- Chat headers show only context available from the existing authorized relationship. Tenant short names/room labels reuse the existing scope-aware helper; no unrelated tenancy lookup or global directory was added.
- Message history shows explicit Automatic/Manual labels where the backend knows the source. `SYSTEM_NOTICE` is reserved for future trusted notice producers, not a user-selectable message type. No new maintenance or financial notice automation was introduced.

## One-time welcome

New PRIVATE tables:

- `dekez_chat_private.welcome_control`: one disabled-by-default flag.
- `dekez_chat_private.welcome_deliveries`: unique relationship, conversation, message, actual Admin sender, triggering actor and timestamp.

After approved enablement, the first creation of the two existing authorized participants in a new active Admin/Management–Tenant conversation may send the fixed welcome message. The trigger neither creates contacts nor grants access. It delegates only to the existing Admin participant, reuses normal send authorization, and restores the original identity. Delivery and audit insertion share the message transaction. A failure rolls back welcome work and records a safe diagnostic without preventing ordinary chat opening.

There is no login hook, no retrospective welcome to existing chats, and no automatic re-welcome when reopening the same conversation. No welcome is sent to unrelated users, Owner–Tenant pairs or Contractor conversations. A new authorized relationship can have its own welcome. The welcome text does not promise an actual agreement term, payment change or maintenance action.

Both private tables have RLS enabled and no ordinary-user policies or table grants. Trigger helpers are not callable by public/anonymous/authenticated/service roles. New inbox/detail wrappers expose only the same participant-scoped reads as the original wrappers. Existing wrappers remain available for older clients and rollback.

## Local verification

SQL/API checks use a disposable PGlite database with synthetic accounts and sources, never production records. Coverage includes source classification, unchanged old history, same-thread automatic/user/manual flow, unread and Needs Reply, all filters, cursor pagination, actual timestamp retention, no global Admin read access, Owner–Tenant denial, closed-job send denial, once-only welcome, restored sender identity and restricted private controls.

The browser harness uses the actual shared React workspace, API handler and SQL. It verifies a reminder arriving in Tenant chat, a Tenant reply raising the Admin unread badge/Needs Reply, Admin reading and replying in that same thread, and Tenant receiving the reply without navigation. It also runs existing attachment, support and closed-job regression flows. Realtime delivery is locally injected at the transport boundary: this is NOT proof of production Supabase WebSocket delivery, Storage or authentication.

Admin center viewport checks: 320×568, 375×812, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1024×1366, 1280×800, 1366×768, 1440×900, 1920×1080. No page-level horizontal overflow. Screenshots are explicitly marked synthetic.

Observed results, 25 October 2026 Malaysia time: 515 prebuild regression tests passed, production build and standalone TypeScript check passed, and the browser suite passed twice. The focused Admin-center SQL suite also passed after the final fail-closed control adjustment. No lint command is configured in this repository. Build log: `artifacts/admin-message-center-build.log`. These are local results, not a claim that the feature is live.

## Rollout — requires approval

1. Confirm current release branch and integrate any newer production work before release. Run the full prebuild regression gate, type checks and browser harness.
2. Apply the pending tenant-reminder migration first, followed by `20261024164249_dekez_admin_message_center.sql`, in the approved test environment. No financial or WhatsApp schema changes are included.
3. Keep reminder sending and welcome control disabled. Deploy the compatible application preview only against an approved environment.
4. Verify real authenticated Admin/Tenant accounts, existing authorized conversation, real WebSocket signals and scoped access. Test an authorized manual exchange before enabling automatic sends. Do not create maintenance jobs or broaden access to make a test pass.
5. Review the existing reminder prerequisite report: the prior read-only audit found no existing Tenant chat conversations, and signing/notice/auto-renewal deadlines were not structured in the current records. Missing existing conversations or verified actual agreement rules must remain skips. Never invent an auto-renewal clause.
6. Obtain explicit approval for production migration/release, then separately enable actual reminder sending or new-chat welcomes as reviewed. Do not enable by merely deploying this code.

## Rollback

First disable reminder sending and set `dekez_chat_private.welcome_control.enabled=false` through an authorized database change. Roll the application back to the prior release; original inbox/detail signatures remain compatible. Keep messages, source fields, welcome/reminder delivery ledgers and audit history intact. Do NOT drop these tables or delete sent messages. No rental, tenancy, accounting, WhatsApp or existing chat permission rollback is needed because none was changed by this migration.
