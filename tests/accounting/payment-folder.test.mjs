import assert from 'node:assert/strict';
import test from 'node:test';
import { folderSummary, groupPaymentFolders } from '../../lib/payments/payment-folder.ts';

test('pending slips do not reduce the official balance', () => {
  assert.deepEqual(folderSummary(380, 280, 150), { required: 380, verified: 100, pending: 150, outstanding: 280, toSubmit: 130, excess: 0 });
  assert.equal(folderSummary(380, 280, 350).excess, 70);
});

const slip = (id, bill, status, purpose = 'monthly_rent', tenancy = 'tenant-a') => ({ id, rent_bill_id: bill, tenancy_id: tenancy,
  tenant_record_id: null, tenant_application_id: null, payment_type: purpose, verification_status: status });
test('a pending folder keeps all earlier verified slips, not just the latest upload', () => {
  const rows = [slip('1', 'september', 'verified'), slip('2', 'september', 'pending_verification'), slip('3', 'august', 'verified')];
  const groups = groupPaymentFolders(rows, 'pending_verification');
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0][1].map(s => s.id), ['1', '2']);
});
test('deposit stays together across months, but different tenancies and rental months never mix', () => {
  const rows = [slip('1', 'august', 'verified', 'deposit'), slip('2', 'september', 'pending_verification', 'deposit'),
    slip('3', 'september', 'pending_verification'), slip('4', 'august', 'verified'), slip('5', 'september-b', 'pending_verification', 'deposit', 'tenant-b')];
  const groups = groupPaymentFolders(rows);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.find(([key]) => key === 'deposit:tenant-a')[1].map(s => s.id), ['1', '2']);
});
