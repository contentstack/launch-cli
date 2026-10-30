import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/prompt';
import type { ApiSurface } from '../resources';
import { ALL_DEPLOYMENTS, IN_FLIGHT_DEPLOYMENTS, deploymentChoice, promptForDeployment } from './deployment.prompt';

const SCOPE = { org: 'org1', project: 'proj1', environment: 'env1' };
const UID_A = 'a1b2c3d4e5f60718293a4b5c';
const UID_B = 'b1b2c3d4e5f60718293a4b5c';
const UID_C = 'c1b2c3d4e5f60718293a4b5c';
const UID_D = 'd1b2c3d4e5f60718293a4b5c';

function deps(answers: unknown[], page: unknown) {
  const asked: unknown[] = [];
  const printed: string[] = [];
  const requested: unknown[] = [];
  let index = 0;

  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: async (payload: unknown) => {
      asked.push(payload);
      const answer = answers[index];
      index += 1;
      return answer as never;
    },
  };
  const api = {
    deployments: {
      list: async (params: unknown) => {
        requested.push(params);
        return page;
      },
    },
  } as unknown as ApiSurface;

  return { deps: { api, ux }, asked, printed, requested };
}

const PAGE = {
  pagination: { count: 4, limit: 100 },
  deployments: [
    { uid: UID_A, status: 'DEPLOYING', commitHash: '9fceb02d0ae598e95dc970b74767f19372d61af8' },
    { uid: UID_B, status: 'LIVE', createdAt: '2026-05-01T10:00:00.000Z' },
    { uid: UID_C, status: 'QUEUED' },
    { uid: UID_D, status: 'FAILED', commitHash: '1234567890' },
  ],
};

describe('promptForDeployment', () => {
  it('offers the rollback-eligible deployments newest first, without the live one, as one list of full uids', async () => {
    const { deps: d, asked, printed, requested } = deps([UID_D], PAGE);

    await expect(promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS)).resolves.toBe(UID_D);
    expect(requested).toEqual([{ ...SCOPE, limit: 100, skip: 0, rollbackEligible: true }]);
    expect(asked).toEqual([
      {
        type: 'list',
        name: 'value',
        message: 'Choose a deployment for rollback',
        choices: [
          { name: `${UID_A}  DEPLOYING  9fceb02`, value: UID_A },
          { name: `${UID_C}  QUEUED`, value: UID_C },
          { name: `${UID_D}  FAILED  1234567`, value: UID_D },
        ],
        default: undefined,
        loop: false,
        pageSize: 3,
      },
    ]);
    expect(printed).toEqual([]);
  });

  it('offers only the deployments in flight for a cancel, and words the question for it', async () => {
    const { deps: d, asked, requested } = deps([UID_C], PAGE);

    await expect(promptForDeployment(d, SCOPE, IN_FLIGHT_DEPLOYMENTS)).resolves.toBe(UID_C);
    expect(requested).toEqual([{ ...SCOPE, limit: 100, skip: 0 }]);
    expect(Object.keys(requested[0] as object)).not.toContain('rollbackEligible');
    expect((asked[0] as { choices: unknown }).choices).toEqual([
      { name: `${UID_A}  DEPLOYING  9fceb02`, value: UID_A },
      { name: `${UID_C}  QUEUED`, value: UID_C },
    ]);
    expect((asked[0] as { message: string }).message).toBe('Choose a deployment for cancellation');
  });

  it('leaves out a deployment the server marks not cancellable, and keeps one that does not say', async () => {
    const { deps: d, asked } = deps([UID_C], {
      pagination: { count: 4 },
      deployments: [
        { uid: UID_A, status: 'DEPLOYING', isCancellable: false },
        { uid: UID_B, status: 'DEPLOYING', isCancellable: true },
        { uid: UID_C, status: 'QUEUED' },
        { uid: UID_D, status: 'QUEUED', isCancellable: null },
      ],
    });

    await promptForDeployment(d, SCOPE, IN_FLIGHT_DEPLOYMENTS);

    expect((asked[0] as { choices: { value: string }[] }).choices.map((choice) => choice.value)).toEqual([
      UID_B,
      UID_C,
      UID_D,
    ]);
  });

  it('refuses a cancel with exit 2 when every in-flight deployment is past the point of cancelling', async () => {
    const { deps: d, asked } = deps([UID_A], {
      pagination: { count: 1 },
      deployments: [{ uid: UID_A, status: 'DEPLOYING', isCancellable: false }],
    });

    const failure = await promptForDeployment(d, SCOPE, IN_FLIGHT_DEPLOYMENTS).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe('No in-progress deployments are available for cancellation.');
    expect(asked).toEqual([]);
  });

  it('leaves out only the newest live deployment, the current one, and keeps an older live row and the rest', async () => {
    const { deps: d, asked } = deps([UID_B], {
      pagination: { count: 4 },
      deployments: [
        { uid: UID_A, status: 'FAILED' },
        { uid: UID_B, status: 'live' },
        { uid: UID_C, status: 'LIVE' },
        { uid: UID_D, status: 'DEPLOYED' },
      ],
    });

    await promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS);

    expect((asked[0] as { choices: { value: string }[] }).choices.map((choice) => choice.value)).toEqual([
      UID_A,
      UID_C,
      UID_D,
    ]);
  });

  it('offers everything the server sent when none of it is live', async () => {
    const { deps: d, asked } = deps([UID_A], { pagination: { count: 2 }, deployments: [{ uid: UID_A }, { uid: UID_B, status: 'DEPLOYED' }] });

    await promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS);

    expect((asked[0] as { choices: unknown[] }).choices).toHaveLength(2);
  });

  it.each([[undefined], [''], ['  ']])('labels a deployment whose status is %p with a dash', async (status) => {
    const { deps: d, asked } = deps([UID_A], { pagination: { count: 1 }, deployments: [{ uid: UID_A, status }] });

    await promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS);

    expect((asked[0] as { choices: unknown }).choices).toEqual([{ name: `${UID_A}  -`, value: UID_A }]);
  });

  it('leaves out a deployment that carries no uid, since choosing it could address nothing', async () => {
    const { deps: d, asked } = deps([UID_B], {
      pagination: { count: 3 },
      deployments: [{ status: 'FAILED' }, { uid: '  ', status: 'FAILED' }, { uid: UID_B, status: 'FAILED' }],
    });

    await promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS);

    expect((asked[0] as { choices: unknown }).choices).toEqual([{ name: `${UID_B}  FAILED`, value: UID_B }]);
  });

  it('says how many deployments the page left out when the environment has more', async () => {
    const { deps: d, printed } = deps([UID_A], { pagination: { count: 250, limit: 100 }, deployments: PAGE.deployments });

    await promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS);

    expect(printed).toEqual(['Showing the first 4 of 250 deployments. Use --deployment to reach any of them.']);
  });

  it.each([
    ['no deployments', { pagination: { count: 0 }, deployments: [] }],
    ['only the live one', { pagination: { count: 1 }, deployments: [{ uid: UID_A, status: 'LIVE' }] }],
    ['only entries without a uid', { pagination: { count: 1 }, deployments: [{ status: 'LIVE' }] }],
  ])('refuses a rollback with exit 2 and never prompts when the page holds %s', async (_label, page) => {
    const { deps: d, asked } = deps([UID_A], page);

    const failure = await promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(2);
    expect((failure as Error).message).toBe('No deployments are available for rollback.');
    expect(asked).toEqual([]);
  });

  it('refuses a cancel with exit 2 when every deployment has finished, an unknown status included', async () => {
    const { deps: d, asked } = deps([UID_A], {
      pagination: { count: 3 },
      deployments: [
        { uid: UID_A, status: 'LIVE' },
        { uid: UID_B, status: 'PROMOTING' },
        { uid: UID_C },
      ],
    });

    const failure = await promptForDeployment(d, SCOPE, IN_FLIGHT_DEPLOYMENTS).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(2);
    expect((failure as Error).message).toBe('No in-progress deployments are available for cancellation.');
    expect(asked).toEqual([]);
  });

  it('treats an undeclared picker as offering every deployment', async () => {
    const { deps: d, asked } = deps([UID_A], PAGE);

    await promptForDeployment(d, SCOPE, undefined);

    expect((asked[0] as { choices: unknown[] }).choices).toHaveLength(3);
  });

  it.each([[undefined], [''], [null]])('turns an answer of %p at the prompt into a cancellation', async (answer) => {
    const { deps: d } = deps([answer], PAGE);

    await expect(promptForDeployment(d, SCOPE, ALL_DEPLOYMENTS)).rejects.toBeInstanceOf(CancelledError);
  });

  it('propagates a failed list unchanged and asks nothing', async () => {
    const failure = new Error('boom');
    const asked: unknown[] = [];
    const api = {
      deployments: {
        list: async () => {
          throw failure;
        },
      },
    } as unknown as ApiSurface;
    const ux: UxLike = {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        asked.push(payload);
        return undefined as never;
      },
    };

    await expect(promptForDeployment({ api, ux }, SCOPE, ALL_DEPLOYMENTS)).rejects.toBe(failure);
    expect(asked).toEqual([]);
  });

  it('shortens a commit to seven characters and prefers it over the creation time', () => {
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', commitHash: 'abcdef0123', createdAt: 'x' }).name).toBe(
      `${UID_A}  LIVE  abcdef0`,
    );
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', commitHash: '  ', updatedAt: 'later' }).name).toBe(
      `${UID_A}  LIVE  later`,
    );
  });

  it('never lets a control character in the status, the commit or the timestamp reach the label', () => {
    expect(deploymentChoice({ uid: UID_A, status: 'LI\u001b[31mVE\u001b[0m\r', commitHash: 'abc\u001b]0;x\u0007def0123' }).name).toBe(
      `${UID_A}  LIVE  abcdef0`,
    );
    expect(deploymentChoice({ uid: UID_A, status: '\u0007', createdAt: '2026\r\n05\u001b[2J' }).name).toBe(
      `${UID_A}  -  2026 05`,
    );
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', createdAt: '\u0007', updatedAt: 'later' }).name).toBe(
      `${UID_A}  LIVE  later`,
    );
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', createdAt: '\u0007' }).name).toBe(`${UID_A}  LIVE`);
  });

  it('puts the deployment number in front of the uid, keeping zero and refusing absent, null and blank values', () => {
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', deploymentNumber: 12 }).name).toBe(`#12  ${UID_A}  LIVE`);
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', deploymentNumber: 0 }).name).toBe(`#0  ${UID_A}  LIVE`);
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE' }).name).toBe(`${UID_A}  LIVE`);
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', deploymentNumber: null as never }).name).toBe(`${UID_A}  LIVE`);
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', deploymentNumber: '  ' as never }).name).toBe(
      `${UID_A}  LIVE`,
    );
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', deploymentNumber: 12 }).value).toBe(UID_A);
  });

  it('never lets a control character in the deployment number reach the label', () => {
    expect(deploymentChoice({ uid: UID_A, status: 'LIVE', deploymentNumber: '7\u001b[31m\r\n8' as never }).name).toBe(
      `#7 8  ${UID_A}  LIVE`,
    );
  });
});
