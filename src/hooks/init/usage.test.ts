import { usageProblem } from './usage';

const NOTHING_KNOWN = (): boolean => false;

describe('usageProblem', () => {
  it.each([
    ['cm:stacks:import', ['-h']],
    ['cm:export', []],
    ['help', ['cm:stacks:import']],
    ['help', []],
    [undefined, []],
  ] as const)('leaves %p %p, which is not a launch command, to csdx', (id, argv) => {
    expect(usageProblem(id, [...argv], NOTHING_KNOWN)).toBeUndefined();
  });

  it('reads -h after -- as a value, not as a help request', () => {
    expect(usageProblem('launch:logs:get', ['--', '-h'], () => true)).toBeUndefined();
  });
});
