# Chrome Native Messaging Host

The development host uses Chrome's official native-messaging transport. Chrome
launches the Swift executable, sends 4-byte little-endian length-prefixed UTF-8
JSON on stdin, and receives framed ACK/NACK replies on stdout. The host validates
the 8 KiB playback contract before posting it to the running macOS app through
`DistributedNotificationCenter`.

## Register

1. Build and run the Boring Notch app once.
2. Load `extension/` unpacked at `chrome://extensions`.
3. Copy its 32-character extension ID.
4. From the repository root run:

```bash
npm run native:register -- <extension-id>
```

The command builds `boring-notch-native-host` in release mode and atomically
writes:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.ctphack.discussionnotch.bridge.json
```

The generated manifest contains one exact
`chrome-extension://<extension-id>/` origin and the absolute build output path.
Neither value is hard-coded in the repository. Reload the extension after
registration.

To remove the Chrome registration:

```bash
npm run native:unregister
```

Unregistration is idempotent and refuses to remove a manifest whose `name`
does not match this host. It intentionally leaves Swift build output in the
package's ignored `.build/` directory.

## Restart checklist

- App restart: quit and reopen Boring Notch; the next host notification updates
  `NativePlaybackBridge.shared.connectionState` and playback session.
- Extension reload: press **Reload** at `chrome://extensions`; the fresh MV3
  worker connects before forwarding its first observation.
- Service-worker restart: stop the worker from its DevTools, then play the
  video; the content-script message wakes it and it reconnects.
- Chrome restart: reopen Chrome and a YouTube watch page; Chrome launches the
  registered host when the first observation arrives.
- Host restart: terminate `boring-notch-native-host`; the extension reports
  `error` and retries after 250 ms with exponential backoff capped at 10 s.
- Registration change: unpacked extension IDs can change when loaded from a
  different directory. Rerun registration with the new exact ID.

In the service-worker console, inspect
`chrome.storage.session.get('nativeConnectionState')`. Expected states are
`disconnected`, `connecting`, `connected`, and `error`. The app-facing state is
`NativePlaybackBridge.shared.connectionState`; its `session` is the W2-T4
`DiscussionSessionState` consumed by W3-T3/W3-T4.

## Safety and framing

- Host name: `com.ctphack.discussionnotch.bridge`.
- Input limit: 8192 UTF-8 bytes, enforced in both extension and host.
- Oversized length headers are rejected before allocating or decoding payloads.
- Invalid UTF-8, JSON, schema versions, types, IDs, seconds, and playback rates
  never reach the timeline.
- stdout contains framed protocol replies only; diagnostics go to stderr.
- The official native-host path is implemented. There is no loopback WebSocket
  fallback and no listening network port.

Run offline checks:

```bash
npm test
npm run lint
swift test --package-path Packages/NativeMessagingHost
```

The Swift command requires macOS/Xcode. Node tests cover the native transport,
backoff, manifest generation, and reversible registration on every platform.
