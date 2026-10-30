import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LaunchError } from '../core/errors';
import { UsageError } from '../core/errors';
import type { ServiceContext } from '../core/service-context';
import type { ApiSurface } from '../resources';
import { LaunchApiError } from '../transport/errors';
import type { CreateDeploymentRequest } from './deployment.create';
import { DeploymentCreator } from './deployment.create';
import { DeploymentUnsuccessfulError, DeploymentWaitInterruptedError } from './deployment.errors';
import { PICK_COMMIT } from './deployment.inputs';
import type { DeploymentOutcome, WatchTiming } from './deployment.watcher';
import type { Deployment } from './types';

const ORG = `blt${randomBytes(8).toString('hex')}`;
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');
const DEPLOYMENT = randomBytes(12).toString('hex');
const SHA = randomBytes(20).toString('hex');
const MISSING_DIR = join(tmpdir(), `launch-no-such-dir-${randomBytes(6).toString('hex')}`);

const BASE: CreateDeploymentRequest = {
  org: ORG,
  project: PROJECT,
  environment: ENVIRONMENT,
  dataDir: MISSING_DIR,
  configPath: join(MISSING_DIR, '.cs-launch.json'),
  lastUpload: false,
};

class FakeSignals {
  readonly listeners: (() => void)[] = [];
  readonly registered: string[] = [];

  on(signal: 'SIGINT', listener: () => void): void {
    this.registered.push(signal);
    this.listeners.push(listener);
  }

  removeListener(_signal: 'SIGINT', listener: () => void): void {
    const index = this.listeners.indexOf(listener);

    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  interrupt(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

interface Harness {
  creator: DeploymentCreator;
  signals: FakeSignals;
  created: unknown[];
  methods: string[];
  signedUrlCalls: unknown[];
  fetched: unknown[];
  watched: { scope: unknown; stop?: AbortSignal }[];
  announced: Deployment[];
  picked: unknown[];
  printed: string[];
}

function harness(
  options: {
    projectType?: string;
    outcome?: DeploymentOutcome | (() => Promise<DeploymentOutcome>);
    watch?: (scope: unknown, stop?: AbortSignal) => Promise<DeploymentOutcome>;
    createFails?: Error;
    projectFails?: Error;
    announceFails?: Error;
    pick?: () => Promise<string>;
  } = {},
): Harness {
  const created: unknown[] = [];
  const methods: string[] = [];
  const signedUrlCalls: unknown[] = [];
  const fetched: unknown[] = [];
  const watched: { scope: unknown; stop?: AbortSignal }[] = [];
  const announced: Deployment[] = [];
  const picked: unknown[] = [];
  const printed: string[] = [];
  const signals = new FakeSignals();

  const api = {
    projects: {
      get: async (params: unknown) => {
        fetched.push(params);

        if (options.projectFails !== undefined) {
          throw options.projectFails;
        }

        return { uid: PROJECT, projectType: options.projectType ?? 'GITPROVIDER' };
      },
    },
    deployments: {
      create: async (params: unknown) => {
        methods.push('create');
        created.push(params);

        if (options.createFails !== undefined) {
          throw options.createFails;
        }

        return { uid: DEPLOYMENT, status: 'QUEUED' };
      },
    },
    uploads: {
      signedUploadUrl: async (params: unknown) => {
        signedUrlCalls.push(params);
        throw new Error('no upload expected');
      },
    },
  } as unknown as ApiSurface;

  const services: ServiceContext = {
    api,
    ux: { print: (message: string) => printed.push(message), inquire: async () => undefined as never },
    isTTY: false,
    outputIsTTY: false,
  };

  const timing: WatchTiming = {
    sleep: async () => undefined,
    now: () => 0,
    pollDelayMs: 1,
    maxBackoffSteps: 1,
    timeoutMs: 1,
  };

  const follower = {
    watch: async (scope: unknown, stop?: AbortSignal): Promise<DeploymentOutcome> => {
      watched.push({ scope, stop });

      if (options.watch !== undefined) {
        return options.watch(scope, stop);
      }

      const outcome = options.outcome ?? { kind: 'success', status: 'LIVE', deployment: { uid: DEPLOYMENT, status: 'LIVE' } };

      return typeof outcome === 'function' ? outcome() : outcome;
    },
    announceLive: async (deployment: Deployment) => {
      if (options.announceFails !== undefined) {
        throw options.announceFails;
      }

      announced.push(deployment);
    },
  };

  const creator = new DeploymentCreator(services, timing, {
    pickCommit: async (scope) => {
      picked.push(scope);

      return options.pick === undefined ? SHA : options.pick();
    },
    signals,
    follower,
  });

  return { creator, signals, created, methods, signedUrlCalls, fetched, watched, announced, picked, printed };
}

async function failureOf(run: Promise<unknown>): Promise<Error> {
  return run.then(
    () => {
      throw new Error('expected the creation to fail');
    },
    (error: Error) => error,
  );
}

describe('DeploymentCreator on a GitHub project', () => {
  it('deploys the branch tip with a body of only the environment, then follows the new deployment and announces it live', async () => {
    const { creator, created, fetched, watched, announced, picked, signedUrlCalls, signals } = harness();

    await creator.create(BASE);

    expect(fetched).toEqual([{ org: ORG, project: PROJECT }]);
    expect(created).toEqual([{ org: ORG, project: PROJECT, environment: ENVIRONMENT }]);
    expect(Object.keys(created[0] as object)).not.toContain('commitHash');
    expect(Object.keys(created[0] as object)).not.toContain('uploadUid');
    expect(watched.map((entry) => entry.scope)).toEqual([
      { org: ORG, project: PROJECT, environment: ENVIRONMENT, deployment: DEPLOYMENT },
    ]);
    expect(announced).toEqual([{ uid: DEPLOYMENT, status: 'LIVE' }]);
    expect(picked).toEqual([]);
    expect(signedUrlCalls).toEqual([]);
    expect(signals.listeners).toEqual([]);
  });

  it('deploys the commit named by --commit and never asks the picker', async () => {
    const { creator, created, picked } = harness();

    await creator.create({ ...BASE, commit: SHA });

    expect(created).toEqual([{ org: ORG, project: PROJECT, environment: ENVIRONMENT, commitHash: SHA }]);
    expect(picked).toEqual([]);
  });

  it('deploys the commit the picker answers for a bare --commit, handing the picker the full scope', async () => {
    const answer = randomBytes(20).toString('hex');
    const { creator, created, picked } = harness({ pick: async () => answer });

    await creator.create({ ...BASE, commit: PICK_COMMIT });

    expect(picked).toEqual([{ org: ORG, project: PROJECT, environment: ENVIRONMENT }]);
    expect(created).toEqual([{ org: ORG, project: PROJECT, environment: ENVIRONMENT, commitHash: answer }]);
  });

  it('creates nothing when the picker refuses, passing its error through unchanged', async () => {
    const refusal = new UsageError('Pass --commit <sha>.');
    const { creator, created } = harness({
      pick: async () => {
        throw refusal;
      },
    });

    const failure = await failureOf(creator.create({ ...BASE, commit: PICK_COMMIT }));

    expect(failure).toBe(refusal);
    expect(created).toEqual([]);
  });

  it('refuses --last-upload with exit 2 naming --commit and creates nothing', async () => {
    const { creator, created, watched } = harness();

    const failure = await failureOf(creator.create({ ...BASE, lastUpload: true }));

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as LaunchError).exitCode).toBe(2);
    expect(failure.message).toContain('--last-upload');
    expect(failure.message).toContain('--commit <sha>');
    expect(created).toEqual([]);
    expect(watched).toEqual([]);
  });
});

describe('DeploymentCreator on a FileUpload project', () => {
  const FILE = { projectType: 'FILEUPLOAD' };

  it.each([
    ['a sha', SHA],
    ['a bare --commit', PICK_COMMIT],
  ])('refuses %s with exit 2 naming --last-upload, asking and sending nothing', async (_label, commit) => {
    const { creator, created, picked, signedUrlCalls } = harness(FILE);

    const failure = await failureOf(creator.create({ ...BASE, commit }));

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as LaunchError).exitCode).toBe(2);
    expect(failure.message).toContain('--commit');
    expect(failure.message).toContain('--last-upload');
    expect(created).toEqual([]);
    expect(picked).toEqual([]);
    expect(signedUrlCalls).toEqual([]);
  });

  it('redeploys the last bundle with a body of only the environment and makes no signed-url call', async () => {
    const { creator, created, signedUrlCalls, printed } = harness(FILE);

    await creator.create({ ...BASE, lastUpload: true });

    expect(created).toEqual([{ org: ORG, project: PROJECT, environment: ENVIRONMENT }]);
    expect(Object.keys(created[0] as object)).not.toContain('uploadUid');
    expect(signedUrlCalls).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('refuses a missing project directory naming the path and both ways out, --data-dir and --last-upload', async () => {
    const { creator, created, signedUrlCalls } = harness(FILE);

    const failure = await failureOf(creator.create(BASE));

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as LaunchError).exitCode).toBe(2);
    expect(failure.message).toBe(
      `No files to upload were found in "${MISSING_DIR}". ` +
        'Use --data-dir to point to your project folder, or --last-upload to redeploy the last upload.',
    );
    expect(created).toEqual([]);
    expect(signedUrlCalls).toEqual([]);
  });
});

describe('DeploymentCreator on a FileUpload project whose archive is refused for another reason', () => {
  it('keeps that error instead of rewording it as a missing directory', async () => {
    const { creator, created, signedUrlCalls } = harness({ projectType: 'FILEUPLOAD' });
    const dataDir = mkdtempSync(join(tmpdir(), 'launch-tiny-dir-'));
    writeFileSync(join(dataDir, 'index.html'), 'x');

    const failure = await failureOf(creator.create({ ...BASE, dataDir }));

    expect(failure).toBeInstanceOf(UsageError);
    expect(failure.message).not.toContain('No files to upload');
    expect(failure.message).not.toContain('--last-upload');
    expect(created).toEqual([]);
    expect(signedUrlCalls).toEqual([]);
  });
});

describe('DeploymentCreator waiting for the outcome', () => {
  const deployment = { uid: DEPLOYMENT };
  const logsHint = `csdx launch:logs:get --org ${ORG} --project ${PROJECT} --env ${ENVIRONMENT} --deployment ${DEPLOYMENT}`;
  const getHint = `csdx launch:deployments:get --org ${ORG} --project ${PROJECT} --env ${ENVIRONMENT} --deployment ${DEPLOYMENT}`;

  it('resolves and announces the site for a DEPLOYED outcome as it does for LIVE', async () => {
    const { creator, announced } = harness({ outcome: { kind: 'success', status: 'DEPLOYED', deployment } });

    await creator.create(BASE);

    expect(announced).toEqual([deployment]);
  });

  it.each([['ARCHIVED'], ['SKIPPED'], ['CANCELLED'], ['FAILED']])(
    'raises DeploymentUnsuccessfulError naming %s and the log command with the full scope, announcing nothing',
    async (status) => {
      const { creator, announced } = harness({ outcome: { kind: 'failure', status, deployment } });

      const failure = await failureOf(creator.create(BASE));

      expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
      expect((failure as LaunchError).exitCode).toBe(1);
      expect(failure.message).toBe(`Deployment "${DEPLOYMENT}" ended with status ${status}. Run ${logsHint} to see the cause.`);
      expect(announced).toEqual([]);
    },
  );

  it('raises DeploymentUnsuccessfulError on a timeout that points at deployments:get and does not suggest another create', async () => {
    const { creator, announced } = harness({ outcome: { kind: 'timed-out', status: 'DEPLOYING', deployment } });

    const failure = await failureOf(creator.create(BASE));

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect((failure as LaunchError).exitCode).toBe(1);
    expect(failure.message).toBe(
      `Deployment "${DEPLOYMENT}" was still DEPLOYING when the CLI stopped waiting. Run ${getHint} to check its status.`,
    );
    expect(failure.message).not.toContain('deployments:create');
    expect(announced).toEqual([]);
  });

  it('words a poll that gave up with the deployment it left running, naming the status command', async () => {
    const outage = new LaunchApiError(503, [{ code: 'x', message: 'Service unavailable.' }]);
    const { creator } = harness({
      watch: async () => {
        throw outage;
      },
    });

    const failure = await failureOf(creator.create(BASE));

    expect(failure).toBeInstanceOf(DeploymentUnsuccessfulError);
    expect(failure.message).toBe(
      `Deployment "${DEPLOYMENT}" could not be followed to completion: Service unavailable. ` +
        `Run ${getHint} to check its status.`,
    );
  });

  const rejections = {
    projectFails: new LaunchApiError(500, [{ code: 'a', message: 'a' }]),
    createFails: new LaunchApiError(500, [{ code: 'b', message: 'b' }]),
    announceFails: new Error('browser failed'),
  };

  it.each([
    ['projects.get', 'projectFails'],
    ['deployments.create', 'createFails'],
    ['announceLive', 'announceFails'],
  ] as const)('passes a rejection from %s through as the same instance', async (_step, key) => {
    const { creator, signals } = harness({ [key]: rejections[key] });

    const failure = await failureOf(creator.create(BASE));

    expect(failure).toBe(rejections[key]);
    expect(signals.listeners).toEqual([]);
  });

  it('stops no deployment and starts no second one when the create request fails', async () => {
    const { creator, methods, watched } = harness({ createFails: new LaunchApiError(500, [{ code: 'c', message: 'c' }]) });

    await failureOf(creator.create(BASE));

    expect(methods).toEqual(['create']);
    expect(watched).toEqual([]);
  });
});

describe('DeploymentCreator interrupted with Ctrl-C while waiting', () => {
  function waitingForever(stopHolder: { stop?: AbortSignal }) {
    return (_scope: unknown, stop?: AbortSignal) =>
      new Promise<DeploymentOutcome>((_resolve, reject) => {
        stopHolder.stop = stop;
        stop?.addEventListener('abort', () => reject(stop.reason), { once: true });
      });
  }

  it('stops the wait, says the deployment was not cancelled and names deployments:get, sends no cancel, and exits 3', async () => {
    const holder: { stop?: AbortSignal } = {};
    const { creator, signals, methods } = harness({ watch: waitingForever(holder) });

    const running = failureOf(creator.create(BASE));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(signals.registered).toEqual(['SIGINT']);
    expect(signals.listeners).toHaveLength(1);
    expect(holder.stop?.aborted).toBe(false);

    signals.interrupt();
    const failure = await running;

    expect(holder.stop?.aborted).toBe(true);
    expect(failure).toBeInstanceOf(DeploymentWaitInterruptedError);
    expect((failure as LaunchError).exitCode).toBe(3);
    expect(failure.message).toBe(
      `Stopped waiting. Deployment "${DEPLOYMENT}" was not cancelled and continues on Launch. ` +
        `Check it with csdx launch:deployments:get --org ${ORG} --project ${PROJECT} --env ${ENVIRONMENT} ` +
        `--deployment ${DEPLOYMENT}.`,
    );
    expect(methods).toEqual(['create']);
    expect(signals.listeners).toEqual([]);
  });

  it('does not word an interrupt as a failed deployment', async () => {
    const holder: { stop?: AbortSignal } = {};
    const { creator, signals } = harness({ watch: waitingForever(holder) });

    const running = failureOf(creator.create(BASE));
    await new Promise<void>((resolve) => setImmediate(resolve));
    signals.interrupt();

    expect(await running).not.toBeInstanceOf(DeploymentUnsuccessfulError);
  });

  it('registers no listener when nothing is waited on', async () => {
    const { creator, signals } = harness({ projectFails: new Error('lookup failed') });

    await failureOf(creator.create(BASE));

    expect(signals.registered).toEqual([]);
  });
});
