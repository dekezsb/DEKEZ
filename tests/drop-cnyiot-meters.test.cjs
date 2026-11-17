const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const devices = fs.readFileSync(path.join(root, 'app/smart-devices/page.tsx'), 'utf8');
const roomCard = fs.readFileSync(path.join(root, 'app/properties/[id]/rooms/[roomId]/room-smart-devices.tsx'), 'utf8');
const discovery = fs.readFileSync(path.join(root, 'app/smart-devices/actions.ts'), 'utf8');

test('Smart Devices no longer advertises CNYIOT inventory or waits for a CNYIOT API', () => {
  assert.doesNotMatch(devices, /getCnyiotConfigStatus/);
  assert.doesNotMatch(devices, /waiting for the CNYIOT server API/);
  assert.doesNotMatch(devices, /CNYIOT and TTLock prepaid meters/);
  assert.match(devices, /TTLock prepaid meters/);
});

test('room pages do not tell staff to look for CNYIOT meters', () => {
  assert.doesNotMatch(roomCard, /CNYIOT/);
  assert.match(roomCard, /TTLock meters/);
});

test('device sync does not insert or rediscover CNYIOT meters', () => {
  assert.doesNotMatch(discovery, /cnyiot/i);
});
