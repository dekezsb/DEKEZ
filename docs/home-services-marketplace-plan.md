# DEKEZ Home Services Marketplace architecture and delivery plan

## Scope and current status

Phase 0 audit completed on 23 October 2026 against release `02597aa` and the connected production database. Development branch: `feature/home-services-marketplace`. This plan extends the existing production application; it does not introduce a second Admin or Owner portal.

The architecture audit and local Contractor Portal shell are complete. The existing Super Admin page now links to `/admin/marketplace`; its Contractor preview has 13 navigable sections using shared components under `components/marketplace`. Both route pages and their parent layout require the existing Super Admin role. No additional staff permissions are granted. The preview explicitly identifies unavailable data/actions and displays no sample business records. Marketplace policies and calculation tests remain isolated from accounting. Phase 1 is not complete: migrations, restricted contractor provisioning, login, profile persistence and file access are still outstanding. Nothing has been deployed or installed in production. Existing rental, renovation, tenant, invoice, receipt and accounting records remain unchanged. The previous speed-update deployment approval does not authorize a marketplace release.

Contractor authentication decision, updated 23 October 2026: **phone number plus its last four digits as a temporary starter PIN; WhatsApp OTP later**. Preserve existing tenant and owner login methods. The starter PIN is guessable, not proof of phone ownership. The implementation plan requires first-login replacement with a personal PIN, durable failed-attempt limits and restricted onboarding before approval. No contractor account or credential has been created or changed. Live Auth phone OTP is disabled; no OTP was sent and no provider credentials were inspected.

Parts 1–45 are received. Part 45 confirms audit-first delivery, existing portal reuse, independent phase testing and explicit approval before any production migration or release. The audit and phased plan have been presented. The user approved Admin-created accounts for the temporary Contractor pilot; safe local Phase 1 work may proceed. This does not authorize production migrations or deployment.

Pilot account request: phone `0123456789` (normalized `+60123456789`) with a user-supplied temporary password, rather than the default phone-suffix starter PIN. Do not record that password in source, tests, logs or this plan. Read-only checks found no matching normalized profile, tenant phone or Auth phone on 23 October 2026; repeat collision checks atomically during provisioning. The account has not been created. Never mark this number OTP-verified, send messages to it, or activate verification/subscription merely to preview the portal. First-login credential replacement and Contractor-only permissions still apply.

## Existing architecture and reuse

| Area | Inspected implementation | Reuse and boundary |
| --- | --- | --- |
| Application | Next.js App Router, React 19, Tailwind 4; `app/layout.tsx`, `components/app-shell.tsx` | Extend this application. Preserve existing pages and actions. |
| Authentication | Supabase SSR clients; `lib/auth/session.ts`, `lib/supabase/middleware.ts`, `lib/auth/roles.ts` | Reuse sessions and authenticated user IDs. Add a restricted contractor role, not an internal technician role. |
| Internal authorization | `lib/auth/access.ts`, `user_module_permissions`, company and organization memberships | Add an explicit marketplace permission. Do not give external contractors internal company or organization membership. |
| Client Owner portal | `app/owner/[[...segments]]/page.tsx`, `components/owner/portal.tsx`, `lib/owner/data.ts` | Add `/owner/services` within the current portal. Keep existing Home, Property, Finance, Documents and Profile. |
| Owner data isolation | `owner_private.check_request`, restrictive RLS, `client_owner_snapshot` | Keep rental-data isolation. Explicitly allow only reviewed marketplace operations; never remove the existing restrictions wholesale. |
| Owner property relationships | `property_owners` links `owner_id` to `property_id` with start/end dates; `client_owner_settings.enabled` | Validate active assignment in the database when selecting an existing property. Other addresses belong to the job, not the rental property master. |
| Admin portal | Existing shared management shell, `/admin-setup`, module-based navigation | Add Services Marketplace to the same shell and authentication. Do not establish a second Admin login. |
| UI | Existing Button, Card, Badge, document previews, Lucide icons, DEKEZ branding and responsive Owner CSS | Reuse primitives and design tokens. Use the supplied contractor reference for presentation, never its sample figures. |
| Files | Private Supabase buckets, signed-document routes, bounded signing helper | Add marketplace-specific private file ownership and purpose checks. Existing owner document publication is not a contractor-document store. |
| Notifications | `notifications`, `agreement_notifications`, tenant WhatsApp integration | Reuse the general notification inbox where safe, with recipient-scoped marketplace access and deduplicated delivery events. Do not send marketplace conversations through tenant WhatsApp tables. |
| PDF generation | `pdf-lib`, fontkit and existing document renderers | Reuse rendering utilities where independent. Contractor quotations need their own data model and contractor identity, not DEKEZ invoice issuance. |
| Background work | Vercel scheduled HTTP jobs for rental billing, reminders, renewals and archival | Add an isolated authenticated worker with durable task records. Do not run matching during ordinary page renders. No pg_cron, pgmq or pg_net extension was present in the inspected database. |
| Deployment | GitHub `main` to Vercel production, Singapore region, mandatory prebuild regression tests | Develop independently, test each phase, obtain approval for production migrations and release. Preserve every existing release test. |

No contractor profile, marketplace job, invitation, marketplace quotation, job-chat, review or subscription table was found in the inspected public/private table inventory. Existing maintenance tickets require a tenant and managed property, so they are not suitable as the marketplace job master. Existing renovation documents contain company income/journal linkage and must not become contractor marketplace quotations.

## Integration conflicts to resolve in Phase 1

1. **New accounts currently start as tenants.** The Auth user trigger creates a tenant profile. Contractor onboarding must establish the new restricted role through a trusted, validated provisioning path before issuing an application session; it must not trust editable user metadata or leave a new contractor with tenant workflow access. Starter-PIN sign-in must not mark the phone as OTP-verified.
2. **Owner marketplace writes are currently blocked.** Client Owner Data API access is restricted to profile reads and the owner snapshot RPC. New operations require a narrow allowlist plus database ownership checks, not blanket access to existing tables.
3. **Client Owner storage writes are also blocked.** Owner job uploads need an authorized marketplace file path, explicit attachment metadata and controlled upload/read operations. Do not loosen existing rental-document policies.
4. **Profile approval is not contractor verification.** Middleware currently redirects non-approved profiles to registration status. Contractors need access to onboarding, verification feedback and subscription screens while business verification is pending. Opportunity access must separately require approved verification and active membership.
5. **Company role defaults cannot be reused blindly.** A new role must receive no rental, finance, maintenance-staff or Admin module rights. Protect both direct Data API access and legacy privileged RPCs, not just navigation.
6. **Existing Owner navigation has five mobile tabs.** Keep those five. Add Find Services as a prominent Home action and accessible Profile link on mobile, and an additional sidebar entry on larger screens. Share the existing shell instead of creating a second Owner experience.
7. **Marketplace quotations are not DEKEZ revenue.** Accepting a contractor quotation creates a match only. No rental invoice, renovation invoice, receipt, payable, bank entry or accounting journal is created. Existing DEKEZ renovation operations remain intact.
8. **No subscription gateway implementation was found in the inspected application.** Subscription billing must remain unavailable until a provider is configured and signed webhook processing is tested. An active status must never come from a browser success page or arbitrary staff edit.
9. **Tenant WhatsApp is not participant-secured chat.** Its conversations are keyed around tenant/phone records. Marketplace chat needs job and participant relationships and separate private attachments.

## Proposed routes

Preserve every existing URL. Use the existing App Router conventions.

- Owner: `/owner/services`, `/owner/services/categories`, `/owner/services/post-job`, `/owner/services/my-jobs`, and `/owner/services/jobs/[jobId]` with quotations, messages and review children.
- Contractor: `/contractor` redirects to `/contractor/dashboard`; add jobs, quotations, my-jobs, messages, subscription/billing, profile/services/portfolio/verification, reviews and support. Add contractor phone/PIN entry and first-login PIN-change screens using existing Supabase sessions, without changing current login routes. Add WhatsApp OTP later without duplicating the account.
- Admin: `/admin/marketplace` with owners, contractors, verifications, jobs, matching, quotations, active-jobs, subscriptions, reviews, reports and settings. This is a route group within the existing Admin shell, protected by a new marketplace module permission.

Contractor mobile navigation has exactly Home, Jobs, Quotations, Messages and Profile. My Jobs, Subscription, Reviews and Support remain accessible through Profile/contextual links. Sidebar begins at the existing dashboard breakpoint; tablet uses bottom or compact navigation according to available width.

## Proposed data structures

Names below are proposals, not applied migrations. Create them phase by phase. Use existing `profiles.id` and existing company/property identities; never manufacture duplicate users or insert external addresses into `properties`.

| Domain | Proposed records | Essential controls |
| --- | --- | --- |
| Contractor identity | Contractor profiles, profile memberships if business teams are enabled, services and coverage | Unique user/business association; private contact and registration fields separated from owner-visible business summaries. No automatic conversion of existing internal users. |
| Category and qualification rules | Service categories, document requirements, contractor documents and verification decisions | Admin-configurable requirements, qualification scope and expiry; immutable review history. SSM alone does not establish trade qualification. |
| Job requests | Jobs, restricted site/contact details, attachments | Owner-derived identity, optional verified property relationship, independent external address, controlled draft/submission/moderation states. Invited contractors receive only a safe general-location projection before authorized disclosure. |
| Invitations | Invitation batches and contractor invitations | Unique job/contractor invitation, durable batch identity, response expiry, limits and fairness timestamps. Save-for-later is separate and consumes no capacity. |
| Quotations | Quotations, editable draft items and immutable submitted versions | Server-calculated amounts; one active quotation per contractor/job; controlled revisions preserve submitted content and attachments. No accounting linkage. |
| Selected work | Job matches, status events and progress evidence | One selected match per job, accepted quotation version reference, owner-only completion confirmation, controlled dispute handling. |
| Communication | Job conversations, participants, messages, attachment associations and read cursors | Participant-scoped access; paginated history; no competitor quotes, private registration documents or unrelated owner contacts. |
| Reviews | Reviews, category scores, reports and moderation history | Unique reviewer/job relationship, verified participation and completion eligibility; independent reviews and appeals. Payment experience is a participant statement, not verified payment evidence. |
| Subscriptions | Plans, subscriptions, immutable provider events and billing document references | Price configurable, verified server/provider state, unique provider event IDs, out-of-order event protection, no project-payment processing. |
| Automation and audit | Durable tasks/outbox and marketplace audit events | Unique event keys; retries, attempt history, leases and failure visibility. Reuse `notifications` for delivery where isolation permits, rather than maintaining duplicate inboxes. |

Keep general-location and public business fields distinct from private columns. A row-level policy alone does not hide sensitive columns from an otherwise-authorized reader; use narrow projections/operations and restricted tables for private data.

Use foreign keys without cascading away issued quotations, reviews or audit history. Add indexes against actual access paths: owner plus job date/id; invitation contractor plus state/expiry; job plus quotation state; conversation plus message date/id; worker state plus next-attempt time; provider plus event ID. Apply consistent keyset pagination, normally 25 records, with bounded page sizes. Do not add every imaginable index.

## Lifecycle and concurrency rules

The job lifecycle follows the supplied Phase 39 sequence, with actor-specific transitions. Normalize `VERIFIED`/`APPROVED` terminology in a shared definition: only an approved verification decision grants eligibility. Subscription and verification remain independent.

Completion and review availability should not erase each other: retain the owner's completion event and expose review eligibility as a separate state/flag. Likewise, an accepted match can show Awaiting Start without incorrectly returning the job to the opportunity pool.

Critical operations run in database transactions with live permission and state checks:

- Submission validates current invitation, deadline, verification, membership, qualification and quotation capacity, then stores the immutable version and notification event together.
- Selection locks the job, checks that the selected version is current/eligible, enforces one match and updates competing quotation states atomically.
- Matching uses persisted fairness history, configurable batches and response windows. Declines are not quotations. Workers recheck live capacity and stop on selection, expiry or closure.
- Billing validates provider signatures and deduplicates events before changing entitlement; stale webhook events cannot roll membership back incorrectly.
- Retrying a form, worker or webhook must not create another quotation version, match, invitation or billing activation for the same operation.

Expiry of membership restricts new paid opportunities only. Existing accepted jobs, their documents and essential participant communication remain accessible. Account suspension and safety restrictions need an explicit policy separate from ordinary membership expiry.

## Temporary PIN login and deferred WhatsApp OTP

Use the phone number and last four digits as a temporary Contractor starter PIN, as requested. Reuse `normalizeInternationalPhone` and existing Supabase session infrastructure. The existing tenant PIN derivation only accepts the phone suffix and its login handler can activate tenant records; do not reuse that activation path or change tenant helpers. Contractor credential handling must be separate, server-only, stored through the existing Auth provider rather than as plaintext PINs, and rate-limited atomically. Missing rate-limit infrastructure must deny login rather than silently permit unlimited attempts.

Require replacement of the starter PIN before accessing contractor business documents or paid opportunities. A personal six-digit PIN must not be the phone suffix, repeated digits or a simple sequence. Five unsuccessful attempts trigger a 15-minute lockout; also apply network-level abuse limits. Rotation does not prove ownership of the phone: keep identity verification pending, and do not make public self-provisioning or last-four-digit account recovery available until ownership/recovery checks are established. For the initial controlled pilot, provision only reviewed accounts. Do not silently reset existing accounts or convert their roles on phone collision. Existing users adding a contractor business need an explicit, reviewed capability-linking design using the same user ID.

WhatsApp OTP remains the selected future method but is deferred at the user's request. No provider setup, messages or charges are required for local foundation work. Before activation, configure the supported provider, sender/templates, anti-abuse limits and a designated test number. Keep provider secrets out of source and chat; do not claim ordinary tenant WhatsApp messaging is a verified login service. Preserve user IDs when changing the login method.

Subscription payment provider, recurring billing support, invoice issuer details and webhook credentials are not yet confirmed. Implement the provider interface with an explicit unavailable state; no simulated live payments or manual “paid” toggle. RM199/month is the proposed configurable plan price, not authorization to charge anyone.

External homeowner onboarding must reuse the Owner portal without granting internal Owner/Admin powers or requiring a managed rental property. Existing Client Owners reuse their accounts. Confirm the public onboarding and verification policy before opening external owner registration.

Initial category-specific qualification requirements and document-expiry policies require Admin configuration. Do not invent licence requirements or display qualification guarantees. Review marketplace terms, privacy, review moderation and dispute handling before public launch.

## Delivery phases and test gates

| Phase | Deliverable | Gate before proceeding |
| --- | --- | --- |
| 0 | Architecture, reuse, schema, security and dependency audit | Present this plan, including Part 45 and the updated temporary PIN decision. |
| 1 | Isolated models, categories, Contractor phone/PIN integration, marketplace permission, Admin navigation and private file foundations | Local migration tests, cross-role/direct-API denial, immutable legacy-role checks, first-login PIN rotation and abuse tests. WhatsApp OTP remains deferred. |
| 2 | Existing Owner Find Services, job draft/wizard, property selection, external address, upload, submission and Admin review | Owner A/B isolation, assignment validation, upload authorization, draft recovery and moderation-only distribution. |
| 3 | Contractor registration/profile/verification, responsive dashboard, opportunities, quotation editor and records | No fake metrics; pending/inactive users denied new opportunities; drafts stay private; revision/amount/deadline tests. |
| 4 | Fair matching, capacity, owner comparison/selection, messaging and notifications | Concurrent submissions/selection, retry idempotency, participant privacy and duplicate-notification tests. |
| 5 | Progress, owner completion, two-way reviews, moderation and disputes | Contractor cannot confirm owner completion; real-job and unique-review enforcement; audit history retained. |
| 6 | Real subscription provider, billing history and membership lifecycle | Sandbox billing/webhook replay/forgery tests; provider setup approved; no project payments and no fake active subscriptions. |
| 7 | Supply/demand, conversion, retention/churn/fairness reports and optimization | Reconciled metric definitions, scoped aggregate queries, measured load tests, full security and responsive regression suite. |

Do not publish a phase as a complete marketplace. Test gated implementations in an isolated environment with synthetic records. Production migration/deployment requires explicit approval after the phase test results are shown. Do not create real jobs, contractor subscriptions, invoices or payments as test fixtures.

For every phase, retain the existing accounting, rental, owner security and responsive release gates. Add tests for unauthorized direct table access, legacy privileged RPC access, guessed attachment IDs, stale mutations, duplicate requests and cross-owner/contractor IDs. Verify the entire browser → server → database → storage path; local model tests alone do not prove live authorization.

Test all relevant sections at widths 320, 375, 390, 430, 768, 820, 1024, 1280, 1440 and 1920, including tablet portrait/landscape. Check 44px touch targets, 16px form text, safe areas, accessible navigation, local-only table/tab scrolling and no page overflow. Use the supplied image as visual direction, not as test data.

### Phase implementation locations and dependencies

| Phase | Likely code areas | Database additions and dependencies |
| --- | --- | --- |
| 1 | `lib/marketplace`, `lib/auth/roles.ts`, `lib/auth/access.ts`, `lib/supabase/middleware.ts`, existing shell/navigation, isolated contractor auth routes | Contractor business/profile association, categories, coverage, qualification requirements, verification history, private attachment metadata, audit records and atomic auth throttling. Narrow owner API extension and contractor legacy-data denial. No production install without approval. |
| 2 | Existing Owner route and shared shell; new `app/owner/services` pages/actions; marketplace job services | Jobs, restricted site data, job attachments and submission/moderation events. Depends on active property assignment checks and secure upload foundations. |
| 3 | New `app/contractor` and `components/marketplace/contractor`; shared quotation services/PDF renderer | Invitations exposed only through eligible scoped operations; quotations, items, immutable versions, portfolio and saved jobs. Depends on restricted contractor sessions and Phase 1 verification controls. |
| 4 | Owner comparison actions, Admin marketplace pages, job-scoped messaging, isolated worker endpoints | Invitation batches, unique invitations, atomic match records, conversations/participants/messages, durable outbox. Requires concurrency tests and an approved scheduler configuration. |
| 5 | Accepted-job pages/actions, shared review forms, Admin moderation | Progress records, completion events, independent reviews and review-report/moderation history. Depends on an accepted match and participant authorization. |
| 6 | Subscription adapter, server webhook route, billing pages and Admin plan settings | Plans, subscriptions and immutable provider events. Missing provider/configuration blocks live payment activation, not truthful unavailable UI. |
| 7 | Marketplace aggregate/report services, Admin reports, scoped performance instrumentation | Targeted indexes and aggregate queries justified by query measurements; fairness/retention reporting. Depends on earlier phases' durable events. |

### Phase 1 approval boundaries

Local policy tests and isolated schema/prototype work may continue without changing production. Admin-created pilot onboarding is approved. Do not enable real contractor sign-in until database-level legacy-data denial, credential rotation, abuse controls and account collision handling are proven. Public registration and multi-role account linking remain unresolved security workflows, not permission to create a second identity. Ask for the specific onboarding decision before implementing a broader path. Production migrations, permission grants, storage configuration and release each require explicit approval. Billing activation requires separately configured and tested provider credentials.

### Foundation verification on 23 October 2026

- `npm run build` passed, including every existing prebuild regression gate, the new 17-test marketplace gate and TypeScript compilation. No lint script is configured in this project.
- All 13 Contractor preview sections passed browser layout checks at 320×568, 375×812, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1024×1366, 1280×800, 1440×900 and 1920×1080: 143 page/viewport combinations. Checks covered page overflow, sidebar/bottom navigation visibility, content width, navigation touch height, bottom clearance and heading/metric clipping. Desktop and mobile screenshots were inspected.
- The loopback-only visual harness renders the actual component/CSS without credentials or database access. It is a development test tool, not a separate application or an authentication bypass in Next.js routes. Real route gates were tested with denied/allowed authorization stubs. Production account login, deployed RLS, live file authorization and marketplace writes have not been tested because they are not implemented yet.
- No OTP messages, contractor accounts, financial records, memberships, migrations or production deployments were created. The approved pilot account remains unprovisioned.

## Performance and operations

Keep marketplace data fetching out of existing rental page renders. Use narrow database aggregates for dashboards, paginated opportunity/quote/message queries, lazy image previews and bounded file signing. Do not fetch the entire Owner financial snapshot just to display a marketplace job list.

Use a durable background outbox with bounded batches, `FOR UPDATE SKIP LOCKED` or equivalent atomic claims, expiring leases and idempotent effects. A scheduled authenticated worker can reuse the existing hosting pattern without adding an infrastructure subscription prematurely. Matching and notification delivery remain outside request-critical page rendering. Monitor failed tasks, retry counts, unmatched approved jobs, delivery delay and invitation distribution.

Use only participant-scoped realtime subscriptions where needed; do not attach the existing broad rental-table refresh subscription to Contractor pages. Avoid per-user caches that can leak private results and invalidate only affected marketplace data.

Acceptance does not guarantee that one to three staff can manage any volume. Operational capacity depends on actual verification demand, disputes, message volume and matching failures; measure these after a controlled pilot.

## Documentation references

- Supabase [phone sign-in](https://supabase.com/docs/guides/auth/phone-login) describes the future provider-backed OTP flow; it is not required for temporary PIN sign-in and has not been enabled.
- Supabase [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) supports the database isolation requirements.
- Supabase's October 2026 [TLS change notice](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) affects old clients; do not introduce obsolete transport clients.

These references support platform implementation details, not verification of the marketplace's commercial or legal readiness.
