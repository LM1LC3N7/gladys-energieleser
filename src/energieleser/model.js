// -----------------------------------------------------------------------------
// The answer of GET /v1/data -> values. Pure. Ported from the energieleser
// library (nineti GmbH, MIT, see THIRD_PARTY_NOTICES.md), models.py:
// - the reader type comes from the prefix of `device_id`, longest first
//   (`GAS_PULSE` before `GAS`): STROM, GAS, GAS_PULSE, WASSER, HEAT;
// - a stromleser sends a dynamic subset of OBIS codes, each a string
//   "value unit" ("12345.000 Wh", "8.160 W"): every code is optional;
// - a cumulative register (1.8.x, 2.8.x) at 0 is absent, never a value;
// - "16.7" is a firmware alias of "16.7.0", used only when 16.7.0 is absent;
// - without the active power (16.7.0) the meter is PIN-locked: it gives its
//   indexes only;
// - `rssi` is a number or a string in dBm.
// Changed here: an energy is converted to kWh from the unit the reader gives
// (Wh, kWh, MWh) and is absent without a known unit (never guessed: it is
// billed); a power without unit is read in W (OBIS powers are W); values are
// read against strict patterns, bounded, nothing read as 0 by default.
//
// Only the stromleser (electricity) is read for now: the other readers are
// recognized and refused with their name (src/energieleser/client.js).
// -----------------------------------------------------------------------------

import { INDEX_MAX, MAX_FIELDS, POWER_MAX, RSSI_MIN } from '../constants.js';

/** The reader types, by `device_id` prefix, longest first (models.py `_PREFIXES_LONGEST_FIRST`). */
const PREFIXES = [
  ['GAS_PULSE', 'gasleser.pulse'],
  ['WASSER', 'wasserleser'],
  ['STROM', 'stromleser'],
  ['HEAT', 'waermeleser'],
  ['GAS', 'gasleser'],
];

/** A device id we accept: it becomes an external id, forever. */
export const DEVICE_ID = /^[A-Z][A-Z0-9_]{2,63}$/;

/** The reader type of a device id (upper case), undefined when unknown. */
export function readerType(deviceId) {
  return PREFIXES.find(([prefix]) => deviceId.startsWith(prefix))?.[1];
}

const MEASUREMENT = /^\s*(-?\d{1,15}(?:\.\d{1,9})?)(?:\s+([A-Za-z]{1,4}))?\s*$/;

/** "8.160 W" -> { value: 8.16, unit: 'W' }; "-51" -> { value: -51, unit: '' }; else undefined. */
export function measurement(raw) {
  if (typeof raw !== 'string' || raw.length > 64) {
    return undefined;
  }
  const match = MEASUREMENT.exec(raw);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, unit: match[2] ?? '' } : undefined;
}

const ENERGY_TO_KWH = { Wh: 0.001, kWh: 1, MWh: 1000 };
const POWER_TO_W = { '': 1, W: 1, kW: 1000 };

const own = (payload, key) => (Object.hasOwn(payload, key) ? payload[key] : undefined);

/** A cumulative register in kWh: absent at 0, without a known unit, below 0 or too large. */
function energyOf(payload, code) {
  const m = measurement(own(payload, code));
  const factor = m && ENERGY_TO_KWH[m.unit];
  if (!factor) {
    return undefined;
  }
  // Wh are counted in whole units by the meter: rounded to the Wh, no float residue.
  const kwh = Math.round(m.value * factor * 1e6) / 1e6;
  return kwh > 0 && kwh <= INDEX_MAX ? kwh : undefined;
}

/** A power in W, signed, within ±POWER_MAX. */
function powerOf(payload, code) {
  const m = measurement(own(payload, code));
  const factor = m && POWER_TO_W[m.unit];
  if (!factor) {
    return undefined;
  }
  const w = m.value * factor;
  return Math.abs(w) <= POWER_MAX ? w : undefined;
}

function rssiOf(raw) {
  const value = typeof raw === 'number' ? raw : measurement(raw)?.value;
  return Number.isFinite(value) && value >= RSSI_MIN && value <= 0 ? value : undefined;
}

function timestampOf(raw) {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
    return raw;
  }
  return typeof raw === 'string' && /^\d{1,12}$/.test(raw) ? Number(raw) : undefined;
}

const tariffs = (payload, base) => ({
  total: energyOf(payload, `${base}.0`),
  t1: energyOf(payload, `${base}.1`),
  t2: energyOf(payload, `${base}.2`),
  t3: energyOf(payload, `${base}.3`),
  t4: energyOf(payload, `${base}.4`),
});

/**
 * The answer, parsed:
 * - undefined: not an energieleser answer (not an object, too many fields, no
 *   readable `device_id`);
 * - `{ deviceId, type }` without values: a reader other than the stromleser;
 * - `{ deviceId, type: 'stromleser', timestamp, imports, exports, power,
 *   powerAbsolute, powerImport, powerExport, phases, rssi, pinLocked }`.
 */
export function parseData(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  if (Object.keys(payload).length > MAX_FIELDS) {
    return undefined;
  }
  const rawId = own(payload, 'device_id');
  if (typeof rawId !== 'string' || rawId.length > 64) {
    return undefined;
  }
  const deviceId = rawId.trim().toUpperCase();
  const type = DEVICE_ID.test(deviceId) ? readerType(deviceId) : undefined;
  if (!type) {
    return undefined;
  }
  if (type !== 'stromleser') {
    return { deviceId, type };
  }
  const active = powerOf(payload, '16.7.0') ?? powerOf(payload, '16.7');
  const imports = tariffs(payload, '1.8');
  const rawIndex = own(payload, '1.8.0');
  return {
    deviceId,
    type,
    timestamp: timestampOf(own(payload, 'timestamp')),
    imports,
    // 1.8.0 sent but not usable (no known unit, not a number, out of
    // bounds): the status says so. A register at 0 is absent (models.py).
    indexRefused:
      rawIndex !== undefined && imports.total === undefined && measurement(rawIndex)?.value !== 0,
    exports: tariffs(payload, '2.8'),
    power: active,
    powerAbsolute: powerOf(payload, '15.7.0'),
    powerImport: powerOf(payload, '1.7.0'),
    powerExport: powerOf(payload, '2.7.0'),
    phases: [powerOf(payload, '36.7.0'), powerOf(payload, '56.7.0'), powerOf(payload, '76.7.0')],
    rssi: rssiOf(own(payload, 'rssi')),
    // models.py: no active power, the meter is PIN-locked (its indexes only).
    pinLocked: active === undefined,
  };
}
