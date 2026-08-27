# Chrome Extension

Manifest V3 extension that observes YouTube playback and forwards it toward the
macOS app. W2-T3 provides the production playback observer and mock transport;
**W3-T2** replaces that transport with native messaging.

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
      -> service worker -> ordered playback forwarder
         -> createPlaybackMessage() -> validatePlaybackMessage()
         -> transport.send({ schemaVersion, type: "PLAYBACK_STATE", payload })
```

The content script sends raw observations and the service worker builds the
versioned envelope, so the wire contract lives in exactly one place
(`src/shared/messages.js`).

The content script emits immediately when it is injected, when the active video
or YouTube SPA route changes, and on `play`, `pause`, `seeked`, `ratechange`, and
`loadedmetadata`. While playing it emits every 250 ms. Pausing removes that
timer. A mutation observer reacquires a replaced player and detaches every
listener from the old element.

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

## DevTools verification checklist

After loading `extension/` unpacked:

- [ ] Open a YouTube watch page and confirm an `injected` observation is logged
  in the extension service-worker console.
- [ ] Play the video and confirm timestamps advance about four times per second.
- [ ] Pause and confirm one immediate `pause` observation arrives, followed by
  no periodic observations.
- [ ] Seek and change playback rate; confirm immediate `seeked` and `ratechange`
  observations with the new values.
- [ ] Navigate to another video using YouTube links without reloading the tab;
  confirm one `videochange` observation has the new 11-character ID.
- [ ] Let the MV3 worker become inactive (or stop it from `chrome://extensions`),
  then resume playback and confirm the next observation wakes it and reconnects
  the mock transport.
- [ ] Navigate to a feed page and confirm preview videos do not produce messages.

Automated coverage for the same lifecycle lives in
`test/content-script.test.js` and `test/playback-forwarder.test.js`.
