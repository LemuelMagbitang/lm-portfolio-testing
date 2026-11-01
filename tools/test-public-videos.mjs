import assert from "node:assert/strict";
import { loadPublicMuxVideos } from "../js/infrastructure/mux/public-videos.js?v=20261101-01";

const config = {
  supabaseUrl: "https://portfolio-test.supabase.co",
  supabasePublishableKey: "public-test-key"
};
const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});
const timers = [];
const setTimeoutImpl = (callback, delay) => {
  const timer = { callback, delay, cleared: false };
  timers.push(timer);
  return timer;
};
const clearTimeoutImpl = timer => {
  if (timer) timer.cleared = true;
};
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args);

try {
  const calls = [];
  const successfulFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === "data/video-platform.json") return response(config);
    return response({
      videos: [
        { provider: "mux", playbackId: "test-playback-id", posterUrl: "https://image.mux.com/test/thumbnail.jpg", title: "Published Hero" },
        { provider: "static_mp4", src: "/assets/hero/test.mp4", posterUrl: "/assets/hero/test.webp", title: "Static Hero" },
        { provider: "unsupported", src: "/ignored" }
      ]
    });
  };
  const videos = await loadPublicMuxVideos("hero", {
    fetchImpl: successfulFetch,
    resolveUrl: value => value,
    configTimeoutMs: 500,
    timeoutMs: 2500,
    setTimeoutImpl,
    clearTimeoutImpl
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "data/video-platform.json");
  assert.equal(calls[1].url, "https://portfolio-test.supabase.co/functions/v1/mux-public?placement=hero");
  assert.equal(calls[1].init.headers.apikey, "public-test-key");
  assert.deepEqual(videos.map(video => video.type), ["mux", "video"]);
  assert.equal(videos[0].playbackId, "test-playback-id");
  assert.equal(videos[1].src, "/assets/hero/test.mp4");
  assert.equal(warnings.length, 0, "A valid published feed must not produce warnings.");

  timers.splice(0);
  warnings.splice(0);
  let feedSignal = null;
  const timeoutFetch = async (url, init = {}) => {
    if (url === "data/video-platform.json") return response(config);
    feedSignal = init.signal;
    const timer = timers.at(-1);
    assert.equal(timer.delay, 1200);
    timer.callback();
    return new Promise((resolve, reject) => {
      const abort = () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      };
      if (feedSignal.aborted) abort();
      else feedSignal.addEventListener("abort", abort, { once: true });
    });
  };
  const timedOutVideos = await loadPublicMuxVideos("hero", {
    fetchImpl: timeoutFetch,
    resolveUrl: value => value,
    configTimeoutMs: 500,
    timeoutMs: 1200,
    setTimeoutImpl,
    clearTimeoutImpl
  });
  assert.deepEqual(timedOutVideos, [], "A timed-out optional feed must preserve the configured Hero fallback.");
  assert.equal(feedSignal.aborted, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /timed out after 1200ms/i);
  assert.doesNotMatch(warnings[0][0], /AbortError/);
  assert.ok(timers.every(timer => timer.cleared), "Each request timeout must be cleared after its request settles.");

  console.log("Public Mux video feed timeout and mapping tests passed.");
} finally {
  console.warn = originalWarn;
}
