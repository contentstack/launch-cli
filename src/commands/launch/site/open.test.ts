import { randomBytes } from 'node:crypto';

import { UsageError } from '../../../core/errors';
import type { UxLike } from '../../../core/prompt';
import { DEPLOYMENT_ERROR_MESSAGES } from '../../../deployments/deployment.errors';
import { ENVIRONMENT_ERROR_MESSAGES } from '../../../environments/environment.errors';
import { LaunchApiError } from '../../../transport/errors';
import SiteOpen from './open';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };
const DEPLOYMENT_UID = randomBytes(12).toString('hex');
const DEPLOYMENT_SCOPE = { ...SCOPE, deployment: DEPLOYMENT_UID };
const PREVIEW_URL = 'https://preview-1a2b.contentstackapps.com';
const LIVE_URL = 'https://my-site.contentstackapps.com';

interface Harness {
  outputIsTTY?: boolean;
  withoutOpener?: boolean;
  environment?: unknown;
  environmentFails?: Error;
  latest?: unknown;
  latestFails?: Error;
  deployment?: string;
  fetched?: unknown;
  fetchFails?: Error;
}

function commandUnderTest(harness: Harness = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[] = [];
  const got: unknown[] = [];
  const opened: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      stdout.push(message);
    },
    inquire: async () => undefined as never,
  };
  const command = Object.create(SiteOpen.prototype) as SiteOpen;

  Object.assign(command, {
    ux,
    resolved: { org: 'org1', project: 'proj1', env: 'env1', deployment: harness.deployment },
    services: {
      ux,
      isTTY: false,
      outputIsTTY: harness.outputIsTTY ?? true,
      openUrl: harness.withoutOpener ? undefined : (url: string) => opened.push(url),
      api: {
        environments: {
          get: async (params: unknown) => {
            calls.push('environments.get');
            got.push(params);

            if (harness.environmentFails) {
              throw harness.environmentFails;
            }

            return harness.environment ?? { uid: 'env1', domains: [] };
          },
        },
        deployments: {
          get: async (params: unknown) => {
            calls.push('deployments.get');
            got.push(params);

            if (harness.fetchFails) {
              throw harness.fetchFails;
            }

            return harness.fetched;
          },
          latest: async (params: unknown) => {
            calls.push('deployments.latest');
            got.push(params);

            if (harness.latestFails) {
              throw harness.latestFails;
            }

            return 'latest' in harness ? harness.latest : { uid: 'd1', deploymentUrl: LIVE_URL };
          },
        },
      },
    },
  });

  jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });

  return { command, stdout, stderr, calls, got, opened };
}

async function exitCodeOf(run: Promise<void>): Promise<number | undefined> {
  const error = (await run.catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

  return error.oclif?.exit;
}

describe('launch:site:open', () => {
  it('reads the environment, then the latest deployment, and opens the deployment url on a terminal', async () => {
    const { command, stdout, calls, got, opened } = commandUnderTest();

    await command.run();

    expect(calls).toEqual(['environments.get', 'deployments.latest']);
    expect(got).toEqual([SCOPE, SCOPE]);
    expect(stdout).toEqual([`\u001b[32m✔ Opening ${LIVE_URL} in your browser...\u001b[39m`]);
    expect(opened).toEqual([LIVE_URL]);
  });

  it("falls back to the environment's domains when the latest deployment has no url", async () => {
    const { command, opened } = commandUnderTest({
      environment: { uid: 'env1', domains: [{ url: 'www.example.com' }] },
      latest: { uid: 'd1', status: 'LIVE' },
    });

    await command.run();

    expect(opened).toEqual(['https://www.example.com']);
  });

  it('prints only the bare url and starts no browser when stdout is not a terminal', async () => {
    const { command, stdout, stderr, opened } = commandUnderTest({ outputIsTTY: false });

    await command.run();

    expect(stdout).toEqual([LIVE_URL]);
    expect(stderr).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('still prints the opening line when no browser opener is available', async () => {
    const { command, stdout, opened } = commandUnderTest({ withoutOpener: true });

    await command.run();

    expect(stdout).toEqual([`\u001b[32m✔ Opening ${LIVE_URL} in your browser...\u001b[39m`]);
    expect(opened).toEqual([]);
  });

  it('says the website url was not found in yellow on stdout and exits 2 when there is no deployment on a terminal', async () => {
    const { command, stdout, stderr, opened } = commandUnderTest({
      environment: { uid: 'env1', domains: [{ url: 'https://www.example.com' }] },
      latest: undefined,
    });

    const code = await exitCodeOf(command.run());

    expect(code).toBe(2);
    expect(stdout).toEqual(['\u001b[33mWebsite URL not found.\u001b[39m']);
    expect(stderr).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('writes the plain message to stderr, nothing to stdout, and exits 2 when there is no deployment and no terminal', async () => {
    const { command, stdout, stderr, opened } = commandUnderTest({ outputIsTTY: false, latest: undefined });

    const code = await exitCodeOf(command.run());

    expect(code).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Website URL not found.\n']);
    expect(opened).toEqual([]);
  });

  it('exits 2 when the deployment and the environment between them have no url', async () => {
    const { command, stdout, opened } = commandUnderTest({ latest: { uid: 'd1' } });

    const code = await exitCodeOf(command.run());

    expect(code).toBe(2);
    expect(stdout).toEqual(['\u001b[33mWebsite URL not found.\u001b[39m']);
    expect(opened).toEqual([]);
  });

  it('reports an environment the project does not have as a usage error in the api wording, reading no deployment', async () => {
    const notFound = new LaunchApiError(404, [{ code: 'launch.ENVIRONMENT.NOT_FOUND' }], ENVIRONMENT_ERROR_MESSAGES);
    const { command, calls, stdout, opened } = commandUnderTest({ environmentFails: notFound });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('No environment found with that name or UID.');
    expect(calls).toEqual(['environments.get']);
    expect(stdout).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('propagates any other failure reading the environment untouched, reading no deployment', async () => {
    const failure = new LaunchApiError(500, []);
    const { command, calls, stdout, opened } = commandUnderTest({ environmentFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(failure.exitCode).toBe(1);
    expect(calls).toEqual(['environments.get']);
    expect(stdout).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('propagates a failure reading the latest deployment and prints and opens nothing', async () => {
    const failure = new LaunchApiError(502, []);
    const { command, stdout, stderr, opened } = commandUnderTest({ latestFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(failure.exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("opens the named deployment's preview url, not its deployment url, reading the environment first and never the latest", async () => {
    const { command, stdout, calls, got, opened } = commandUnderTest({
      deployment: DEPLOYMENT_UID,
      fetched: { uid: DEPLOYMENT_UID, deploymentUrl: LIVE_URL, previewUrl: 'preview-1a2b.contentstackapps.com' },
      environment: { uid: 'env1', domains: [{ url: 'https://www.example.com' }] },
    });

    await command.run();

    expect(calls).toEqual(['environments.get', 'deployments.get']);
    expect(got).toEqual([SCOPE, DEPLOYMENT_SCOPE]);
    expect(stdout).toEqual([`\u001b[32m✔ Opening ${PREVIEW_URL} in your browser...\u001b[39m`]);
    expect(opened).toEqual([PREVIEW_URL]);
  });

  it('prints only the preview url and starts no browser for a named deployment when stdout is not a terminal', async () => {
    const { command, stdout, stderr, opened } = commandUnderTest({
      outputIsTTY: false,
      deployment: DEPLOYMENT_UID,
      fetched: { uid: DEPLOYMENT_UID, previewUrl: PREVIEW_URL },
    });

    await command.run();

    expect(stdout).toEqual([PREVIEW_URL]);
    expect(stderr).toEqual([]);
    expect(opened).toEqual([]);
  });

  it.each([['absent', undefined], ['empty', ''], ['whitespace only', '   ']])(
    'says the website url was not found in yellow on stdout and exits 2 when the named deployment has a %s preview url',
    async (_label, previewUrl) => {
      const { command, stdout, stderr, calls, got, opened } = commandUnderTest({
        deployment: DEPLOYMENT_UID,
        fetched: { uid: DEPLOYMENT_UID, deploymentUrl: LIVE_URL, ...(previewUrl === undefined ? {} : { previewUrl }) },
        environment: { uid: 'env1', domains: [{ url: 'https://www.example.com' }] },
      });

      const code = await exitCodeOf(command.run());

      expect(code).toBe(2);
      expect(stdout).toEqual(['\u001b[33mWebsite URL not found.\u001b[39m']);
      expect(stderr).toEqual([]);
      expect(opened).toEqual([]);
      expect(calls).toEqual(['environments.get', 'deployments.get']);
      expect(got).toEqual([SCOPE, DEPLOYMENT_SCOPE]);
    },
  );

  it('writes the plain message to stderr, nothing to stdout, and exits 2 for a named deployment without a preview url and no terminal', async () => {
    const { command, stdout, stderr, opened } = commandUnderTest({
      outputIsTTY: false,
      deployment: DEPLOYMENT_UID,
      fetched: { uid: DEPLOYMENT_UID, deploymentUrl: LIVE_URL },
    });

    const code = await exitCodeOf(command.run());

    expect(code).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Website URL not found.\n']);
    expect(opened).toEqual([]);
  });

  it('reports a deployment the environment does not have as a usage error in the api wording, printing and opening nothing', async () => {
    const notFound = new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND' }], DEPLOYMENT_ERROR_MESSAGES);
    const { command, calls, stdout, stderr, opened } = commandUnderTest({
      deployment: DEPLOYMENT_UID,
      fetchFails: notFound,
    });

    const error = (await command.run().catch((thrown: unknown) => thrown)) as UsageError;

    expect(error).toBeInstanceOf(UsageError);
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('No deployment found with that UID.');
    expect(calls).toEqual(['environments.get', 'deployments.get']);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('propagates any other failure reading the named deployment untouched, printing and opening nothing', async () => {
    const failure = new LaunchApiError(500, []);
    const { command, calls, stdout, stderr, opened } = commandUnderTest({
      deployment: DEPLOYMENT_UID,
      fetchFails: failure,
    });

    await expect(command.run()).rejects.toBe(failure);
    expect(failure.exitCode).toBe(1);
    expect(calls).toEqual(['environments.get', 'deployments.get']);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('reads no deployment when the environment is missing, even with --deployment', async () => {
    const failure = new LaunchApiError(500, []);
    const { command, calls } = commandUnderTest({ deployment: DEPLOYMENT_UID, environmentFails: failure });

    await expect(command.run()).rejects.toBe(failure);
    expect(calls).toEqual(['environments.get']);
  });

  it('declares org, project and env as required inputs and --deployment as optional', () => {
    expect(SiteOpen.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      env: { required: true },
      deployment: {},
    });
  });
});
