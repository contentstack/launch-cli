export interface TimerTracker {
  created: () => number;
  pending: () => number;
}

export function trackTimers(...delaysMs: number[]): TimerTracker {
  const created: NodeJS.Timeout[] = [];
  const settled = new Set<NodeJS.Timeout>();
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;

  jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) => {
    if (ms === undefined || !delaysMs.includes(ms)) {
      return realSet(callback, ms);
    }

    const timer: NodeJS.Timeout = realSet(() => {
      settled.add(timer);
      callback();
    }, ms);
    created.push(timer);

    return timer;
  }) as unknown as typeof setTimeout);
  jest.spyOn(global, 'clearTimeout').mockImplementation(((timer?: NodeJS.Timeout) => {
    settled.add(timer as NodeJS.Timeout);
    realClear(timer);
  }) as typeof clearTimeout);

  return { created: () => created.length, pending: () => created.filter((timer) => !settled.has(timer)).length };
}
