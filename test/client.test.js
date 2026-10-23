// -----------------------------------------------------------------------------
// The only network access: one GET of /v1/data, bounded, our error codes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReaderClient } from '../src/energieleser/client.js';
import { GAS, STROM, json } from './fixtures/energieleser.js';
import { createFetch, refusedError, streamOf, timeoutError } from './helpers/fakeNet.js';

const client = (handler) => {
  const net = createFetch(handler);
  return { net, client: new ReaderClient({ address: '192.168.1.70:8080', fetchImpl: net.fetch }) };
};

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected an error');
};

test('one GET of /v1/data at the address, no redirect followed, a timeout', async () => {
  const { net, client: c } = client(() => json(STROM));
  const reading = await c.readData();
  assert.equal(reading.deviceId, 'STROM_ONE_1234567890');
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].host, '192.168.1.70:8080');
  assert.equal(net.calls[0].path, '/v1/data');
  assert.equal(net.calls[0].init.method, 'GET');
  assert.equal(net.calls[0].init.redirect, 'manual');
  assert.ok(net.calls[0].init.signal instanceof AbortSignal);
  assert.equal(net.calls[0].init.headers['User-Agent'], undefined);
});

test('our error codes, never a text of the reader', async () => {
  const cases = [
    [() => json('nope', { status: 404 }), 'not_found'],
    [() => json('secret text', { status: 403 }), 'http'],
    [() => json('', { status: 302, headers: { location: 'http://elsewhere/' } }), 'http'],
    [() => json('', { status: 500 }), 'server'],
    [() => json('', { status: 429, headers: { 'retry-after': '120' } }), 'rate_limited'],
    [() => json('<html>'), 'not_data'],
    [() => json({ hello: 'world' }), 'unknown_answer'],
    [() => json(GAS), 'unsupported'],
    [
      () => {
        throw timeoutError();
      },
      'timeout',
    ],
    [
      () => {
        throw refusedError();
      },
      'unreachable',
    ],
  ];
  for (const [handler, code] of cases) {
    const err = await codeOf(client(handler).client.readData());
    assert.equal(err.code, code);
    assert.ok(!/secret|html|elsewhere/.test(err.message), err.message);
  }
  const limited = await codeOf(
    client(() => json('', { status: 429, headers: { 'retry-after': '120' } })).client.readData(),
  );
  assert.equal(limited.retryAfter, 120_000);
  const gas = await codeOf(client(() => json(GAS)).client.readData());
  assert.equal(gas.readerType, 'gasleser');
});

test('a hostile answer is cut at 16 KiB', async () => {
  const err = await codeOf(
    client(() => new Response(streamOf(10_000, 1024), { status: 200 })).client.readData(),
  );
  assert.equal(err.code, 'too_large');
});

test('one request at a time', async () => {
  const { net, client: c } = client(() => json(STROM));
  net.hold = true;
  const a = c.readData();
  const b = c.readData();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.calls.length, 1);
  net.hold = false;
  net.release();
  await a;
  await b;
  assert.equal(net.calls.length, 2);
});
