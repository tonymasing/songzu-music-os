/** Retry work queued by other songs without requiring another user click.
 * The caller owns the watchdog and aborts on source change/unmount. A busy
 * response renews it: time waiting for admission is outside the six-job queue.
 */
export async function requestPlayerBeats(source: string, signal: AbortSignal, onQueued: () => void) {
  let failures = 0;
  for (;;) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`/api/player-beats?src=${encodeURIComponent(source)}`, { signal, cache: "no-store" });
    } catch (error) {
      signal.throwIfAborted();
      if (++failures >= 3) throw error;
      await waitForRetry(1000 * 2 ** (failures - 1), signal);
      continue;
    }
    failures = 0;
    if (response.status === 429 || response.status === 503) {
      onQueued();
      const retry = response.headers.get("Retry-After");
      const seconds = retry === null ? NaN : Number(retry);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : NaN;
      await response.body?.cancel();
      await waitForRetry(Number.isFinite(delay) ? Math.max(1000, Math.min(30000, delay)) : 10000, signal);
      continue;
    }
    // Invalid/unsupported recordings must not loop indefinitely or invent a BPM.
    if (!response.ok) throw new Error("unavailable");
    return response;
  }
}

function waitForRetry(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, delay);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
