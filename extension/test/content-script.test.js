import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(extensionRoot, 'src/content/youtube-observer.js'), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    dispatch(name) {
      for (const callback of listeners.get(name) ?? []) callback({ type: name });
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    }
  };
}

function createVideo(overrides = {}) {
  return Object.assign(eventTarget(), {
    currentTime: 42.25,
    duration: 600,
    paused: false,
    playbackRate: 1.5,
    isConnected: true
  }, overrides);
}

function executeContentScript({ href, video = createVideo() }) {
  const documentEvents = eventTarget();
  const windowEvents = eventTarget();
  const messages = [];
  const intervals = new Map();
  const timeouts = new Map();
  const mutationObservers = [];
  let selectedVideo = video;
  let nextTimerId = 1;

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      mutationObservers.push(this);
    }

    observe() {
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }

    fire() {
      if (this.connected) this.callback([]);
    }
  }

  const window = Object.assign(windowEvents, { location: { href } });
  const document = Object.assign(documentEvents, {
    documentElement: {},
    querySelector: () => selectedVideo
  });
  const runtime = { id: 'abcdefghijklmnopabcdefghijklmnop', lastError: undefined };
  runtime.sendMessage = (message, callback) => {
    messages.push(message);
    callback?.();
  };

  const context = vm.createContext({
    URL,
    window,
    document,
    MutationObserver: FakeMutationObserver,
    chrome: { runtime },
    setInterval(callback, delay) {
      const id = nextTimerId++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timeouts.set(id, { callback, delay });
      return id;
    }
  });

  vm.runInContext(source, context, { filename: 'youtube-observer.js' });

  return {
    context,
    document,
    window,
    runtime,
    messages,
    intervals,
    timeouts,
    mutationObservers,
    get video() {
      return selectedVideo;
    },
    setVideo(nextVideo) {
      selectedVideo = nextVideo;
    },
    runIntervals() {
      for (const { callback } of [...intervals.values()]) callback();
    },
    runTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      for (const { callback } of pending) callback();
    },
    reinject() {
      vm.runInContext(source, context, { filename: 'youtube-observer.js' });
    }
  };
}

test('reports actual state immediately and every 250 ms while playing', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });

  assert.equal(runtime.messages.length, 1);
  assert.equal(runtime.messages[0].reason, 'injected');
  assert.deepEqual(
    {
      ...runtime.messages[0].payload,
      observedAt: '<timestamp>'
    },
    {
      videoId: 'dQw4w9WgXcQ',
      currentTime: 42.25,
      duration: 600,
      paused: false,
      playbackRate: 1.5,
      observedAt: '<timestamp>'
    }
  );
  assert.equal(runtime.intervals.size, 1);
  assert.equal([...runtime.intervals.values()][0].delay, 250);

  runtime.video.currentTime = 42.5;
  runtime.runIntervals();
  assert.equal(runtime.messages.at(-1).reason, 'interval');
  assert.equal(runtime.messages.at(-1).payload.currentTime, 42.5);
});

test('emits immediately for every required media event without duplicate listeners', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });

  for (const eventName of ['loadedmetadata', 'play', 'pause', 'seeked', 'ratechange']) {
    runtime.video.paused = eventName === 'pause';
    runtime.video.dispatch(eventName);
  }

  assert.deepEqual(
    runtime.messages.map(({ reason }) => reason),
    ['injected', 'loadedmetadata', 'play', 'pause', 'seeked', 'ratechange']
  );
  for (const eventName of ['loadedmetadata', 'play', 'pause', 'seeked', 'ratechange']) {
    assert.equal(runtime.video.listenerCount(eventName), 1);
  }
});

test('does not poll while paused and restarts cadence on play', () => {
  const video = createVideo({ paused: true });
  const runtime = executeContentScript({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video });
  assert.equal(runtime.intervals.size, 0);

  video.paused = false;
  video.dispatch('play');
  assert.equal(runtime.intervals.size, 1);

  video.paused = true;
  video.dispatch('pause');
  assert.equal(runtime.intervals.size, 0);
});

test('tracks YouTube SPA video-id changes without an extension reload', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  runtime.window.location.href = 'https://www.youtube.com/watch?v=abcdefghijk';
  runtime.document.dispatch('yt-navigate-finish');

  assert.equal(runtime.messages.at(-1).reason, 'videochange');
  assert.equal(runtime.messages.at(-1).payload.videoId, 'abcdefghijk');
});

test('acquires a feed preview only after SPA navigation supplies a video id', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/feed/subscriptions' });
  assert.equal(runtime.intervals.size, 0);

  runtime.window.location.href = 'https://www.youtube.com/watch?v=abcdefghijk';
  runtime.document.dispatch('yt-navigate-finish');

  assert.equal(runtime.video.listenerCount('play'), 1);
  assert.equal(runtime.intervals.size, 1);
  assert.equal(runtime.messages.at(-1).payload.videoId, 'abcdefghijk');
});

test('detaches an old player and reacquires a replacement video element', () => {
  const oldVideo = createVideo();
  const runtime = executeContentScript({
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    video: oldVideo
  });
  const replacement = createVideo({ currentTime: 3, paused: true });
  oldVideo.isConnected = false;
  runtime.setVideo(replacement);
  runtime.mutationObservers.at(-1).fire();

  assert.equal(oldVideo.listenerCount('play'), 0);
  assert.equal(replacement.listenerCount('play'), 1);
  assert.equal(runtime.intervals.size, 0, 'the paused replacement must not be polled');
  assert.equal(runtime.messages.at(-1).reason, 'videochange');
  assert.equal(runtime.messages.at(-1).payload.currentTime, 3);
});

test('re-injection disposes the previous controller before adding listeners', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  runtime.reinject();

  assert.equal(runtime.video.listenerCount('play'), 1);
  assert.equal(runtime.video.listenerCount('seeked'), 1);
  assert.equal(runtime.intervals.size, 1);
  assert.equal(runtime.mutationObservers.filter(({ connected }) => connected).length, 1);
});

test('retries one failed send so a restarting service worker can wake', () => {
  const runtime = executeContentScript({
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    video: createVideo({ paused: true })
  });
  runtime.messages.length = 0;
  runtime.runtime.sendMessage = (message, callback) => {
    runtime.messages.push(message);
    runtime.runtime.lastError = { message: 'worker restarting' };
    callback();
    runtime.runtime.lastError = undefined;
  };

  runtime.video.dispatch('seeked');
  assert.equal(runtime.messages.length, 1);
  assert.equal([...runtime.timeouts.values()][0].delay, 250);
  runtime.runtime.sendMessage = (message, callback) => {
    runtime.messages.push(message);
    callback();
  };
  runtime.runTimeouts();
  assert.equal(runtime.messages.length, 2);
});

test('stops observing when an extension reload invalidates the content script', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  runtime.runtime.sendMessage = () => {
    throw new Error('Extension context invalidated.');
  };

  assert.doesNotThrow(() => runtime.video.dispatch('seeked'));
  assert.equal(runtime.video.listenerCount('play'), 0);
  assert.equal(runtime.intervals.size, 0);
  assert.equal(runtime.mutationObservers.filter(({ connected }) => connected).length, 0);
});

test('suppresses messages when the page has no video id', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/feed/subscriptions' });
  assert.deepEqual(runtime.messages, []);
  assert.equal(runtime.intervals.size, 0, 'feed previews must not start playback polling');
  assert.equal(runtime.context.boringNotchObserve(), null);
});

test('normalizes transient media values to the playback contract', () => {
  const runtime = executeContentScript({
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    video: createVideo({ currentTime: 12, duration: 10, playbackRate: 0, paused: true })
  });

  assert.equal(runtime.messages[0].payload.currentTime, 10);
  assert.equal(runtime.messages[0].payload.duration, 10);
  assert.equal(runtime.messages[0].payload.playbackRate, 1);
});
