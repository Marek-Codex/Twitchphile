// Runs `fn` at most once per `ms`, always with a trailing call so the last change lands. For DOM scans that the
// shared onDom tick would otherwise run every frame on busy pages (card grids don't change that fast).
export function throttle(fn: () => void, ms: number) {
  let last = 0;
  let timer = 0;
  const run = () => {
    timer = 0;
    last = Date.now();
    fn();
  };
  return {
    /** Schedule a run (immediately if it's been long enough, else once the wait is up). */
    request() {
      if (timer) return;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) run();
      else timer = window.setTimeout(run, wait);
    },
    /** Run now (e.g. after a settings change). */
    now: run,
    cancel: () => clearTimeout(timer),
  };
}
