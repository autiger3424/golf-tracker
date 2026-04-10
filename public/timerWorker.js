// Timer Web Worker — runs on a separate thread.
// Less aggressively throttled than main thread when phone screen is off.
// Uses wall-clock time so it self-corrects even if paused by the OS.

let intervalId = null;
let adjustedMs = 0;
let startTime = 0;
let paused = true;

function getRemainingMs() {
  if (paused) return adjustedMs;
  return Math.max(0, adjustedMs - (Date.now() - startTime));
}

function tick() {
  const rem = getRemainingMs();
  self.postMessage({ type: 'tick', remaining: rem });
  if (rem <= 0) {
    self.postMessage({ type: 'complete' });
    clearInterval(intervalId);
    intervalId = null;
    paused = true;
  }
}

self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'start':
      adjustedMs = data.adjustedMs;
      startTime = data.startTime || Date.now();
      paused = false;
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(tick, 500);
      break;

    case 'pause':
      adjustedMs = getRemainingMs();
      paused = true;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      self.postMessage({ type: 'tick', remaining: adjustedMs });
      break;

    case 'resume':
      adjustedMs = data.adjustedMs;
      startTime = Date.now();
      paused = false;
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(tick, 500);
      break;

    case 'stop':
      paused = true;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      break;

    default:
      break;
  }
};
