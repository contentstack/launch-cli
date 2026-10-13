import type { ServiceContext } from '../core/service-context';
import type { ApiSurface } from '../resources';
import { DeploymentFollower, SITE_OPEN_DELAY_MS } from './deployment.follower';
import type { WatchTiming } from './deployment.watcher';

const SCOPE = { org: 'org1', project: 'p1', environment: 'e1', deployment: 'd1' };

function harness(options: { withoutOpenUrl?: boolean } = {}) {
  const timeline: string[] = [];
  const polled: unknown[] = [];
  const logged: unknown[] = [];

  const api = {
    deployments: {
      get: async (params: unknown) => {
        polled.push(params);
        return { uid: 'd1', status: 'LIVE' };
      },
    },
    deploymentLogs: {
      after: async (params: unknown) => {
        logged.push(params);
        return [];
      },
    },
  } as unknown as ApiSurface;

  const services: ServiceContext = {
    api,
    ux: { print: (message: string) => timeline.push(`print ${message}`), inquire: async () => undefined as never },
    isTTY: false,
    outputIsTTY: false,
    openUrl: options.withoutOpenUrl ? undefined : (url: string) => timeline.push(`open ${url}`),
  };

  const timing: WatchTiming = {
    sleep: async (ms: number) => {
      timeline.push(`sleep ${ms}`);
    },
    now: () => 0,
    pollDelayMs: 1000,
    maxBackoffSteps: 3,
    timeoutMs: 60_000,
  };

  return { follower: new DeploymentFollower(services, timing), timeline, polled, logged };
}

describe('DeploymentFollower.watch', () => {
  it('polls the deployment and reads its logs in the scope it was given', async () => {
    const { follower, polled, logged } = harness();

    const outcome = await follower.watch(SCOPE);

    expect(outcome).toEqual(expect.objectContaining({ kind: 'success', status: 'LIVE' }));
    expect(polled).toEqual([SCOPE]);
    expect(logged).toEqual([{ ...SCOPE, timestamp: '1970-01-01T00:00:00.000Z' }]);
  });
});

describe('DeploymentFollower.announceLive', () => {
  it('prints the deployment url, then opens it once the site has had time to come up', async () => {
    const { follower, timeline } = harness();

    await follower.announceLive({ uid: 'd1', deploymentUrl: 'site.example.test' });

    expect(timeline).toEqual([
      'print Deployment URL https://site.example.test',
      `sleep ${SITE_OPEN_DELAY_MS}`,
      'open https://site.example.test',
    ]);
  });

  it('falls back to the first domain with a url when the deployment carries none', async () => {
    const { follower, timeline } = harness({ withoutOpenUrl: true });

    await follower.announceLive({ uid: 'd1' }, [{}, { url: 'custom.example.test' }, { url: 'other.example.test' }]);

    expect(timeline).toEqual(['print Deployment URL https://custom.example.test']);
  });

  it('prints nothing and opens nothing when there is no url to show', async () => {
    const { follower, timeline } = harness();

    await follower.announceLive({ uid: 'd1' }, [{}]);

    expect(timeline).toEqual([]);
  });

  it('neither waits nor opens anything when there is no browser to open', async () => {
    const { follower, timeline } = harness({ withoutOpenUrl: true });

    await follower.announceLive({ uid: 'd1', deploymentUrl: 'https://site.example.test' });

    expect(timeline).toEqual(['print Deployment URL https://site.example.test']);
  });
});
