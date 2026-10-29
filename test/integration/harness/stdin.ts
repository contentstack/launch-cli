import { Readable } from 'stream';

const original = Object.getOwnPropertyDescriptor(process, 'stdin') as PropertyDescriptor;

const replace = (isTTY: boolean, chunks: string[]): void => {
  const stream: any = Readable.from(chunks);
  stream.isTTY = isTTY;
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true });
};

export const stdin = {
  pipe(value: string): void {
    replace(false, [value]);
  },
  tty(): void {
    replace(true, []);
  },
  restore(): void {
    Object.defineProperty(process, 'stdin', original);
  },
};
