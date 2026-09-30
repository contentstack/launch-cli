import { cliux } from '@contentstack/cli-utilities';

import { styled } from './style';

export interface Progress {
  start(total: number): void;
  advance(value: number): void;
  stop(): void;
}

interface ProgressBar {
  start(total: number, value: number, payload: Record<string, string>): void;
  update(value: number, payload: Record<string, string>): void;
  stop(): void;
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const BAR_WIDTH = 24;
const BAR_COMPLETE = '█';
const BAR_INCOMPLETE = '░';

interface SizeUnit {
  suffix: string;
  scaled: (bytes: number) => string;
}

function unitOf(total: number): SizeUnit {
  if (total < BYTES_PER_KB) {
    return { suffix: 'B', scaled: (bytes) => String(bytes) };
  }

  if (total < BYTES_PER_MB) {
    return { suffix: 'KB', scaled: (bytes) => String(Math.round(bytes / BYTES_PER_KB)) };
  }

  return { suffix: 'MB', scaled: (bytes) => (bytes / BYTES_PER_MB).toFixed(1) };
}

export function transferredOf(value: number, total: number): string {
  const unit = unitOf(total);

  return `${unit.scaled(value)}/${unit.scaled(total)} ${unit.suffix}`;
}

export function progressBarOf(progress: number): string {
  const complete = Math.round(progress * BAR_WIDTH);

  return (
    styled(BAR_COMPLETE.repeat(complete), 'cyan', true) +
    styled(BAR_INCOMPLETE.repeat(BAR_WIDTH - complete), 'dim', true)
  );
}

export const silentProgress: Progress = {
  start: () => undefined,
  advance: () => undefined,
  stop: () => undefined,
};

export function terminalProgress(label: string): Progress {
  let bar: ProgressBar | undefined;
  let total = 0;

  return {
    start: (bytes) => {
      if (bar) {
        return;
      }

      total = bytes;
      const drawn: ProgressBar = cliux.progress({
        format: `${label}  {bar}  {percentage}%  {transferred}`,
        formatBar: progressBarOf,
        barsize: BAR_WIDTH,
        stream: process.stdout,
        autopadding: true,
        hideCursor: true,
        linewrap: false,
        gracefulExit: true,
      });
      bar = drawn;
      drawn.start(bytes, 0, { transferred: transferredOf(0, bytes) });
    },
    advance: (value) => {
      bar?.update(value, { transferred: transferredOf(value, total) });
    },
    stop: () => {
      if (!bar) {
        return;
      }

      bar.stop();
      bar = undefined;
    },
  };
}
