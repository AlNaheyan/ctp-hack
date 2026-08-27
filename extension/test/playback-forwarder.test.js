import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlaybackForwarder } from '../src/background/playback-forwarder.js';
import { createMockTransport } from '../src/transport/mock-transport.js';

const observation = (currentTime) => ({
  videoId: 'dQw4w9WgXcQ',
  currentTime,
  duration: 600,
  paused: false,
  playbackRate: 1,
  observedAt: '2026-08-27T12:00:00.000Z'
});

test('connects a fresh worker transport before its first send', async () => {
  const transport = createMockTransport({ logger: {} });
  const forwarder = createPlaybackForwarder({ transport });

  assert.equal(transport.status, 'disconnected');
  assert.deepEqual(await forwarder.forward(observation(1)), { ok: true });
  assert.equal(transport.status, 'connected');
  assert.equal(transport.sent.length, 1);
});

test('preserves observation order across asynchronous transport sends', async () => {
  const sent = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const transport = {
    status: 'connected',
    async connect() {},
    async send(message) {
      if (message.payload.currentTime === 1) await firstBlocked;
      sent.push(message.payload.currentTime);
    }
  };
  const forwarder = createPlaybackForwarder({ transport });
  const first = forwarder.forward(observation(1));
  const second = forwarder.forward(observation(2));

  await Promise.resolve();
  assert.deepEqual(sent, []);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [1, 2]);
});

test('drops an invalid observation before touching the transport', async () => {
  const transport = createMockTransport({ logger: {} });
  const forwarder = createPlaybackForwarder({ transport });
  const result = await forwarder.forward({ ...observation(1), videoId: 'bad' });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /videoId/);
  assert.equal(transport.status, 'disconnected');
  assert.deepEqual(transport.sent, []);
});

test('a failed send does not poison later observations', async () => {
  const sent = [];
  let attempts = 0;
  const transport = {
    status: 'connected',
    async connect() {},
    async send(message) {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary failure');
      sent.push(message.payload.currentTime);
    }
  };
  const forwarder = createPlaybackForwarder({ transport });

  await assert.rejects(forwarder.forward(observation(1)), /temporary failure/);
  await assert.doesNotReject(forwarder.forward(observation(2)));
  assert.deepEqual(sent, [2]);
});
