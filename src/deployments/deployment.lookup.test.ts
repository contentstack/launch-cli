import { FIRST_LOOKUP_ATTEMPTS, untilFound } from './deployment.lookup';

function lookupFindingOn(attempt: number | undefined) {
  const slept: number[] = [];
  let looks = 0;
  const timing = {
    pollDelayMs: 250,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };
  const lookup = async () => {
    looks += 1;
    return looks === attempt ? 'found' : undefined;
  };

  return { timing, lookup, slept, looks: () => looks };
}

describe('untilFound', () => {
  it('answers at once, without waiting, when the first look finds it', async () => {
    const { timing, lookup, slept, looks } = lookupFindingOn(1);

    await expect(untilFound(lookup, timing)).resolves.toBe('found');
    expect(looks()).toBe(1);
    expect(slept).toEqual([]);
  });

  it('waits the poll delay between looks and answers on the last allowed look', async () => {
    const { timing, lookup, slept, looks } = lookupFindingOn(FIRST_LOOKUP_ATTEMPTS);

    await expect(untilFound(lookup, timing)).resolves.toBe('found');
    expect(looks()).toBe(3);
    expect(slept).toEqual([250, 250]);
  });

  it('gives up with nothing after exactly three looks, never sleeping after the last one', async () => {
    const { timing, lookup, slept, looks } = lookupFindingOn(undefined);

    await expect(untilFound(lookup, timing)).resolves.toBeUndefined();
    expect(FIRST_LOOKUP_ATTEMPTS).toBe(3);
    expect(looks()).toBe(3);
    expect(slept).toEqual([250, 250]);
  });

  it('propagates a failed look without trying again', async () => {
    const failure = new Error('lookup refused');
    const { timing, slept } = lookupFindingOn(undefined);

    await expect(untilFound(async () => Promise.reject(failure), timing)).rejects.toBe(failure);
    expect(slept).toEqual([]);
  });
});
