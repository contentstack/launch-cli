import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { LaunchApiError } from '../../../transport/errors';
import DeploymentsCancel from './cancel';

const UID = 'd1e2f3a4b5c6d7e8f9012345';
const QUESTION = `Cancel deployment "${UID}"? This cannot be undone.`;
const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1', deployment: UID };

interface Harness {
  answer?: boolean;
  isTTY?: boolean;
  outputIsTTY?: boolean;
  yes?: boolean;
  getFails?: Error;
  cancelFails?: Error;
}

function commandUnderTest(harness: Harness) {
  const lines: string[] = [];
  const inquired: unknown[] = [];
  const calls: string[] = [];
  const got: unknown[] = [];
  const cancelled: unknown[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async (payload: unknown) => {
      inquired.push(payload);
      return harness.answer as never;
    },
  };
  const command = Object.create(DeploymentsCancel.prototype) as DeploymentsCancel;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'proj1', env: 'env1', deployment: UID, yes: harness.yes ?? false },
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
          cancel: async (params: unknown) => {
            calls.push('cancel');
            cancelled.push(params);

            if (harness.cancelFails) {
              throw harness.cancelFails;
            }
          },
        },
      },
    },
  });

  return { command, lines, inquired, calls, got, cancelled };
}

describe('launch:deployments:cancel', () => {
  it('fetches the deployment, confirms that it cannot be undone, cancels it and reports it', async () => {
    const { command, lines, inquired, calls, got, cancelled } = commandUnderTest({ answer: true });

    await command.run();

    expect(inquired).toEqual([{ type: 'confirm', name: 'confirm', message: QUESTION, default: false }]);
    expect(calls).toEqual(['get', 'cancel']);
    expect(got).toEqual([SCOPE]);
    expect(cancelled).toEqual([SCOPE]);
    expect(lines).toEqual([`✔ Deployment "${UID}" cancelled.`]);
  });

  it('skips the prompt when --yes was passed and colours the success line when stdout is a terminal', async () => {
    const { command, lines, inquired, calls } = commandUnderTest({ yes: true, isTTY: false, outputIsTTY: true });

    await command.run();

    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get', 'cancel']);
    expect(lines).toEqual([`\u001b[32m✔ Deployment "${UID}" cancelled.\u001b[39m`]);
  });

  it('says it was not cancelled and exits 3 without sending the cancel when the user declines', async () => {
    const { command, lines, calls, cancelled } = commandUnderTest({ answer: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
    expect(calls).toEqual(['get']);
    expect(cancelled).toEqual([]);
    expect(lines).toEqual(['Deployment not cancelled.']);
  });

  it('exits 2 naming --yes without sending the cancel when there is no terminal', async () => {
    const { command, lines, inquired, calls, cancelled } = commandUnderTest({ isTTY: false });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(`${QUESTION} Pass --yes to confirm without an interactive terminal.`);
    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get']);
    expect(cancelled).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('turns a 404 NOT_FOUND from the lookup into the generic not-found usage error before asking', async () => {
    const missing = new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'x' }]);
    const { command, inquired, calls, cancelled } = commandUnderTest({ answer: true, getFails: missing });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(`No deployment with UID "${UID}" found in this environment.`);
    expect(inquired).toEqual([]);
    expect(calls).toEqual(['get']);
    expect(cancelled).toEqual([]);
  });

  it('propagates another failure from the lookup without asking or cancelling', async () => {
    const failure = new LaunchApiError(500, []);
    const { command, lines, calls, inquired } = commandUnderTest({ answer: true, getFails: failure });

    await expect(command.run()).rejects.toBe(failure);

    expect(calls).toEqual(['get']);
    expect(inquired).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('propagates a failure from the cancel rather than reporting a success', async () => {
    const failure = new LaunchApiError(400, [{ message: 'x' }]);
    const { command, lines, calls } = commandUnderTest({ yes: true, cancelFails: failure });

    await expect(command.run()).rejects.toBe(failure);

    expect(calls).toEqual(['get', 'cancel']);
    expect(lines).toEqual([]);
  });

  it('declares the deployment as required and opts into the confirm gate', () => {
    expect(DeploymentsCancel.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      deployment: { required: true },
      yes: {},
    });
    expect(Object.keys(DeploymentsCancel.flags).sort()).toEqual(Object.keys(DeploymentsCancel.inputs).sort());
  });
});
