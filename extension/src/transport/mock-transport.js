// Replaceable transport boundary.
//
// The service worker only ever talks to this interface:
//
//   {
//     name: string
//     connect(): Promise<void>
//     send(message: object): Promise<void>
//     disconnect(): Promise<void>
//     onStatusChange(listener: (status) => void): () => void
//     status: 'disconnected' | 'connecting' | 'connected' | 'error'
//   }
//
// W2-T3 keeps this mock as the component-test transport. W3-T2 implements the
// same interface over Chrome native messaging, so nothing else has to change.

export const TRANSPORT_STATUS = Object.freeze({
  disconnected: 'disconnected',
  connecting: 'connecting',
  connected: 'connected',
  error: 'error'
});

/**
 * In-memory transport: records messages and logs them to the service worker
 * console. No native host, no network, no permissions.
 * @param {{ logger?: Pick<Console, 'debug'>, historyLimit?: number }} [options]
 */
export function createMockTransport({ logger = console, historyLimit = 200 } = {}) {
  /** @type {object[]} */
  const sent = [];
  /** @type {Set<(status: string) => void>} */
  const listeners = new Set();
  let status = TRANSPORT_STATUS.disconnected;

  const setStatus = (next) => {
    status = next;
    for (const listener of listeners) listener(status);
  };

  return {
    name: 'mock',

    get status() {
      return status;
    },

    /** Messages observed so far, newest last. Test-only accessor. */
    get sent() {
      return [...sent];
    },

    async connect() {
      setStatus(TRANSPORT_STATUS.connecting);
      setStatus(TRANSPORT_STATUS.connected);
    },

    async send(message) {
      if (status !== TRANSPORT_STATUS.connected) {
        throw new Error('mock transport is not connected; call connect() first');
      }
      sent.push(message);
      if (sent.length > historyLimit) sent.shift();
      logger.debug?.('[boring-notch] playback', message);
    },

    async disconnect() {
      setStatus(TRANSPORT_STATUS.disconnected);
    },

    onStatusChange(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    }
  };
}
