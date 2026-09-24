import { CancelledError } from './errors';
import { UxLike } from './render';

export interface InterruptSource {
  once(signal: 'SIGINT', listener: () => void): unknown;
  removeListener(signal: 'SIGINT', listener: () => void): unknown;
}

export type Release = () => void;

const HOLD_INTERVAL_MS = 2 ** 30;

export function holdEventLoop(): Release {
  const timer = setInterval(() => undefined, HOLD_INTERVAL_MS);

  return () => clearInterval(timer);
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
          release();
          reject(new CancelledError());
        };

        signals.once('SIGINT', cancel);
        ux.inquire<T>(payload).then(
          (answer) => {
            release();
            resolve(answer);
          },
          (error: unknown) => {
            release();
            reject(error);
          },
        );
      }),
  };
}
