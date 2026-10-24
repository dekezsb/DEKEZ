# DEKEZ shared in-app chat

## Rollout status — 24 October 2026

The user approved building, testing and deploying the shared chat foundation.
Four additive chat-only migrations were installed in the existing DEKEZ Supabase
project after transaction-only rehearsals. No existing user account, maintenance
job, financial record or WhatsApp record was created or changed.

The application feature gates remain default-off: DEKEZ_CHAT_ENABLED,
DEKEZ_CHAT_FILES_ENABLED and DEKEZ_CHAT_REALTIME_ENABLED. Database membership is a
separate authorization. Approved users self-enroll through a narrowly scoped
bootstrap when opening Messages; this grants no support or administrative powers.

## Installed database additions

Public RLS-protected tables:

- dekez_conversations
- dekez_conversation_participants (read position and stored unread counter)
- dekez_messages
- dekez_message_attachments
- dekez_support_cases
- dekez_chat_signals (only user ID, revision and update timestamp)

The unexposed dekez_chat_private schema holds members, scopes, relationships,
selected message/file evidence, audit records, send limits and upload reservations.
Private tables intentionally have deny-by-default RLS and no client table grants.
The security advisor reports these eight private tables as RLS-without-policies;
this is intentional, not a reason to grant direct access.

Public RPC wrappers are SECURITY INVOKER. Private privileged implementations check
the authenticated caller, capabilities, company/property scope and current job
assignment. Ordinary clients cannot write messages, participants, grants, upload
attestations or counters directly.

Migration sources:

1. 20261023174901_dekez_in_app_chat_foundation.sql
2. 20261024025757_dekez_chat_files_and_access.sql
3. 20261024030355_dekez_chat_gateway_and_realtime.sql
4. 20261024060911_dekez_chat_contact_desks.sql

The installation added a narrow request guard which delegates every non-chat
request to the unchanged marketplace_private.check_request guard. Only enumerated
chat RPCs are admitted for enrolled members or authorized setup administrators.
Existing Owner and Contractor restrictions remain in force outside those RPCs.
Do not replay migrations just because the remote migration tool assigned different
version timestamps; reconcile migration history before any future CLI push.

Recorded remote migration versions, in the same order: 20261024044137,
20261024044138 and 20261024044139; contact desks is 20261024061828.
Local source filenames above remain unchanged.

## One engine, existing portals

Shared UI and API serve /messages, /owner/messages, and the existing Contractor
Messages section. Admin support and access setup live within the existing Admin
Marketplace section. No portal, login flow or user identity is recreated.

Owner–Tenant direct chat is rejected in UI, backend authorization and database
checks. Only two-party conversations are supported, so adding group participants
cannot bypass the prohibition. Admin has no global message-browsing privilege.

Super Admin setup enrolls existing approved accounts with explicit capabilities
and records a reason. Current company_users, property_owners, tenants/tenancies,
rooms and maintenance assignments are the authority. Organization fields are
empty in the existing application and are not used as substitutes for company
relationships. No existing records are rewritten to supply missing relationships.
Contact-desk bootstrap is an explicitly approved exception for existing approved
Contractor preview accounts. Their login and non-chat restrictions are unchanged.

Contractor job-chat access requires a real active maintenance assignment. Supported active
ticket statuses are submitted, assigned, in_progress and waiting_for_parts.
Completion/closure/rejection or assignment cancellation/completion/reassignment
closes the job conversation. Every send checks the current source relationship.
Closed history remains available to authorized participants; revoked grants deny
access. A new job needs a new authorization; an old conversation does not reopen.

The audited schema has no operational Marketplace job/match source yet. Renovation
job chat must not be faked from financial quotation or accounting tables.

### Basic contact desks — no maintenance job required

Approved existing users can contact existing company-linked DEKEZ desks. Owner,
Tenant and Staff desk lists follow their existing company/property/tenancy scope.
Contractors without a company or job can contact the designated Super Admin DEKEZ
Support desk only. Desks are seeded from existing approved active company-linked
Admin/Management accounts, not a global user directory. Opening a desk creates
one idempotent two-party chat relationship. Staff reads/replies as a participant.
Desk disablement or loss of source permission denies sends and preserves history.
Support evidence on desk conversations retains assignment and company boundaries.
No synthetic job, account duplication or Owner–Tenant permission is introduced.

## Attachments and support privacy

The private dekez-chat-files bucket accepts at most 3 MiB per file. Images are
signature-checked, decoded with pixel limits, resized and metadata-stripped.
PDFs are parsed and limited to 100 pages. Only JPG, PNG, WebP and PDF are supported.

Uploads use an authorized immutable reservation, content digest, server-only
Storage write and server-only attestation. End-user file-send permission is checked
again before attaching the file. Retries cannot overwrite files or retroactively
attach a file to an already-sent text message. The current composer supports one
file per message.

The server file proxy authorizes and audits every request and rechecks access after
Storage I/O. No public/signed file URL is exposed. PDFs download rather than execute
inside the portal origin. Full files load only on request; initial history returns
metadata. Already-downloaded copies cannot be recalled.

Support is selected-evidence-only. Dispatch is an explicit capability and reveals
case metadata, not private content. An assigned support member needs current
company scope, an unexpired 15-minute-to-24-hour grant and an access reason.
Message selection does not implicitly select its files. Evidence views/downloads,
assignments, status changes and provisioning actions are audited. Resolved/closed
cases immediately deny further evidence access. UI evidence clears on closure,
expiry, navigation and focus loss. Report retries deduplicate; report/upload/send
rates are separately bounded.

Abandoned upload cleanup needs an approved retention policy before any deletion;
there is no automated deletion of chat history or evidence.

## Performance and Realtime

History defaults to the latest 40 messages, capped at 50; older pages use sequence
cursors. Inbox/contact/setup pages request 25 rows. Stored per-user unread counters
avoid full-history scans. Send client keys enforce durable idempotency.

Only dekez_chat_signals was added to supabase_realtime. Each client subscribes to
its own RLS-protected row. Events coalesce and revalidate authorized chat data only,
not dashboards, invoices or the whole portal. Socket errors use a visible-page
fallback; periodic authorization rechecks account for access expiry/source changes.
No full message bodies or file keys are published as chat events.

## Verification

Latest local chat suite: 56 tests passed. All mandatory prebuild regression suites,
TypeScript checking and the production build passed on 24 October 2026.

Local browser checks passed across:
320x568, 375x812, 390x844, 430x932, 768x1024, 820x1180, 1024x768,
1024x1366, 1280x800, 1366x768, 1440x900 and 1920x1080.

Those checks use actual React/API/migration code with synthetic identities,
PGlite, in-memory file transport and a simulated Realtime transport. They cover
send/reply, retries, history, images/PDFs, selected support evidence, closure and
responsive chat/access setup, and no-job Contractor–Admin desk send/reply. They
are not live Supabase end-to-end results.

Live database checks after installation:

- All six public chat tables have RLS.
- Bucket is private and limited to 3 MiB.
- Only the signal table is published for chat.
- Non-member send, upload attestation, evidence and setup requests are denied.
- Anonymous chat table/RPC access is denied.
- Existing function definitions and policies match their pre-installation hashes.
- Profile count remains 173; no enrolled chat accounts or conversation records.
- Security advisor reviewed; private deny-all RLS notices are expected.
  Existing unrelated security notices were not altered in this task.

The contact-desk migration was also rehearsed on actual PostgreSQL with existing
Contractor and Super Admin identities: bootstrap, desk creation, send, reply and
history returned two messages, then the entire transaction was rolled back.
Actual HTTP/PostgREST, Storage and Realtime smoke checks are separate release
checks; do not describe local simulated transports as live results.

## Recovery and release controls

The latest user instruction explicitly approves deployment after testing. Current
production and origin/main were compared against the release base. All existing
release gates remain mandatory. Never publish a stale worktree over newer work.

Non-destructive rollback plan (manual, only if needed):

1. Keep/turn all three application chat flags off.
2. Restore authenticator's pgrst.db_pre_request to
   marketplace_private.check_request ONLY if its current value is exactly
   dekez_chat_private.check_request; otherwise stop for review. Reload PostgREST
   config/schema. The previous guard itself has not been replaced.
3. Revoke authenticated execution of the new public dekez_chat_* RPC wrappers and
   private chat entry points to stop direct sends/setup if necessary.
4. Remove only public.dekez_chat_signals from supabase_realtime if delivery must
   stop. Leave every pre-existing publication member untouched.
5. Preserve tables, private bucket/files, members, participants and audit history.
   Never drop chat or rental/accounting history as rollback.
6. Keep the private bucket's restrictive policy. Do not expose old files while
   recovering. If lifecycle triggers ever need disabling, keep sends disabled
   until source status and authorization are revalidated.

The migration rehearsal and permission checks were transactionally rolled back.
The actual four migration installations are committed. No rollback has been
executed against the installed chat additions.
