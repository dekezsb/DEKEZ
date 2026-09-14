import assert from 'node:assert/strict';
import test from 'node:test';
import { commercialDepositSchedule, requiredTenancyDeposit } from '../../lib/tenancy/commercial-deposit-policy.ts';
test('agreed office deposit survives a rent change without top-up', () => {
  const agreed = {securityDeposit:1000,utilityDeposit:250};
  for (const monthlyRent of [500,600,700]) {
    assert.deepEqual(commercialDepositSchedule(monthlyRent,agreed),{securityDeposit:1000,utilityDeposit:250,totalDeposit:1250});
    assert.equal(requiredTenancyDeposit({isCommercial:true,monthlyRent,statedDeposit:1500,agreed}),1250);
  }
});
test('other office units keep the automatic two plus half month schedule', () => {
  assert.deepEqual(commercialDepositSchedule(600),{securityDeposit:1200,utilityDeposit:300,totalDeposit:1500});
  assert.equal(requiredTenancyDeposit({isCommercial:false,monthlyRent:600,statedDeposit:200}),200);
});
