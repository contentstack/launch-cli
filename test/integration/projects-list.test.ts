import nock from 'nock';

import { buildApi } from '../../src/resources';
import { ProjectsPage } from '../../src/projects/types';
import { PROJECT_COLUMNS } from '../../src/commands/launch/projects/list';
import { LaunchApiError } from '../../src/transport/errors';
import { RestApiClient } from '../../src/transport/rest-client';
import { UxLike, renderPagination, renderTable } from '../../src/core/render';
import listFixture from '../fixtures/projects-list.json';

const ORIGIN = 'https://launch-api.integration.test';
const BASE_PATH = '/manage';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const AUTHTOKEN = 'test-authtoken';
const ANALYTICS_INFO = '@contentstack/cli-launch/2.0.0-alpha.0 darwin-arm64 node-v22.0.0';

function buildClient(): RestApiClient {
  return new RestApiClient({
    baseUrl: `${ORIGIN}${BASE_PATH}`,
    analyticsInfo: ANALYTICS_INFO,
    authHeaders: async () => ({ authtoken: AUTHTOKEN }),
    retryDelayMs: 0,
    sleep: async () => undefined,
  });
}

function recordingUx(): { ux: UxLike; lines: string[] } {
  const lines: string[] = [];
  const ux: UxLike = {
    print: (message: string) => {
      lines.push(message);
    },
    inquire: async <T>() => undefined as unknown as T,
  };
  return { ux, lines };
}

describe('integration: GET /projects', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('sends the documented method, path, query string and headers', async () => {
    let capturedHeaders: Record<string, string | string[]> = {};
    let capturedPath = '';
    const scope = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: '50', skip: '0' })
      .reply(function (uri: string) {
        capturedHeaders = this.req.headers as Record<string, string | string[]>;
        capturedPath = uri;
        return [200, listFixture];
      });

    await buildApi(buildClient()).projects.list({ org: ORG_UID, limit: 50, skip: 0 });

    expect(scope.isDone()).toBe(true);
    expect(capturedPath).toBe(`${BASE_PATH}/projects?limit=50&skip=0`);
    expect(capturedHeaders['x-cs-api-version']).toBe('1.0');
    expect(capturedHeaders['x-organization-uid']).toBe(ORG_UID);
    expect(capturedHeaders['x-cs-cli']).toBe(ANALYTICS_INFO);
    expect(capturedHeaders.authtoken).toBe(AUTHTOKEN);
    expect(capturedHeaders['x-project-uid']).toBeUndefined();
  });

  it('omits limit and skip from the query string when they are not supplied', async () => {
    let capturedPath = '';
    const scope = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({})
      .reply(function (uri: string) {
        capturedPath = uri;
        return [200, listFixture];
      });

    await buildApi(buildClient()).projects.list({ org: ORG_UID });

    expect(scope.isDone()).toBe(true);
    expect(capturedPath).toBe(`${BASE_PATH}/projects`);
  });

  it('parses the documented bare envelope into a ProjectsPage', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects`).query({}).reply(200, listFixture);

    const page: ProjectsPage = await buildApi(buildClient()).projects.list({ org: ORG_UID });

    expect(page).not.toHaveProperty('projects.projects');
    expect(page.pagination).toEqual({ count: 3, limit: 10, skip: null });
    expect(page.projects).toHaveLength(3);
    expect(page.projects[0].uid).toBe('a1b2c3d4e5f60718293a4b5c');
    expect(page.projects[0].name).toBe('sample-project');
    expect(page.projects[0].organizationUid).toBe('blt4d9e2a7c1f6b3085');
    expect(page.projects[0].projectType).toBe('GITPROVIDER');
    expect(page.projects[0].repository).toEqual({
      repositoryName: 'octo-user/sample-project',
      username: 'octo-user',
      repositoryUrl: 'https://github.com/octo-user/sample-project',
    });
    expect(page.projects[0].deletedAt).toBeNull();
    expect(page.projects[0].deletedBy).toBeNull();
    expect(page.projects[0].createdBy).toBe('blt8c3f1b6d4a9e2075');
    expect(page.projects[0].updatedBy).toBe('blt8c3f1b6d4a9e2075');
    expect(page.projects[0].createdAt).toBe('2025-08-18T13:17:18.261Z');
    expect(page.projects[0].updatedAt).toBe('2025-10-09T09:36:16.484Z');
  });

  it('parses a FileUpload project that carries neither repository nor description', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects`).query({}).reply(200, listFixture);

    const page: ProjectsPage = await buildApi(buildClient()).projects.list({ org: ORG_UID });

    expect(page.projects[2].projectType).toBe('FILEUPLOAD');
    expect(page.projects[2].repository).toBeUndefined();
    expect(page.projects[2].description).toBeUndefined();
    expect(Object.keys(page.projects[2]).sort()).toEqual([
      'createdAt',
      'createdBy',
      'deletedAt',
      'deletedBy',
      'name',
      'organizationUid',
      'projectType',
      'uid',
      'updatedAt',
      'updatedBy',
    ]);
  });

  it('renders the parsed page through the real table and pagination renderers', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects`).query({}).reply(200, listFixture);
    const { ux, lines } = recordingUx();

    const page = await buildApi(buildClient()).projects.list({ org: ORG_UID });
    renderTable(ux, PROJECT_COLUMNS, page.projects);
    renderPagination(ux, page.pagination);

    expect(lines).toEqual([
      'UID                       NAME            TYPE         UPDATED',
      'a1b2c3d4e5f60718293a4b5c  sample-project  GITPROVIDER  2025-10-09T09:36:16.484Z',
      'b2c3d4e5f60718293a4b5c6d  marketing-site  GITPROVIDER  2025-08-28T10:27:31.065Z',
      'c3d4e5f60718293a4b5c6d7e  docs-site       FILEUPLOAD   2025-08-08T06:23:58.338Z',
      'Showing 1-3 of 3',
    ]);
  });

  it('retries a 429 once and resolves from the following 200', async () => {
    const throttled = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({})
      .reply(429, { errors: [{ code: 'launch.RATE_LIMITED', message: 'Too many requests.' }], status: 429 });
    const succeeded = nock(ORIGIN).get(`${BASE_PATH}/projects`).query({}).reply(200, listFixture);

    const page = await buildApi(buildClient()).projects.list({ org: ORG_UID });

    expect(throttled.isDone()).toBe(true);
    expect(succeeded.isDone()).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
    expect(page.projects).toHaveLength(3);
  });

  it('raises a LaunchApiError when the retry budget is exhausted by repeated 429s', async () => {
    const body = { errors: [{ code: 'launch.RATE_LIMITED', message: 'Too many requests.' }], status: 429 };
    nock(ORIGIN).get(`${BASE_PATH}/projects`).query({}).times(4).reply(429, body);

    const rejection = await buildApi(buildClient())
      .projects.list({ org: ORG_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(LaunchApiError);
    expect((rejection as LaunchApiError).status).toBe(429);
    expect((rejection as LaunchApiError).code).toBe('launch.RATE_LIMITED');
    expect((rejection as LaunchApiError).message).toBe('Too many requests.');
    expect(nock.pendingMocks()).toEqual([]);
  });
});
