// -----------------------------------------------------------------------------
// The app end to end against the SDK's fake Gladys, a scripted reader and a
// virtual clock: discovery, states, the guarded index, the pace, late
// answers, identity, pauses, buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.js';
import { ADDRESS, DEVICE_ID, NOW, json, strom } from './fixtures/energieleser.js';
import { CONFIG, F, MINUTE, SECOND, created, createReader, setup } from './helpers/app.js';

const statesOf = (gladys, key, id) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === F(key, id)).map((s) => s.state);

test('without a device: the reader is offered in Discovery, the status says so', async () => {
  const s = await setup();
  await s.start();
  const [device] = s.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, `ext:energieleser:energieleser:${DEVICE_ID}`);
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys, [
    'power',
    'consumption_index',
    'consumption_t1',
    'consumption_t2',
    'injection_index',
    'power_l1',
    'power_l2',
    'power_l3',
    'signal',
  ]);
  const index = device.features.find((f) => f.external_id === F('consumption_index'));
  assert.equal(index.category, 'energy-sensor');
  assert.equal(index.type, 'index');
  const injection = device.features.find((f) => f.external_id === F('injection_index'));
  assert.equal(injection.category, 'unknown', 'the injection is never an energy index');
  assert.equal(s.gladys.fake.connectionStatus.connected, true);
  assert.match(s.gladys.fake.connectionStatus.message.en, /create its device/);
  assert.equal(s.gladys.fake.states.length, 0);
});

test('a created device: live values every 10 s, the indexes once a minute', async () => {
  let kwh = 9000;
  const reader = createReader(() => strom({ kwh, w: 400 }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  assert.deepEqual(statesOf(s.gladys, 'power'), [400]);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000]);
  assert.deepEqual(statesOf(s.gladys, 'consumption_t1'), [5400]);
  assert.deepEqual(statesOf(s.gladys, 'injection_index'), [1500]);
  assert.deepEqual(statesOf(s.gladys, 'power_l1'), [200]);
  assert.deepEqual(statesOf(s.gladys, 'signal'), [-60]);
  kwh = 9000.01;
  await s.wait(50 * SECOND);
  assert.equal(reader.net.calls.length, 6, 'one read every 10 s');
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000], 'not before a minute');
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000, 9000.01]);
  assert.match(s.gladys.fake.connectionStatus.message.en, /Connected/);
  assert.equal(s.gladys.fake.sceneEvents.length, 0);
});

test('the index: never 0, a jump held until the user accepts it', async () => {
  let answer = strom({ kwh: 9000 });
  const reader = createReader(() => answer);
  const s = await setup({
    devices: [created({ index: { value: 9000, at: NOW - MINUTE } })],
    reader,
  });
  await s.start();
  answer = strom({ kwh: 0 });
  await s.wait(MINUTE);
  answer = strom({ kwh: 19_000 });
  await s.wait(MINUTE);
  await s.wait(MINUTE);
  const published = statesOf(s.gladys, 'consumption_index');
  assert.ok(!published.includes(0));
  assert.ok(!published.includes(19_000));
  assert.match(s.gladys.fake.connectionStatus.message.en, /jumped from 9000 to 19000 kWh/);
  assert.equal(s.store.data.indexes[F('consumption_index')].held.to, 19_000);
  const ack = await s.app.acceptHeldIndex();
  assert.match(ack.en, /10000 kWh/);
  await s.wait(10 * SECOND);
  assert.equal(statesOf(s.gladys, 'consumption_index').at(-1), 19_000);
  assert.doesNotMatch(s.gladys.fake.connectionStatus.message.en, /jumped/);
  assert.equal(
    (await s.app.acceptHeldIndex()).en,
    'No consumption index is held back: nothing to accept.',
  );
});

test('a held index survives a restart; saving the configuration accepts nothing', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => strom({ kwh: 500 }));
  const device = created({ index: { value: 9000, at: NOW - MINUTE } });
  let s = await setup({ devices: [device], reader, store });
  await s.start();
  await s.app.start(CONFIG);
  await s.wait(MINUTE);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(500));
  await s.app.stop();
  s = await setup({ devices: [device], reader, store, now: s.clock.now + MINUTE });
  await s.start();
  assert.match(s.gladys.fake.connectionStatus.message.en, /dropped from 9000 to 500 kWh/);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(500));
});

test('the pace: never two reads less than 10 s apart, whatever asks', async () => {
  const store = createMemoryStore();
  const reader = createReader();
  const s = await setup({ reader, store });
  await s.start();
  assert.equal(reader.net.calls.length, 1);
  await s.app.start(CONFIG);
  await s.app.scan();
  await s.app.start(await s.gladys.getConfig());
  await s.app.onDeviceCreated(created());
  const test1 = await s.app.testConnection();
  assert.match(test1.en, /Last read .* ago.*Next read in 10 s/);
  await s.wait(5 * SECOND);
  assert.equal(reader.net.calls.length, 1, 'a reconnection, a save, a scan, the test: no read');
  await s.wait(5 * SECOND);
  assert.equal(reader.net.calls.length, 2);
  // A restart of the container 2 s after a read: the time is in /data.
  await s.app.stop();
  const again = await setup({ reader, store, now: s.clock.now + 2 * SECOND });
  await again.start();
  assert.equal(reader.net.calls.length, 2);
  assert.ok(store.data.lastAttemptAt <= s.clock.now);
});

test('every connection publishes the status and the Discovery list again', async () => {
  const s = await setup();
  await s.start();
  const statuses = s.gladys.fake.connectionStatuses.length;
  const discoveries = s.gladys.fake.bodies('POST', '/discovered_device').length;
  // What index.js does on every `connected`.
  await s.app.start(await s.gladys.getConfig());
  await s.app.idle();
  assert.equal(s.gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(s.gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
});

test('a late answer of an old address publishes nothing and sets no status', async () => {
  const reader = createReader(() => strom({ kwh: 9000, w: 999 }));
  const s = await setup({ devices: [created()], reader });
  reader.net.hold = true;
  await s.app.start(CONFIG);
  // Not awaited: the timer runs the read, which waits for the held answer.
  const running = s.advance(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.net.calls.length, 1);
  await s.app.start({ address: '192.168.1.71' });
  const statuses = s.gladys.fake.connectionStatuses.length;
  reader.net.hold = false;
  reader.net.release();
  await running;
  await s.app.idle();
  assert.deepEqual(statesOf(s.gladys, 'power'), []);
  assert.equal(s.gladys.fake.connectionStatuses.length, statuses);
});

test('another reader at the address: its values go to its own device', async () => {
  let id = DEVICE_ID;
  const reader = createReader(() => strom({ id, w: 100 }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  id = 'STROM_ONE_5555555555';
  reader.world = () => strom({ id, w: 777 });
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [100], 'never into the old device');
  assert.equal(
    s.gladys.fake.discoveredDevices[0].external_id,
    'ext:energieleser:energieleser:STROM_ONE_5555555555',
  );
  assert.match(s.gladys.fake.connectionStatus.message.en, /STROM_ONE_5555555555/);
});

test('an unreadable answer is never another reader; retries are doubled', async () => {
  const reader = createReader(() => json({ device_id: '??' }));
  const s = await setup({
    devices: [created()],
    reader,
    store: createMemoryStore({ deviceId: DEVICE_ID }),
  });
  await s.start();
  assert.equal(s.gladys.fake.connectionStatus.connected, false);
  assert.match(s.gladys.fake.connectionStatus.message.en, /not an energieleser answer/);
  assert.equal(s.gladys.fake.discoveredDevices[0].external_id.endsWith(DEVICE_ID), true);
  await s.wait(10 * SECOND);
  assert.equal(reader.net.calls.length, 2);
  await s.wait(10 * SECOND);
  assert.equal(reader.net.calls.length, 2, 'the second retry waits 20 s');
  await s.wait(10 * SECOND);
  assert.equal(reader.net.calls.length, 3);
});

test('429: a pause kept in /data, never a read during it, even after a restart', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => json('', { status: 429, headers: { 'retry-after': '600' } }));
  const s = await setup({ reader, store });
  await s.start();
  assert.equal(store.data.pause.code, 'rate_limited');
  assert.match(s.gladys.fake.connectionStatus.message.en, /asks to wait/);
  await s.wait(5 * MINUTE);
  assert.equal(reader.net.calls.length, 1);
  await s.app.stop();
  const again = await setup({ reader, store, now: s.clock.now });
  await again.start();
  await again.wait(4 * MINUTE);
  assert.equal(reader.net.calls.length, 1);
  await again.wait(2 * MINUTE);
  assert.equal(reader.net.calls.length, 2);
});

test('a frozen reading: the power is no longer sent, the status says so', async () => {
  const reader = createReader(() => strom({ ts: 42, w: 300 }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  await s.wait(6 * MINUTE);
  reader.world = () => strom({ ts: 42, w: 700 });
  await s.wait(MINUTE);
  assert.deepEqual(statesOf(s.gladys, 'power'), [300]);
  assert.match(s.gladys.fake.connectionStatus.message.en, /no new reading/);
});

test('a PIN-locked meter: the indexes go on, the status says so', async () => {
  const answer = { device_id: DEVICE_ID, timestamp: '1', '1.8.0': '9000 kWh' };
  const reader = createReader(() => answer);
  const s = await setup({ devices: [created()], reader });
  await s.start();
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000]);
  assert.match(s.gladys.fake.connectionStatus.message.en, /PIN-locked/);
  // The device published again keeps every feature it was created with.
  const keys = s.gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  assert.ok(keys.includes(F('power')) && keys.includes(F('power_l3')));
});

test('another reader type is refused with its name; a bad address is told', async () => {
  const reader = createReader(() => ({ device_id: 'WASSER_1', timestamp: '1' }));
  const s = await setup({ reader });
  await s.start();
  assert.match(s.gladys.fake.connectionStatus.message.en, /wasserleser: only the stromleser/);
  await s.app.start({ address: 'http://user:pw@host/' });
  assert.match(s.gladys.fake.connectionStatus.message.en, /not valid/);
  await s.app.start({});
  assert.match(s.gladys.fake.connectionStatus.message.en, /Enter the address/);
  assert.match((await s.app.testConnection()).en, /Enter the address/);
});

test('the test button reads when a read is due, and tells it', async () => {
  const s = await setup({ config: { address: ADDRESS } });
  const reader = s.reader;
  await s.start();
  assert.match((await s.app.testConnection()).en, /^Last read .*Next read in 10 s/);
  // The clock moves without the timer firing: the click finds a read due.
  s.clock.now += 10 * SECOND;
  const answer = await s.app.testConnection();
  assert.match(answer.en, /^Read now: stromleser STROM_ONE_1234567890, net power 350 W/);
  assert.equal(reader.net.calls.length, 2);
});
