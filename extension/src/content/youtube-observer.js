// Content script skeleton (classic script - MV3 content scripts are not modules).
//
// Wave 1 scope: prove the script injects on a watch page, finds the player, and
// can hand one observation to the service worker. W2-T3 owns the real observer:
// play/pause/seeked/ratechange/loadedmetadata handling, the 250 ms playing
// cadence, SPA navigation re-acquisition, and listener cleanup.

(() => {
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

  function currentVideoId() {
    const url = new URL(window.location.href);
    const queryId = url.searchParams.get('v');
    if (queryId && VIDEO_ID.test(queryId)) return queryId;

    for (const prefix of ['/shorts/', '/embed/', '/live/']) {
      if (url.pathname.startsWith(prefix)) {
        const candidate = url.pathname.slice(prefix.length).split('/')[0];
        if (VIDEO_ID.test(candidate)) return candidate;
      }
    }
    return null;
  }

  function observe() {
    const video = document.querySelector('video.html5-main-video, video');
    const videoId = currentVideoId();
    if (!video || videoId === null) return null;

    return {
      videoId,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      paused: video.paused,
      playbackRate: video.playbackRate || 1,
      observedAt: new Date().toISOString()
    };
  }

  function report(reason) {
    const observation = observe();
    if (observation === null) return;

    chrome.runtime.sendMessage(
      { type: 'PLAYBACK_OBSERVATION', reason, payload: observation },
      () => void chrome.runtime.lastError // service worker may be asleep; W2-T3 adds retry
    );
  }

  // Minimal proof of life: one observation once the player is ready, and one on
  // each play/pause. Everything else is W2-T3.
  const video = document.querySelector('video.html5-main-video, video');
  if (video) {
    video.addEventListener('loadedmetadata', () => report('loadedmetadata'), { once: true });
    video.addEventListener('play', () => report('play'));
    video.addEventListener('pause', () => report('pause'));
  }

  report('injected');

  // Exposed for manual DevTools checks: boringNotchObserve() in the page console
  // of the content-script context.
  globalThis.boringNotchObserve = observe;
})();
