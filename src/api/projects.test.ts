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

  it('buildApi exposes the projects resource', () => {
    const { client } = fakeRestClient({});

    expect(buildApi(client).projects).toBeInstanceOf(ProjectsApi);
  });
});
