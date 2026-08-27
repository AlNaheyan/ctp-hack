# Chrome Extension

Manifest V3 skeleton that observes YouTube playback and forwards it to the
macOS app. Wave 1 proves it loads unpacked and produces one schema-valid
message; **W2-T3** owns the real observer and **W3-T2** owns native messaging.

Full runbook: [docs/setup/local-stack.md](../docs/setup/local-stack.md).

## Load it

1. `chrome://extensions` -> enable **Developer mode**.
2. **Load unpacked** -> select this `extension/` directory.
3. Open a YouTube watch page, then click **service worker** on the extension
   card to watch `[boring-notch] playback` messages as you play and pause.

No production key, no store listing, and no native host are required. After
editing files press **Reload** on the extension card; content-script changes also
need a page reload.

## Layout

```text
extension/
  manifest.json                   MV3, minimum permissions, no key
  src/
    content/youtube-observer.js   classic script: finds the player, reports state
    background/service-worker.js  ES module: validates and forwards
    shared/messages.js            playback envelope + structural validation
    transport/mock-transport.js   replaceable transport boundary
  test/                           node --test suites (no Chrome required)
```

## Message path

```text
<video> events -> content script -> chrome.runtime.sendMessage
   { type: "PLAYBACK_OBSERVATION", payload: { videoId, currentTime, duration, paused, playbackRate } }
      -> service worker -> createPlaybackMessage() -> validatePlaybackMessage()
         -> transport.send({ schemaVersion, type: "PLAYBACK_STATE", payload })
```

The content script sends raw observations and the service worker builds the
versioned envelope, so the wire contract lives in exactly one place
(`src/shared/messages.js`).

## Transport interface

Everything downstream of the service worker goes through one object. W2-T3 keeps
the mock for component tests; W3-T2 implements the same interface over native
messaging so nothing else changes.

```js
{
  name: string,
  status: 'disconnected' | 'connecting' | 'connected' | 'error',
  connect(): Promise<void>,
  send(message: object): Promise<void>,
  disconnect(): Promise<void>,
  onStatusChange(listener: (status) => void): () => void  // returns unsubscribe
}
```

`onStatusChange` calls the listener immediately with the current status, so the
connection-state UI (W3-T3/W3-T4) never has to poll.

## Permissions policy

Wave 1 requests `https://www.youtube.com/*` and nothing else. `npm run lint`
fails if:

- host permissions widen beyond YouTube,
- a `key` or `oauth2` field appears in the manifest (the dev build must load
  unpacked on any machine),
- a credential-shaped string appears in any file.

`nativeMessaging` is deliberately **not** requested yet. It lands with W3-T2
alongside the host manifest and the reversible registration script - see the
native-host section of the
[local stack runbook](../docs/setup/local-stack.md#planned-native-host-registration-w3-t2-not-implemented).

## Not implemented here (on purpose)

SPA navigation re-acquisition, the 250 ms playing cadence, seek and rate
handling, listener teardown on detached videos, and service-worker suspension
recovery are all W2-T3. The stub only listens for `loadedmetadata`, `play`, and
`pause` so there is something to verify today.
