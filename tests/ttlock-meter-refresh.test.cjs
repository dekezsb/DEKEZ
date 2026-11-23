const test = require('node:test');
const assert = require('node:assert/strict');
const { read, fakeAdmin, loader } = require('./ttlock-test-helpers.cjs');

function loadRefresh({ meters, refresh }) {
  const admin = fakeAdmin({ smart_meters: (ops) => { loadRefresh.lastQuery = ops; return { data: meters, error: null }; } });
  const mod = loader({
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => admin.client },
    '@/lib/ttlock/meter-control': { refreshTTLockMeter: refresh },
  })('lib/ttlock/meter-refresh-all.ts');
  return mod;
}

test('hourly refresh covers every active room-linked TTLock meter and keeps going after a failure', async () => {
  const seen = [];
  const mod = loadRefresh({
    meters: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }],
    refresh: async (id) => {
      seen.push(id);
      if (id === 'm2') throw new Error('Meter is offline');
      return {};
    },
  });
  const sleeps = [];
  const result = await mod.refreshAllTTLockMeters({ concurrency: 2, delayMs: 400, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual([...seen].sort(), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(result.total, 4);
  assert.equal(result.refreshed, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.deferred, 0);
  assert.deepEqual(result.errors, [{ meterId: 'm2', error: 'Meter is offline' }]);
  assert.ok(sleeps.length >= 2 && sleeps.every((ms) => ms === 400));
  assert.deepEqual(loadRefresh.lastQuery.filters, [
    ['eq', 'provider', 'ttlock'],
    ['eq', 'meter_type', 'electricity'],
    ['eq', 'status', 'active'],
    ['not', 'provider_meter_id', null],
    ['not', 'room_id', null],
  ]);
});

test('never runs more than the allowed number of meters at once', async () => {
  let running = 0;
  let peak = 0;
  const mod = loadRefresh({
    meters: Array.from({ length: 7 }, (_, i) => ({ id: `m${i}` })),
    refresh: async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    },
  });
  const result = await mod.refreshAllTTLockMeters({ concurrency: 2, delayMs: 0 });
  assert.equal(result.refreshed, 7);
  assert.equal(peak, 2);
});

test('stops starting new meters when the time budget is used, leaving them for the next hour', async () => {
  let clock = 0;
  const mod = loadRefresh({
    meters: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    refresh: async () => { clock += 100; },
  });
  const result = await mod.refreshAllTTLockMeters({ concurrency: 1, delayMs: 0, budgetMs: 150, now: () => clock });
  assert.equal(result.refreshed, 2);
  assert.equal(result.deferred, 1);
});

test('no meters means no TTLock calls', async () => {
  let calls = 0;
  const mod = loadRefresh({ meters: [], refresh: async () => { calls += 1; } });
  const result = await mod.refreshAllTTLockMeters({ sleep: async () => {} });
  assert.equal(calls, 0);
  assert.equal(result.total, 0);
});

test('cron route requires CRON_SECRET and is scheduled hourly', async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const called = [];
  const api = loader({
    '@/lib/ttlock/meter-refresh-all': {
      refreshAllTTLockMeters: async () => {
        called.push('ran');
        return { total: 2, refreshed: 1, failed: 1, deferred: 0, errors: [{ meterId: 'm', error: 'offline' }] };
      },
    },
  })('app/api/ttlock-meter-refresh/route.ts');
  const request = (authorization) => new Request('https://example.invalid/api/ttlock-meter-refresh', {
    headers: authorization ? { authorization } : {},
  });
  try {
    assert.equal((await api.GET(request())).status, 401);
    process.env.CRON_SECRET = 'fixture-meter-cron';
    assert.equal((await api.GET(request('Bearer wrong'))).status, 401);
    assert.equal(called.length, 0);
    const ok = await api.GET(request('Bearer fixture-meter-cron'));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.failed, 1);
    assert.deepEqual(called, ['ran']);
  } finally {
    if (previous == null) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
  const crons = JSON.parse(read('vercel.json')).crons;
  assert.deepEqual(
    crons.filter((row) => row.path === '/api/ttlock-meter-refresh'),
    [{ path: '/api/ttlock-meter-refresh', schedule: '25 * * * *' }],
  );
});
