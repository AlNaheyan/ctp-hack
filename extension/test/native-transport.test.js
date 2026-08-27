import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_NATIVE_MESSAGE_BYTES,
  NATIVE_HOST_NAME,
  createNativeTransport
} from '../src/transport/native-transport.js';

function eventHook() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    emit(value) { for (const listener of [...listeners]) listener(value); }
  };
}

function fakeRuntime() {
  const ports = [];
  return {
    ports,
    lastError: undefined,
    connectNative(name) {
      const port = {
        name,
        sent: [],
        onMessage: eventHook(),
        onDisconnect: eventHook(),
        postMessage(message) { this.sent.push(message); },
        disconnect() { this.onDisconnect.emit(); }
      };
      ports.push(port);
      return port;
    }
  };
}

test('connects to the exact host and forwards a message', async () => {
  const runtime = fakeRuntime();
  const transport = createNativeTransport({ runtime, logger: {} });
  const seen = [];
  transport.onStatusChange((status) => seen.push(status));

  await transport.send({ schemaVersion: 1, type: 'PLAYBACK_STATE', payload: {} });
  assert.equal(runtime.ports[0].name, NATIVE_HOST_NAME);
  assert.equal(runtime.ports[0].sent.length, 1);
  assert.deepEqual(seen, ['disconnected', 'connecting', 'connected']);
});

test('ACK resets the error and records visible liveness', async () => {
  const runtime = fakeRuntime();
  const transport = createNativeTransport({ runtime, logger: {} });
  await transport.connect();
  runtime.ports[0].onMessage.emit({ type: 'ACK' });
  assert.equal(transport.status, 'connected');
  assert.match(transport.lastAcknowledgedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('NACK exposes a host validation error until a later ACK', async () => {
  const runtime = fakeRuntime();
  const transport = createNativeTransport({ runtime, logger: {} });
  await transport.connect();
  runtime.ports[0].onMessage.emit({ type: 'NACK', code: 'INVALID_PLAYBACK_MESSAGE' });
  assert.equal(transport.status, 'error');
  assert.equal(transport.lastError, 'INVALID_PLAYBACK_MESSAGE');
  runtime.ports[0].onMessage.emit({ type: 'ACK' });
  assert.equal(transport.status, 'connected');
  assert.equal(transport.lastError, undefined);
});

test('disconnect schedules bounded exponential reconnect', async () => {
  const runtime = fakeRuntime();
  const scheduled = [];
  const transport = createNativeTransport({
    runtime,
    logger: {},
    baseDelayMs: 250,
    maxDelayMs: 1000,
    schedule(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    cancel() {}
  });
  await transport.connect();

  runtime.lastError = { message: 'host exited' };
  runtime.ports[0].onDisconnect.emit();
  assert.equal(transport.status, 'error');
  assert.equal(transport.lastError, 'host exited');
  assert.equal(scheduled[0].delay, 250);

  scheduled.shift().callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.ports.length, 2);
  runtime.ports[1].onDisconnect.emit();
  assert.equal(scheduled.at(-1).delay, 500);
});

test('manual disconnect cancels reconnect and reports disconnected', async () => {
  const runtime = fakeRuntime();
  let scheduled = 0;
  const transport = createNativeTransport({
    runtime,
    logger: {},
    schedule() { scheduled += 1; return scheduled; },
    cancel() {}
  });
  await transport.connect();
  await transport.disconnect();
  assert.equal(transport.status, 'disconnected');
  assert.equal(scheduled, 0);
});

test('rejects oversized UTF-8 before opening a native port', async () => {
  const runtime = fakeRuntime();
  const transport = createNativeTransport({ runtime, logger: {} });
  const message = { padding: 'x'.repeat(MAX_NATIVE_MESSAGE_BYTES) };
  await assert.rejects(transport.send(message), /limit is 8192/);
  assert.equal(runtime.ports.length, 0);
});
