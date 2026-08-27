// Service worker skeleton.
//
// Scope in Wave 1: prove the extension loads unpacked, receives content-script
// observations, and forwards them through a replaceable transport. W2-T3 owns
// the real observer semantics (250 ms cadence, SPA navigation, suspension
// recovery); W3-T2 swaps the mock transport for native messaging.

import { createPlaybackMessage, validatePlaybackMessage } from '../shared/messages.js';
import { createMockTransport } from '../transport/mock-transport.js';

const transport = createMockTransport();

transport.onStatusChange((status) => {
  console.debug('[boring-notch] transport status', status);
});

async function forward(observation) {
  const message = createPlaybackMessage(observation);
  const { valid, errors } = validatePlaybackMessage(message);

  if (!valid) {
    console.warn('[boring-notch] dropping invalid playback message', errors);
    return { ok: false, errors };
  }

  if (transport.status !== 'connected') await transport.connect();
  await transport.send(message);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PLAYBACK_OBSERVATION') return undefined;

  forward(message.payload)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, errors: [String(error)] }));

  // Keep the message channel open for the async response.
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.info('[boring-notch] discussion observer installed (transport: %s)', transport.name);
});
