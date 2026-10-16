import type { UxLike } from '../../../core/prompt';
import EnvironmentsList from './list';

function commandUnderTest(
  page: unknown,
  resolved: Record<string, unknown> = { org: 'org1', project: 'proj1', limit: 50, skip: 0 },
  answer: () => Promise<unknown> = async () => page,
) {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async () => undefined as never,
  };
  const listed: unknown[] = [];
  const command = Object.create(EnvironmentsList.prototype) as EnvironmentsList;

  Object.assign(command, {
    ux,
    resolved,
    services: {
      ux,
      isTTY: false,
      api: {
        environments: {
          list: async (params: unknown) => {
            listed.push(params);
            return answer();
          },
        },
      },
    },
  });

  return { command, lines, listed };
}

describe('launch:env:list', () => {
  it('lists the project environments as a table with a pagination footer', async () => {
    const { command, lines, listed } = commandUnderTest({
      pagination: { count: 1, limit: 50, skip: 0 },
      environments: [
        {
          uid: 'e1',
          name: 'production',
          gitBranch: 'main',
          domains: [{ url: 'https://a.io' }],
          updatedAt: '2026-09-01',
        },
      ],
    });

    await command.run();

    expect(listed).toEqual([{ org: 'org1', project: 'proj1', limit: 50, skip: 0 }]);
    expect(lines[1]).toBe('│  NAME        │  BRANCH  │  URL           │  UPDATED     │  UID  │');
    expect(lines[3]).toBe('│  production  │  main    │  https://a.io  │  2026-09-01  │  e1   │');
    expect(lines[5]).toBe('Showing 1-1 of 1');
  });

  it('shows the first domain that carries a url, skipping domains without one', async () => {
    const { command, lines } = commandUnderTest({
      pagination: { count: 1, limit: 50, skip: 0 },
      environments: [
        {
          uid: 'e1',
          name: 'production',
          gitBranch: 'main',
          domains: [{}, { url: '' }, { url: 'https://a.io' }, { url: 'https://b.io' }],
          updatedAt: '2026-09-01',
        },
      ],
    });

    await command.run();

    expect(lines[3]).toBe('│  production  │  main    │  https://a.io  │  2026-09-01  │  e1   │');
  });

  it.each([[{}], [{ domains: [] }], [{ domains: [{ url: '  ' }] }]])(
    'renders a placeholder in every cell of an environment row carrying none of its fields (%p)',
    async (environment) => {
      const { command, lines } = commandUnderTest({ pagination: { count: 1, limit: 50, skip: 0 }, environments: [environment] });

      await command.run();

      expect(lines[1]).toBe('│  NAME  │  BRANCH  │  URL  │  UPDATED  │  UID  │');
      expect(lines[3]).toBe('│  -     │  -       │  -    │  -        │  -    │');
    },
  );

  it('prints only the empty-table placeholder and no pagination footer for an empty page', async () => {
    const { command, lines } = commandUnderTest({ pagination: { count: 0, limit: 50, skip: 0 }, environments: [] });

    await command.run();

    expect(lines).toEqual(['No records found.']);
  });

  it('passes a non-default limit and skip through to the api and numbers the footer from the requested skip', async () => {
    const { command, lines, listed } = commandUnderTest(
      { pagination: { count: 120, limit: 10, skip: null }, environments: [{ uid: 'e1', name: 'production' }] },
      { org: 'org1', project: 'proj1', limit: 10, skip: 20 },
    );

    await command.run();

    expect(listed).toEqual([{ org: 'org1', project: 'proj1', limit: 10, skip: 20 }]);
    expect(lines[lines.length - 1]).toBe('Showing 21-21 of 120');
  });

  it('propagates a failed list request', async () => {
    const failure = new Error('list failed');
    const { command } = commandUnderTest(undefined, undefined, async () => Promise.reject(failure));

    await expect(command.run()).rejects.toBe(failure);
  });

  it('declares org and project as required and limit and skip as optional', () => {
    expect(EnvironmentsList.inputs).toEqual({ org: { required: true }, project: { required: true }, limit: {}, skip: {} });
    expect(Object.keys(EnvironmentsList.flags).sort()).toEqual(['limit', 'org', 'project', 'skip']);
    expect(Object.keys(EnvironmentsList.flags).sort()).toEqual(Object.keys(EnvironmentsList.inputs).sort());
  });
});
