import { Readable } from 'node:stream';

import { readPipedInput } from './piped-input';

describe('readPipedInput', () => {
  it('reads every chunk piped in, in order, as text', async () => {
    await expect(readPipedInput(Readable.from(['ab', Buffer.from('cd'), 'e\n']))).resolves.toBe('abcde\n');
  });

  it('reads nothing as an empty string', async () => {
    await expect(readPipedInput(Readable.from([]))).resolves.toBe('');
  });
});
