# Pending tenant contact evidence (local review only)

This is an addition to the existing Rent Due Tracker → Rental payment reminder follow-ups. It is not a new portal, contact directory, consent approval system, or WhatsApp sending path.

## Workflow

- Existing approved Management with company-scoped `rent_due_tracker/manage` can record a tenant's actual response, actual Malaysia-local confirmation date, source and evidence reference. There are no prefilled dates, responses or approvals.
- A proposed phone correction is stored only as a proposal. It never changes `profiles`, authentication, the existing login number or any reminder destination. The protected sender and Management recipient numbers cannot be proposed as tenant numbers.
- Pending evidence and its immutable review history are visible in the same existing follow-up page, 25 at a time. Existing collection/source/consent holds remain fully effective.
- Only the existing fresh Super Admin gate can submit a disposition. The database independently requires an approved, company-scoped Super Admin and rejects explicit `admin_setup` restrictions. Ordinary Management cannot dispose of evidence.
- “Reviewed” means evidence was reviewed, **not** that consent or a phone change was approved. The existing Admin ownership/consent workflow and existing Admin account-change workflow remain separate. A changed login number prevents a “reviewed” disposition until fresh evidence is obtained.
- A separate Management **STOP-only** control records actual withdrawal immediately through the existing `dekez_collection_review_contact` RPC with literal `record_opt_out`. It requires fresh scoped Management authorization, the exact current canonical registered number, actual date/source/reference/response and explicit confirmation. The database rechecks tenant identity, number, company and current assignment; stale/ambiguous numbers fail closed and require immediate Admin follow-up. This action cannot opt in, verify ownership, clear holds or change numbers. Saving pending evidence alone does not clear or add suppression. Never send a message merely to obtain opt-in.

## Additive migration

`20261028091044_rental_collection_pending_evidence.sql` depends on the applied `20261028025857_rental_collection_review.sql`. Production applied it once on 28 October 2026 under version `20261028091044`; the reviewed source filename was `20261028041808_rental_collection_pending_evidence.sql`. The source was renamed to match recorded history without changing or reapplying SQL. Do not apply either production migration again.

It adds two allowed audit event types, two partial indexes and eight narrowly scoped functions. It reuses the private, forced-RLS, append-only `dekez_collections_private.audit` table. It creates no new user/table/chat system and performs no business-record, consent-control, suppression, delivery-ledger, credential, cron or financial writes. The existing internal executor receives no new business-table access. New RPCs use the existing trusted server-side service role; ordinary authenticated/anonymous users have no EXECUTE or direct table privileges. Private helpers retain an empty search path, forced RLS, restricted executor ownership and a service-role check.

Public server-only RPCs recheck fresh company/module access after the per-proposal transaction lock. A unique `(company_id, action, record_id)` partial index guarantees one immutable submission and one immutable disposition for a proposal. Identical retries acknowledge the existing event; altered retries fail. Company and actor are derived server-side, not accepted from form fields.

## Deployment / rollback boundaries

The draft migration uses a transaction, five-second lock timeout and bounded statement timeouts. The audit constraint change requires a brief exclusive lock; if unavailable, stop and retry only under separate authorized migration execution—not by increasing the timeout or forcing through locks. Check the audit constraint name, permitted actions and migration history against production before approval. Do not reapply the prior migration.

Deploy only after review, backup/recovery verification and separate migration/release approval. Until the migration exists, the page shows an unavailable evidence-review state and keeps existing follow-ups available; submission failure returns a safe message, never a false approval. No environment changes or send-flag activation are required.

Rollback the application feature independently if necessary. Prefer a forward correction to SQL. Do not delete evidence events or restore the earlier audit CHECK while new evidence actions exist; doing so would erase audit history or fail validation. Existing consent/phone/finance workflows remain unaffected by leaving the additive schema installed.

## Local verification

Run `tests/rental-collection-proposals.test.cjs`, `tests/rental-collection-proposals-sql.test.cjs`, the existing Admin/workflow tests and TypeScript checking. PGlite uses synthetic local fixtures only. Independent PostgreSQL session evidence, when available, is recorded separately; do not treat PGlite's queued connection as a concurrency proof.
