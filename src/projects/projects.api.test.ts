import { EXIT_USAGE, MAX_LIMIT, MAX_PAGES } from '../core/constants';
import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { ProjectsPage } from './types';
import { buildApi } from '../resources';
import { PROJECT_ERROR_MESSAGES } from './project.errors';
import { ProjectScanLimitError, ProjectsApi } from './projects.api';

function pagingRestClient(pages: { count: number; projects: { uid: string; name: string }[] }[]) {
  const requests: RestRequest[] = [];
  let index = 0;
  const client = {
    request: async (req: RestRequest) => {
      requests.push(req);
      const page = pages[Math.min(index++, pages.length - 1)];
      return { pagination: { count: page.count, limit: MAX_LIMIT, skip: null }, projects: page.projects };
    },
  } as unknown as RestApiClient;
  return { client, requests };
}

async function drain(iterator: AsyncGenerator<ProjectsPage>): Promise<ProjectsPage[]> {
  const collected: ProjectsPage[] = [];
  for await (const page of iterator) {
    collected.push(page);
  }
  return collected;
}

function projectsOfSize(size: number, prefix: string): { uid: string; name: string }[] {
  return Array.from({ length: size }, (_, index) => ({ uid: `${prefix}${index}`, name: `${prefix}-${index}` }));
}

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

  it('pages the organization one MAX_LIMIT page at a time, advancing skip by the projects returned', async () => {
    const { client, requests } = pagingRestClient([
      { count: 150, projects: projectsOfSize(MAX_LIMIT, 'a') },
      { count: 150, projects: projectsOfSize(50, 'b') },
    ]);

    const collected = await drain(new ProjectsApi(client).pages({ org: 'org1' }));

    expect(collected).toHaveLength(2);
    expect(collected[0].projects).toHaveLength(MAX_LIMIT);
    expect(collected[1].projects).toHaveLength(50);
    expect(requests).toEqual([
      { method: 'GET', path: '/projects', orgUid: 'org1', query: { limit: MAX_LIMIT, skip: 0 } },
      { method: 'GET', path: '/projects', orgUid: 'org1', query: { limit: MAX_LIMIT, skip: MAX_LIMIT } },
    ]);
  });

  it('honours a caller supplied page size instead of the maximum', async () => {
    const { client, requests } = pagingRestClient([
      { count: 4, projects: projectsOfSize(2, 'a') },
      { count: 4, projects: projectsOfSize(2, 'b') },
      { count: 4, projects: [] },
    ]);

    await drain(new ProjectsApi(client).pages({ org: 'org1', pageSize: 2 }));

    expect(requests.map((request) => request.query)).toEqual([
      { limit: 2, skip: 0 },
      { limit: 2, skip: 2 },
    ]);
  });

  it('stops after a page shorter than the page size rather than asking for another', async () => {
    const { client, requests } = pagingRestClient([{ count: 900, projects: projectsOfSize(3, 'a') }]);

    const collected = await drain(new ProjectsApi(client).pages({ org: 'org1' }));

    expect(collected).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('stops on an empty page rather than looping forever when the count is never satisfied', async () => {
    const { client, requests } = pagingRestClient([{ count: 900, projects: [] }]);

    const collected = await drain(new ProjectsApi(client).pages({ org: 'org1' }));

    expect(collected).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('raises the page ceiling by name rather than reporting the scan as complete', async () => {
    const { client, requests } = pagingRestClient([
      { count: Number.NaN, projects: projectsOfSize(1, 'a') },
    ]);

    const rejection = await drain(new ProjectsApi(client).pages({ org: 'org1', pageSize: 1 })).catch(
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(ProjectScanLimitError);
    expect((rejection as Error).message).toBe(
      `Stopped after scanning ${MAX_PAGES} pages of projects without reaching the end of the organization. ` +
        'Pass --project with the project uid instead of its name.',
    );
    expect(requests).toHaveLength(MAX_PAGES);
    expect(MAX_PAGES).toBe(100);
  });

  it('maps the page ceiling to the usage exit code because the caller must pass a uid instead', () => {
    expect(new ProjectScanLimitError().exitCode).toBe(EXIT_USAGE);
    expect(new ProjectScanLimitError().name).toBe('ProjectScanLimitError');
  });

  it('stops once the reported count is reached even though the last page was full', async () => {
    const { client, requests } = pagingRestClient([{ count: 2, projects: projectsOfSize(2, 'a') }]);

    const collected = await drain(new ProjectsApi(client).pages({ org: 'org1', pageSize: 2 }));

    expect(collected).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('fetches no further page once the consumer stops reading', async () => {
    const { client, requests } = pagingRestClient([
      { count: 150, projects: projectsOfSize(MAX_LIMIT, 'a') },
      { count: 150, projects: projectsOfSize(50, 'b') },
    ]);

    for await (const page of new ProjectsApi(client).pages({ org: 'org1' })) {
      expect(page.projects).toHaveLength(MAX_LIMIT);
      break;
    }

    expect(requests).toHaveLength(1);
  });

  it('propagates a malformed page instead of swallowing it mid-walk', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN', message: 'no access' }]);
    const client = {
      request: async () => {
        throw failure;
      },
    } as unknown as RestApiClient;

    await expect(drain(new ProjectsApi(client).pages({ org: 'org1' }))).rejects.toBe(failure);
  });

  it('buildApi exposes the projects resource', () => {
    const { client } = fakeRestClient({});

    expect(buildApi(client).projects).toBeInstanceOf(ProjectsApi);
  });
});

describe('ProjectsApi error wording', () => {
  function failingClient(status: number, data: unknown) {
    const seen: { messages: unknown }[] = [];
    const client = {
      request: async (_req: RestRequest, errorMessages?: Record<string, string>) => {
        seen.push({ messages: errorMessages });
        throw parseErrorEnvelope(status, data, errorMessages);
      },
    } as unknown as RestApiClient;

    return { client, seen };
  }

  it('turns launch.PROJECT.NOT_FOUND on the wire into the project wording', async () => {
    const { client, seen } = failingClient(404, { errors: [{ code: 'launch.PROJECT.NOT_FOUND', message: 'x' }] });

    const error = (await new ProjectsApi(client).get({ org: 'org1', project: 'p1' }).catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.message).toBe('No project found with that name or UID.');
    expect(error.code).toBe('launch.PROJECT.NOT_FOUND');
    expect(seen[0].messages).toBe(PROJECT_ERROR_MESSAGES);
  });

  it('hands the same project wording to the list request', async () => {
    const { client, seen } = failingClient(429, { errors: [{ code: 'launch.PROJECT.LIMIT_REACHED', message: 'x' }] });

    const error = (await new ProjectsApi(client).list({ org: 'org1' }).catch((e) => e)) as LaunchApiError;

    expect(error.message).toBe('This organization has reached its project limit.');
    expect(error.code).toBe('launch.PROJECT.LIMIT_REACHED');
    expect(seen[0].messages).toBe(PROJECT_ERROR_MESSAGES);
  });

  it('leaves a code the project dictionary does not list with the wording the API sent', async () => {
    const { client } = failingClient(400, { errors: [{ code: 'launch.SOMETHING.ELSE', message: 'bad input' }] });

    const error = (await new ProjectsApi(client).get({ org: 'org1', project: 'p1' }).catch((e) => e)) as LaunchApiError;

    expect(error.message).toBe('bad input');
    expect(error.code).toBe('launch.SOMETHING.ELSE');
  });
});

describe('PROJECT_ERROR_MESSAGES', () => {
  it('maps every project code the CLI rewords and nothing else', () => {
    expect(PROJECT_ERROR_MESSAGES).toEqual({
      'launch.PROJECT.DUPLICATE_NAME': 'A project with that name already exists in this organization.',
      'launch.PROJECT.LIMIT_REACHED': 'This organization has reached its project limit.',
      'launch.PROJECT.NOT_FOUND': 'No project found with that name or UID.',
    });
  });
});
