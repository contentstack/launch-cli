import { CancelledError, UsageError } from '../../../core/errors';
import { UxLike } from '../../../core/render';
import { Project } from '../../../projects/types';
import ProjectsDelete from './delete';

const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';

interface Harness {
  answer?: boolean;
  isTTY?: boolean;
  yes?: boolean;
  project?: Partial<Project>;
  getFails?: Error;
  deleteFails?: Error;
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const inquired: unknown[] = [];
  const calls: string[] = [];
  const got: unknown[] = [];
  const deleted: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload);
      return harness.answer as never;
    },
  };
  const command = Object.create(ProjectsDelete.prototype) as ProjectsDelete;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: PROJECT_UID, yes: harness.yes ?? false },
    services: {
      ux,
      isTTY: harness.isTTY ?? true,
      api: {
        projects: {
          get: async (params: unknown) => {
            calls.push('get');
            got.push(params);

            if (harness.getFails) {
              throw harness.getFails;
            }

            return harness.project ?? { uid: PROJECT_UID, name: 'sample-project' };
          },
          delete: async (params: unknown) => {
            calls.push('delete');
            deleted.push(params);

            if (harness.deleteFails) {
              throw harness.deleteFails;
            }
          },
        },
      },
    },
  });

  return { command, lines, inquired, calls, got, deleted };
}

describe('launch:projects:delete', () => {
  it('confirms, deletes the resolved project and reports it by name', async () => {
    const { command, lines, inquired, calls, got, deleted } = commandUnderTest({ answer: true });

    await command.run();

    expect(inquired).toEqual([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Delete project "${PROJECT_UID}"? This cannot be undone.`,
        default: false,
      },
    ]);
    expect(calls).toEqual(['get', 'delete']);
    expect(got).toEqual([{ org: 'org1', project: PROJECT_UID }]);
    expect(deleted).toEqual([{ org: 'org1', project: PROJECT_UID }]);
    expect(lines).toEqual(['✔ Project "sample-project" deleted.']);
  });

  it('skips the prompt entirely when --yes was passed', async () => {
    const { command, lines, inquired, calls } = commandUnderTest({ yes: true, isTTY: true });

    await command.run();

    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get', 'delete']);
    expect(lines).toEqual(['✔ Project "sample-project" deleted.']);
  });

  it('exits 3 without touching the API when the user declines', async () => {
    const { command, lines, calls } = commandUnderTest({ answer: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as CancelledError;

    expect(error).toBeInstanceOf(CancelledError);
    expect(error.exitCode).toBe(3);
    expect(error.message).toBe('Cancelled. Nothing was changed.');
    expect(calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('exits 2 naming --yes without touching the API when there is no terminal to prompt on', async () => {
    const { command, lines, inquired, calls } = commandUnderTest({ isTTY: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      `Delete project "${PROJECT_UID}"? This cannot be undone. Pass --yes to confirm without an interactive terminal.`,
    );
    expect(inquired).toEqual([]);
    expect(calls).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('falls back to the resolved reference when the deleted project carried no name', async () => {
    const { command, lines } = commandUnderTest({ yes: true, project: { uid: PROJECT_UID } });

    await command.run();

    expect(lines).toEqual([`✔ Project "${PROJECT_UID}" deleted.`]);
  });

  it('propagates a failure from the lookup without deleting anything', async () => {
    const failure = new Error('lookup exploded');
    const { command, lines, calls } = commandUnderTest({ yes: true, getFails: failure });

    await expect(command.run()).rejects.toBe(failure);

    expect(calls).toEqual(['get']);
    expect(lines).toEqual([]);
  });

  it('propagates a failure from the delete rather than reporting a success', async () => {
    const failure = new Error('delete exploded');
    const { command, lines, calls } = commandUnderTest({ yes: true, deleteFails: failure });

    await expect(command.run()).rejects.toBe(failure);

    expect(calls).toEqual(['get', 'delete']);
    expect(lines).toEqual([]);
  });

  it('declares org and project as required and opts into the confirm gate', () => {
    expect(ProjectsDelete.inputs).toEqual({ org: { required: true }, project: { required: true }, yes: {} });
    expect(Object.keys(ProjectsDelete.flags).sort()).toEqual(['org', 'project', 'yes']);
    expect(Object.keys(ProjectsDelete.flags).sort()).toEqual(Object.keys(ProjectsDelete.inputs).sort());
  });

  it('declares no --json flag and no json mode', () => {
    expect(Object.keys(ProjectsDelete.flags)).not.toContain('json');
    expect((ProjectsDelete as unknown as { enableJsonFlag?: boolean }).enableJsonFlag).toBeFalsy();
  });
});
