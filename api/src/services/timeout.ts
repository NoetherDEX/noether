/** Reject `promise` if it has not settled within `ms`. The timer never keeps
 *  the process alive (unref), so tests and shutdown are unaffected. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}
