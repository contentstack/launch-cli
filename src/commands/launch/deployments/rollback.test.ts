import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { LaunchApiError } from '../../../transport/errors';
import DeploymentsRollback from './rollback';

const UID = 'd1e2f3a4b5c6d7e8f9012345';
const QUESTION = `Roll back this environment to deployment "${UID}"?`;

interface Harness {
  answer?: boolean;
  isTTY?: boolean;
  outputIsTTY?: boolean;
  yes?: boolean;
  reason?: string;
  getFails?: Error;
  rollbackFails?: Error;
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const inquired: unknown[] = [];
  const calls: string[] = [];
  const got: unknown[] = [];
  const rolledBack: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload);
      return harness.answer as never;
    },
  };
  const command = Object.create(DeploymentsRollback.prototype) as DeploymentsRollback;

  Object.assign(command, {
    ux,
    resolved: {
      org: 'org1',
      project: 'proj1',
      env: 'env1',
      deployment: UID,
      reason: harness.reason,
      yes: harness.yes ?? false,
    },
    services: {
      ux,
      isTTY: harness.isTTY ?? true,
      outputIsTTY: harness.outputIsTTY ?? false,
      api: {
        deployments: {
          get: async (params: unknown) => {
            calls.push('get');
            got.push(params);

            if (harness.getFails) {
              throw harness.getFails;
            }

            return { uid: UID };
          },
          rollback: async (params: unknown) => {
            calls.push('rollback');
            rolledBack.push(params);

            if (harness.rollbackFails) {
              throw harness.rollbackFails;
            }
          },
        },
      },
    },
  });

  return { command, lines, inquired, calls, got, rolledBack };
}

describe('launch:deployments:rollback', () => {
  it('fetches the deployment, confirms, rolls back with the reason and reports it', async () => {
    const { command, lines, inquired, calls, got, rolledBack } = commandUnderTest({
      answer: true,
      reason: 'bad release',
    });

    await command.run();

    expect(inquired).toEqual([{ type: 'confirm', name: 'confirm', message: QUESTION, default: false }]);
    expect(calls).toEqual(['get', 'rollback']);
    expect(got).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', deployment: UID }]);
    expect(rolledBack).toEqual([
      { org: 'org1', project: 'proj1', environment: 'env1', deployment: UID, reason: 'bad release' },
    ]);
    expect(lines).toEqual([`✔ Rolled back to deployment "${UID}"`]);
  });

  it('skips the prompt when --yes was passed and colours the success line when stdout is a terminal', async () => {
    const { command, lines, inquired, calls } = commandUnderTest({ yes: true, isTTY: false, outputIsTTY: true });

    await command.run();

    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get', 'rollback']);
    expect(lines).toEqual([`\u001b[32m✔ Rolled back to deployment "${UID}"\u001b[39m`]);
  });

  it('hands an absent reason to the api as undefined', async () => {
    const { command, rolledBack } = commandUnderTest({ yes: true });

    await command.run();

    expect(rolledBack).toEqual([{ org: 'org1', project: 'proj1', environment: 'env1', deployment: UID, reason: undefined }]);
  });

  it('says it was not rolled back and exits 3 without sending the rollback when the user declines', async () => {
    const { command, lines, calls, rolledBack } = commandUnderTest({ answer: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(calls).toEqual(['get']);
    expect(rolledBack).toEqual([]);
    expect(lines).toEqual(['Deployment not rolled back.']);
  });

  it('exits 2 naming --yes without sending the rollback when there is no terminal', async () => {
    const { command, lines, inquired, calls, rolledBack } = commandUnderTest({ isTTY: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(`${QUESTION} Pass --yes to confirm without an interactive terminal.`);
    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get']);
    expect(rolledBack).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('turns a 404 NOT_FOUND from the lookup into the generic not-found usage error before asking', async () => {
    const missing = new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'x' }]);
    const { command, inquired, calls, rolledBack } = commandUnderTest({ answer: true, getFails: missing });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(`No deployment with UID "${UID}" found in this environment.`);
    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get']);
    expect(rolledBack).toEqual([]);
  });

  it('propagates another failure from the lookup without asking or rolling back', async () => {
    const failure = new LaunchApiError(500, []);
    const { command, lines, calls, inquired } = commandUnderTest({ answer: true, getFails: failure });

    await expect(command.run()).rejects.toBe(failure);

    expect(calls).toEqual(['get']);
    expect(inquired).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('propagates a failure from the rollback rather than reporting a success', async () => {
    const failure = new LaunchApiError(409, [{ code: 'launch.DEPLOYMENT.ROLLBACK_NOT_ELIGIBLE', message: 'x' }]);
    const { command, lines, calls } = commandUnderTest({ yes: true, rollbackFails: failure });

    await expect(command.run()).rejects.toBe(failure);

    expect(calls).toEqual(['get', 'rollback']);
    expect(lines).toEqual([]);
  });

  it('declares the deployment as required, reason optional and opts into the confirm gate', () => {
    expect(DeploymentsRollback.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      deployment: { required: true },
      reason: {},
      yes: {},
    });
    expect(Object.keys(DeploymentsRollback.flags).sort()).toEqual(Object.keys(DeploymentsRollback.inputs).sort());
  });
});
