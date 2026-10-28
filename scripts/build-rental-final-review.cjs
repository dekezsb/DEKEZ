// PRIVATE local review renderer. Reads previously authorized, local read-only
// exports only; no environment files, database, provider, network or live calls.
// Generated artifacts contain tenant information and MUST NOT be committed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts/rental-collection-review');
const read = name => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
const dry = read('20261027-final-dry-run.json');
const privateRows = read('20261027-private-blocked-accounts.json');
const native = read('native-final-followup/native-results.json');
const load = require('../tests/marketplace-component-loader.cjs')({ 'server-only': {} });
const model = load('lib/rental-collection/model.ts');
const failure = load('lib/rental-collection/failure-report.ts');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
assert.equal(native.status, 'PASS');
assert.equal(native.migrations[0].sha256, sha('supabase/migrations/20261028025857_rental_collection_review.sql'), 'Native evidence must match current migration');
assert.equal(dry.report_date, '2026-10-27');
assert.equal(privateRows.report_date, dry.report_date);
const names = new Map(privateRows.accounts.map(row => [row.reference, row]));
assert.equal(names.size, dry.items.length);
const labels = { ...model.collectionStageLabels, overdue_8_13: 'Overdue 8–13 days — review', day_14_review: 'Day 14 — internal termination review', overdue_15_plus: '15+ days — review', resolved: 'Zero recorded balance / history' };
const stageOrder = ['advance_7', 'due_today', 'overdue_1_6', 'day_7_review', 'overdue_8_13', 'day_14_review', 'overdue_15_plus', 'tracking', 'exception', 'resolved'];
const isCandidate = row => !['tracking', 'resolved', 'exception'].includes(row.stage);
const records = dry.items.map(item => {
  const account = names.get(item.reference); assert(account, 'Every redacted group must have one private action record');
  assert.equal(account.recorded_outstanding, item.outstanding, 'Separate read-only snapshots differ; refresh before rendering');
  assert.equal(account.collectible_outstanding, item.collectible_outstanding);
  assert.equal(account.pending_verification, item.pending_verification);
  return { ...item, ...account, candidate: isCandidate(item), clean: isCandidate(item) && item.exceptions.length === 0 && !item.pending_verification };
}).sort((a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) || a.tenant_name.localeCompare(b.tenant_name));
const sum = rows => Math.round(rows.reduce((n, r) => n + (r.collectible_outstanding || 0), 0) * 100) / 100;
const positive = records.filter(r => r.recorded_outstanding > 0.005);
const candidates = records.filter(r => r.candidate), clean = records.filter(r => r.clean);
const metrics = {
  groups: records.length, invoices: dry.items.reduce((n, r) => n + r.invoices.length, 0),
  candidates: candidates.length, candidateAmount: sum(candidates), candidatePartial: candidates.filter(r => r.partial_invoices > 0).length,
  clean: clean.length, cleanAmount: sum(clean), candidatePending: candidates.filter(r => r.pending_verification).length,
  sourceClean: candidates.filter(r => r.exceptions.length === 0).length,
  linkedPositive: positive.filter(r => r.linked_tenant).length,
  linkedMissing: positive.filter(r => r.linked_tenant && !r.phone_valid).length,
  unlinkedPositive: positive.filter(r => !r.linked_tenant).length,
  allPending: records.filter(r => r.pending_verification).length,
};
assert.deepEqual([metrics.groups, metrics.invoices, metrics.candidates, metrics.candidateAmount, metrics.candidatePartial, metrics.clean, metrics.cleanAmount, metrics.linkedMissing, metrics.unlinkedPositive], [183, 791, 35, 18240, 5, 11, 4740, 24, 17]);

// Real formatter, actual source facts, no invented invoice identifiers. The
// formatter omits invoice references for a single due/overdue invoice, so those
// messages can be reproduced exactly from the redacted snapshot. Multi-invoice
// exact output is withheld because its real invoice references were not exported.
const exactSamples = [];
for (const stage of stageOrder) {
  const sameStage = clean.filter(r => r.stage === stage && r.invoices.filter(i => i.outstanding > 0 && (stage === 'advance_7' ? i.days_overdue === -7 : i.days_overdue >= 0)).length === 1);
  sameStage.sort((a, b) => b.partial_invoices - a.partial_invoices || a.reference.localeCompare(b.reference));
  const row = sameStage[0]; if (!row) continue;
  const input = { ...row, resolved: false, name: null, phone: null, pending: [],
    invoices: row.invoices.map(i => ({ ...i, reference: null, pending: [] })) };
  const body = model.formatCollectionMessage(input); assert(body); assert(!body.includes('Invoice 1:'));
  exactSamples.push({ stage, reference: row.reference, body, partial: row.partial_invoices > 0,
    explanation: 'Exact current formatter output using actual source values. One reportable invoice; no invoice reference is printed or invented. This is wording review only, not authority to send.' });
}
const pendingRecord = records.find(r => r.pending_verification);
if (pendingRecord) exactSamples.push({ stage: 'pending_verification', reference: pendingRecord.reference,
  body: model.formatCollectionMessage({ ...pendingRecord, pending_verification: true }),
  explanation: 'Exact neutral pending-verification formatter output. The current worker holds these cases for Admin; this text is not scheduled for delivery.' });

// No new reporting ledger exists in production. Do not manufacture delivery
// evidence, completed worker outcomes, management consent or ownership proof.
const scoped = dry.verification.rosley_company_scope;
const membership = scoped.scoped_memberships[0];
assert.equal(scoped.matched_profiles, 1); assert.equal(membership.company_status, 'active');
const rosley = failure.buildCollectionFailureReportPreview({
  company_id: dry.company_id, report_date: dry.report_date, current_items: [], evidence: [], contact_cases: [],
  all_history_loaded: false, daily_outcomes_complete: false, daily_reservation: 'unknown',
  recipient_authorization: { verified: true, company_id: dry.company_id, recipient: failure.COLLECTION_FAILURE_REPORT_RECIPIENT,
    management_profile_id: 'redacted-authorized-management-reference', approved_management_account: true,
    active_company_membership: true, rent_due_tracker_manage: true, whatsapp_ownership_verified: false, whatsapp_consent: 'unknown' },
});
assert.equal(rosley.canSend, false); assert.equal(rosley.containsPersonalDetails, false);
assert.equal(rosley.readiness, 'recipient_unverified');

const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null ? 'Unavailable — review' : model.collectionMoney(n);
const when = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(value)) + ' MYT';
const friendly = {
  allocation_mismatch: 'Verified allocations and recorded paid balance do not reconcile',
  identity_or_scope: 'Invoice / tenancy / tenant identity or company scope mismatch',
  inactive_or_checked_out: 'Inactive or checked-out tenancy',
  invalid_phone: 'Missing or invalid current portal phone',
  invoice_not_issued: 'Invoice not issued for the reporting date',
  non_collectible_invoice_state: 'Draft, cancelled or waived invoice',
  not_current_room_tenancy: 'Not the room’s current tenancy',
  portal_login_phone_mismatch: 'Portal login phone mapping does not match',
  unallocated_credit: 'Unallocated credit needs reconciliation',
  contact_phone_mismatch: 'Contact phone differs from canonical portal account',
  consent_missing: 'Exact-number WhatsApp opt-in evidence not recorded',
  whatsapp_ownership_unverified: 'WhatsApp ownership evidence not recorded',
  collection_disabled: 'New reminder engine disabled', compliance_approval_missing: 'Operational / compliance approval not recorded',
  opt_out_not_ready: 'STOP pipeline not activated', legacy_handover_incomplete: 'Legacy sender handover not approved',
  scope_or_reconciliation_review: 'Source exceptions require review', payment_verification_pending: 'Payment submission awaiting verification',
  portal_login_phone_missing: 'Current portal login phone unavailable',
};
const filterDefs = [
  ['all', 'All action rows', () => true], ['candidate', 'Current reminder-stage candidates', r => r.candidate],
  ['clean', 'Source-clean, no pending payment', r => r.clean],
  ['missing', 'Linked positive balance, missing phone', r => r.linked_tenant && r.recorded_outstanding > 0.005 && !r.phone_valid],
  ['unlinked', 'Unlinked positive balance', r => !r.linked_tenant && r.recorded_outstanding > 0.005],
  ['partial', 'Partially paid reminder candidates', r => r.candidate && r.partial_invoices > 0],
  ['pending', 'Pending verification — all groups', r => r.pending_verification],
  ['source', 'Source exceptions', r => r.exceptions.length > 0], ['history', 'Zero balance / history', r => r.stage === 'resolved'],
];
const chips = values => values.map(value => `<span class="chip">${h(friendly[value] || value.replaceAll('_', ' '))}</span>`).join('');
const tableRows = records.map(r => {
  const filters = filterDefs.filter(([, , test]) => test(r)).map(([id]) => id).join(' ');
  const context = r.property_rooms.map(x => [x.property_code || x.property, x.room].filter(Boolean).join(' · ')).join('; ');
  const flags = [...new Set([...r.exceptions, ...r.delivery_blocks])];
  const next = r.stage === 'resolved' ? 'No rent demand. Retain historical records; investigate any identity/contact issues separately.'
    : !r.linked_tenant ? 'Link the invoice to the correct current tenancy/profile through the existing authorized workflow. Never guess a recipient.'
    : r.pending_verification ? 'Verify the submitted payment first; do not send an inaccurate demand.'
    : !r.phone_valid ? 'Management must verify the current tenant and phone through an authorized channel; obtain ownership and consent evidence. No automatic account change.'
    : r.exceptions.length ? 'Review source and reconciliation exceptions before considering any reminder. Do not alter balances merely to clear a reminder.'
    : 'Record exact-number ownership and opt-in evidence, complete release/compliance/handover checks, then refresh all source facts.';
  return `<tr data-filters="${filters}" data-stage="${h(r.stage)}"><td data-label="Account"><strong>${h(r.tenant_name)}</strong><small>${r.linked_tenant ? 'Linked account' : 'Unlinked record'} · review ${h(r.reference)}</small><span class="context">${h(context || 'Property / room unresolved')}</span></td>
    <td data-label="Stage">${h(labels[r.stage] || r.stage)}<small>${r.days_overdue == null ? 'No verified aging' : h(r.days_overdue) + ' days from original due date'}${r.partial_invoices ? ' · partially paid' : ''}</small></td>
    <td data-label="Recorded balance">${h(money(r.recorded_outstanding))}<small>Unreconciled value may be present</small></td>
    <td data-label="Financially eligible component">${h(money(r.collectible_outstanding))}<small>${r.clean ? 'Source-clean; no pending payment' : 'Not a cleared tenant demand'}</small></td>
    <td data-label="Action"><div class="status ${r.clean ? 'neutral' : 'hold'}">NO SEND${r.pending_verification ? ' · PAYMENT REVIEW' : ''}</div><p>${h(next)}</p><details><summary>${flags.length} recorded blockers / checks</summary>${chips(flags)}</details></td></tr>`;
}).join('');
const stageRows = stageOrder.map(stage => {
  const row = dry.stages.find(x => x.stage === stage);
  return `<tr><td>${h(labels[stage] || stage)}</td><td>${row?.groups || 0}</td><td>${h(money(row?.amount || 0))}</td><td>${row?.partially_paid_groups || 0}</td><td>${row?.pending_verification_groups || 0}</td></tr>`;
}).join('');
const sampleBlocks = exactSamples.map(sample => `<details class="sample"><summary>${h(sample.stage === 'pending_verification' ? 'Pending payment — neutral preview only' : labels[sample.stage])}${sample.partial ? ' · verified partial payment' : ''}</summary><p class="muted">Review reference ${h(sample.reference)} is an opaque local review identifier, not an invoice number. ${h(sample.explanation)}</p><pre>${h(sample.body)}</pre></details>`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"><title>DEKEZ · Private reminder readiness review</title><style>
*{box-sizing:border-box}body{margin:0;background:#f8f5ed;color:#24231f;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}header{background:#1d1b17;color:#fff8e8;padding:30px clamp(18px,4vw,64px)}main{padding:24px clamp(18px,4vw,64px) 60px;max-width:1800px;margin:auto}h1{font-size:clamp(24px,3vw,36px);line-height:1.2;margin:5px 0 12px}h2{font-size:22px;margin:0 0 14px}h3{font-size:17px;margin:0 0 8px}.eyebrow{color:#d7b76a;letter-spacing:.1em;text-transform:uppercase;font-size:12px;font-weight:700}.private{display:inline-block;background:#643a2c;color:#ffe8d9;border-radius:6px;padding:4px 9px;font-weight:700;font-size:12px}.muted,small{color:#6e6b63}header .muted{color:#d8d1c0}section{margin:24px 0;padding:24px;border:1px solid #e2dccd;border-radius:14px;background:#fffdf8;box-shadow:0 2px 7px #30280a05}.notice{border-left:4px solid #ae8430;background:#f8efda;padding:16px 20px;border-radius:7px}.alert{border-left-color:#b64d36;background:#fff0e9}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:22px 0}.metric{background:#fffdf8;border:1px solid #e2dccd;border-radius:12px;padding:18px}.metric b{font-size:28px;display:block;line-height:1.3}.metric span{display:block;font-size:13px;color:#6e6b63}.metric.highlight{border-color:#b29247;background:#fffbeb}.metric.safe b{color:#4c7058}.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.split section{margin:0}.tablewrap{max-width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6e6550;background:#f4f0e7}td,th{border-bottom:1px solid #e8e3d8;padding:12px;vertical-align:top}td small{display:block;margin-top:5px;font-size:12px}.roster td:nth-child(1){width:23%}.roster td:nth-child(2){width:16%}.roster td:nth-child(3),.roster td:nth-child(4){width:13%}.roster td:nth-child(5){width:35%}.context{display:block;margin-top:6px;color:#68552c;font-size:13px}.filters{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}input,select,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #d8cfbd;background:#fffdf8;color:#25231d;min-height:44px}input{flex:1;min-width:220px}button{cursor:pointer;background:#8e6b24;color:white;border-color:#8e6b24}.status{font-size:11px;font-weight:800;letter-spacing:.04em;display:inline-block;padding:4px 8px;border-radius:5px;background:#efe7d5;color:#735420}.hold{background:#fff0e9;color:#914a32}.chip{display:inline-block;font-size:11px;padding:3px 7px;border-radius:5px;background:#f1ede4;margin:3px 3px 0 0}details summary{cursor:pointer;color:#785a1e;font-weight:650}details p{font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f2ea;border:1px solid #e6ddca;border-radius:8px;padding:18px;font:14px/1.6 system-ui}p{margin:8px 0 12px}.roster p{font-size:12px}.sample{border-top:1px solid #e4ddcd;padding:14px 0}li{margin:7px 0}a{color:#755617}code{overflow-wrap:anywhere}.test{color:#3d6949;font-weight:700}.rowCount{font-weight:700;color:#685322}.foot{font-size:12px;color:#777065;margin-top:25px}[hidden]{display:none!important}@media(max-width:1000px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.split{grid-template-columns:1fr}.roster{font-size:13px}}@media(max-width:650px){section{padding:16px}main{padding:16px}.metrics{gap:9px}.metric{padding:13px}.metric b{font-size:24px}.roster thead{display:none}.roster,.roster tbody,.roster tr,.roster td{display:block;width:100%!important}.roster tr{border:1px solid #e2dccd;border-radius:10px;margin:12px 0;padding:8px}.roster td{border:0;padding:8px}.roster td:before{content:attr(data-label);display:block;font-size:10px;text-transform:uppercase;color:#82765c;letter-spacing:.04em;margin-bottom:4px}.filters>*{width:100%}input{min-width:0}.tablewrap{overflow:visible}}@media print{.filters{display:none}.private{color:#000;border:1px solid #000}.roster{font-size:10px}section{break-inside:avoid}.roster tr{break-inside:avoid}header{background:#fff;color:#000}.eyebrow{color:#000}}
</style></head><body><header><div class="eyebrow">DEKEZ · Draft PR #32 · Read-only production review</div><h1>Payment reminder readiness</h1><p>A complete private action list, real-source message wording and the remaining approval gates.</p><span class="private">PRIVATE · TENANT DATA · DO NOT PUBLISH OR COMMIT</span><p class="muted">Financial snapshot: ${h(when(dry.as_of))}<br>Account/action lookup: ${h(when(privateRows.as_of))}. Separate read-only queries; all 183 matching balances checked for consistency.</p></header><main>
<div class="notice alert"><strong>Not activated. Zero approved sends.</strong> This page is a local review artifact, not a live Admin control. No production migration, settings, device access, provider call or message was performed. Logging in with a phone number is not proof of WhatsApp ownership or consent.</div>
<div class="metrics"><div class="metric"><span>All scoped invoice records</span><b>${metrics.invoices}</b><span>${metrics.groups} account / unlinked groups</span></div><div class="metric"><span>Current reminder-stage candidates</span><b>${metrics.candidates}</b><span>${h(money(metrics.candidateAmount))} financially eligible invoice components</span></div><div class="metric highlight"><span>Source-clean, no pending payment</span><b>${metrics.clean}</b><span>${h(money(metrics.cleanAmount))} — still NOT authorized to send</span></div><div class="metric safe"><span>Verified WhatsApp opt-ins / sends</span><b>0 / 0</b><span>Ownership and consent registry not installed</span></div></div>
<section><h2>What the numbers mean</h2><p>The <strong>35 candidates / ${h(money(metrics.candidateAmount))}</strong> include financially eligible invoice components, but some tenant groups also contain reconciliation exceptions or pending payments. This is <strong>not</strong> an approved amount to demand from every candidate.</p><p><strong>14</strong> candidates have no source exceptions. <strong>3</strong> of those have pending payment verification, leaving <strong>11 / ${h(money(metrics.cleanAmount))}</strong> with clear financial/source checks at this snapshot. They still have no recorded ownership, opt-in or live activation approval.</p><p><strong>5</strong> candidates are partially paid; the original invoice due date stays unchanged. <strong>5</strong> candidates have pending payments: 3 source-clean and 2 with additional exceptions. Pending submissions are held for verification, not treated as unpaid demands.</p><p>All positive-balance groups: <strong>136</strong> (119 linked + 17 unlinked). Missing/invalid current phone among linked positive-balance accounts: <strong>24</strong>. The broader all-history count is 54 groups (25 linked + 29 unlinked); do not compare it with the positive-only 24.</p><div class="notice">Recorded outstanding across all source records is ${h(money(dry.derived_metrics.recorded_outstanding))}; only ${h(money(metrics.candidateAmount))} is classified as financially eligible components by the strict source checks. Cancelled, inactive, unissued, misallocated or otherwise invalid records are not automatically collectible. This work changes none of those records.</div></section>
<div class="split"><section><h2>Stages at the snapshot</h2><div class="tablewrap"><table><thead><tr><th>Stage</th><th>Groups</th><th>Eligible components</th><th>Partial</th><th>Pending</th></tr></thead><tbody>${stageRows}</tbody></table></div><p class="muted">No actual Day 14 or advance-7 candidate exists in this snapshot. No fake example account, due date or invoice reference has been created to fill a missing stage. Day 7/14 are internal reviews, not automatic legal or physical enforcement.</p></section><section><h2>Engineering verification</h2><p class="test">${native.tests.length}/${native.tests.length} native PostgreSQL checks passed</p><p>Independent caller sessions ${h(native.callerPids.a)} / ${h(native.callerPids.b)}; ${native.waits.length} observed database lock waits. One daily tenant/phone reservation, one worker per company/date, one management summary, STOP races, scope revocation, receipt deduplication and audited follow-up resolution were checked.</p><p class="test">10/10 legacy sender and physical-access safety tests passed</p><p>Eleven private tables enforce RLS and deny direct anon/authenticated/service-role access. Synthetic business tables remained unchanged. Zero provider calls.</p><p class="muted">Successful tenant ledger claims used synthetic private fixtures. The public 09:00 MYT send gate was tested against the real outside-window clock, not bypassed. This is not a live WhatsApp or full 09:00 production send test.</p><p class="foot">Reviewed migration SHA256<br><code>${h(native.migrations[0].sha256)}</code></p></section></div>
<section id="actions"><h2>Complete private Admin action list</h2><p>All <strong>183</strong> rows are retained, including historical/zero-balance and unlinked records. No list truncation. Names and room context are for authorized local management review only. “NO SEND” is a hold, <strong>not</strong> proof that WhatsApp delivery failed.</p><div class="filters"><input id="search" type="search" aria-label="Search tenant, room or review reference" placeholder="Search name, property, room or review reference"><select id="filter" aria-label="Filter action list">${filterDefs.map(([key, label, test]) => `<option value="${key}">${h(label)} (${records.filter(test).length})</option>`).join('')}</select><select id="stage" aria-label="Filter stage"><option value="all">Every stage</option>${stageOrder.map(s => `<option value="${s}">${h(labels[s] || s)}</option>`).join('')}</select><button id="reset" type="button">Reset</button></div><p class="rowCount" id="count" aria-live="polite">183 of 183 rows shown</p><div class="tablewrap"><table class="roster"><thead><tr><th>Account / property / room</th><th>Stage / original clock</th><th>Recorded balance</th><th>Eligible invoice component</th><th>Hold / next action</th></tr></thead><tbody>${tableRows}</tbody></table></div></section>
<section><h2>Exact tenant-message wording previews</h2><p>Generated by <code>formatCollectionMessage</code> from the current application source. Real current financial values are used only where a source-clean single reportable invoice permits exact output without exposing or inventing invoice numbers. These are <strong>not sent</strong>. Multi-invoice exact messages are withheld because this private export intentionally omitted their real invoice references.</p><div class="notice alert">Escalation text is wording for review, not a legal notice approval. The migration is not installed and internal review records have not been created. Do not send wording claiming a case “has been referred” until the corresponding internal record exists and required agreement/compliance review is complete.</div>${sampleBlocks}</section>
<section><h2>Rosley · Bahasa Melayu management preview</h2><p>Intended number: <strong>60188702371</strong>. Current production lookup found one approved management account with active DEKEZ company membership and <code>rent_due_tracker: manage</code>. Generic Reports and Admin Setup remain denied. No additional access is granted.</p><p>WhatsApp ownership: <strong>not verified</strong>. Opt-in: <strong>unknown</strong>. Sending: <strong>blocked</strong>. The actual formatter therefore produces only the generic, non-personal notice below; even this notice is <strong>not authorized to send yet</strong>.</p><pre>${h(rosley.body)}</pre><p>The complete roster is the private Admin list above. Phone gaps, payment holds, source exceptions, unknown outcomes and confirmed delivery failures are separate categories. The new delivery ledger is absent in production, so delivery evidence is <strong>unavailable</strong>; no historical failure count is invented. A provider “accepted” response would still not prove delivery.</p><p>One future consolidated management report per Malaysia date is protected by a durable reservation. Later receipt or follow-up changes update the portal draft, not a second WhatsApp report. The formatter’s generic fallback does not authorize bypassing consent, management scope or the daily worker review.</p></section>
<section><h2>Required before any live activation</h2><ol><li>Review the Draft PR and additive migration, verify a recoverable backup, then obtain separate production migration/release approval.</li><li>Deploy the legacy rent-sender retirement and complete controlled handover, including old immutable deployment URLs and in-flight/uncertain sends. Never run two rent senders.</li><li>Record verified current-number ownership and explicit WhatsApp opt-in for tenants and Rosley. Login phone or management role alone is insufficient.</li><li>Activate and verify authenticated STOP and delivery-receipt handling under separate approval. START must not automatically restore consent.</li><li>Resolve source exceptions and pending payments using existing authorized financial workflows. Refresh balances immediately before claiming a send; never alter accounting merely to clear a hold.</li><li>Approve exact messaging cadence/content and actual signed-agreement review thresholds. Ordinary factual payment reminders are not automatically prohibited debt collection, but repeated final-warning/termination wording needs specific review.</li><li>Complete the physical credential-expiry audit and access-continuity decision. The dormant arrears suspension helper is disabled; existing 30-day/payment-linked expiry has not been changed or cleared.</li><li>Approve measured provider pacing and bounded worker capacity. Uncertain sends never automatically retry; incomplete batches stay visible for review.</li><li>Only after explicit activation approval, enable the new reminder controls and schedule. Preserve all seven current cron entries and the 20:00 management report.</li></ol><p>Settlement changes the outstanding balance, not the original due date. No automated lockout, utility cut-off, eviction or tenancy termination is implemented.</p></section>
<p class="foot">Source: authorized read-only production exports; company ${h(dry.company_id)}. This static file has no external assets, network calls, sending controls or production credentials. It contains private tenant details: keep local and do not attach to the PR or publish as a public preview.</p>
</main><script>(()=>{const rows=[...document.querySelectorAll('.roster tbody tr')];const search=document.getElementById('search'),filter=document.getElementById('filter'),stage=document.getElementById('stage'),count=document.getElementById('count');function refresh(){const q=search.value.trim().toLocaleLowerCase();let shown=0;for(const row of rows){const show=row.dataset.filters.split(' ').includes(filter.value)&&(stage.value==='all'||row.dataset.stage===stage.value)&&(!q||row.textContent.toLocaleLowerCase().includes(q));row.hidden=!show;if(show)shown++;}count.textContent=shown+' of '+rows.length+' rows shown';}search.addEventListener('input',refresh);filter.addEventListener('change',refresh);stage.addEventListener('change',refresh);document.getElementById('reset').addEventListener('click',()=>{search.value='';filter.value='all';stage.value='all';refresh();});refresh();})();</script></body></html>`;
// Exercise the actual embedded filtering script against the generated rows.
// This checks behavior without loading private names into a browser/log output.
const uiRows = [...tableRows.matchAll(/<tr data-filters="([^"]+)" data-stage="([^"]+)">([\s\S]*?)<\/tr>/g)]
  .map(match => ({ dataset: { filters: match[1], stage: match[2] }, textContent: match[3].replace(/<[^>]+>/g, ' '), hidden: false }));
assert.equal(uiRows.length, 183);
const controls = Object.fromEntries(['search', 'filter', 'stage', 'count', 'reset'].map(id => [id, {
  value: ['filter', 'stage'].includes(id) ? 'all' : '', textContent: '', handlers: {},
  addEventListener(event, callback) { this.handlers[event] = callback; },
}]));
const filterScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new Function('document', filterScript)({ querySelectorAll: () => uiRows, getElementById: id => controls[id] });
for (const [key, , test] of filterDefs) {
  controls.filter.value = key; controls.filter.handlers.change();
  assert.equal(uiRows.filter(row => !row.hidden).length, records.filter(test).length, 'Filter ' + key);
}
controls.reset.handlers.click(); controls.stage.value = 'due_today'; controls.stage.handlers.change();
assert.equal(uiRows.filter(row => !row.hidden).length, 1);
controls.reset.handlers.click(); controls.search.value = 'no-matching-review-reference-xyz'; controls.search.handlers.input();
assert.equal(uiRows.filter(row => !row.hidden).length, 0);
controls.reset.handlers.click(); assert.equal(uiRows.filter(row => !row.hidden).length, 183);
assert(!/<script[^>]+src=|<link[^>]+href=|<iframe|fetch\(|XMLHttpRequest/.test(html), 'No external assets/network controls');
assert(html.includes('connect-src \'none\''));
fs.writeFileSync(path.join(out, 'final-20261027.html'), html, 'utf8');
fs.writeFileSync(path.join(out, '20261027-exact-message-previews.private.json'), JSON.stringify({ classification: 'PRIVATE REVIEW ONLY - no send authorization', report_date: dry.report_date, as_of: dry.as_of, exactSamples, rosley: { recipient: rosley.recipient, body: rosley.body, canSend: false, readiness: rosley.readiness }, sourceHashes: { model: sha('lib/rental-collection/model.ts'), failureReport: sha('lib/rental-collection/failure-report.ts') } }, null, 2), 'utf8');
console.log(JSON.stringify({ generated: 'artifacts/rental-collection-review/final-20261027.html', groups: records.length, metrics, exactFormatterSamples: exactSamples.length, nativeTests: native.tests.length, localFilterChecks: filterDefs.length + 4, liveCalls: 0, containsPrivateTenantDetails: true }));
