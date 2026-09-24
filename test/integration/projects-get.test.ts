import nock from 'nock';

import { buildApi } from '../../src/resources';
import { Project } from '../../src/projects/types';
import { projectDetailFields } from '../../src/projects/project.presenter';
import { LaunchApiError } from '../../src/transport/errors';
import { RestApiClient } from '../../src/transport/rest-client';
import { UxLike, renderDetail } from '../../src/core/render';
import getFileUploadFixture from '../fixtures/project-get-fileupload.json';
import getFixture from '../fixtures/project-get.json';
import notFoundFixture from '../fixtures/project-not-found.json';
import type { CmaSession } from '../../src/transport/cma-client';

const UNUSED_CMA: CmaSession = {
  fetchOrganizations: async () => {
    throw new Error('this test lists no organizations');
  },
  fetchOrganization: async () => {
    throw new Error('this test fetches no organization');
  },
  scopedOrganizationUid: () => undefined,
};

const ORIGIN = 'https://launch-api.integration.test';
const BASE_PATH = '/manage';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const PROJECT_UID = 'a1b2c3d4e5f60718293a4b5c';
const FILEUPLOAD_PROJECT_UID = 'c3d4e5f60718293a4b5c6d7e';
const AUTHTOKEN = 'test-authtoken';
const ANALYTICS_INFO = '@contentstack/cli-launch/2.0.0-alpha.0 darwin-arm64 node-v22.0.0';

function buildClient(): RestApiClient {
  return new RestApiClient({
    baseUrl: `${ORIGIN}${BASE_PATH}`,
    analyticsInfo: ANALYTICS_INFO,
    auth: { headers: async () => ({ authtoken: AUTHTOKEN }) },
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

describe('integration: GET /projects/{project_uid}', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('sends the documented method, path, empty query string and headers', async () => {
    let capturedHeaders: Record<string, string | string[]> = {};
    let capturedPath = '';
    const scope = nock(ORIGIN)
      .get(`${BASE_PATH}/projects/${PROJECT_UID}`)
      .query({})
      .reply(function (uri: string) {
        capturedHeaders = this.req.headers as Record<string, string | string[]>;
        capturedPath = uri;
        return [200, getFixture];
      });

    await buildApi(buildClient(), UNUSED_CMA).projects.get({ org: ORG_UID, project: PROJECT_UID });

    expect(scope.isDone()).toBe(true);
    expect(capturedPath).toBe(`${BASE_PATH}/projects/${PROJECT_UID}`);
    expect(capturedHeaders['x-cs-api-version']).toBe('1.0');
    expect(capturedHeaders['x-organization-uid']).toBe(ORG_UID);
    expect(capturedHeaders['x-project-uid']).toBe(PROJECT_UID);
    expect(capturedHeaders['x-cs-cli']).toBe(ANALYTICS_INFO);
    expect(capturedHeaders.authtoken).toBe(AUTHTOKEN);
  });

  it('unwraps the documented project envelope into a bare Project', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);

    const project: Project = await buildApi(buildClient(), UNUSED_CMA).projects.get({ org: ORG_UID, project: PROJECT_UID });

    expect(project).not.toHaveProperty('project');
    expect(project.uid).toBe(PROJECT_UID);
    expect(project.name).toBe('sample-project');
    expect(project.organizationUid).toBe(ORG_UID);
    expect(project.projectType).toBe('GITPROVIDER');
    expect(project.repository).toEqual({
      repositoryName: 'octo-user/sample-project',
      username: 'octo-user',
      repositoryUrl: 'https://github.com/octo-user/sample-project',
    });
    expect(project.deletedAt).toBeNull();
    expect(project.deletedBy).toBeNull();
    expect(project.createdBy).toBe('blt8c3f1b6d4a9e2075');
    expect(project.updatedBy).toBe('blt8c3f1b6d4a9e2075');
    expect(project.createdAt).toBe('2025-08-18T13:17:18.261Z');
    expect(project.updatedAt).toBe('2025-10-09T09:36:16.484Z');
  });

  it('renders the unwrapped project through the real detail renderer', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);
    const { ux, lines } = recordingUx();

    const project = await buildApi(buildClient(), UNUSED_CMA).projects.get({ org: ORG_UID, project: PROJECT_UID });
    renderDetail(ux, projectDetailFields(project));

    expect(lines).toEqual(['uid   a1b2c3d4e5f60718293a4b5c', 'name  sample-project', 'type  GITPROVIDER']);
  });

  it('unwraps a FileUpload project that carries neither repository nor description', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects/${FILEUPLOAD_PROJECT_UID}`).query({}).reply(200, getFileUploadFixture);

    const project: Project = await buildApi(buildClient(), UNUSED_CMA).projects.get({
      org: ORG_UID,
      project: FILEUPLOAD_PROJECT_UID,
    });

    expect(project.uid).toBe(FILEUPLOAD_PROJECT_UID);
    expect(project.projectType).toBe('FILEUPLOAD');
    expect(project.repository).toBeUndefined();
    expect(project.description).toBeUndefined();
  });

  it('renders a FileUpload project without a description row', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects/${FILEUPLOAD_PROJECT_UID}`).query({}).reply(200, getFileUploadFixture);
    const { ux, lines } = recordingUx();

    const project = await buildApi(buildClient(), UNUSED_CMA).projects.get({ org: ORG_UID, project: FILEUPLOAD_PROJECT_UID });
    renderDetail(ux, projectDetailFields(project));

    expect(lines).toEqual(['uid   c3d4e5f60718293a4b5c6d7e', 'name  docs-site', 'type  FILEUPLOAD']);
  });

  it('raises a LaunchApiError carrying the mapped message for the documented 404 body', async () => {
    nock(ORIGIN).get(`${BASE_PATH}/projects/${PROJECT_UID}`).query({}).reply(404, notFoundFixture);

    const rejection = await buildApi(buildClient(), UNUSED_CMA)
      .projects.get({ org: ORG_UID, project: PROJECT_UID })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(LaunchApiError);
    expect((rejection as LaunchApiError).status).toBe(404);
    expect((rejection as LaunchApiError).code).toBe('launch.PROJECT.NOT_FOUND');
    expect((rejection as LaunchApiError).message).toBe('No project found with that name or UID.');
    expect((rejection as LaunchApiError).errors).toEqual([
      { code: 'launch.PROJECT.NOT_FOUND', message: 'Project not found.' },
    ]);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('retries a 429 once and resolves the unwrapped project from the following 200', async () => {
    const throttled = nock(ORIGIN)
      .get(`${BASE_PATH}/projects/${PROJECT_UID}`)
      .query({})
      .reply(429, { errors: [{ code: 'launch.RATE_LIMITED', message: 'Too many requests.' }], status: 429 });
    const succeeded = nock(ORIGIN).get(`${BASE_PATH}/projects/${PROJECT_UID}`).query({}).reply(200, getFixture);

    const project = await buildApi(buildClient(), UNUSED_CMA).projects.get({ org: ORG_UID, project: PROJECT_UID });

    expect(throttled.isDone()).toBe(true);
    expect(succeeded.isDone()).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
    expect(project.uid).toBe(PROJECT_UID);
    expect(project.name).toBe('sample-project');
  });
});
