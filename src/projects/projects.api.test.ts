import { EXIT_USAGE, MAX_PAGES } from '../core/constants';
import { PROJECT_SCAN_PAGE_SIZE } from './projects.api';
import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { ProjectsPage } from './types';
import { buildApi } from '../resources';
import { PROJECT_ERROR_MESSAGES } from './project.errors';
import { ProjectScanLimitError, ProjectsApi } from './projects.api';
import type { CmaSession } from '../transport/cma-client';

const UNUSED_CMA: CmaSession = {
  fetchOrganizations: async () => {
    throw new Error('this test lists no organizations');
  },
  fetchOrganization: async () => {
    throw new Error('this test fetches no organization');
  },
  scopedOrganizationUid: () => undefined,
};

function pagingRestClient(pages: { count?: number; projects: { uid: string; name: string }[] }[]) {
  const requests: RestRequest[] = [];
  let index = 0;
  const client = {
    request: async (req: RestRequest) => {
      requests.push(req);
      const page = pages[Math.min(index++, pages.length - 1)];
      return { pagination: { count: page.count, limit: PROJECT_SCAN_PAGE_SIZE, skip: null }, projects: page.projects };
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

  it('pages the organization one PROJECT_SCAN_PAGE_SIZE page at a time, advancing skip by the projects returned', async () => {
    const { client, requests } = pagingRestClient([
      { count: 150, projects: projectsOfSize(PROJECT_SCAN_PAGE_SIZE, 'a') },
      { count: 150, projects: projectsOfSize(50, 'b') },
    ]);

    const collected = await drain(new ProjectsApi(client).pages({ org: 'org1' }));

    expect(collected).toHaveLength(2);
    expect(collected[0].projects).toHaveLength(PROJECT_SCAN_PAGE_SIZE);
    expect(collected[1].projects).toHaveLength(50);
    expect(requests).toEqual([
      { method: 'GET', path: '/projects', orgUid: 'org1', query: { limit: PROJECT_SCAN_PAGE_SIZE, skip: 0 } },
      { method: 'GET', path: '/projects', orgUid: 'org1', query: { limit: PROJECT_SCAN_PAGE_SIZE, skip: PROJECT_SCAN_PAGE_SIZE } },
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

  it('keeps paging to a short page when the API reports no total at all', async () => {
    const { client, requests } = pagingRestClient([
      { projects: projectsOfSize(2, 'a') },
      { projects: projectsOfSize(1, 'b') },
    ]);

    const collected = await drain(new ProjectsApi(client).pages({ org: 'org1', pageSize: 2 }));

    expect(collected).toHaveLength(2);
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
      { count: 150, projects: projectsOfSize(PROJECT_SCAN_PAGE_SIZE, 'a') },
      { count: 150, projects: projectsOfSize(50, 'b') },
    ]);

    for await (const page of new ProjectsApi(client).pages({ org: 'org1' })) {
      expect(page.projects).toHaveLength(PROJECT_SCAN_PAGE_SIZE);
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

    expect(buildApi(client, UNUSED_CMA).projects).toBeInstanceOf(ProjectsApi);
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
      'launch.GIT_PROVIDER.UNAUTHORIZED_ACCESS':
        'Launch could not access your GitHub account. Reconnect GitHub in the Launch app, then try again.',
      'launch.PROJECT.DUPLICATE_NAME': 'A project with that name already exists in this organization.',
      'launch.PROJECT.LIMIT_REACHED': 'This organization has reached its project limit.',
      'launch.PROJECT.NOT_FOUND': 'No project found with that name or UID.',
      'launch.PROJECT.DELETE_FAILED': 'The Launch API could not delete that project.',
      'launch.PROJECT.UPDATE_FAILED': 'The Launch API could not update that project.',
    });
  });
});

describe('ProjectsApi.delete', () => {
  it('deletes a project as a scoped DELETE carrying no body', async () => {
    const { client, requests } = fakeRestClient(undefined);

    await expect(new ProjectsApi(client).delete({ org: 'org1', project: 'p1' })).resolves.toBeUndefined();

    expect(requests).toEqual([
      { method: 'DELETE', path: '/projects/p1', orgUid: 'org1', projectUid: 'p1' },
    ]);
  });

  it('resolves for a 204 that carried no response body at all', async () => {
    const { client } = fakeRestClient('');

    await expect(new ProjectsApi(client).delete({ org: 'org1', project: 'p1' })).resolves.toBeUndefined();
  });

  it('propagates the API failure rather than reporting a delete that did not happen', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN', message: 'no access' }]);
    const client = {
      request: async () => {
        throw failure;
      },
    } as unknown as RestApiClient;

    await expect(new ProjectsApi(client).delete({ org: 'org1', project: 'p1' })).rejects.toBe(failure);
  });
});

describe('ProjectsApi.update', () => {
  it('updates a project as a scoped PUT carrying only the fields supplied', async () => {
    const { client, requests } = fakeRestClient({ project: { uid: 'p1', name: 'Renamed Site' } });

    const result = await new ProjectsApi(client).update({
      org: 'org1',
      project: 'p1',
      update: { name: 'Renamed Site' },
    });

    expect(result).toEqual({ uid: 'p1', name: 'Renamed Site' });
    expect(requests).toEqual([
      {
        method: 'PUT',
        path: '/projects/p1',
        orgUid: 'org1',
        projectUid: 'p1',
        body: { name: 'Renamed Site' },
      },
    ]);
  });

  it('sends both updatable fields when both were supplied', async () => {
    const { client, requests } = fakeRestClient({ project: { uid: 'p1', name: 'n', description: 'd' } });

    await new ProjectsApi(client).update({
      org: 'org1',
      project: 'p1',
      update: { name: 'n', description: 'd' },
    });

    expect(requests[0].body).toEqual({ name: 'n', description: 'd' });
  });

  it('leaves a field the caller did not supply out of the body rather than sending undefined', async () => {
    const { client, requests } = fakeRestClient({ project: { uid: 'p1', name: 'n' } });

    await new ProjectsApi(client).update({
      org: 'org1',
      project: 'p1',
      update: { name: 'n', description: undefined },
    });

    expect(requests[0].body).toEqual({ name: 'n' });
    expect(Object.keys(requests[0].body as object)).toEqual(['name']);
  });

  it('raises a malformed-response error when the PUT answers without a project envelope', async () => {
    const { client } = fakeRestClient({ uid: 'p1', name: 'n' });

    const error = (await new ProjectsApi(client)
      .update({ org: 'org1', project: 'p1', update: { name: 'n' } })
      .catch((thrown: unknown) => thrown)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.code).toBe('launch.RESPONSE.MALFORMED');
    expect(error.message).toBe('The Launch API returned a project response without a project.');
  });

  it.each([[null], [undefined], ['text']])('raises a malformed-response error for the body %p', async (body) => {
    const { client } = fakeRestClient(body);

    const error = (await new ProjectsApi(client)
      .update({ org: 'org1', project: 'p1', update: { name: 'n' } })
      .catch((thrown: unknown) => thrown)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.code).toBe('launch.RESPONSE.MALFORMED');
  });

  it('propagates the API failure rather than reporting an update that did not happen', async () => {
    const failure = new LaunchApiError(409, [{ code: 'launch.PROJECT.DUPLICATE_NAME', message: 'taken' }]);
    const client = {
      request: async () => {
        throw failure;
      },
    } as unknown as RestApiClient;

    await expect(
      new ProjectsApi(client).update({ org: 'org1', project: 'p1', update: { name: 'n' } }),
    ).rejects.toBe(failure);
  });
});

describe('ProjectsApi create and detection endpoints', () => {
  const CREATE_INPUT = {
    name: 'sample-project',
    projectType: 'FILEUPLOAD' as const,
    environment: {
      name: 'Default',
      buildCommand: 'npm run build',
      outputDirectory: './',
      frameworkPreset: 'OTHER' as const,
      environmentVariables: [],
    },
    fileUpload: { uploadUid: 'upload-uid' },
  };

  it('posts the create body to /projects and unwraps the project envelope', async () => {
    const project = { uid: 'p1', name: 'sample-project', projectType: 'FILEUPLOAD' };
    const { client, requests } = fakeRestClient({ project });

    const result = await new ProjectsApi(client).create({ org: 'org1', input: CREATE_INPUT });

    expect(result).toBe(project);
    expect(requests[0]).toEqual({
      method: 'POST',
      path: '/projects',
      orgUid: 'org1',
      body: CREATE_INPUT,
    });
  });

  it('raises a malformed-response error when create returns no project envelope', async () => {
    const { client } = fakeRestClient({ uid: 'p1' });

    await expect(new ProjectsApi(client).create({ org: 'org1', input: CREATE_INPUT })).rejects.toThrow(
      'The Launch API returned a project response without a project.',
    );
  });

  it.each([[undefined], [null], [''], ['   '], [42]])(
    'raises a malformed-response error when create returns a project whose uid is %p',
    async (uid) => {
      const { client } = fakeRestClient({ project: { uid, name: 'sample-project' } });

      const failure = await new ProjectsApi(client)
        .create({ org: 'org1', input: CREATE_INPUT })
        .catch((error: Error) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as LaunchApiError).exitCode).toBe(1);
      expect((failure as Error).message).toBe('The Launch API returned a project response without a project uid.');
    },
  );

  it('raises a malformed-response error when create returns nothing at all', async () => {
    const { client } = fakeRestClient(undefined);

    await expect(new ProjectsApi(client).create({ org: 'org1', input: CREATE_INPUT })).rejects.toThrow(
      LaunchApiError,
    );
  });

  it('asks for a signed upload url as an org-scoped GET', async () => {
    const signed = {
      uploadUrl: 'https://uploads.example.test/x',
      expiresIn: 600,
      uploadUid: 'upload-uid',
      method: 'POST',
      fields: [{ formFieldKey: 'bucket', formFieldValue: 'launch-uploads' }],
    };
    const { client, requests } = fakeRestClient(signed);

    const result = await new ProjectsApi(client).signedUploadUrl({ org: 'org1' });

    expect(result).toBe(signed);
    expect(requests[0]).toEqual({ method: 'GET', path: '/projects/upload/signed_url', orgUid: 'org1' });
  });

  it('raises a malformed-response error when the signed url response is unusable', async () => {
    for (const body of [undefined, {}, { uploadUrl: 'https://x' }, { uploadUid: 'u' }, { uploadUrl: 1, uploadUid: 'u' }]) {
      const { client } = fakeRestClient(body);

      await expect(new ProjectsApi(client).signedUploadUrl({ org: 'org1' })).rejects.toThrow(
        'The Launch API returned an upload response without an upload URL and uid.',
      );
    }
  });

  it('detects a framework from a git repository and branch', async () => {
    const detected = { framework: 'NEXTJS', buildCommand: 'npm run build', outputDirectory: '.next' };
    const { client, requests } = fakeRestClient(detected);

    const result = await new ProjectsApi(client).gitFramework({
      org: 'org1',
      provider: 'GitHub',
      repoName: 'my-org/my-repo',
      branchName: 'main',
      namespace: 'my-org',
    });

    expect(result).toBe(detected);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/projects/framework',
      orgUid: 'org1',
      query: { provider: 'GitHub', repoName: 'my-org/my-repo', branchName: 'main', namespace: 'my-org' },
    });
  });

  it('detects a framework from an uploaded bundle', async () => {
    const detected = { framework: 'OTHER' };
    const { client, requests } = fakeRestClient(detected);

    const result = await new ProjectsApi(client).fileFramework({ org: 'org1', uploadUid: 'upload-uid' });

    expect(result).toBe(detected);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/projects/file-framework',
      orgUid: 'org1',
      query: { uploadUid: 'upload-uid' },
    });
  });

  it('raises a malformed-response error when a framework response is not an object', async () => {
    const { client } = fakeRestClient(null);

    await expect(new ProjectsApi(client).fileFramework({ org: 'org1', uploadUid: 'u' })).rejects.toThrow(
      'The Launch API returned a framework response that was not an object.',
    );
  });

  it('accepts a framework response that names nothing it detected', async () => {
    const { client } = fakeRestClient({});

    await expect(new ProjectsApi(client).fileFramework({ org: 'org1', uploadUid: 'u' })).resolves.toEqual({});
  });
});
