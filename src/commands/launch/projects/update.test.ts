import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { resolveInputs } from '../../../core/resolve';
import type { ApiSurface } from '../../../resources';
import type { Project } from '../../../projects/types';
import ProjectsUpdate from './update';

const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';

interface Terminal {
  answers: unknown[];
  current?: Partial<Project>;
  outputIsTTY?: boolean;
}

function commandUnderTest(
  resolved: Record<string, unknown>,
  updated?: Partial<Project>,
  failure?: Error,
  terminal?: Terminal,
) {
  const lines: string[] = [];
  const sent: unknown[] = [];
  const asked: unknown[] = [];
  const fetched: unknown[] = [];
  const answers = [...(terminal?.answers ?? [])];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      asked.push(payload);
      return answers.shift() as never;
    },
  };
  const command = Object.create(ProjectsUpdate.prototype) as ProjectsUpdate;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: PROJECT_UID, ...resolved },
    services: {
      ux,
      isTTY: terminal !== undefined,
      outputIsTTY: terminal?.outputIsTTY ?? false,
      api: {
        projects: {
          get: async (params: unknown) => {
            fetched.push(params);

            return terminal?.current ?? { uid: PROJECT_UID, name: 'test', description: 'old blurb' };
          },
          update: async (params: unknown) => {
            sent.push(params);

            if (failure) {
              throw failure;
            }

            return updated ?? { uid: PROJECT_UID, name: 'Renamed Site' };
          },
        },
      },
    },
  });

  return { command, lines, sent, asked, fetched };
}

function fakeServices() {
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };
  return { api: {} as ApiSurface, ux, isTTY: false };
}

describe('launch:projects:update', () => {
  it('sends only the name it was given and reports success', async () => {
    const { command, lines, sent } = commandUnderTest({ name: 'Renamed Site', description: undefined });

    await command.run();

    expect(sent).toEqual([{ org: 'org1', project: PROJECT_UID, update: { name: 'Renamed Site' } }]);
    expect(lines).toEqual(['✔ Project updated successfully.']);
  });

  it('sends only the description it was given and reports success', async () => {
    const { command, lines, sent } = commandUnderTest(
      { name: undefined, description: 'A new blurb' },
      {
        uid: PROJECT_UID,
        name: 'sample-project',
        description: 'A new blurb',
      },
    );

    await command.run();

    expect(sent).toEqual([{ org: 'org1', project: PROJECT_UID, update: { description: 'A new blurb' } }]);
    expect(lines).toEqual(['✔ Project updated successfully.']);
  });

  it('sends both fields and reports success once when both were given', async () => {
    const { command, lines, sent } = commandUnderTest(
      { name: 'Renamed Site', description: 'A new blurb' },
      {
        uid: PROJECT_UID,
        name: 'Renamed Site',
        description: 'A new blurb',
      },
    );

    await command.run();

    expect(sent).toEqual([
      { org: 'org1', project: PROJECT_UID, update: { name: 'Renamed Site', description: 'A new blurb' } },
    ]);
    expect(lines).toEqual(['✔ Project updated successfully.']);
  });

  it('shows the success line in green only when output is a terminal', async () => {
    const { command, lines } = commandUnderTest({ name: undefined, description: undefined }, undefined, undefined, {
      answers: ['test-renamed', ''],
      outputIsTTY: true,
    });

    await command.run();

    expect(lines).toEqual(['\u001b[32m✔ Project updated successfully.\u001b[39m']);
  });

  it('propagates an API failure rather than reporting an update that did not happen', async () => {
    const failure = new Error('update exploded');
    const { command, lines } = commandUnderTest({ name: 'Renamed Site' }, undefined, failure);

    await expect(command.run()).rejects.toBe(failure);

    expect(lines).toEqual([]);
  });

  it('exits 2 without prompting or sending when no field was supplied and there is no terminal', async () => {
    const { command, sent, asked } = commandUnderTest({ name: undefined, description: undefined });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('Pass at least one of --name, --description; none was supplied.');
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('prompts for both fields in a terminal and sends only the name when only the name was typed', async () => {
    const { command, lines, sent, asked } = commandUnderTest(
      { name: undefined, description: undefined },
      { uid: PROJECT_UID, name: 'test-renamed' },
      undefined,
      { answers: ['test-renamed', ''] },
    );

    await command.run();

    expect(asked).toHaveLength(2);
    expect(sent).toEqual([{ org: 'org1', project: PROJECT_UID, update: { name: 'test-renamed' } }]);
    expect(lines).toEqual(['✔ Project updated successfully.']);
  });

  it('sends only the description when only the description was typed in a terminal', async () => {
    const { command, lines, sent } = commandUnderTest(
      { name: undefined, description: undefined },
      { uid: PROJECT_UID, name: 'test', description: 'Marketing site for Q4' },
      undefined,
      { answers: ['', 'Marketing site for Q4'] },
    );

    await command.run();

    expect(sent).toEqual([{ org: 'org1', project: PROJECT_UID, update: { description: 'Marketing site for Q4' } }]);
    expect(lines).toEqual(['✔ Project updated successfully.']);
  });

  it('sends only --name without prompting for the description or fetching the project in a terminal', async () => {
    const { command, lines, sent, asked, fetched } = commandUnderTest(
      { name: 'Renamed Site', description: undefined },
      undefined,
      undefined,
      { answers: [] },
    );

    await command.run();

    expect(asked).toEqual([]);
    expect(fetched).toEqual([]);
    expect(sent).toEqual([
      { org: 'org1', project: PROJECT_UID, update: { name: 'Renamed Site', description: undefined } },
    ]);
    expect(lines).toEqual(['✔ Project updated successfully.']);
  });

  it('sends only --description without prompting for the name or fetching the project in a terminal', async () => {
    const { command, lines, sent, asked, fetched } = commandUnderTest(
      { name: undefined, description: 'A new blurb' },
      undefined,
      undefined,
      { answers: [] },
    );

    await command.run();

    expect(asked).toEqual([]);
    expect(fetched).toEqual([]);
    expect(sent).toEqual([
      { org: 'org1', project: PROJECT_UID, update: { name: undefined, description: 'A new blurb' } },
    ]);
    expect(lines).toEqual(['✔ Project updated successfully.']);
  });

  it('does not prompt or fetch the project when every field was supplied as a flag', async () => {
    const { command, sent, asked, fetched } = commandUnderTest(
      { name: 'Renamed Site', description: 'A new blurb' },
      undefined,
      undefined,
      { answers: [] },
    );

    await command.run();

    expect(asked).toEqual([]);
    expect(fetched).toEqual([]);
    expect(sent).toEqual([
      { org: 'org1', project: PROJECT_UID, update: { name: 'Renamed Site', description: 'A new blurb' } },
    ]);
  });

  it('does not prompt for the missing field without a terminal', async () => {
    const { command, sent, asked, fetched } = commandUnderTest({ name: 'Renamed Site', description: undefined });

    await command.run();

    expect(asked).toEqual([]);
    expect(fetched).toEqual([]);
    expect(sent).toEqual([
      { org: 'org1', project: PROJECT_UID, update: { name: 'Renamed Site', description: undefined } },
    ]);
  });

  it('sends nothing and says the project was not updated when both prompts were left blank', async () => {
    const { command, lines, sent } = commandUnderTest(
      { name: undefined, description: undefined },
      undefined,
      undefined,
      {
        answers: ['', ''],
      },
    );

    await command.run();

    expect(sent).toEqual([]);
    expect(lines).toEqual(['Project not updated. No changes were entered.']);
  });

  it('treats retyping the current values as no change', async () => {
    const { command, lines, sent } = commandUnderTest(
      { name: undefined, description: undefined },
      undefined,
      undefined,
      {
        answers: ['test', 'old blurb'],
      },
    );

    await command.run();

    expect(sent).toEqual([]);
    expect(lines).toEqual(['Project not updated. No changes were entered.']);
  });

  it('shows the not-updated notice in yellow only when output is a terminal', async () => {
    const { command, lines } = commandUnderTest({ name: undefined, description: undefined }, undefined, undefined, {
      answers: ['', ''],
      outputIsTTY: true,
    });

    await command.run();

    expect(lines).toEqual(['\u001b[33mProject not updated. No changes were entered.\u001b[39m']);
  });

  it('accepts a resolution carrying only one of the two updatable fields', async () => {
    await expect(
      resolveInputs(ProjectsUpdate.inputs, {
        parsed: { org: 'org1', project: PROJECT_UID, description: 'A new blurb' },
        projectConfig: {},
        services: fakeServices(),
      }),
    ).resolves.toMatchObject({ description: 'A new blurb', name: undefined });
  });

  it('rejects a name over the server limit as a usage error before sending', async () => {
    const error = (await resolveInputs(ProjectsUpdate.inputs, {
      parsed: { org: 'org1', project: PROJECT_UID, name: 'n'.repeat(201) },
      projectConfig: {},
      services: fakeServices(),
    }).catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('--name must be 200 characters or fewer; that value is 201 characters.');
  });

  it('declares org and project as required, name and description as optional', () => {
    expect(ProjectsUpdate.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      name: {},
      description: {},
    });
    expect(Object.keys(ProjectsUpdate.flags).sort()).toEqual(['description', 'name', 'org', 'project']);
    expect(Object.keys(ProjectsUpdate.flags).sort()).toEqual(Object.keys(ProjectsUpdate.inputs).sort());
  });

  it('declares no --json flag and no json mode', () => {
    expect(Object.keys(ProjectsUpdate.flags)).not.toContain('json');
    expect((ProjectsUpdate as unknown as { enableJsonFlag?: boolean }).enableJsonFlag).toBeFalsy();
  });
});
