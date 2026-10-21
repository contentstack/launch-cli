import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { readPipedInput } from '../core/piped-input';
import type { VariableContext } from './variable.sources';

export type VariableIo = Pick<VariableContext, 'readFile' | 'exists' | 'readStdin'>;

export const DEFAULT_VARIABLE_IO: VariableIo = {
  readFile: (path) => readFile(path, 'utf8'),
  exists: existsSync,
  readStdin: () => readPipedInput(),
};

export function given(values: string[] | undefined): boolean {
  return (values ?? []).length > 0;
}
