export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Slows down guessing. There is one owner and the app sits behind a proxy, so failures are
 * counted for the whole app rather than per address: after {@link MAX_FAILURES} failures within
 * {@link FAILURE_WINDOW_MS}, logins are refused until the oldest of them is out of the window.
 */
export class LoginThrottle {
  private failures: number[] = [];

  /** Seconds to wait before another attempt is accepted, or 0 when one is. */
  retryAfterSeconds(now: Date): number {
    this.prune(now);
    if (this.failures.length < MAX_FAILURES) return 0;
    return Math.ceil((this.failures[0] + FAILURE_WINDOW_MS - now.getTime()) / 1000);
  }

  /**
   * Counts an attempt as a failure right away, before it is checked, so a burst of parallel
   * attempts cannot all slip under the limit. Call {@link forgive} if it turns out to be right.
   */
  recordFailure(now: Date): number {
    this.prune(now);
    const at = now.getTime();
    this.failures.push(at);
    return at;
  }

  /** Takes back the failure recorded at `at`, once the attempt proved to be correct. */
  forgive(at: number): void {
    const index = this.failures.indexOf(at);
    if (index !== -1) this.failures.splice(index, 1);
  }

  private prune(now: Date): void {
    this.failures = this.failures.filter((at) => at > now.getTime() - FAILURE_WINDOW_MS);
  }
}
