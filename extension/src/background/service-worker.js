// MV3 service worker. Chrome wakes it for each content-script message; a fresh
// worker reconnects the replaceable transport before forwarding its first item.

import { createPlaybackForwarder } from './playback-forwarder.js';
import { createNativeTransport } from '../transport/native-transport.js';

const transport = createNativeTransport();
const forwarder = createPlaybackForwarder({ transport });

transport.onStatusChange((status) => {
  console.debug('[boring-notch] transport status', status);
  void chrome.storage?.session
    ?.set({ nativeConnectionState: status })
    .catch((error) => console.warn('[boring-notch] could not persist transport status', String(error)));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PLAYBACK_OBSERVATION') return undefined;

  forwarder
    .forward(message.payload)
    .then((result) => {
      if (!result.ok) console.warn('[boring-notch] dropping invalid playback message', result.errors);
      sendResponse(result);
    })
    .catch((error) => sendResponse({ ok: false, errors: [String(error)] }));

  // Keep the message channel open for the async response.
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.info('[boring-notch] discussion observer installed (transport: %s)', transport.name);
});
