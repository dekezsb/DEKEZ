# DEKEZ shared chat MVP — 24 October 2026

## Scope

Reuse existing DEKEZ in-app conversations, participants, messages, attachment and signal tables. No new tables, identities, maintenance jobs, rental accounting changes or WhatsApp changes.

Header chat bubbles use the same launcher in Admin, Management, Tenant, Owner and Contractor. Numeric red badges disappear at zero and cap visually at 99+. The inbox has initials and compact names. Scoped tenant labels use first name and the scope's room number when present. Existing left/right bubbles, text delivery and responsive layouts remain. Older messages load on upward scroll, retaining the accessible Load older button.

## Backend update

20261024152754_dekez_chat_mvp.sql adds an authenticated caller-only unread aggregate over existing participant counters. It does not scan message history. The API adds realtime enablement from the existing server flag. Header and workspace share one per-user signal subscription; no private message bodies are broadcast and no portal-wide refresh is introduced.

The latest active-job-only contractor rule supersedes the earlier no-job support desk exception. New contractor desk chats and further sending in existing desk chats are denied. Existing authorized history remains readable. Active job-scoped contractor conversations retain existing assignment checks. Completed/cancelled/closed jobs are read-only. Owner–Tenant direct messages remain forbidden. Admin has no global private-chat access.

## Verification

- Existing release regression suites and Next production build passed locally.
- Chat tests cover role isolation, Owner–Tenant denial, assigned jobs, closure, immutable history, unauthorized IDs, uploads/support access, unread counters, summary access, subscription sharing and the legacy desk upgrade.
- Actual React UI → application API → disposable PostgreSQL-compatible fixture passed at 320×568, 375×812, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1024×1366, 1280×800, 1366×768, 1440×900 and 1920×1080.
- Browser assertions include 40-message initial page, older pagination, send/reply, recoverable draft errors, unread header 85→0, selected support evidence and closed-job API denial.
- Realtime invalidation uses a synthetic browser event in local end-to-end tests. Actual subscription filtering, coalescing, shared channel and cleanup have unit coverage. This is NOT a claim of verified live two-account WebSocket delivery.
- Read-only production inspection found RLS enabled on all six public chat tables and only the per-user signal table in the chat realtime publication. Existing conversation/message content was not read.

## Release and rollback

1. Review the exact chat-only diff; retain the approved visual-polish production baseline.
2. Run release gates, TypeScript and production build; deploy the commit to a preview branch first.
3. Install only the new chat-function migration, transactionally. Do not replay old local migrations, whose remote installation timestamps differ.
4. Verify the new RPC ACLs, RLS and unchanged conversation/message counts. Publish the reviewed commit to main only after checks succeed.
5. Smoke-test public login and unauthenticated chat denial, then perform a real signed-in two-account chat smoke check when working sessions are available. Do not reset existing credentials or fabricate a live maintenance job for testing.

Rollback: restore the preceding UI deployment (ecfb382). The added summary RPC is backwards-compatible and can remain unused. Keep the tighter contractor restriction in place during a UI rollback; do not silently restore the former no-job exception. If the database transaction fails, PostgreSQL rolls back every function change. No chat/history rows are altered by the migration. An unexpected permission failure should disable the existing chat feature flags pending diagnosis, not weaken RLS.

Production security advisor INFO notices for private tables with no policies are intentional default-deny tables accessed only through checked private functions; do not add broad policies to silence them.
