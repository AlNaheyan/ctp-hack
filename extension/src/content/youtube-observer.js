// YouTube playback observer (classic content script; MV3 content scripts are
// not ES modules). The player owns time. This script observes it and emits raw,
// transport-neutral observations to the extension service worker.

(() => {
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const PLAYING_INTERVAL_MS = 250;
  const VIDEO_EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata'];
  const CONTROLLER_KEY = '__boringNotchPlaybackObserver';

  // Re-injection can happen while developing an unpacked extension. Dispose an
  // earlier controller so one page never has duplicate listeners or timers.
  globalThis[CONTROLLER_KEY]?.dispose?.();

  let activeVideo = null;
  let activeVideoId = null;
  let cadenceTimer = null;
  let disposed = false;

  function currentVideoId() {
    try {
      const url = new URL(window.location.href);
      const queryId = url.searchParams.get('v');
      if (queryId && VIDEO_ID.test(queryId)) return queryId;

      for (const prefix of ['/shorts/', '/embed/', '/live/']) {
        if (!url.pathname.startsWith(prefix)) continue;
        const candidate = url.pathname.slice(prefix.length).split('/')[0];
        if (VIDEO_ID.test(candidate)) return candidate;
      }
    } catch {
      // Navigation can expose a transient malformed URL. The next navigation or
      // DOM signal will retry without emitting an invalid observation.
    }
    return null;
  }

  function selectedVideo() {
    return document.querySelector('video.html5-main-video, video');
  }

  function observe() {
    const videoId = currentVideoId();
    if (!activeVideo || videoId === null || activeVideo.isConnected === false) return null;

    const duration = Number.isFinite(activeVideo.duration) ? Math.max(0, activeVideo.duration) : 0;
    const rawCurrentTime = Number.isFinite(activeVideo.currentTime) ? Math.max(0, activeVideo.currentTime) : 0;

    return {
      videoId,
      currentTime: duration > 0 ? Math.min(rawCurrentTime, duration) : rawCurrentTime,
      duration,
      paused: Boolean(activeVideo.paused),
      playbackRate:
        Number.isFinite(activeVideo.playbackRate) && activeVideo.playbackRate > 0
          ? activeVideo.playbackRate
          : 1,
      observedAt: new Date().toISOString()
    };
  }

  function deliver(message, attempt = 0) {
    if (disposed) return;
    try {
      chrome.runtime.sendMessage(message, () => {
        let failed;
        try {
          failed = Boolean(chrome.runtime.lastError);
        } catch {
          // Reloading an unpacked extension invalidates scripts already living
          // in open tabs. Stop their polling until Chrome injects the new script
          // after the tab itself is reloaded.
          controller.dispose();
          return;
        }
        if (failed && attempt === 0 && !disposed) {
          // sendMessage wakes an MV3 worker. One bounded retry covers the short
          // startup/reload window without creating a permanent polling loop.
          setTimeout(() => deliver(message, 1), PLAYING_INTERVAL_MS);
        }
      });
    } catch {
      controller.dispose();
    }
  }

  function report(reason) {
    const payload = observe();
    if (payload === null) return;
    deliver({ type: 'PLAYBACK_OBSERVATION', reason, payload });
  }

  function stopCadence() {
    if (cadenceTimer === null) return;
    clearInterval(cadenceTimer);
    cadenceTimer = null;
  }

  function ensureCadence() {
    if (!activeVideo || activeVideo.paused || cadenceTimer !== null) return;
    cadenceTimer = setInterval(() => {
      if (activeVideo?.isConnected === false || selectedVideo() !== activeVideo) {
        reconcile('videochange');
        return;
      }
      report('interval');
    }, PLAYING_INTERVAL_MS);
  }

  const eventHandlers = Object.fromEntries(
    VIDEO_EVENTS.map((eventName) => [
      eventName,
      () => {
        if (eventName === 'pause') stopCadence();
        report(eventName);
        if (eventName === 'play' || eventName === 'loadedmetadata') ensureCadence();
      }
    ])
  );

  function detachVideo() {
    stopCadence();
    if (!activeVideo) return;
    for (const eventName of VIDEO_EVENTS) {
      activeVideo.removeEventListener(eventName, eventHandlers[eventName]);
    }
    activeVideo = null;
  }

  function attachVideo(video) {
    activeVideo = video;
    for (const eventName of VIDEO_EVENTS) {
      video.addEventListener(eventName, eventHandlers[eventName]);
    }
    ensureCadence();
  }

  function reconcile(reason = 'videochange') {
    if (disposed) return;
    const nextVideo = selectedVideo();
    const nextVideoId = currentVideoId();
    // YouTube feeds may contain autoplay previews. Only a player paired with a
    // canonical video ID is observable.
    const observableVideo = nextVideoId ? nextVideo : null;
    const elementChanged = observableVideo !== activeVideo;
    const idChanged = nextVideoId !== activeVideoId;

    if (elementChanged) {
      detachVideo();
      if (observableVideo) attachVideo(observableVideo);
    }
    activeVideoId = nextVideoId;

    if (observableVideo && (elementChanged || idChanged || reason === 'injected')) {
      report(reason === 'injected' ? 'injected' : 'videochange');
    }
  }

  function onNavigation() {
    reconcile('videochange');
  }

  const mutationObserver = new MutationObserver(() => reconcile('videochange'));
  mutationObserver.observe(document.documentElement ?? document, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', onNavigation);
  window.addEventListener('popstate', onNavigation);

  const controller = {
    observe,
    reconcile,
    dispose() {
      if (disposed) return;
      disposed = true;
      mutationObserver.disconnect();
      document.removeEventListener('yt-navigate-finish', onNavigation);
      window.removeEventListener('popstate', onNavigation);
      detachVideo();
    }
  };

  globalThis[CONTROLLER_KEY] = controller;
  globalThis.boringNotchObserve = observe;
  reconcile('injected');
})();
