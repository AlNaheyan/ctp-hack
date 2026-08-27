import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(extensionRoot, 'src/content/youtube-observer.js'), 'utf8');

function executeContentScript({ href, video }) {
  const listeners = new Map();
  const messages = [];
  const observedVideo = {
    currentTime: 42.25,
    duration: 600,
    paused: false,
    playbackRate: 1.5,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    ...video
  };

  const context = {
    URL,
    window: { location: { href } },
    document: { querySelector: () => observedVideo },
    chrome: {
      runtime: {
        lastError: undefined,
        sendMessage(message, callback) {
          messages.push(message);
          callback?.();
        }
      }
    }
  };

  vm.runInNewContext(source, context, { filename: 'youtube-observer.js' });
  return { context, listeners, messages, video: observedVideo };
}

test('content script injects on YouTube and reports the actual video state', () => {
  const runtime = executeContentScript({
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  });

  assert.equal(runtime.messages.length, 1);
  assert.equal(runtime.messages[0].type, 'PLAYBACK_OBSERVATION');
  assert.equal(runtime.messages[0].reason, 'injected');
  assert.equal(runtime.messages[0].payload.videoId, 'dQw4w9WgXcQ');
  assert.equal(runtime.messages[0].payload.currentTime, 42.25);
  assert.equal(runtime.messages[0].payload.duration, 600);
  assert.equal(runtime.messages[0].payload.paused, false);
  assert.equal(runtime.messages[0].payload.playbackRate, 1.5);
  assert.match(runtime.messages[0].payload.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof runtime.context.boringNotchObserve, 'function');
});

test('content script forwards play, pause, and loaded-metadata events', () => {
  const runtime = executeContentScript({
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  });

  runtime.listeners.get('loadedmetadata')();
  runtime.listeners.get('play')();
  runtime.video.paused = true;
  runtime.listeners.get('pause')();

  assert.deepEqual(
    runtime.messages.map(({ reason }) => reason),
    ['injected', 'loadedmetadata', 'play', 'pause']
  );
  assert.equal(runtime.messages.at(-1).payload.paused, true);
});

test('content script suppresses messages when the page has no video id', () => {
  const runtime = executeContentScript({ href: 'https://www.youtube.com/feed/subscriptions' });
  assert.deepEqual(runtime.messages, []);
  assert.equal(runtime.context.boringNotchObserve(), null);
});

