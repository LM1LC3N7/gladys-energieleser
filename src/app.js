// -----------------------------------------------------------------------------
// The integration itself: the data page of the energieleser reader read every
// 10 s, its device, the consumption index checked by its guard and published
// once a minute, the pauses kept in /data, the test and accept buttons.
// index.js only wires the SDK handlers to it. Read-only: nothing is ever sent
// to the reader but one GET of its data page.
//
// The pace is global and kept across restarts: never two reads less than an
// interval apart, whatever asks (a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container: the
// time of the last read is kept in /data). Structure taken from
// gladys-zeversolar (approved).
//
// A read belongs to its session (the client of one address): when the
// address changes, a late answer of the old one publishes nothing and sets no
// status (checked after every await).
//
// Every answer carries the id of the reader: its values go to the device of
// THAT id, never to another one (a DHCP swap); an answer without a readable
// id is a wrong answer, never "another reader".
//
// Two clocks: `now` (wall clock) dates the index and what /data keeps;
// `monotonic` paces the reads, so that a wall clock set back never stops them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig } from './config.js';
import {
  ATTEMPT_SAVE_EVERY,
  INDEX_INTERVAL,
  INDEX_MAX_KW,
  INDEX_SLACK_KWH,
  PAUSE_MAX,
  PAUSE_MIN,
  POLL_INTERVAL,
  READING_STALE_AFTER,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  TEST_ANSWER_WITHIN,
} from './constants.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOf,
  capabilitiesOfDevice,
  ids,
  indexStates,
  liveStates,
  round,
  union,
  validKeys,
} from './devices.js';
import { ReaderClient } from './energieleser/client.js';
import { DEVICE_ID } from './energieleser/model.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };

const GUARD_LIMITS = { maxKw: INDEX_MAX_KW, slackKwh: INDEX_SLACK_KWH };
/** At most this many index states kept in /data (one per reader seen). */
const MAX_KEPT_INDEXES = 8;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/** A pause read back from /data: `{ until, count, code, status }`, its end capped from now. */
function validPause(pause, now) {
  if (
    !pause ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  return {
    until: Math.min(pause.until, now + PAUSE_MAX),
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** The freshness read back from /data: `{ deviceId, timestamp, at }`, `at` never in the future. */
function validFresh(fresh, now) {
  return fresh &&
    typeof fresh.deviceId === 'string' &&
    DEVICE_ID.test(fresh.deviceId) &&
    Number.isSafeInteger(fresh.timestamp) &&
    finite(fresh.at)
    ? { deviceId: fresh.deviceId, timestamp: fresh.timestamp, at: Math.min(fresh.at, now) }
    : undefined;
}

/** The index states kept in /data: plain objects under string keys only. */
function keptIndexes(indexes) {
  if (!indexes || typeof indexes !== 'object' || Array.isArray(indexes)) {
    return {};
  }
  const kept = {};
  for (const [key, value] of Object.entries(indexes)) {
    if (key !== '__proto__' && value && typeof value === 'object' && !Array.isArray(value)) {
      kept[key] = value;
    }
  }
  return kept;
}

export class EnergieleserApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'energieleser' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new ReaderClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    /** /data: the guard of the index, the reader id and features, the pause, the last read. */
    this.store = store;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** `{ client, discovered }` of the current address; replaced (never reused) when it changes. */
    this.session = undefined;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;

    const kept = store.load();
    const at = now();
    this.pause = validPause(kept.pause, at);
    /** The id of the reader last read, kept so that its device is offered at a restart. */
    this.deviceId =
      typeof kept.deviceId === 'string' && DEVICE_ID.test(kept.deviceId)
        ? kept.deviceId
        : undefined;
    /** The feature keys of that reader (src/devices.js): only grow. */
    this.keys = this.deviceId ? validKeys(kept.keys) : new Set();
    // The last read before a restart: the next one never comes sooner than
    // the interval (a date in the future, a clock set back, is brought to now).
    this.lastAttemptAt = finite(kept.lastAttemptAt) ? Math.min(kept.lastAttemptAt, at) : undefined;
    this.savedAttemptAt = this.lastAttemptAt;
    /** Monotonic time of the last read started. */
    this.lastReadAt =
      this.lastAttemptAt === undefined ? undefined : monotonic() - (at - this.lastAttemptAt);
    /**
     * The freshness kept in /data (review 1, I1): `{ deviceId, timestamp, at }`,
     * the last `timestamp` of the reader and the wall time it changed, saved
     * with the state of each read. After a restart, a reading with this same
     * timestamp keeps its age: a frozen power is never published as new.
     */
    this.fresh = validFresh(kept.fresh, at);
    this.keptFresh = this.fresh;
    /** By index feature external id. */
    this.guards = new Map();
    this.resetReads();
  }

  /** What belongs to one address: forgotten when it changes. */
  resetReads() {
    /** The last read: `{ at (monotonic), kind: 'reading' | 'error', reading?, err? }`. */
    this.outcome = undefined;
    /** Wrong answers and unreachable reader: retries doubled, in memory. */
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    /** Freshness of the reading: its `timestamp`, and when (monotonic) it last changed. */
    this.readingStamp = undefined;
    this.freshAt = 0;
    /**
     * The timestamp was seen changing in this session, or matches the one
     * kept in /data: until then the live values are not published (a reading
     * frozen before a restart is never sent as new).
     */
    this.freshKnown = false;
    this.otherReader = undefined;
    /** Monotonic time the indexes were last published. */
    this.lastIndexAt = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the read running are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    this.doStop();
    const config = normalizeConfig(raw);
    const first = this.session === undefined;
    const changed =
      first ||
      config.address !== this.config.address ||
      config.invalidAddress !== this.config.invalidAddress;
    this.config = config;
    if (changed) {
      this.session = {
        client: isComplete(config) ? this.clientFactory({ address: config.address }) : undefined,
        discovered: false,
      };
      if (!first) {
        // Another address: its own story. A pause asked by the old one ends;
        // the pace does not (never two reads less than an interval apart).
        this.resetReads();
        if (this.pause) {
          this.pause = undefined;
          await this.saveState();
        }
      }
    }
    this.running = true;
    // The core keeps the connection status, the Discovery list and the last
    // values in memory: a restarted Gladys has lost them, so they are always
    // sent again (the values at the next read).
    this.lastStatus = undefined;
    this.lastIndexAt = undefined;
    this.gladys.forgetPublishedStates?.();
    if (!this.session.client) {
      await this.setStatus(false, config.invalidAddress ? T.badAddress : T.incomplete);
      return;
    }
    if (!changed || first) {
      // Another address may be another reader: its device is published once
      // its id is read, never the old one with the new address.
      await this.discover();
    }
    await this.updateStatus();
    this.schedule();
  }

  doStop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // --- Pace ------------------------------------------------------------------

  /** The monotonic time from which the next read may start, from the caller's instant `mono` (the clock is read once per decision). */
  dueAt(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + POLL_INTERVAL;
    if (this.nextTryAt !== undefined) {
      due = Math.max(due, this.nextTryAt);
    }
    const now = this.now();
    if (this.pause && now < this.pause.until) {
      due = Math.max(due, mono + (this.pause.until - now));
    }
    return due;
  }

  /** One timer: the next read when it is due. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.session?.client) {
      return;
    }
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop();
      return this.loopRun;
    }, wait);
  }

  async loop() {
    const session = this.session;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`energieleser: unexpected error (${err?.name ?? 'Error'})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick() {
    if (this.busy) {
      return this.busy;
    }
    this.busy = this.read().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read() {
    const session = this.session;
    const client = session?.client;
    if (!client || !this.running) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) {
      return;
    }
    /** Another address (or a stop) during an await: this read gives up, silently. */
    const gone = () => session !== this.session || !this.running;
    this.lastReadAt = mono;
    // Kept BEFORE the request: a restart during it never reads again sooner.
    await this.saveAttempt(this.now());
    if (gone()) return;
    let reading;
    try {
      reading = await client.readData();
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono, gone);
      return;
    }
    if (gone()) return;
    await this.succeeded(reading, mono, gone);
  }

  async saveAttempt(now) {
    this.lastAttemptAt = now;
    if (
      this.savedAttemptAt === undefined ||
      now < this.savedAttemptAt ||
      now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY
    ) {
      this.savedAttemptAt = now;
      await this.saveState();
    }
  }

  // --- Outcomes ----------------------------------------------------------------

  async succeeded(reading, mono, gone) {
    // An answer: a pause asked before and the retries are over.
    this.pause = undefined;
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    // The identity of this read: the id in the same answer as its values.
    const previous = this.deviceId;
    const otherId = previous !== undefined && previous !== reading.deviceId;
    if (otherId) {
      this.otherReader = reading.deviceId;
      this.logger.warn('energieleser: another reader answers at this address');
      this.keys = new Set();
      this.readingStamp = undefined;
      this.lastIndexAt = undefined;
    }
    this.deviceId = reading.deviceId;
    if (this.createdDevice()) {
      // The reader answering has its device (the first one back after a
      // swap, or a device created since): the note about it ends (review 1).
      this.otherReader = undefined;
    }
    this.followFreshness(reading, mono);
    this.outcome = { at: mono, kind: 'reading', reading };
    const keys = union(
      this.keys,
      capabilitiesOfDevice(this.createdDevice()),
      capabilitiesOf(reading),
    );
    const grew = keys.size !== this.keys.size;
    this.keys = keys;
    const session = this.session;
    if (grew || otherId || !session.discovered) {
      // Also the first reading of a session: a new address of the same
      // reader reaches the Discovery list at once.
      session.discovered = true;
      await this.discover();
      if (gone()) return;
    }
    await this.publish(reading, mono, gone);
    if (gone()) return;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  async failed(err, mono, gone) {
    const code = err?.code ?? 'error';
    const now = this.now();
    // Our own words only (ReaderError codes): never a text of the reader.
    this.logger.warn(
      `energieleser read failed: ${code}${Number.isInteger(err?.status) ? ` ${err.status}` : ''}`,
    );
    this.outcome = { at: mono, kind: 'error', err };
    if (code === 'rate_limited' || code === 'server') {
      const count = (this.pause?.count ?? 0) + 1;
      const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX);
      this.pause = {
        until: now + wait,
        count: Math.min(count, 32),
        code,
        status: Number.isInteger(err.status) ? err.status : null,
      };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    // Retries doubled (never faster than a poll).
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures += 1;
    this.lastError = err;
    this.nextTryAt = mono + wait;
    await this.updateStatus();
  }

  /**
   * The reading is stale when its `timestamp` has not changed for a while
   * (monotonic). The first timestamp of a session is fresh only when it
   * matches the one kept in /data (its age then goes on from there) or once
   * it changes: a reading frozen before a restart is never sent as new
   * (review 1, I1).
   */
  followFreshness(reading, mono) {
    const ts = reading.timestamp;
    if (ts === undefined) {
      // Without timestamp, a frozen reading cannot be told (the status says so).
      this.readingStamp = undefined;
      this.freshKnown = true;
      this.freshAt = mono;
      return;
    }
    const now = this.now();
    if (this.readingStamp === undefined) {
      this.readingStamp = ts;
      const kept = this.keptFresh;
      if (kept && kept.deviceId === reading.deviceId && kept.timestamp === ts) {
        this.freshKnown = true;
        this.freshAt = mono - Math.max(0, now - kept.at);
        this.fresh = kept;
      } else {
        this.freshKnown = false;
        this.freshAt = mono;
      }
      return;
    }
    if (ts !== this.readingStamp) {
      this.readingStamp = ts;
      this.freshAt = mono;
      this.freshKnown = true;
      this.fresh = { deviceId: reading.deviceId, timestamp: ts, at: now };
    }
  }

  isStale(mono) {
    return this.readingStamp !== undefined && mono - this.freshAt >= READING_STALE_AFTER;
  }

  /** Whether the live values (powers, signal) of the last reading may be published. */
  isLive(mono) {
    return this.freshKnown && !this.isStale(mono);
  }

  // --- Status ------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /** The status from what is known now: never a read. */
  currentStatus() {
    const address = this.config.address;
    if (!this.session?.client) {
      return [false, this.config.invalidAddress ? T.badAddress : T.incomplete];
    }
    const notes = this.heldNotes();
    const now = this.now();
    if (this.pause && now < this.pause.until) {
      return [false, T.paused(address, this.pause, this.pause.until - now, notes)];
    }
    if (this.lastError && this.failures > 0) {
      const wait = Math.max(0, (this.nextTryAt ?? 0) - this.monotonic());
      return [false, T.unreachable(address, this.lastError, wait, notes)];
    }
    if (this.outcome?.kind === 'reading' && this.deviceId) {
      const reading = this.outcome.reading;
      const extra = [];
      if (this.otherReader) extra.push(T.notes.otherReader(this.otherReader));
      if (reading.pinLocked) extra.push(T.notes.pinLocked);
      if (reading.timestamp === undefined) extra.push(T.notes.noTimestamp);
      else if (this.isStale(this.monotonic())) extra.push(T.notes.stale);
      // 1.8.0 sent but unusable, or gone after it was seen (review 1).
      if (
        reading.indexRefused ||
        (reading.imports.total === undefined && this.keys.has(FEATURE.CONSUMPTION_INDEX))
      ) {
        extra.push(T.notes.noIndex);
      }
      if (!this.createdDevice()) {
        return [true, T.noDevice(this.deviceId, extra)];
      }
      return [true, T.ok(address, [...extra, ...notes])];
    }
    return [false, T.waiting(address)];
  }

  /** The index held back, for every status (the user must see it while waiting). */
  heldNotes() {
    const held = this.currentGuard()?.held;
    return held ? [T.notes.held(held)] : [];
  }

  // --- /data -------------------------------------------------------------------------

  /** Keeps the reader, the pause, the time of the last read and the guards when they changed. */
  async saveState() {
    const indexes = {};
    for (const [id, guard] of this.guards) {
      indexes[id] = guard.state();
    }
    const kept = keptIndexes(this.store.load().indexes);
    for (const id of Object.keys(indexes)) delete kept[id];
    const merged = Object.entries({ ...kept, ...indexes }).slice(-MAX_KEPT_INDEXES);
    const state = {
      deviceId: this.deviceId ?? null,
      keys: [...this.keys],
      pause: this.pause ?? null,
      lastAttemptAt: this.lastAttemptAt ?? null,
      fresh: this.fresh ?? null,
      indexes: Object.fromEntries(merged),
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
    } catch (err) {
      this.logger.warn(`Saving the energieleser state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Devices -----------------------------------------------------------------------

  external() {
    return this.deviceId ? ids(this.gladys, this.deviceId) : undefined;
  }

  /** The created Gladys device of the reader, undefined until the user creates it. */
  createdDevice() {
    const id = this.external()?.device;
    return id ? (this.gladys.devices ?? []).find((d) => d.external_id === id) : undefined;
  }

  async discover() {
    if (!this.deviceId || !this.session?.client) {
      return;
    }
    const keys = union(this.keys, capabilitiesOfDevice(this.createdDevice()));
    if (keys.size === 0) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([
        buildDevice(this.gladys, this.deviceId, keys, this.config.address),
      ])
      .catch((err) =>
        this.logger.warn(`Publishing the energieleser device failed: ${err.message}`),
      );
  }

  /** The Discover tab asks: the known device, never a read (the next one comes at its time). */
  async scan() {
    await this.discover();
  }

  async onDeviceCreated(device) {
    const external = this.external();
    if (!external || device?.external_id !== external.device) {
      return;
    }
    // A new device: no reference of its index yet (nor a state kept in /data
    // for a deleted device of the same id). Its values come at the next read.
    const id = external.feature(FEATURE.CONSUMPTION_INDEX);
    this.guards.delete(id);
    const kept = this.store.load();
    const indexes = keptIndexes(kept.indexes);
    delete indexes[id];
    await this.store
      .save({ ...kept, indexes })
      .catch((err) =>
        this.logger.warn(`Clearing the energieleser index state failed (${err?.code ?? 'error'})`),
      );
    this.savedKey = undefined;
    this.lastIndexAt = undefined;
    // The reader now answering has its device: the note about it ends.
    this.otherReader = undefined;
    await this.updateStatus();
  }

  async onDeviceUpdated(device) {
    if (device?.external_id === this.external()?.device) {
      // New features (Update in Discovery): their indexes at the next read.
      this.lastIndexAt = undefined;
      await this.updateStatus();
    }
  }

  // --- Values ------------------------------------------------------------------------

  /** The guard of the index of the created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = keptIndexes(this.store.load().indexes)[id];
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), saved, this.now(), GUARD_LIMITS),
      );
    }
    return this.guards.get(id);
  }

  /** The guard of the created device, when there is one. */
  currentGuard() {
    const created = this.createdDevice();
    return created
      ? this.guardOf(created, this.external().feature(FEATURE.CONSUMPTION_INDEX))
      : undefined;
  }

  /** The states of a reading: the live values every time, the indexes once a minute. */
  async publish(reading, mono, gone) {
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    const external = this.external();
    // A frozen reading (the head fell off), or one not yet seen moving since a
    // restart: its power would look live, it is not sent.
    const states = this.isLive(mono) ? liveStates(external, reading) : [];
    if (this.lastIndexAt !== undefined && mono < this.lastIndexAt) {
      this.lastIndexAt = undefined;
    }
    if (this.lastIndexAt === undefined || mono - this.lastIndexAt >= INDEX_INTERVAL) {
      this.lastIndexAt = mono;
      const id = external.feature(FEATURE.CONSUMPTION_INDEX);
      const guard = this.guardOf(created, id);
      const raw = reading.imports.total;
      const total = finite(raw) ? round(raw, 3) : undefined;
      const plausible = total !== undefined && guard.accept(total, this.now());
      if (total !== undefined && !plausible && guard.held) {
        this.logger.warn(
          `energieleser consumption index ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
        );
      }
      // While a value is held, the last accepted one is sent again (no delta for the core).
      const index = plausible ? total : guard.held ? guard.last?.value : undefined;
      // The guard is in /data BEFORE Gladys gets the value: a crash in
      // between never sends an index /data does not know.
      await this.saveState();
      if (gone()) return;
      states.push(...indexStates(external, reading, index));
    }
    // Only the features the created device has (they are fixed at its creation).
    const features = created.features ? new Set(created.features.map((f) => f.external_id)) : null;
    const allowed = features
      ? states.filter((s) => features.has(s.device_feature_external_id))
      : states;
    if (allowed.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(allowed, { heartbeat: STATE_HEARTBEAT })
      .catch((err) =>
        this.logger.warn(`Publishing the energieleser values failed: ${err.message}`),
      );
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * The "Accept the held index" button: takes the value held as shown now
   * (plus what the home may draw until the next read, src/guard.js), never
   * anything else. Published at the next read (never a read sooner).
   */
  async acceptHeldIndex() {
    const accepted = this.currentGuard()?.acceptHeld();
    if (!accepted) {
      return T.accept.nothing;
    }
    this.logger.info(
      `energieleser consumption index ${accepted.direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
    );
    this.lastIndexAt = undefined;
    return accepted.direction === 'down' ? T.accept.down(accepted) : T.accept.up(accepted);
  }

  /**
   * The test button: never a read sooner than the pace allows. When a read
   * is due, this click makes it; otherwise it tells the last one.
   */
  async testConnection() {
    if (!this.session?.client) {
      return this.config.invalidAddress ? T.badAddress : T.incomplete;
    }
    if (this.pause && this.now() < this.pause.until) {
      return this.currentStatus()[1];
    }
    const mono = this.monotonic();
    if (this.busy || this.dueAt(mono) > mono) {
      return this.describeOutcome();
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.tick().then(() => this.describeOutcome(mono)), late]);
    } finally {
      this.timers.clearTimeout(timer);
      if (this.running) this.schedule();
    }
  }

  /**
   * The last read in words, and the time to the next one. `since`: when this
   * click started a read; a read from then on is told as "read now".
   */
  describeOutcome(since) {
    const mono = this.monotonic();
    const next = Math.max(0, this.dueAt(mono) - mono);
    const outcome = this.outcome;
    if (!outcome) {
      return T.test.notYet(next);
    }
    const ago =
      since !== undefined && outcome.at >= since ? undefined : Math.max(0, mono - outcome.at);
    if (outcome.kind === 'reading') {
      const { deviceId, power, imports } = outcome.reading;
      return T.test.reading({ deviceId, power, index: imports.total }, ago, next);
    }
    return T.test.failed(this.config.address, outcome.err, ago, next);
  }
}
