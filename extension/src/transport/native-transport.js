import { TRANSPORT_STATUS } from './mock-transport.js';

export const NATIVE_HOST_NAME = 'com.ctphack.discussionnotch.bridge';
export const MAX_NATIVE_MESSAGE_BYTES = 8 * 1024;

/**
 * Chrome native-messaging transport with bounded exponential reconnect.
 * A fresh MV3 worker simply creates a new instance and connects on first send.
 */
export function createNativeTransport({
  runtime = globalThis.chrome?.runtime,
  hostName = NATIVE_HOST_NAME,
  baseDelayMs = 250,
  maxDelayMs = 10_000,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  logger = console
} = {}) {
  if (typeof runtime?.connectNative !== 'function') {
    throw new Error('chrome.runtime.connectNative is unavailable');
  }

  const listeners = new Set();
  let status = TRANSPORT_STATUS.disconnected;
  let port;
  let connectPromise;
  let reconnectTimer;
  let reconnectAttempt = 0;
  let manuallyDisconnected = false;
  let lastError;
  let lastAcknowledgedAt;

  const notify = (next, error) => {
    status = next;
    lastError = error;
    for (const listener of listeners) listener(status);
  };

  const clearReconnect = () => {
    if (reconnectTimer !== undefined) cancel(reconnectTimer);
    reconnectTimer = undefined;
  };

  const scheduleReconnect = () => {
    if (manuallyDisconnected || reconnectTimer !== undefined) return;
    const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** reconnectAttempt));
    reconnectAttempt += 1;
    reconnectTimer = schedule(() => {
      reconnectTimer = undefined;
      connect().catch(() => undefined);
    }, delay);
  };

  const handleMessage = (message) => {
    if (message?.type === 'ACK') {
      reconnectAttempt = 0;
      lastAcknowledgedAt = new Date().toISOString();
      notify(TRANSPORT_STATUS.connected);
    } else if (message?.type === 'NACK') {
      notify(TRANSPORT_STATUS.error, message.code ?? 'Native host rejected the message.');
    }
  };

  const handleDisconnect = () => {
    const disconnectedPort = port;
    port = undefined;
    connectPromise = undefined;
    const message = runtime.lastError?.message ?? 'Native host disconnected.';
    if (!manuallyDisconnected) {
      notify(TRANSPORT_STATUS.error, message);
      logger.warn?.('[boring-notch] native host disconnected', message);
      scheduleReconnect();
    } else {
      notify(TRANSPORT_STATUS.disconnected);
    }
    disconnectedPort?.onMessage.removeListener?.(handleMessage);
    disconnectedPort?.onDisconnect.removeListener?.(handleDisconnect);
  };

  async function connect() {
    if (port && status === TRANSPORT_STATUS.connected) return;
    if (connectPromise) return connectPromise;

    manuallyDisconnected = false;
    clearReconnect();
    notify(TRANSPORT_STATUS.connecting);
    connectPromise = Promise.resolve().then(() => {
      try {
        const connectedPort = runtime.connectNative(hostName);
        if (!connectedPort || typeof connectedPort.postMessage !== 'function') {
          throw new Error('Chrome did not return a native messaging port.');
        }
        port = connectedPort;
        port.onMessage.addListener(handleMessage);
        port.onDisconnect.addListener(handleDisconnect);
        notify(TRANSPORT_STATUS.connected);
      } catch (error) {
        port = undefined;
        connectPromise = undefined;
        notify(TRANSPORT_STATUS.error, String(error));
        scheduleReconnect();
        throw error;
      }
    });

    try {
      await connectPromise;
    } finally {
      connectPromise = undefined;
    }
  }

  return {
    name: 'native',

    get status() { return status; },
    get lastError() { return lastError; },
    get lastAcknowledgedAt() { return lastAcknowledgedAt; },

    async connect() {
      await connect();
    },

    async send(message) {
      const serialized = JSON.stringify(message);
      const size = new TextEncoder().encode(serialized).byteLength;
      if (size > MAX_NATIVE_MESSAGE_BYTES) {
        throw new Error(`native message is ${size} bytes; limit is ${MAX_NATIVE_MESSAGE_BYTES}`);
      }
      if (status !== TRANSPORT_STATUS.connected || !port) await connect();
      try {
        port.postMessage(message);
      } catch (error) {
        notify(TRANSPORT_STATUS.error, String(error));
        port = undefined;
        scheduleReconnect();
        throw error;
      }
    },

    async disconnect() {
      manuallyDisconnected = true;
      clearReconnect();
      const connectedPort = port;
      port = undefined;
      connectPromise = undefined;
      connectedPort?.onMessage.removeListener?.(handleMessage);
      connectedPort?.onDisconnect.removeListener?.(handleDisconnect);
      connectedPort?.disconnect();
      notify(TRANSPORT_STATUS.disconnected);
    },

    onStatusChange(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    }
  };
}
