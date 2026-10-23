// -----------------------------------------------------------------------------
// The data page parsed as the energieleser library reads it (its fixtures),
// with our stricter rules: units, bounds, nothing read as 0 by default.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measurement, parseData, readerType } from '../src/energieleser/model.js';
import { GAS, STROM, STROM_SINGLE } from './fixtures/energieleser.js';

test('a three-phase stromleser: Wh to kWh, powers in W, rssi', () => {
  const r = parseData(STROM);
  assert.equal(r.deviceId, 'STROM_ONE_1234567890');
  assert.equal(r.type, 'stromleser');
  assert.equal(r.timestamp, 1776178480);
  assert.equal(r.imports.total, 12.345);
  assert.equal(r.exports.total, 26.561);
  assert.equal(r.imports.t1, undefined);
  assert.equal(r.power, 8.16);
  assert.deepEqual(r.phases, [0, 0, 8.16]);
  assert.equal(r.rssi, -51);
  assert.equal(r.pinLocked, false);
});

test('a single-phase stromleser: kWh and tariff registers', () => {
  const r = parseData(STROM_SINGLE);
  assert.equal(r.imports.total, 45.167);
  assert.equal(r.imports.t1, 45.167);
  assert.equal(r.exports.t1, 19929.796);
  assert.equal(r.power, 5);
  assert.deepEqual(r.phases, [undefined, undefined, undefined]);
});

test('the reader type comes from the id prefix, longest first', () => {
  assert.equal(readerType('STROM_ONE_1'), 'stromleser');
  assert.equal(readerType('GAS_PULSE_1'), 'gasleser.pulse');
  assert.equal(readerType('GAS_1'), 'gasleser');
  assert.equal(readerType('WASSER_1'), 'wasserleser');
  assert.equal(readerType('HEAT_1'), 'waermeleser');
  assert.equal(readerType('OTHER_1'), undefined);
  assert.deepEqual(parseData(GAS), { deviceId: 'GAS_8530321017', type: 'gasleser' });
  assert.equal(parseData({ ...STROM, device_id: 'strom_one_5' }).deviceId, 'STROM_ONE_5');
});

test('not an energieleser answer: no readable id, not an object, too many fields', () => {
  for (const payload of [
    null,
    [],
    'STROM',
    {},
    { device_id: 42 },
    { device_id: 'STROM one' },
    { device_id: 'X'.repeat(80) },
    { device_id: 'UNKNOWN_1' },
  ]) {
    assert.equal(parseData(payload), undefined, JSON.stringify(payload));
  }
  const many = { ...STROM };
  for (let i = 0; i < 200; i += 1) many[`f${i}`] = '1 W';
  assert.equal(parseData(many), undefined);
});

test('a cumulative register at 0 is absent, never 0; the 16.7 alias; PIN-locked', () => {
  const r = parseData({ ...STROM, '1.8.0': '0.000 Wh', '16.7.0': undefined, 16.7: '12 W' });
  assert.equal(r.imports.total, undefined);
  assert.equal(r.power, 12);
  const locked = parseData({ device_id: 'STROM_ONE_9', timestamp: 5, '1.8.0': '100 kWh' });
  assert.equal(locked.pinLocked, true);
  assert.equal(locked.power, undefined);
  assert.equal(locked.imports.total, 100);
});

test('units: an energy without a known unit is absent; a power without unit is W', () => {
  const r = parseData({
    ...STROM,
    '1.8.0': '12345',
    '2.8.0': '3 GWh',
    '1.8.1': '2 MWh',
    '16.7.0': '-250',
    '36.7.0': '1.5 kW',
    '56.7.0': '3 VA',
  });
  assert.equal(r.imports.total, undefined);
  assert.equal(r.exports.total, undefined);
  assert.equal(r.imports.t1, 2000);
  assert.equal(r.power, -250);
  assert.deepEqual(r.phases, [1500, undefined, 8.16]);
});

test('values: strict patterns and bounds, never a default', () => {
  assert.deepEqual(measurement('8.160 W'), { value: 8.16, unit: 'W' });
  assert.deepEqual(measurement('-51'), { value: -51, unit: '' });
  for (const raw of ['', 'W', 'nan W', '1e9 W', '1,5 W', '12 W extra', 12, null, 'x'.repeat(65)]) {
    assert.equal(measurement(raw), undefined, String(raw));
  }
  const r = parseData({
    ...STROM,
    '16.7.0': '250000 W',
    '1.8.0': '-5 kWh',
    rssi: '-500',
    timestamp: 'soon',
  });
  assert.equal(r.power, undefined);
  assert.equal(r.imports.total, undefined);
  assert.equal(r.rssi, undefined);
  assert.equal(r.timestamp, undefined);
  assert.equal(parseData({ ...STROM, rssi: -70 }).rssi, -70);
  assert.equal(parseData({ ...STROM, timestamp: 1747285200 }).timestamp, 1747285200);
});

test('a __proto__ key in the answer pollutes nothing', () => {
  const payload = JSON.parse(
    '{"device_id":"STROM_ONE_7","__proto__":{"polluted":1},"1.8.0":"1 kWh","16.7.0":"1 W"}',
  );
  const r = parseData(payload);
  assert.equal(r.imports.total, 1);
  assert.equal({}.polluted, undefined);
  assert.equal(r.polluted, undefined);
});
