import { cliux } from '@contentstack/cli-utilities';

export interface Loader {
  start(message: string): void;
  stop(): void;
}

export function terminalLoader(): Loader {
  let running: ReturnType<typeof cliux.loaderV2>;

  return {
    start: (message) => {
      if (!running) {
        running = cliux.loaderV2(message);
      }
    },
    stop: () => {
      if (running) {
        cliux.loaderV2('done', running);
        running = undefined;
      }
    },
  };
}

export const silentLoader: Loader = {
  start: () => undefined,
  stop: () => undefined,
};
