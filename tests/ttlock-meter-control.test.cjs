const test = require('node:test');
const assert = require('node:assert/strict');
const { read, fakeAdmin, loader } = require('./ttlock-test-helpers.cjs');

const rules = require('../lib/ttlock/meter-rules.ts');

test('meter readings parse kWh strings and Malaysia billing months', () => {
  assert.equal(rules.parseKwh('9.89'), 9.89);
  assert.equal(rules.parseKwh('0.00kWh'), 0);
  assert.equal(rules.parseKwh(null), null);
  assert.equal(rules.malaysiaBillingMonth(new Date('2026-11-30T17:00:00Z')), '2026-12-01');
  assert.equal(rules.malaysiaBillingMonth(new Date('2026-11-30T15:00:00Z')), '2026-11-01');
  assert.equal(rules.providerTimestamp(1750748374000).toISOString(), '2025-06-24T06:59:34.000Z');
  assert.equal(rules.providerTimestamp(null), null);
});

test('monthly readings stay monotonic and open from last month close', () => {
  assert.deepEqual(
    rules.planMonthlyReading({ totalKwh: 120, existingThisMonth: null, lastClosingReading: 100 }),
    { previous_reading: 100, current_reading: 120, changed: true },
  );
  assert.deepEqual(
    rules.planMonthlyReading({ totalKwh: 5, existingThisMonth: null, lastClosingReading: 100 }),
    { previous_reading: 5, current_reading: 5, changed: true },
  );
  assert.deepEqual(
    rules.planMonthlyReading({ totalKwh: 90, existingThisMonth: { previous_reading: 100, current_reading: 110 }, lastClosingReading: 80 }),
    { previous_reading: 100, current_reading: 100, changed: true },
  );
  assert.equal(
    rules.planMonthlyReading({ totalKwh: 110, existingThisMonth: { previous_reading: 100, current_reading: 110 }, lastClosingReading: null }).changed,
    false,
  );
});

test('move-in only restores power DEKEZ cut at checkout', () => {
  assert.equal(rules.shouldRestorePowerOnMoveIn({ power_state: 'off', power_control_reason: 'checkout' }), true);
  assert.equal(rules.shouldRestorePowerOnMoveIn({ power_state: 'off', power_control_reason: 'staff' }), false);
  assert.equal(rules.shouldRestorePowerOnMoveIn({ power_state: 'on', power_control_reason: null }), false);
  assert.equal(rules.operationRecordLabel(7), 'Recharge');
});

function loadClient(respond) {
  const calls = [];
  const previous = { ...process.env };
  Object.assign(process.env, { TTLOCK_CLIENT_ID: 'c', TTLOCK_CLIENT_SECRET: 's', TTLOCK_USERNAME: 'u', TTLOCK_PASSWORD: 'p', TTLOCK_API_BASE_URL: 'https://ttlock.test' });
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const body = Object.fromEntries(new URLSearchParams(String(init.body ?? '')));
    calls.push({ path: new URL(String(url)).pathname, body });
    if (String(url).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 't' }));
    return new Response(JSON.stringify(respond(new URL(String(url)).pathname, body)));
  };
  const client = loader({ 'server-only': {} })('lib/ttlock/client.ts');
  return { client, calls, restore() { global.fetch = originalFetch; process.env = previous; } };
}

test('meter client calls controlOnOff, detail, listRecords and listOperationRecords with documented params', async () => {
  const t = loadClient((path) => {
    if (path === '/v3/electricMeter/detail') return { electricMeterId: 296, remainderKwh: '10.00', totalKwh: '9.89', onOff: 1, online: 1, mac: 'secret-ish', payMode: 1 };
    if (path === '/v3/electricMeter/listRecords') return { list: [{ dateType: 1, usedKwh: '3.2kWh', createDate: '2026-11' }] };
    if (path === '/v3/electricMeter/listOperationRecords') return { list: [{ id: 1, recordType: 7, content: 'recharge 10', headUrl: 'http://x' }] };
    return { errcode: 0 };
  });
  try {
    await t.client.controlTTLockElectricMeterPower({ electricMeterId: 296, on: false });
    await t.client.controlTTLockElectricMeterPower({ electricMeterId: 296, on: true });
    const detail = await t.client.getTTLockElectricMeterDetail(296);
    assert.equal(detail.remainderKwh, '10.00');
    assert.equal('mac' in detail, false);
    const usage = await t.client.listTTLockElectricMeterUsage({ electricMeterId: 296, dateType: 1, dateStr: '2026' });
    assert.equal(usage[0].usedKwh, '3.2kWh');
    const ops = await t.client.listTTLockElectricMeterOperationRecords({ electricMeterId: 296 });
    assert.equal('headUrl' in ops[0], false);
    const api = t.calls.filter((c) => c.path !== '/oauth2/token');
    assert.deepEqual(api.slice(0, 2).map((c) => [c.path, c.body.electricMeterId, c.body.onOff]), [
      ['/v3/electricMeter/controlOnOff', '296', '0'],
      ['/v3/electricMeter/controlOnOff', '296', '1'],
    ]);
    const records = api.find((c) => c.path === '/v3/electricMeter/listRecords');
    assert.deepEqual([records.body.dateType, records.body.dateStr], ['1', '2026']);
  } finally { t.restore(); }
});

function loadControl({ tables, client }) {
  const admin = fakeAdmin(tables);
  const module = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => admin.client },
    '@/lib/ttlock/client': client,
  })('lib/ttlock/meter-control.ts');
  return { module, writes: admin.writes };
}

const meterRow = {
  id: 'm1', provider: 'ttlock', provider_meter_id: '296', property_id: 'p', room_id: 'r',
  tenancy_id: 'old-tenancy', tenant_id: 'old-tenant', rate: 0.57, status: 'active',
  power_state: 'on', power_control_reason: null, provider_metadata: { payMode: 1 },
};

test('checkout switches the room meter off, detaches the old tenancy and never throws', async () => {
  const commands = [];
  const ok = loadControl({
    tables: { smart_meters: [meterRow] },
    client: { controlTTLockElectricMeterPower: async (input) => { commands.push(input); } },
  });
  const result = await ok.module.cutRoomMeterPowerAfterCheckout({ roomId: 'r', tenancyId: 'old-tenancy', performedBy: 'staff' });
  assert.deepEqual(result, { switchedOff: 1, errors: [] });
  assert.deepEqual(commands, [{ electricMeterId: '296', on: false }]);
  const power = ok.writes.find((w) => w.value.power_state === 'off');
  assert.equal(power.value.power_control_reason, 'checkout');
  assert.ok(ok.writes.some((w) => w.value.tenancy_id === null && w.value.tenant_id === null));

  const offline = loadControl({
    tables: { smart_meters: [meterRow] },
    client: { controlTTLockElectricMeterPower: async () => { throw new Error('meter offline'); } },
  });
  const failed = await offline.module.cutRoomMeterPowerAfterCheckout({ roomId: 'r', tenancyId: 'old-tenancy' });
  assert.equal(failed.switchedOff, 0);
  assert.match(failed.errors[0], /meter offline/);
  assert.ok(offline.writes.some((w) => /Power off failed: meter offline/.test(w.value.last_sync_error ?? '')));
});

test('move-in links the meter to the new tenancy and restores power cut at checkout', async () => {
  const commands = [];
  const { module, writes } = loadControl({
    tables: {
      tenancies: [{ id: 'new-tenancy', room_id: 'r', tenant_id: 'new-tenant', status: 'active', checkout_date: null }],
      smart_meters: [{ ...meterRow, power_state: 'off', power_control_reason: 'checkout' }],
    },
    client: { controlTTLockElectricMeterPower: async (input) => { commands.push(input); } },
  });
  const result = await module.prepareRoomMeterForTenancy('new-tenancy');
  assert.deepEqual(result, { linked: 1, restored: 1, errors: [] });
  assert.deepEqual(commands, [{ electricMeterId: '296', on: true }]);
  assert.ok(writes.some((w) => w.value.tenancy_id === 'new-tenancy' && w.value.tenant_id === 'new-tenant'));
  assert.ok(writes.some((w) => w.value.power_state === 'on' && w.value.power_control_reason === null));
});

test('refresh stores live balance, usage and power, and records the monthly reading', async () => {
  const { module, writes } = loadControl({
    tables: { smart_meters: [meterRow], smart_meter_readings: [] },
    client: {
      syncTTLockElectricMeterState: async () => {},
      getTTLockElectricMeterDetail: async () => ({ electricMeterId: 296, remainderKwh: '12.50', totalKwh: '340.25', online: 1, onOff: 1, payMode: 1, syncKwhDate: Date.now() }),
    },
  });
  const reading = await module.refreshTTLockMeter('m1');
  assert.deepEqual(reading, { remainingKwh: 12.5, totalKwh: 340.25, online: true, powerOn: true });
  const meterUpdate = writes.find((w) => w.table === 'smart_meters');
  assert.equal(meterUpdate.value.remaining_units, 12.5);
  assert.equal(meterUpdate.value.total_units, 340.25);
  assert.equal(meterUpdate.value.connection_status, 'online');
  const insert = writes.find((w) => w.table === 'smart_meter_readings' && w.kind === 'insert');
  assert.equal(insert.value.current_reading, 340.25);
  assert.equal(insert.value.charge_amount, 0);
});

test('meter wiring: checkout cuts power after access is revoked, top-up recharge is unchanged', () => {
  const checkout = read('lib/tenancy/checkout.ts');
  assert.ok(checkout.indexOf('await cutRoomMeterPowerAfterCheckout(') > checkout.indexOf('return { ok: false, reason: "lock" }'));
  assert.match(read('lib/ttlock/tenancy-extras.ts'), /prepareRoomMeterForTenancy\(tenancyId\)/);
  assert.match(read('lib/ttlock/meter-recharge.ts'), /rechargeTTLockElectricMeter/);
  assert.match(read('app/smart-devices/ekey-meter-actions.ts'), /setTTLockMeterPower\(\{ meterId, on, reason: "staff"/);
});
