import { randomBytes } from 'node:crypto';

import { ResourceRef, UID_PATTERN } from './resource-ref';

const UID = randomBytes(12).toString('hex');

describe('ResourceRef', () => {
  it.each([[UID], [UID.toUpperCase()]])('takes the 24-character hex string %s as a uid', (input) => {
    expect(ResourceRef.parse(input)).toEqual({ kind: 'uid', uid: input });
    expect(UID_PATTERN.test(input)).toBe(true);
  });

  it.each([['0'.repeat(23)], ['0'.repeat(25)], ['production'], ['Production'], [''], ['g'.repeat(24)], [' '.repeat(24)]])(
    'takes %p as a name, unchanged',
    (input) => {
      expect(ResourceRef.parse(input)).toEqual({ kind: 'name', name: input });
    },
  );

  it.each([['production'], [''], ['0'.repeat(24)]])(
    'takes %p as a uid without sniffing its shape when the caller already knows it is one',
    (input) => {
      expect(ResourceRef.uid(input)).toEqual({ kind: 'uid', uid: input });
    },
  );
});
