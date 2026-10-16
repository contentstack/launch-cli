import { UsageError } from './errors';
import { uidByName } from './name-lookup';
import type { ResourceRef } from './resource-ref';

interface Entry {
  uid?: string | null;
  name?: string;
}

function pagesReading(pages: Entry[][]) {
  const read: number[] = [];
  const opened = jest.fn(async function* () {
    for (let index = 0; index < pages.length; index += 1) {
      read.push(index);
      yield pages[index];
    }
  });

  return { opened, read };
}

function lookup(opened: () => AsyncIterable<Entry[]>, ref: ResourceRef): Promise<string> {
  return uidByName(
    opened,
    (entries) => entries,
    ref,
    (name) => new UsageError(`No thing named "${name}".`),
  );
}

describe('uidByName', () => {
  it('returns a uid reference as it is, without opening the pages at all', async () => {
    const { opened } = pagesReading([[{ uid: 'x', name: 'a' }]]);

    await expect(lookup(opened, { kind: 'uid', uid: 'u1' })).resolves.toBe('u1');
    expect(opened).not.toHaveBeenCalled();
  });

  it('matches the name exactly and case-sensitively, stopping at the page that holds it', async () => {
    const { opened, read } = pagesReading([
      [
        { uid: 'a', name: 'Site' },
        { uid: 'b', name: ' site' },
      ],
      [{ uid: 'c', name: 'site' }],
      [{ uid: 'd', name: 'site' }],
    ]);

    await expect(lookup(opened, { kind: 'name', name: 'site' })).resolves.toBe('c');
    expect(read).toEqual([0, 1]);
  });

  it.each([[undefined], [null], [''], ['  ']])('skips a match whose uid is %p', async (uid) => {
    const { opened } = pagesReading([[{ uid, name: 'site' }], [{ uid: 'c', name: 'site' }]]);

    await expect(lookup(opened, { kind: 'name', name: 'site' })).resolves.toBe('c');
  });

  it('raises the caller its not-found error naming the name when nothing matches', async () => {
    const { opened } = pagesReading([[{ uid: null, name: 'site' }]]);

    await expect(lookup(opened, { kind: 'name', name: 'site' })).rejects.toThrow(new UsageError('No thing named "site".'));
  });
});
