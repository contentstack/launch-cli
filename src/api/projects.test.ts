import { LaunchApiError } from '../http/errors';
import { RestApiClient, RestRequest } from '../http/rest-client';
import { ProjectsApi, buildApi } from './index';

function fakeRestClient(result: unknown) {
  const requests: RestRequest[] = [];
  const client = {
    request: async (req: RestRequest) => {
      requests.push(req);
      return result;
    },
  } as unknown as RestApiClient;
  return { client, requests };
}

describe('ProjectsApi', () => {
  it('lists projects as a scoped GET carrying limit and skip', async () => {
    const page = { pagination: { count: 1, limit: 50, skip: 0 }, projects: [{ uid: 'p1', name: 'site' }] };
    const { client, requests } = fakeRestClient(page);

    const result = await new ProjectsApi(client).list({ org: 'org1', limit: 50, skip: 0 });

    expect(result).toBe(page);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/projects',
      orgUid: 'org1',
      query: { limit: 50, skip: 0 },
    });
  });

  it('sends limit and skip as undefined when the caller passes neither', async () => {
    const page = { pagination: { count: 0, limit: 50, skip: 0 }, projects: [] };
    const { client, requests } = fakeRestClient(page);

    await new ProjectsApi(client).list({ org: 'org1' });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/projects',
      orgUid: 'org1',
      query: { limit: undefined, skip: undefined },
    });
  });

  it('gets a project by uid with both scoping identifiers', async () => {
    const project = { uid: 'p1', name: 'site', projectType: 'GITPROVIDER' };
    const { client, requests } = fakeRestClient({ project });

    const result = await new ProjectsApi(client).get({ org: 'org1', project: 'p1' });

    expect(result).toBe(project);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/projects/p1',
      orgUid: 'org1',
      projectUid: 'p1',
    });
  });

  it('unwraps the project envelope rather than returning the response body', async () => {
    const project = { uid: 'p1', name: 'site' };
    const { client } = fakeRestClient({ project });

    const result = await new ProjectsApi(client).get({ org: 'org1', project: 'p1' });

    expect(result).not.toHaveProperty('project');
    expect(result.uid).toBe('p1');
    expect(result.name).toBe('site');
  });

  it('raises a LaunchApiError instead of returning undefined when the project envelope is missing', async () => {
    const { client } = fakeRestClient({ uid: 'p1', name: 'site' });

    const error = (await new ProjectsApi(client)
      .get({ org: 'org1', project: 'p1' })
      .catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(200);
    expect(error.code).toBe('launch.RESPONSE.MALFORMED');
    expect(error.message).toBe('The Launch API returned a project response without a project.');
  });

  it.each([[null], [undefined], [{ project: null }]])(
    'raises a LaunchApiError when the get response body is %p',
    async (body) => {
      const { client } = fakeRestClient(body);

      await expect(new ProjectsApi(client).get({ org: 'org1', project: 'p1' })).rejects.toBeInstanceOf(LaunchApiError);
    },
  );

  it('raises a LaunchApiError when the list response carries no projects array', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 50, skip: 0 } });

    const error = (await new ProjectsApi(client).list({ org: 'org1' }).catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(200);
    expect(error.code).toBe('launch.RESPONSE.MALFORMED');
    expect(error.message).toBe('The Launch API returned a project list without a projects array.');
  });

  it('raises a LaunchApiError when the list response carries no pagination block', async () => {
    const { client } = fakeRestClient({ projects: [] });

    await expect(new ProjectsApi(client).list({ org: 'org1' })).rejects.toBeInstanceOf(LaunchApiError);
  });

  it.each([[null], [undefined]])('raises a LaunchApiError when the list response body is %p', async (body) => {
    const { client } = fakeRestClient(body);

    await expect(new ProjectsApi(client).list({ org: 'org1' })).rejects.toBeInstanceOf(LaunchApiError);
  });

  it('propagates a LaunchApiError raised by the transport rather than masking it', async () => {
    const failure = new LaunchApiError(404, [{ code: 'launch.PROJECT.NOT_FOUND', message: 'x' }]);
    const client = {
      request: async () => {
        throw failure;
      },
    } as unknown as RestApiClient;

    await expect(new ProjectsApi(client).get({ org: 'org1', project: 'p1' })).rejects.toBe(failure);
    await expect(new ProjectsApi(client).list({ org: 'org1' })).rejects.toBe(failure);
  });

  it('buildApi exposes the projects resource', () => {
    const { client } = fakeRestClient({});

    expect(buildApi(client).projects).toBeInstanceOf(ProjectsApi);
  });
});
