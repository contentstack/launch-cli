import nock from 'nock';

import { buildServiceContext } from '../../src/base/service-context';
import { UxLike } from '../../src/output/render';
import listFixture from '../fixtures/projects-list.json';
import getFixture from '../fixtures/project-get.json';

const LAUNCH_HUB_URL = 'https://launch-api.integration.test';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const ANALYTICS_INFO = '@contentstack/cli-launch/2.0.0-alpha.0 darwin-arm64 node-v22.0.0';

function silentUx(): UxLike {
  return {
    print: () => undefined,
    inquire: async <T>() => undefined as unknown as T,
  };
}

function buildContext() {
  return buildServiceContext({
    launchHubUrl: LAUNCH_HUB_URL,
    analyticsInfo: ANALYTICS_INFO,
    ux: silentUx(),
    isTTY: false,
  });
}

describe('integration: the request path a real service context produces', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('sends a project list to /manage/projects under the launch hub origin', async () => {
    let capturedPath = '';
    const scope = nock(LAUNCH_HUB_URL)
      .get('/manage/projects')
      .query({ limit: '50', skip: '0' })
      .reply(function (uri: string) {
        capturedPath = uri;
        return [200, listFixture];
      });

    const page = await buildContext().api.projects.list({ org: ORG_UID, limit: 50, skip: 0 });

    expect(scope.isDone()).toBe(true);
    expect(capturedPath).toBe('/manage/projects?limit=50&skip=0');
    expect(capturedPath.startsWith('/manage/api')).toBe(false);
    expect(page.projects).toHaveLength(3);
  });

  it('sends a project get to /manage/projects/{project_uid} under the launch hub origin', async () => {
    let capturedPath = '';
    const scope = nock(LAUNCH_HUB_URL)
      .get(`/manage/projects/${PROJECT_UID}`)
      .query({})
      .reply(function (uri: string) {
        capturedPath = uri;
        return [200, getFixture];
      });

    const project = await buildContext().api.projects.get({ org: ORG_UID, project: PROJECT_UID });

    expect(scope.isDone()).toBe(true);
    expect(capturedPath).toBe(`/manage/projects/${PROJECT_UID}`);
    expect(capturedPath.startsWith('/manage/api')).toBe(false);
    expect(project.uid).toBe(PROJECT_UID);
  });
});
