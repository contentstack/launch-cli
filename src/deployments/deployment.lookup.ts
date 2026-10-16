import type { WatchTiming } from './deployment.watcher';

export const FIRST_LOOKUP_ATTEMPTS = 3;

export async function untilFound<T>(
  lookup: () => Promise<T | undefined>,
  timing: Pick<WatchTiming, 'sleep' | 'pollDelayMs'>,
): Promise<T | undefined> {
  for (let attempt = 1; attempt < FIRST_LOOKUP_ATTEMPTS; attempt += 1) {
    const found = await lookup();

    if (found !== undefined) {
      return found;
    }

    await timing.sleep(timing.pollDelayMs);
  }

  return lookup();
}
