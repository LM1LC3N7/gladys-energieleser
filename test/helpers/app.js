// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted reader and a virtual clock.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EnergieleserApp } from '../../src/app.js';
import { buildDevice, capabilitiesOf } from '../../src/devices.js';
import { ReaderClient } from '../../src/energieleser/client.js';
import { parseData } from '../../src/energieleser/model.js';
import { createMemoryStore } from '../../src/store.js';
import { ADDRESS, DEVICE_ID, NOW, json, strom } from '../fixtures/energieleser.js';
import { createFetch, timeoutError } from './fakeNet.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'energieleser';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const F = (key, id = DEVICE_ID) => `ext:${SELECTOR}:energieleser:${id}:${key}`;
export const CONFIG = { address: ADDRESS };

/** The device as the user created it from `answer`, the index Gladys holds when given. */
export function created({ index, answer = strom() } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const reading = parseData(answer);
  const device = buildDevice(gladys, reading.deviceId, capabilitiesOf(reading), ADDRESS);
  if (index) {
    const feature = device.features.find(
      (f) => f.external_id === F('consumption_index', reading.deviceId),
    );
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  return device;
}

/** The reader: `world(t)` -> an answer object | 'timeout' | a Response. */
export function createReader(world = () => strom()) {
  const reader = { world, clock: { now: NOW } };
  reader.net = createFetch(() => {
    const answer = reader.world(reader.clock.now);
    if (answer === 'timeout') throw timeoutError();
    return answer instanceof Response ? answer : json(answer);
  });
  return reader;
}

export async function setup({
  devices = [],
  store = createMemoryStore(),
  now = NOW,
  reader = createReader(),
  config = CONFIG,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const { clock, timers, advance } = createFakeClock(now);
  reader.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const app = new EnergieleserApp({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    now: () => clock.now,
    monotonic: () => clock.now,
    timers,
    store,
    clientFactory: (options) => new ReaderClient({ ...options, fetchImpl: reader.net.fetch }),
  });
  const start = async (cfg = config) => {
    await app.start(cfg);
    await advance(0);
    await app.idle();
  };
  const wait = async (ms) => {
    await advance(ms);
    await app.idle();
  };
  return { app, gladys, clock, store, reader, start, wait, advance, lines };
}
