const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./renovation-loader.cjs');
const policy = load('lib/marketplace/policy.ts');
const status = load('lib/marketplace/status.ts');
const quote = load('lib/marketplace/quotation.ts');
const login = load('lib/marketplace/contractor-login.ts');
const now = Date.parse('2026-10-23T04:00:00Z');
const future = '2026-11-23T04:00:00Z';
const contractor = () => ({
  contractorId: 'contractor-a', verification: 'VERIFIED', subscription: 'ACTIVE',
  subscriptionStartsAt: '2026-10-01T00:00:00Z', subscriptionEndsAt: future,
  billingVerified: true, available: true, categoryEligible: true, areaEligible: true,
  qualificationsCurrent: true,
});
const submission = () => ({
  jobId: 'job-a', jobStatus: 'OPEN_FOR_QUOTATIONS', quotationDeadline: future,
  invitation: { jobId: 'job-a', contractorId: 'contractor-a', status: 'INVITED', expiresAt: future },
  hasCurrentSubmittedQuotation: false, activeQuotationCount: 0, maximumActiveQuotations: 5,
});
const job = (state = 'IN_PROGRESS') => ({
  ownerUserId: 'owner-a', status: state, selectedContractorId: 'contractor-a', ownerConfirmedCompletionAt: null,
});
const owner = { kind: 'owner', userId: 'owner-a' };
const technician = { kind: 'contractor', userId: 'user-contractor-a', contractorId: 'contractor-a' };
const admin = { kind: 'admin', userId: 'admin-a', canManageMarketplace: true };
const worker = { kind: 'worker', authorized: true };

test('verified billing and business verification are independent requirements', () => {
  assert.equal(policy.newOpportunityEligibility(contractor(), now).allowed, true);
  for (const verification of status.verificationStatuses.filter(s => s !== 'VERIFIED')) {
    assert.equal(policy.newOpportunityEligibility({ ...contractor(), verification }, now).allowed, false);
  }
  for (const subscription of status.subscriptionStatuses.filter(s => s !== 'ACTIVE')) {
    assert.equal(policy.newOpportunityEligibility({ ...contractor(), subscription }, now).allowed, false);
  }
  for (const field of ['billingVerified', 'available', 'categoryEligible', 'areaEligible', 'qualificationsCurrent']) {
    for (const value of [false, null, undefined, 'true', 1]) {
      assert.equal(policy.newOpportunityEligibility({ ...contractor(), [field]: value }, now).allowed, false, field);
    }
  }
});

test('membership must have a valid current term; equality at expiry is expired', () => {
  for (const end of [null, 'invalid', new Date(now).toISOString(), '2020-01-01T00:00:00Z']) {
    assert.equal(policy.newOpportunityEligibility({ ...contractor(), subscriptionEndsAt: end }, now).allowed, false);
  }
  for (const start of [null, 'invalid', future]) {
    assert.equal(policy.newOpportunityEligibility({ ...contractor(), subscriptionStartsAt: start }, now).allowed, false);
  }
  for (const clock of [NaN, Infinity, -Infinity]) assert.equal(policy.newOpportunityEligibility(contractor(), clock).allowed, false);
});

test('quotation requires the current invitation for the same contractor and job', () => {
  assert.equal(policy.quotationSubmissionEligibility(contractor(), submission(), now).allowed, true);
  for (const invitation of [null, { ...submission().invitation, jobId: 'job-b' }, { ...submission().invitation, contractorId: 'contractor-b' }]) {
    assert.equal(policy.quotationSubmissionEligibility(contractor(), { ...submission(), invitation }, now).allowed, false);
  }
  for (const state of status.invitationStatuses.filter(s => s !== 'INVITED')) {
    assert.equal(policy.quotationSubmissionEligibility(contractor(), { ...submission(), invitation: { ...submission().invitation, status: state } }, now).allowed, false);
  }
});

test('closed jobs, deadlines, duplicate submissions and invalid capacity deny new quotations', () => {
  for (const jobStatus of status.jobStatuses.filter(s => !['OPEN_FOR_QUOTATIONS', 'QUOTATIONS_RECEIVED'].includes(s))) {
    assert.equal(policy.quotationSubmissionEligibility(contractor(), { ...submission(), jobStatus }, now).allowed, false);
  }
  for (const patch of [
    { quotationDeadline: new Date(now).toISOString() }, { quotationDeadline: 'invalid' },
    { invitation: { ...submission().invitation, expiresAt: new Date(now).toISOString() } },
    { hasCurrentSubmittedQuotation: true }, { hasCurrentSubmittedQuotation: undefined },
    { activeQuotationCount: 5 }, { activeQuotationCount: -1 }, { activeQuotationCount: 0.5 },
    { activeQuotationCount: NaN }, { maximumActiveQuotations: 0 }, { maximumActiveQuotations: Infinity },
  ]) assert.equal(policy.quotationSubmissionEligibility(contractor(), { ...submission(), ...patch }, now).allowed, false);
});

test('owner submission, admin moderation and worker invitations form separate transitions', () => {
  assert.equal(policy.evaluateJobTransition(job('DRAFT'), owner, 'SUBMIT').nextStatus, 'PENDING_REVIEW');
  assert.equal(policy.evaluateJobTransition(job('PENDING_REVIEW'), admin, 'APPROVE').nextStatus, 'OPEN_FOR_MATCHING');
  assert.equal(policy.evaluateJobTransition(job('OPEN_FOR_MATCHING'), worker, 'INVITE').nextStatus, 'OPEN_FOR_QUOTATIONS');
  assert.equal(policy.evaluateJobTransition(job('PENDING_REVIEW'), owner, 'APPROVE').allowed, false);
  assert.equal(policy.evaluateJobTransition(job('PENDING_REVIEW'), { ...admin, canManageMarketplace: false }, 'APPROVE').allowed, false);
  assert.equal(policy.evaluateJobTransition(job('OPEN_FOR_MATCHING'), { ...worker, authorized: false }, 'INVITE').allowed, false);
  assert.equal(policy.evaluateJobTransition(job('PENDING_REVIEW'), admin, 'REJECT').reason, 'reason_required');
  assert.equal(policy.evaluateJobTransition(job('PENDING_REVIEW'), admin, 'REJECT', 'Incomplete scope').nextStatus, 'REJECTED');
});

test('only the selected contractor starts/reports work; only the actual owner confirms completion', () => {
  assert.equal(policy.evaluateJobTransition(job('CONTRACTOR_SELECTED'), technician, 'START_WORK').nextStatus, 'IN_PROGRESS');
  assert.equal(policy.evaluateJobTransition(job(), technician, 'REPORT_COMPLETION').nextStatus, 'WORK_REPORTED_COMPLETED');
  assert.equal(policy.evaluateJobTransition(job('WORK_REPORTED_COMPLETED'), owner, 'CONFIRM_COMPLETION').nextStatus, 'COMPLETED');
  for (const actor of [technician, admin, worker, { ...owner, userId: 'owner-b' }]) {
    assert.equal(policy.evaluateJobTransition(job('WORK_REPORTED_COMPLETED'), actor, 'CONFIRM_COMPLETION').allowed, false);
  }
  assert.equal(policy.evaluateJobTransition(job(), { ...technician, contractorId: 'contractor-b' }, 'REPORT_COMPLETION').allowed, false);
  assert.equal(policy.evaluateJobTransition({ ...job('WORK_REPORTED_COMPLETED'), selectedContractorId: null }, owner, 'CONFIRM_COMPLETION').allowed, false);
});

test('selection cannot replace an existing match; exceptional transitions require a reason', () => {
  assert.equal(policy.evaluateJobTransition(job('QUOTATIONS_RECEIVED'), owner, 'SELECT_CONTRACTOR').reason, 'contractor_already_selected');
  assert.equal(policy.evaluateJobTransition({ ...job('QUOTATIONS_RECEIVED'), selectedContractorId: null }, owner, 'SELECT_CONTRACTOR').nextStatus, 'CONTRACTOR_SELECTED');
  assert.equal(policy.evaluateJobTransition(job(), owner, 'CANCEL', 'Changed mind').allowed, false);
  assert.equal(policy.evaluateJobTransition(job(), owner, 'RAISE_DISPUTE', ' ').allowed, false);
  assert.equal(policy.evaluateJobTransition(job(), owner, 'RAISE_DISPUTE', 'Scope disagreement').nextStatus, 'DISPUTED');
  assert.equal(policy.evaluateJobTransition(job('WORK_REPORTED_COMPLETED'), owner, 'REQUEST_FURTHER_WORK', 'Work remains').nextStatus, 'IN_PROGRESS');
  for (const action of ['constructor', '__proto__', 'UNKNOWN']) assert.equal(policy.evaluateJobTransition(job(), owner, action).allowed, false);
});

test('expired membership cannot erase accepted jobs or essential communication', () => {
  const expired = { ...contractor(), subscription: 'EXPIRED' };
  assert.equal(policy.newOpportunityEligibility(expired, now).allowed, false);
  assert.equal(policy.canAccessAcceptedJob(job(), technician), true);
  assert.equal(policy.canAccessAcceptedJob(job('DISPUTED'), technician), true);
  assert.equal(policy.canAccessAcceptedJob(job('CLOSED'), technician), true);
  assert.equal(policy.canAccessAcceptedJob(job(), { ...technician, contractorId: 'contractor-b' }), false);
  assert.equal(policy.canAccessAcceptedJob(job(), { ...owner, userId: 'owner-b' }), false);
  assert.equal(policy.canAccessAcceptedJob(job('OPEN_FOR_QUOTATIONS'), technician), false);
});

test('reviews require real owner-confirmed completion, participation and no prior review by that reviewer', () => {
  const completed = { ...job('COMPLETED'), ownerConfirmedCompletionAt: new Date(now).toISOString() };
  for (const actor of [owner, technician]) {
    assert.equal(policy.canSubmitReview(completed, actor, false), true);
    assert.equal(policy.canSubmitReview(completed, actor, true), false);
    assert.equal(policy.canSubmitReview(job('WORK_REPORTED_COMPLETED'), actor, false), false);
    assert.equal(policy.canSubmitReview(job('COMPLETED'), actor, false), false);
  }
  assert.equal(policy.canSubmitReview(completed, admin, false), false);
  assert.equal(policy.canSubmitReview(completed, { ...owner, userId: 'owner-b' }, false), false);
  assert.equal(policy.evaluateJobTransition(completed, owner, 'CLOSE').nextStatus, 'CLOSED');
  assert.equal(policy.evaluateJobTransition(job('COMPLETED'), owner, 'CLOSE').reason, 'owner_completion_required');
});

test('quotation totals round line amounts to cents and tax once, with no floating point drift', () => {
  const lines = [{ description: 'Repair', quantity: '2.5', unitPrice: '10.01' }, { description: 'Material', quantity: '3', unitPrice: '0.10' }];
  const before = JSON.stringify(lines);
  assert.deepEqual(quote.calculateQuotationTotals(lines, '6'), {
    lineTotalsCents: [2503, 30], subtotalCents: 2533, taxCents: 152, totalCents: 2685,
  });
  assert.equal(JSON.stringify(lines), before);
  assert.equal(quote.calculateQuotationTotals([{ description: 'Half-cent rounds up', quantity: '0.5', unitPrice: '0.01' }], '0').totalCents, 1);
});

test('invalid, negative, unsafe and excessive quotation inputs cannot produce totals', () => {
  const line = { description: 'Repair', quantity: '1', unitPrice: '500.00' };
  for (const value of ['-1', 'NaN', 'Infinity', '1e3', '', ' 1', '1.1234', '1,000', null, 1]) {
    assert.throws(() => quote.calculateQuotationTotals([{ ...line, quantity: value }], '0'));
  }
  for (const value of ['-1', '0.001', 'NaN', 'Infinity', '99999999999999999999999']) {
    assert.throws(() => quote.calculateQuotationTotals([{ ...line, unitPrice: value }], '0'));
  }
  assert.throws(() => quote.calculateQuotationTotals([], '0'));
  assert.throws(() => quote.calculateQuotationTotals(Array(201).fill(line), '0'));
  assert.throws(() => quote.calculateQuotationTotals([{ ...line, description: ' ' }], '0'));
  assert.throws(() => quote.calculateQuotationTotals([{ ...line, quantity: '0' }], '0'));
  assert.throws(() => quote.calculateQuotationTotals([{ ...line, unitPrice: '0' }], '0'));
  for (const rate of ['-1', '100.01', '1.123', 'NaN']) assert.throws(() => quote.calculateQuotationTotals([line], rate));
});

test('phone normalization gives the same starter PIN without changing existing auth helpers', () => {
  for (const phone of ['0198894911', '+60198894911', '+60 19-889 4911']) assert.equal(login.contractorStarterPin(phone), '4911');
  assert.equal(login.contractorStarterPin('not-a-phone'), null);
  assert.equal(login.contractorLoginPolicy.futureMethod, 'whatsapp_otp');
  assert.equal(login.contractorLoginPolicy.maximumFailedAttempts, 5);
});

test('personal PIN replaces the guessable starter; only contractor credentials can enter contractor flow', () => {
  for (const pin of ['4911', '8894911', '123456', '654321', '000000', 'abcdef', '894911']) {
    assert.equal(login.validContractorPersonalPin('0198894911', pin), false, pin);
  }
  assert.equal(login.validContractorPersonalPin('0198894911', '749362'), true);
  const state = { role: 'contractor', credentialVerified: true, starterPinChanged: false, accountEnabled: true };
  assert.equal(login.contractorLoginDestination(state), '/contractor/change-pin');
  assert.equal(login.contractorLoginDestination({ ...state, starterPinChanged: true }), '/contractor/dashboard');
  for (const role of ['tenant', 'client_owner', 'owner', 'admin', 'super_admin', 'technician', '']) {
    assert.equal(login.contractorLoginDestination({ ...state, role }), null);
  }
  assert.equal(login.contractorLoginDestination({ ...state, credentialVerified: false }), null);
  assert.equal(login.contractorLoginDestination({ ...state, accountEnabled: false }), null);
});
