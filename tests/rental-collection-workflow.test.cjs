const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {renderToStaticMarkup} = require('react-dom/server');
const loader = require('./marketplace-component-loader.cjs');
const load = loader({'./evidence-actions':{submitReminderEvidence:async()=>{throw Error('No writes during render');},reviewReminderEvidence:async()=>{throw Error('No writes during render');},recordManagementStop:async()=>{throw Error('No writes during render');}}});
const {reminderWorklist, inReminderQueue} = load('lib/rental-collection/workflow.ts');
const {ReminderWorklist} = load('app/rent-due-tracker/reminder-followups/worklist.tsx');
const {ReminderConsentGuide} = load('app/admin-setup/rental-reminders/consent-guide.tsx');
const row = (n, categories = [], changes = {}) => ({key: `fixture-${n}`, tenant_id: `tenant-${n}`, name: `Fixture ${n}`,
  loginPhone: '60191111111', propertyRooms: ['Synthetic property / Room A'], verifiedCollectibleBalance: 300,
  categories, reasons: ['Synthetic review evidence'], confirmedAttempts: 0, unresolvedAttempts: 0, existingCaseIds: [], ...changes});

test('queues distinguish phone, consent/hold, payment/source and delivery without approving any account', () => {
  const rows = [row(1,['invalid_login_phone']), row(2,['communications_hold']), row(3,['source_exception']), row(4,['awaiting_delivery']), row(5,['confirmed_failure'])];
  assert.deepEqual(reminderWorklist(rows).counts.map(r=>r.count), [5,1,1,1,2]);
  assert.equal(inReminderQueue(row(6,[],{tenant_id:null}), 'phone'),true);
  assert.equal(inReminderQueue(row(7,[],{loginPhone:null}), 'phone'),true);
  assert.equal(inReminderQueue(row(8,['communications_hold']), 'delivery'),false);
  assert.equal(inReminderQueue(row(9,['source_exception']), 'consent'),false);
  assert(!Object.hasOwn(reminderWorklist(rows), 'sendEligible'));
});
test('overlapping issues retain one account per queue without double-counting All', () => {
  const rows=[row(1,['invalid_login_phone','communications_hold','source_exception','delivery_unknown'])];
  assert.deepEqual(reminderWorklist(rows).counts.map(r=>r.count),[1,1,1,1,1]);
});
test('filtering precedes 25-account pagination and includes later matching rows', () => {
  const rows=Array.from({length:60},(_,n)=>row(n,[n<30?'source_exception':'communications_hold']));
  const first=reminderWorklist(rows,'consent'),second=reminderWorklist(rows,'consent','2');
  assert.equal(first.total,30);assert.equal(first.rows.length,25);assert.equal(first.rows[0].key,'fixture-30');
  assert.equal(second.rows.length,5);assert.equal(second.rows[4].key,'fixture-59');
});
test('query parameters cannot select arbitrary accounts or expand page limits', () => {
  const rows=Array.from({length:60},(_,n)=>row(n,['source_exception']));
  for(const input of ['0','-1','NaN','1.5','9999999','<script>'])assert.equal(reminderWorklist(rows,'payment',input).page,1);
  assert.equal(reminderWorklist(rows,'payment','999999').page,3);
  assert.equal(reminderWorklist(rows,'../../private','1').queue,'all');
  assert.equal(reminderWorklist([]).pages,1);
});
test('worklist presentation does not mutate balances, history or consent data', () => {
  const rows=[row(1,['communications_hold'],{verifiedCollectibleBalance:null})];
  const before=JSON.stringify(rows);reminderWorklist(rows,'consent','1');assert.equal(JSON.stringify(rows),before);
});
test('rendered cards escape tenant text, preserve unknown balances and only offer pending evidence submission', () => {
  const html=renderToStaticMarkup(ReminderWorklist({accounts:[row(1,['source_exception'],{name:'<script>unsafe</script>',verifiedCollectibleBalance:null,loginPhone:null})]}));
  assert.match(html,/&lt;script&gt;unsafe/);assert.doesNotMatch(html,/<script>unsafe/);
  assert.match(html,/Unavailable — reconcile source records/);assert.doesNotMatch(html,/RM 0\.00/);
  assert.match(html,/Missing or unusable/);assert.doesNotMatch(html,/href="tel:|wa\.me|name="decision"/);
  assert.match(html,/Submit for review/);assert.match(html,/Pending Super Admin review only/);
});
test('empty and paginated screens are clear and do not imply send approval', () => {
  assert.match(renderToStaticMarkup(ReminderWorklist({accounts:[]})),/not approval to send/);
  const html=renderToStaticMarkup(ReminderWorklist({accounts:Array.from({length:26},(_,n)=>row(n)),queue:'all'}));
  assert.equal((html.match(/<article/g)||[]).length,25);assert.match(html,/Next 25/);assert.match(html,/page=2/);
  assert.match(html,/aria-label="Reminder follow-up queues"/);assert.match(html,/aria-current="page"/);
});
test('guide separates identity, WhatsApp ownership and voluntary consent; STOP is immediate', () => {
  const html=renderToStaticMarkup(ReminderConsentGuide({}));
  for(const text of ['Match the person','Verify WhatsApp ownership','voluntary consent','ordinary phone call','STOP','START only requests review','changed login number','existing payment-verification','never sends a message'])assert(html.includes(text),text);
  assert.match(html,/only authorized Admin/);assert.doesNotMatch(html,/<form|type="submit"/);
  assert.match(renderToStaticMarkup(ReminderConsentGuide({canReview:true})),/verify ownership first/);
});
test('contact control keeps current number read-only and opt-in unavailable before ownership', () => {
  const {ContactReview}=loader({'./actions':{reviewReminderContact:async()=>{throw Error('must not save while rendering');}}})('app/admin-setup/rental-reminders/contact-review.tsx');
  const React=require('react');
  const html=renderToStaticMarkup(React.createElement(ContactReview,{tenant:'fixture',recipient:'60191111111',ownershipVerified:false}));
  assert.match(html,/Current registered number/);assert.match(html,/60191111111/);
  assert.match(html,/value="record_opt_in" disabled/);assert.match(html,/name="recipient" type="hidden"|type="hidden" name="recipient"/);
  assert.doesNotMatch(html,/checked=""|name="reason"[^>]*value=/);
  assert.match(html,/original date\/time/);assert.match(html,/STOP request/);
});
test('navigation is additive and role-limited; follow-up page still authenticates before querying', () => {
  const tracker=fs.readFileSync('app/rent-due-tracker/page.tsx','utf8');
  assert.match(tracker,/canUploadSlip \? <Link href="\/rent-due-tracker\/reminder-followups"/);
  const page=fs.readFileSync('app/rent-due-tracker/reminder-followups/page.tsx','utf8');
  assert(page.indexOf('if (!await reminderManager())')<page.indexOf('collectionFailurePreview(new Date(), true)'));
  assert.match(page,/mayReviewRecipient \? <FailureRecipientReview/);
});

test('activation plan requires initial clearance but no manual approval of each scheduled day',()=>{
 const plan=JSON.parse(fs.readFileSync('config/rental-collection-cron.pending.json','utf8'));
 assert.equal(plan.reviewOnly,true);assert.equal(plan.activationRequiresSeparateApproval,true);
 assert.equal(plan.afterInitialActivation.mode,'unattended_daily');assert.equal(plan.afterInitialActivation.dailyManualApprovalRequired,false);
 assert.equal(plan.afterInitialActivation.recheckEligibilityBeforeEverySend,true);
 assert(plan.requiredBeforeActivation.includes('initial_policy_and_rollout_recipient_message_approval'));
 assert.equal(plan.appendAfterApproval.schedule,'0 1 * * *');
 assert.equal(plan.stage1Deployment.mode,'scan_only');assert.equal(plan.stage1Deployment.tenantSendingEnabled,false);
 assert.equal(plan.stage1Deployment.managementDigestSendingEnabled,false);assert.equal(plan.stage1Deployment.liveSendingStillRequiresSeparateClearance,true);
 const html=renderToStaticMarkup(ReminderConsentGuide({}));assert.match(html,/No daily manual approval is required/);
 assert.match(html,/Management still decides Day 7 restrictions, Day 14 termination reviews/);
});

test('Rosley failed report produces an Admin alert without extra sending controls or false delivery claims',()=>{
 const {ReminderDigestStatus}=load('app/admin-setup/rental-reminders/digest-status.tsx');
 const failed={report_date:'2026-11-15',state:'accepted',delivery_state:'failed',error_code:null,updated_at:null,needs_admin_review:true};
 const html=renderToStaticMarkup(ReminderDigestStatus({available:true,current:failed,alerts:[failed],alertCount:28}));
 assert.match(html,/role="alert"/);assert.match(html,/28 report delivery exceptions/);assert.match(html,/Delivery failure confirmed/);
 assert.match(html,/not proof of delivery/);assert.match(html,/Showing the latest 1 of 28/);
 assert.doesNotMatch(html,/<form|type="submit"|wa\.me|href="tel:/);
 const unavailable=renderToStaticMarkup(ReminderDigestStatus({available:false,current:null,alerts:[],alertCount:0}));
 assert.match(unavailable,/Delivery monitoring unavailable/);assert.doesNotMatch(unavailable,/No recorded report-delivery alerts/);
});

test('Rosley report alerts remain behind the existing fresh Admin permission check',()=>{
 const source=fs.readFileSync('app/rent-due-tracker/reminder-followups/page.tsx','utf8');
 assert.match(source,/mayReviewRecipient \? <ReminderDigestStatus/);
 assert(source.indexOf('if (!await reminderManager())')<source.indexOf('collectionFailurePreview(new Date(), true)'));
});
