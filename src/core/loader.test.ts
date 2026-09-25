import { cliux } from '@contentstack/cli-utilities';

import { silentLoader, terminalLoader } from './loader';

function fakeSpinners() {
  const calls: [string, unknown][] = [];
  const spinner = { id: 'spinner' };
  jest.spyOn(cliux, 'loaderV2').mockImplementation(((message: string, running?: unknown) => {
    calls.push([message, running]);
    return running === undefined ? spinner : undefined;
  }) as never);

  return { calls, spinner };
}

describe('terminalLoader', () => {
  it('starts one cli-utilities spinner however often it is started, and stops that spinner once', () => {
    const { calls, spinner } = fakeSpinners();
    const loader = terminalLoader();

    loader.start('Loading deployment logs...');
    loader.start('Loading deployment logs...');
    loader.stop();
    loader.stop();

    expect(calls).toEqual([
      ['Loading deployment logs...', undefined],
      ['done', spinner],
    ]);
  });

  it('starts a fresh spinner after the previous one was stopped', () => {
    const { calls, spinner } = fakeSpinners();
    const loader = terminalLoader();

    loader.start('Loading deployment logs...');
    loader.stop();
    loader.start('Loading deployment logs...');

    expect(calls).toEqual([
      ['Loading deployment logs...', undefined],
      ['done', spinner],
      ['Loading deployment logs...', undefined],
    ]);
  });
});

describe('silentLoader', () => {
  it('never draws a spinner', () => {
    const { calls } = fakeSpinners();

    silentLoader.start('Loading deployment logs...');
    silentLoader.stop();

    expect(calls).toEqual([]);
  });
});
