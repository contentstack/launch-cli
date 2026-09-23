import { randomBytes } from 'node:crypto';

import { ProjectRef, parseProjectRef } from './project-ref';

const UID = randomBytes(12).toString('hex');

describe('parseProjectRef', () => {
  it('classifies a 24-character hex string as a uid', () => {
    const ref = parseProjectRef(UID);

    expect(ref).toEqual({ kind: 'uid', uid: UID });
  });

  it('classifies an uppercase 24-character hex string as a uid', () => {
    const upper = UID.toUpperCase();

    expect(parseProjectRef(upper)).toEqual({ kind: 'uid', uid: upper });
  });

  it.each([['0'.repeat(23)], ['0'.repeat(25)], ['marketing-site'], [''], ['g'.repeat(24)], [' '.repeat(24)]])(
    'classifies %p as a name',
    (input) => {
      expect(parseProjectRef(input)).toEqual({ kind: 'name', name: input });
    },
  );

  it('is reachable as ProjectRef.parse, the form callers use', () => {
    expect(ProjectRef.parse('marketing-site')).toEqual({ kind: 'name', name: 'marketing-site' });
    expect(ProjectRef.parse(UID)).toEqual({ kind: 'uid', uid: UID });
  });
});
