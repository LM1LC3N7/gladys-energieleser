// -----------------------------------------------------------------------------
// The Gladys device of an energieleser stromleser and its states. Pure.
//
// External id (forever): energieleser:<device_id>, the id the reader gives in
// every answer. Feature keys (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service), as in gladys-p1-monitor:
// - `consumption_index` (OBIS 1.8.0, the electricity taken from the grid) is
//   the ONLY energy-sensor / index feature: the core derives the consumption
//   and its cost from its deltas, by itself. It passes the guard of
//   src/guard.js: never 0, a drop or a jump held until the user accepts it;
// - the tariff registers (1.8.1 to 1.8.4) are plain sensors: as indexes they
//   would be counted a second time;
// - the injection (2.8.x) is NEVER in an energy-sensor index nor `energy`
//   (it would be billed as consumption): plain sensors, kWh in the name;
// - `power` (16.7.0, the net active power, negative when injecting) is the
//   only energy-sensor / power feature. The other powers (import, export,
//   absolute, each phase) are plain sensors, so they are never taken for it;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W and kWh for energy-sensor, none for
//   unknown (the unit is then in the name).
//
// The features follow what the reader showed (a meter sends a subset of the
// codes): the set only grows, and always holds the features of the created
// device, so a device published again never loses one (an "Update" in
// Discovery would drop its history).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { EXTERNAL_ID_TYPE, INDEX_MAX, POWER_MAX, RSSI_MIN } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  POWER_IMPORT: 'power_import',
  POWER_EXPORT: 'power_export',
  POWER_ABSOLUTE: 'power_absolute',
  phase: (n) => `power_l${n}`,
  CONSUMPTION_INDEX: 'consumption_index',
  consumptionTariff: (n) => `consumption_t${n}`,
  INJECTION_INDEX: 'injection_index',
  injectionTariff: (n) => `injection_t${n}`,
  SIGNAL: 'signal',
};

const N = [1, 2, 3, 4];

/** Every feature key, in the order of the device. */
export const ORDER = [
  FEATURE.POWER,
  FEATURE.CONSUMPTION_INDEX,
  ...N.map(FEATURE.consumptionTariff),
  FEATURE.INJECTION_INDEX,
  ...N.map(FEATURE.injectionTariff),
  FEATURE.POWER_IMPORT,
  FEATURE.POWER_EXPORT,
  FEATURE.POWER_ABSOLUTE,
  ...[1, 2, 3].map(FEATURE.phase),
  FEATURE.SIGNAL,
];
const KNOWN = new Set(ORDER);

/** The external ids of the reader with this device id. */
export const ids = (gladys, deviceId) => gladys.externalIds(EXTERNAL_ID_TYPE, deviceId);

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: INDEX_MAX,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (external, key, name, extra = {}) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);

const signedPower = { min: -POWER_MAX, max: POWER_MAX };

/** The definition of each feature key. */
const DEFINITIONS = {
  [FEATURE.POWER]: (e) =>
    feature(
      e,
      FEATURE.POWER,
      'Net power (negative when injecting)',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.POWER,
      { unit: U.WATT, ...signedPower },
    ),
  [FEATURE.CONSUMPTION_INDEX]: (e) =>
    feature(
      e,
      FEATURE.CONSUMPTION_INDEX,
      'Consumption index',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      { unit: U.KILOWATT_HOUR },
    ),
  ...Object.fromEntries(
    N.map((n) => [
      FEATURE.consumptionTariff(n),
      (e) => plain(e, FEATURE.consumptionTariff(n), `Consumption index, tariff ${n} (kWh)`),
    ]),
  ),
  [FEATURE.INJECTION_INDEX]: (e) => plain(e, FEATURE.INJECTION_INDEX, 'Injection index (kWh)'),
  ...Object.fromEntries(
    N.map((n) => [
      FEATURE.injectionTariff(n),
      (e) => plain(e, FEATURE.injectionTariff(n), `Injection index, tariff ${n} (kWh)`),
    ]),
  ),
  [FEATURE.POWER_IMPORT]: (e) =>
    plain(e, FEATURE.POWER_IMPORT, 'Power taken from the grid (W)', { max: POWER_MAX }),
  [FEATURE.POWER_EXPORT]: (e) =>
    plain(e, FEATURE.POWER_EXPORT, 'Power injected into the grid (W)', { max: POWER_MAX }),
  [FEATURE.POWER_ABSOLUTE]: (e) =>
    plain(e, FEATURE.POWER_ABSOLUTE, 'Absolute power (W)', { max: POWER_MAX }),
  ...Object.fromEntries(
    [1, 2, 3].map((n) => [
      FEATURE.phase(n),
      // A value every 10 s: no history unless the user turns it on.
      (e) => plain(e, FEATURE.phase(n), `Power L${n} (W)`, { ...signedPower, keep_history: false }),
    ]),
  ),
  [FEATURE.SIGNAL]: (e) =>
    plain(e, FEATURE.SIGNAL, 'Wi-Fi signal (dBm)', {
      min: RSSI_MIN,
      max: 0,
      keep_history: false,
    }),
};

/**
 * The device. `keys`: the feature keys to give it (a Set, see
 * capabilitiesOf). The features are fixed when the user creates it.
 */
export function buildDevice(gladys, deviceId, keys, address) {
  const external = ids(gladys, deviceId);
  return {
    name: `stromleser ${deviceId}`,
    external_id: external.device,
    features: ORDER.filter((key) => keys.has(key)).map((key) => DEFINITIONS[key](external)),
    params: [
      { name: 'address', value: address },
      { name: 'device_id', value: deviceId },
    ],
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** The feature keys a reading shows (a value present). */
export function capabilitiesOf(reading) {
  const keys = new Set();
  const add = (key, value) => isNumber(value) && keys.add(key);
  add(FEATURE.POWER, reading.power);
  add(FEATURE.CONSUMPTION_INDEX, reading.imports.total);
  add(FEATURE.INJECTION_INDEX, reading.exports.total);
  for (const n of N) {
    add(FEATURE.consumptionTariff(n), reading.imports[`t${n}`]);
    add(FEATURE.injectionTariff(n), reading.exports[`t${n}`]);
  }
  add(FEATURE.POWER_IMPORT, reading.powerImport);
  add(FEATURE.POWER_EXPORT, reading.powerExport);
  add(FEATURE.POWER_ABSOLUTE, reading.powerAbsolute);
  reading.phases.forEach((value, i) => add(FEATURE.phase(i + 1), value));
  add(FEATURE.SIGNAL, reading.rssi);
  return keys;
}

/** The feature keys a CREATED device carries: never fewer when it is published again. */
export function capabilitiesOfDevice(device) {
  return new Set(
    (device?.features ?? [])
      .map((f) => String(f.external_id).split(':').at(-1))
      .filter((key) => KNOWN.has(key)),
  );
}

/** Keys read back from /data: known keys only. */
export const validKeys = (keys) =>
  new Set(Array.isArray(keys) ? keys.filter((key) => KNOWN.has(key)) : []);

export const union = (...sets) => new Set(sets.flatMap((s) => [...(s ?? [])]));

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** A counter: never 0 (nor below), whatever the reader said. */
const counterState = (external, key, value) =>
  isNumber(value) && value > 0 ? state(external, key, value, 3) : [];

/** The live values, read every 10 s: the powers and the signal. */
export function liveStates(external, reading) {
  return [
    ...state(external, FEATURE.POWER, reading.power, 0),
    ...state(external, FEATURE.POWER_IMPORT, reading.powerImport, 0),
    ...state(external, FEATURE.POWER_EXPORT, reading.powerExport, 0),
    ...state(external, FEATURE.POWER_ABSOLUTE, reading.powerAbsolute, 0),
    ...reading.phases.flatMap((value, i) => state(external, FEATURE.phase(i + 1), value, 0)),
    ...state(external, FEATURE.SIGNAL, reading.rssi, 0),
  ];
}

/**
 * The indexes, published once a minute. `consumptionIndex` is the value the
 * IndexGuard let through (undefined: not published this time). Every other
 * index is a plain sensor, never published at 0.
 */
export function indexStates(external, reading, consumptionIndex) {
  return [
    ...counterState(external, FEATURE.CONSUMPTION_INDEX, consumptionIndex),
    ...N.flatMap((n) =>
      counterState(external, FEATURE.consumptionTariff(n), reading.imports[`t${n}`]),
    ),
    ...counterState(external, FEATURE.INJECTION_INDEX, reading.exports.total),
    ...N.flatMap((n) =>
      counterState(external, FEATURE.injectionTariff(n), reading.exports[`t${n}`]),
    ),
  ];
}
