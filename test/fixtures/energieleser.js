// -----------------------------------------------------------------------------
// Answers of the data page, shaped after the test fixtures of the energieleser
// library (tests/fixtures/*.json, nineti GmbH, MIT), ids changed.
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.70';
export const DEVICE_ID = 'STROM_ONE_1234567890';
export const NOW = Date.parse('2026-10-23T10:00:00Z');

/** A three-phase stromleser (fixture stromleser.json: Wh and W). */
export const STROM = {
  device_id: DEVICE_ID,
  timestamp: '1776178480',
  '1.8.0': '12345.000 Wh',
  '2.8.0': '26561.000 Wh',
  '16.7.0': '8.160 W',
  '36.7.0': '0.000 W',
  '56.7.0': '0.000 W',
  '76.7.0': '8.160 W',
  rssi_Percentage: '98 %',
  rssi: '-51',
};

/** A single-phase one with tariff registers (fixture stromleser_single_phase.json: kWh). */
export const STROM_SINGLE = {
  device_id: 'STROM_ONE_2429489063',
  timestamp: '1779205315',
  '1.8.0': '45.167 kWh',
  '1.8.1': '45.167 kWh',
  '2.8.0': '19929.796 kWh',
  '2.8.1': '19929.796 kWh',
  '16.7.0': '5 W',
  rssi_Percentage: '100 %',
  rssi: '-42',
};

/** A gasleser (fixture gasleser.json): recognized, not read. */
export const GAS = {
  device_id: 'GAS_8530321017',
  timestamp: '1776179005',
  count: 603,
  total_consumption: 37030.67,
  current_flow_rate: 0.01,
  signal_strength: '84 %',
  rssi: '-51',
};

/**
 * A stromleser answer: `kwh` the 1.8.0 index (kWh), `w` the net power,
 * `ts` the timestamp (left out: the fake reader of test/helpers/app.js gives
 * the time of its clock, a reading that moves); `extra` merged in.
 */
export function strom({ kwh = 9000, w = 350, ts, id = DEVICE_ID, extra = {} } = {}) {
  return {
    device_id: id,
    ...(ts === undefined ? {} : { timestamp: String(ts) }),
    '1.8.0': `${(kwh * 1000).toFixed(3)} Wh`,
    '1.8.1': `${(kwh * 600).toFixed(3)} Wh`,
    '1.8.2': `${(kwh * 400).toFixed(3)} Wh`,
    '2.8.0': '1500.000 kWh',
    '16.7.0': `${w} W`,
    '36.7.0': `${w / 2} W`,
    '56.7.0': `${w / 4} W`,
    '76.7.0': `${w / 4} W`,
    rssi: '-60',
    ...extra,
  };
}

/** A fetch Response with a JSON body. */
export const json = (body, init = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
