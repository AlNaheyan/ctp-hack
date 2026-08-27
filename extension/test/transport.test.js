import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlaybackMessage } from '../src/shared/messages.js';
import { TRANSPORT_STATUS, createMockTransport } from '../src/transport/mock-transport.js';

const silentLogger = { debug() {} };

const message = () =>
  createPlaybackMessage({
    videoId: 'dQw4w9WgXcQ',
    currentTime: 1,
    duration: 100,
    paused: false,
    playbackRate: 1
  });

test('records messages once connected', async () => {
  const transport = createMockTransport({ logger: silentLogger });
  assert.equal(transport.status, TRANSPORT_STATUS.disconnected);

  await transport.connect();
  assert.equal(transport.status, TRANSPORT_STATUS.connected);

  await transport.send(message());
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].type, 'PLAYBACK_STATE');
});

test('refuses to send while disconnected', async () => {
  const transport = createMockTransport({ logger: silentLogger });
  await assert.rejects(() => transport.send(message()), /not connected/);
});

test('status listeners see the current state and every transition', async () => {
  const transport = createMockTransport({ logger: silentLogger });
  const seen = [];
  const unsubscribe = transport.onStatusChange((status) => seen.push(status));

  await transport.connect();
  await transport.disconnect();
  unsubscribe();
  await transport.connect();

  assert.deepEqual(seen, ['disconnected', 'connecting', 'connected', 'disconnected']);
});

test('history is bounded so a long session cannot grow without limit', async () => {
  const transport = createMockTransport({ logger: silentLogger, historyLimit: 3 });
  await transport.connect();

  for (let index = 0; index < 5; index += 1) {
    await transport.send({ ...message(), index });
  }

  assert.equal(transport.sent.length, 3);
  assert.equal(transport.sent.at(-1).index, 4);
});
