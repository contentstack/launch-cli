import { CancelledError } from './errors';
import type { UxLike } from './prompt';

export interface InterruptSource {
  on(signal: 'SIGINT', listener: () => void): unknown;
  removeListener(signal: 'SIGINT', listener: () => void): unknown;
}

export type Release = () => void;

const HOLD_INTERVAL_MS = 2 ** 30;

export function holdEventLoop(): Release {
  const timer = setInterval(() => undefined, HOLD_INTERVAL_MS);

  return () => clearInterval(timer);
}

export function onInterrupt(listener: () => void, signals: InterruptSource = process): Release {
  let attached = true;
  const release = (): void => {
    if (attached) {
      attached = false;
      signals.removeListener('SIGINT', handle);
    }
  };
  const handle = (): void => {
    queueMicrotask(release);
    listener();
  };

  signals.on('SIGINT', handle);

  return release;
}

export interface InterruptOptions {
  signals?: InterruptSource;
  hold?: () => Release;
}

export function cancelOnInterrupt(ux: UxLike, options: InterruptOptions = {}): UxLike {
  const { signals = process, hold = holdEventLoop } = options;

  return {
    print: (message) => ux.print(message),
    inquire: <T>(payload: unknown) =>
      new Promise<T>((resolve, reject) => {
        const releaseLoop = hold();
        const release = (): void => {
          releaseLoop();
          signals.removeListener('SIGINT', cancel);
        };
        const cancel = (): void => {
          queueMicrotask(release);
          reject(new CancelledError());
        };

        const fail = (error: unknown): void => {
          release();
          reject(error);
        };

        signals.on('SIGINT', cancel);

        try {
          ux.inquire<T>(payload).then((answer) => {
            release();
            resolve(answer);
          }, fail);
        } catch (error) {
          fail(error);
        }
      }),
  };
}
