// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of the device: `energieleser:<device_id>`, the id the
 * reader gives in every answer (`STROM_ONE_8529546829`, upper case): a new IP
 * address of the same reader keeps its device and history, another reader at
 * the address gets its own device.
 */
export const EXTERNAL_ID_TYPE = 'energieleser';

// --- The local API of the reader (as the energieleser library reads it) -------------
/** The only page read: one JSON object of the last reading. */
export const DATA_PATH = '/v1/data';
/** The library waits 10 s for an answer; so do we, the body included. */
export const HTTP_TIMEOUT = 10_000;
/** The answer is a few hundred bytes: more is not an energieleser answer. */
export const MAX_BODY_BYTES = 16 * 1024;
/** At most this many fields in the answer (a stromleser sends about 20). */
export const MAX_FIELDS = 128;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** One read every 10 s (as Home Assistant), never faster, whatever asks for it. */
export const POLL_INTERVAL = 10 * SECOND;
/** The indexes are published (and their guard kept in /data) once a minute. */
export const INDEX_INTERVAL = MINUTE;
/** An unreachable reader or a wrong answer: tries after 10 s, doubled up to 5 minutes. */
export const RETRY_MIN = 10 * SECOND;
export const RETRY_MAX = 5 * MINUTE;
/** HTTP 429 or 5xx: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** The time of the last read is written in /data at most once per this delay. */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay (the manifest gives it 30 s). */
export const TEST_ANSWER_WITHIN = 20 * SECOND;
/**
 * The reading has not changed (same `timestamp`) for this long: the reader no
 * longer reads the meter (the head fell off, the meter is locked): the powers
 * are no longer published. Measured on our clock only.
 */
export const READING_STALE_AFTER = 5 * MINUTE;

// --- Plausibility of the consumption index (the one Gladys bills) -------------------
/**
 * A German home connection never draws more than this on average between two
 * published indexes (63 A x 3 x 230 V is about 43 kW). The guard of
 * src/guard.js takes it as a parameter.
 */
export const INDEX_MAX_KW = 50;
/** kWh always accepted on top of INDEX_MAX_KW x hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/** A power above this (W), either way, is a glitch: not published. */
export const POWER_MAX = 100_000;
/** An index above this (kWh) is a glitch: not published. */
export const INDEX_MAX = 100_000_000;
/** A signal outside [-150, 0] dBm is a glitch. */
export const RSSI_MIN = -150;
