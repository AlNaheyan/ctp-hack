import { createPlaybackMessage, validatePlaybackMessage } from '../shared/messages.js';

/**
 * Ordered, transport-neutral playback forwarding. A newly started MV3 service
 * worker creates a new forwarder and reconnects before its first send.
 *
 * @param {{ transport: {
 *   status: string,
 *   connect(): Promise<void>,
 *   send(message: object): Promise<void>
 * } }} options
 */
export function createPlaybackForwarder({ transport }) {
  let tail = Promise.resolve();

  async function send(observation) {
    const message = createPlaybackMessage(observation);
    const validation = validatePlaybackMessage(message);
    if (!validation.valid) return { ok: false, errors: validation.errors };

    if (transport.status !== 'connected') await transport.connect();
    await transport.send(message);
    return { ok: true };
  }

  return {
    forward(observation) {
      // Keep observations ordered even when connect/send are asynchronous. A
      // prior failure is isolated so it cannot poison all later messages.
      const result = tail.catch(() => undefined).then(() => send(observation));
      tail = result;
      return result;
    }
  };
}
