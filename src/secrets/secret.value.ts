import { readPipedInput } from '../core/piped-input';
import { askSecret } from '../core/prompt';
import type { ServiceContext } from '../core/service-context';
import { SecretInputTimeoutError } from './secrets.errors';

export const STDIN_TIMEOUT_MS = 30_000;

export interface SecretValueIo {
  readStdin(): Promise<string>;
  closeStdin(): void;
  stdinTimeoutMs: number;
}

function destroy(stream: { destroy(): unknown }): void {
  stream.destroy();
}

export const DEFAULT_SECRET_IO: SecretValueIo = {
  readStdin: () => readPipedInput(),
  closeStdin: () => destroy(process.stdin),
  stdinTimeoutMs: STDIN_TIMEOUT_MS,
};

const MS_PER_SECOND = 1000;

export function readWithin(io: SecretValueIo): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      io.closeStdin();
      reject(new SecretInputTimeoutError(Math.ceil(io.stdinTimeoutMs / MS_PER_SECOND)));
    }, io.stdinTimeoutMs);

    io.readStdin().then(
      (text) => {
        clearTimeout(timer);
        resolve(text);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function readSecretValue(key: string, services: ServiceContext, io: SecretValueIo): Promise<string> {
  if (services.isTTY) {
    return askSecret(services.ux, `Value for ${key}`);
  }

  return (await readWithin(io)).replace(/\r?\n$/, '');
}
