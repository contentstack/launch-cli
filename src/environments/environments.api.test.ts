import { randomBytes } from 'node:crypto';

import { EXIT_USAGE, MAX_PAGES } from '../core/constants';
import { LaunchApiError } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { ENVIRONMENT_ERROR_MESSAGES } from './environment.errors';
import type { EnvironmentsPage } from './environments.api';
import { ENVIRONMENT_SCAN_PAGE_SIZE, EnvironmentScanLimitError, EnvironmentsApi } from './environments.api';

const ORG = randomBytes(9).toString('hex');
const PROJECT = randomBytes(12).toString('hex');
const ENVIRONMENT = randomBytes(12).toString('hex');

const SCOPE = { org: ORG, project: PROJECT };

function fakeRestClient(result: unknown) {
  const requests: RestRequest[] = [];
  const messages: unknown[] = [];
  const client = {
    request: async (req: RestRequest, errorMessages: unknown) => {
      requests.push(req);
      messages.push(errorMessages);
      return result;
    },
  } as unknown as RestApiClient;

  return { client, requests, messages };
}

function pagingRestClient(pages: { count?: number; size: number }[]) {
  const requests: RestRequest[] = [];
  let index = 0;
  const client = {
    request: async (req: RestRequest) => {
      requests.push(req);
      const page = pages[Math.min(index++, pages.length - 1)];
      return {
        pagination: { count: page.count, limit: ENVIRONMENT_SCAN_PAGE_SIZE, skip: null },
        environments: Array.from({ length: page.size }, (_, n) => ({ uid: `e${index}-${n}`, name: `env-${n}` })),
      };
    },
  } as unknown as RestApiClient;

  return { client, requests };
}

async function drain(iterator: AsyncGenerator<EnvironmentsPage>): Promise<EnvironmentsPage[]> {
  const collected: EnvironmentsPage[] = [];
  for await (const page of iterator) {
    collected.push(page);
  }
  return collected;
}

describe('EnvironmentsApi', () => {
  it('lists environments as a project-scoped GET carrying limit and skip', async () => {
    const page = { pagination: { count: 1, limit: 10, skip: 0 }, environments: [{ uid: ENVIRONMENT, name: 'Default' }] };
    const { client, requests, messages } = fakeRestClient(page);

    const result = await new EnvironmentsApi(client).list({ ...SCOPE, limit: 10, skip: 0 });

    expect(result).toBe(page);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: `/projects/${PROJECT}/environments`,
      orgUid: ORG,
      projectUid: PROJECT,
      query: { limit: 10, skip: 0 },
    });
    expect(messages[0]).toBe(ENVIRONMENT_ERROR_MESSAGES);
  });

  it('raises a malformed-response error when the list has no environments array', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 10 } });

    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(LaunchApiError);
    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned an environment list without an environments array.',
    );
  });

  it('raises a malformed-response error when the list has no pagination block', async () => {
    const { client } = fakeRestClient({ environments: [] });

    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned an environment list without a pagination block.',
    );
  });

  it('raises a malformed-response error when the list body is not an object at all', async () => {
    const { client } = fakeRestClient('');

    await expect(new EnvironmentsApi(client).list(SCOPE)).rejects.toThrow(
      'The Launch API returned an environment list without an environments array.',
    );
  });

  it('asks for one environment when it wants the first one', async () => {
    const environment = { uid: ENVIRONMENT, name: 'Default' };
    const { client, requests } = fakeRestClient({ pagination: { count: 1, limit: 1 }, environments: [environment] });

    const result = await new EnvironmentsApi(client).first(SCOPE);

    expect(result).toBe(environment);
    expect(requests[0].query).toEqual({ limit: 1, skip: 0 });
  });

  it.each([[undefined], [null], [''], ['  ']])(
    'refuses a first environment whose uid is %p rather than handing back one nothing can address',
    async (uid) => {
      const { client } = fakeRestClient({ pagination: { count: 1, limit: 1 }, environments: [{ uid, name: 'Default' }] });

      const failure = await new EnvironmentsApi(client).first(SCOPE).catch((error: Error) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as Error).message).toBe('The Launch API returned an environment without an environment uid.');
    },
  );

  it('gets one environment as a project-scoped GET and unwraps the environment envelope', async () => {
    const environment = { uid: ENVIRONMENT, name: 'production' };
    const { client, requests, messages } = fakeRestClient({ environment });

    const result = await new EnvironmentsApi(client).get({ ...SCOPE, environment: ENVIRONMENT });

    expect(result).toBe(environment);
    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}`,
        orgUid: ORG,
        projectUid: PROJECT,
      },
    ]);
    expect(messages[0]).toBe(ENVIRONMENT_ERROR_MESSAGES);
  });

  it.each([[{}], [{ environment: null }], [{ environment: 'production' }], ['']])(
    'raises a malformed-response error when the get body %p carries no environment object',
    async (body) => {
      const { client } = fakeRestClient(body);

      const failure = await new EnvironmentsApi(client)
        .get({ ...SCOPE, environment: ENVIRONMENT })
        .catch((error: Error) => error);

      expect(failure).toBeInstanceOf(LaunchApiError);
      expect((failure as Error).message).toBe('The Launch API returned an environment response without an environment.');
    },
  );

  it('pages the project one ENVIRONMENT_SCAN_PAGE_SIZE page at a time, advancing skip by the environments returned', async () => {
    const { client, requests } = pagingRestClient([
      { count: 150, size: ENVIRONMENT_SCAN_PAGE_SIZE },
      { count: 150, size: 50 },
    ]);

    const collected = await drain(new EnvironmentsApi(client).pages(SCOPE));

    expect(collected.map((page) => page.environments.length)).toEqual([ENVIRONMENT_SCAN_PAGE_SIZE, 50]);
    expect(ENVIRONMENT_SCAN_PAGE_SIZE).toBe(100);
    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/environments`,
        orgUid: ORG,
        projectUid: PROJECT,
        query: { limit: ENVIRONMENT_SCAN_PAGE_SIZE, skip: 0 },
      },
      {
        method: 'GET',
        path: `/projects/${PROJECT}/environments`,
        orgUid: ORG,
        projectUid: PROJECT,
        query: { limit: ENVIRONMENT_SCAN_PAGE_SIZE, skip: ENVIRONMENT_SCAN_PAGE_SIZE },
      },
    ]);
  });

  it('keeps paging past a full page when the API reports no total, and stops on the short page', async () => {
    const { client, requests } = pagingRestClient([{ size: ENVIRONMENT_SCAN_PAGE_SIZE }, { size: 1 }]);

    const collected = await drain(new EnvironmentsApi(client).pages(SCOPE));

    expect(collected).toHaveLength(2);
    expect(requests.map((request) => request.query)).toEqual([
      { limit: ENVIRONMENT_SCAN_PAGE_SIZE, skip: 0 },
      { limit: ENVIRONMENT_SCAN_PAGE_SIZE, skip: ENVIRONMENT_SCAN_PAGE_SIZE },
    ]);
  });

  it('stops after a page one shorter than the page size rather than asking for another', async () => {
    const { client, requests } = pagingRestClient([{ count: 900, size: ENVIRONMENT_SCAN_PAGE_SIZE - 1 }]);

    const collected = await drain(new EnvironmentsApi(client).pages(SCOPE));

    expect(collected).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('stops on an empty page without yielding it, even when the count is never satisfied', async () => {
    const { client, requests } = pagingRestClient([{ count: 900, size: 0 }]);

    const collected = await drain(new EnvironmentsApi(client).pages(SCOPE));

    expect(collected).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('stops once the reported count is reached exactly, even though the last page was full', async () => {
    const { client, requests } = pagingRestClient([{ count: ENVIRONMENT_SCAN_PAGE_SIZE, size: ENVIRONMENT_SCAN_PAGE_SIZE }]);

    const collected = await drain(new EnvironmentsApi(client).pages(SCOPE));

    expect(collected).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('asks for the next page when the reported count is one more than what was read', async () => {
    const { client, requests } = pagingRestClient([
      { count: ENVIRONMENT_SCAN_PAGE_SIZE + 1, size: ENVIRONMENT_SCAN_PAGE_SIZE },
      { count: ENVIRONMENT_SCAN_PAGE_SIZE + 1, size: 1 },
    ]);

    await drain(new EnvironmentsApi(client).pages(SCOPE));

    expect(requests).toHaveLength(2);
  });

  it('raises the page ceiling by name after MAX_PAGES full pages rather than reporting the scan as complete', async () => {
    const { client, requests } = pagingRestClient([{ count: Number.NaN, size: ENVIRONMENT_SCAN_PAGE_SIZE }]);

    const rejection = await drain(new EnvironmentsApi(client).pages(SCOPE)).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(EnvironmentScanLimitError);
    expect((rejection as Error).message).toBe(
      `Stopped after scanning ${MAX_PAGES} pages of environments without reaching the end of the project. ` +
        'Pass --env with the environment uid instead of its name.',
    );
    expect((rejection as EnvironmentScanLimitError).exitCode).toBe(EXIT_USAGE);
    expect((rejection as Error).name).toBe('EnvironmentScanLimitError');
    expect(requests).toHaveLength(MAX_PAGES);
  });

  it('fetches no further page once the consumer stops reading', async () => {
    const { client, requests } = pagingRestClient([
      { count: 150, size: ENVIRONMENT_SCAN_PAGE_SIZE },
      { count: 150, size: 50 },
    ]);

    for await (const page of new EnvironmentsApi(client).pages(SCOPE)) {
      expect(page.environments).toHaveLength(ENVIRONMENT_SCAN_PAGE_SIZE);
      break;
    }

    expect(requests).toHaveLength(1);
  });

  it('propagates a failed page request instead of swallowing it mid-walk', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN', message: 'no access' }]);
    const client = {
      request: async () => {
        throw failure;
      },
    } as unknown as RestApiClient;

    await expect(drain(new EnvironmentsApi(client).pages(SCOPE))).rejects.toBe(failure);
    await expect(new EnvironmentsApi(client).get({ ...SCOPE, environment: ENVIRONMENT })).rejects.toBe(failure);
  });

  it('deletes one environment as a bodyless project-scoped DELETE', async () => {
    const { client, requests, messages } = fakeRestClient(undefined);

    await expect(new EnvironmentsApi(client).delete({ ...SCOPE, environment: ENVIRONMENT })).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        method: 'DELETE',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}`,
        orgUid: ORG,
        projectUid: PROJECT,
      },
    ]);
    expect(messages[0]).toBe(ENVIRONMENT_ERROR_MESSAGES);
  });

  it('updates one environment with a project-scoped PUT carrying only the given fields', async () => {
    const environment = { uid: ENVIRONMENT, name: 'renamed' };
    const { client, requests, messages } = fakeRestClient({ environment });
    const update = { name: 'renamed', isCachePrimingEnabled: false };

    const result = await new EnvironmentsApi(client).update({ ...SCOPE, environment: ENVIRONMENT, update });

    expect(result).toBe(environment);
    expect(requests).toEqual([
      {
        method: 'PUT',
        path: `/projects/${PROJECT}/environments/${ENVIRONMENT}`,
        orgUid: ORG,
        projectUid: PROJECT,
        body: { name: 'renamed', isCachePrimingEnabled: false },
      },
    ]);
    expect(messages[0]).toBe(ENVIRONMENT_ERROR_MESSAGES);
  });

  it('raises a malformed-response error when the update body carries no environment', async () => {
    const { client } = fakeRestClient({});

    await expect(
      new EnvironmentsApi(client).update({ ...SCOPE, environment: ENVIRONMENT, update: { name: 'x' } }),
    ).rejects.toThrow('The Launch API returned an environment response without an environment.');
  });

  it.each([
    [[{ message: 'launch.ENVIRONMENT.DUPLICATE_NAME' }]],
    [[{ code: 'launch.ENVIRONMENT.DUPLICATE_NAME', message: 'Environment name already exists.' }]],
    [[{}]],
    [[]],
  ])('words a 409 from the update as a taken name, however the service shaped it (%p)', async (errors) => {
    const client = {
      request: async () => {
        throw new LaunchApiError(409, errors);
      },
    } as unknown as RestApiClient;

    const failure = await new EnvironmentsApi(client)
      .update({ ...SCOPE, environment: ENVIRONMENT, update: { name: 'taken' } })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LaunchApiError);
    expect((failure as LaunchApiError).status).toBe(409);
    expect((failure as Error).message).toBe('An environment with that name already exists in this project.');
  });

  it.each([
    [[{ code: 'launch.ENVIRONMENT.SOMETHING_ELSE', message: 'Another conflict.' }]],
    [[{ message: 'Another conflict.' }]],
  ])('leaves a 409 that names some other conflict alone (%p)', async (errors) => {
    const conflict = new LaunchApiError(409, errors);
    const client = {
      request: async () => {
        throw conflict;
      },
    } as unknown as RestApiClient;

    await expect(
      new EnvironmentsApi(client).update({ ...SCOPE, environment: ENVIRONMENT, update: { name: 'x' } }),
    ).rejects.toBe(conflict);
  });

  it.each([[[{}]], [[]]])('leaves an empty 409 alone when the update did not change the name (%p)', async (errors) => {
    const conflict = new LaunchApiError(409, errors);
    const client = {
      request: async () => {
        throw conflict;
      },
    } as unknown as RestApiClient;

    await expect(
      new EnvironmentsApi(client).update({ ...SCOPE, environment: ENVIRONMENT, update: { buildCommand: 'make' } }),
    ).rejects.toBe(conflict);
  });

  it('propagates any other update failure unchanged', async () => {
    const failure = new LaunchApiError(403, [{ code: 'launch.FORBIDDEN_RESOURCE', message: 'not in plan' }]);
    const client = {
      request: async () => {
        throw failure;
      },
    } as unknown as RestApiClient;

    await expect(
      new EnvironmentsApi(client).update({ ...SCOPE, environment: ENVIRONMENT, update: { name: 'x' } }),
    ).rejects.toBe(failure);
  });

  it('words the duplicate-name code the create endpoint sends', () => {
    expect(ENVIRONMENT_ERROR_MESSAGES['launch.ENVIRONMENT.DUPLICATE_NAME']).toBe(
      'An environment with that name already exists in this project.',
    );
  });

  it('creates an environment with a project-scoped POST and unwraps the identified environment', async () => {
    const environment = { uid: ENVIRONMENT, name: 'staging' };
    const { client, requests, messages } = fakeRestClient({ environment });
    const input = {
      name: 'staging',
      gitBranch: 'develop',
      outputDirectory: './.next',
      frameworkPreset: 'NEXTJS' as const,
      environmentVariables: [],
    };

    await expect(new EnvironmentsApi(client).create({ ...SCOPE, input })).resolves.toBe(environment);
    expect(requests).toEqual([
      { method: 'POST', path: `/projects/${PROJECT}/environments`, orgUid: ORG, projectUid: PROJECT, body: input },
    ]);
    expect(messages[0]).toBe(ENVIRONMENT_ERROR_MESSAGES);
  });

  it.each([[{}], [{ environment: { name: 'staging' } }], [{ environment: { uid: '  ' } }]])(
    'refuses a create response %p that carries no addressable environment',
    async (body) => {
      const { client } = fakeRestClient(body);
      const input = { name: 'x', outputDirectory: './out', frameworkPreset: 'OTHER' as const, environmentVariables: [] };

      await expect(new EnvironmentsApi(client).create({ ...SCOPE, input })).rejects.toBeInstanceOf(LaunchApiError);
    },
  );

  it('reports no first environment when the project has none', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 1 }, environments: [] });

    await expect(new EnvironmentsApi(client).first(SCOPE)).resolves.toBeUndefined();
  });
});
