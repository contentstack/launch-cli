import { randomBytes } from 'node:crypto';

import { LaunchApiError } from '../transport/errors';
import { RestApiClient, RestRequest } from '../transport/rest-client';
import { GIT_ERROR_MESSAGES } from './git.errors';
import { GitApi } from './git.api';
import { GIT_PROVIDER_GITHUB } from './types';

const ORG = randomBytes(9).toString('hex');

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

describe('GitApi', () => {
  it('lists namespaces as an org-scoped GET carrying limit and skip', async () => {
    const page = { pagination: { count: 1, limit: 100, skip: 0 }, namespaces: [{ name: 'my-org' }] };
    const { client, requests, messages } = fakeRestClient(page);

    const result = await new GitApi(client).namespaces({ org: ORG, limit: 100, skip: 0 });

    expect(result).toBe(page);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/git-namespaces',
      orgUid: ORG,
      query: { limit: 100, skip: 0 },
    });
    expect(messages[0]).toBe(GIT_ERROR_MESSAGES);
  });

  it('lists repositories carrying the provider, namespace and search it was given', async () => {
    const page = { pagination: { count: 1, limit: 100 }, repositories: [{ fullName: 'my-org/my-repo' }] };
    const { client, requests } = fakeRestClient(page);

    const result = await new GitApi(client).repositories({
      org: ORG,
      provider: GIT_PROVIDER_GITHUB,
      namespace: 'my-org',
      search: 'my-repo',
      limit: 100,
      skip: 0,
    });

    expect(result).toBe(page);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/git-repositories',
      orgUid: ORG,
      query: {
        provider: 'GitHub',
        namespace: 'my-org',
        search: 'my-repo',
        limit: 100,
        skip: 0,
      },
    });
  });

  it('lists branches carrying the repository name it was given', async () => {
    const page = { pagination: { count: 1, limit: 100 }, branches: [{ name: 'main' }] };
    const { client, requests } = fakeRestClient(page);

    await new GitApi(client).branches({
      org: ORG,
      provider: GIT_PROVIDER_GITHUB,
      repoName: 'my-org/my-repo',
      namespace: 'my-org',
    });

    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/git-branches',
      orgUid: ORG,
      query: {
        provider: 'GitHub',
        repoName: 'my-org/my-repo',
        namespace: 'my-org',
        search: undefined,
        limit: undefined,
        skip: undefined,
      },
    });
  });

  it('raises a malformed-response error when a namespaces body has no namespaces array', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0, limit: 100 } });

    await expect(new GitApi(client).namespaces({ org: ORG })).rejects.toThrow(LaunchApiError);
    await expect(new GitApi(client).namespaces({ org: ORG })).rejects.toThrow(
      'The Launch API returned a namespaces response without a namespaces array.',
    );
  });

  it('raises a malformed-response error when a repositories body has no repositories array', async () => {
    const { client } = fakeRestClient({});

    await expect(
      new GitApi(client).repositories({ org: ORG, provider: GIT_PROVIDER_GITHUB }),
    ).rejects.toThrow('The Launch API returned a repositories response without a repositories array.');
  });

  it('raises a malformed-response error when a branches body has no branches array', async () => {
    const { client } = fakeRestClient(null);

    await expect(
      new GitApi(client).branches({ org: ORG, provider: GIT_PROVIDER_GITHUB, repoName: 'my-org/my-repo' }),
    ).rejects.toThrow('The Launch API returned a branches response without a branches array.');
  });

  it('rewords the Git failures the CLI has its own wording for', () => {
    expect(Object.keys(GIT_ERROR_MESSAGES).sort()).toEqual([
      'launch.GIT_BRANCH.NOT_FOUND',
      'launch.GIT_PROVIDER.UNAUTHORIZED_ACCESS',
      'launch.GIT_REPOSITORY.NOT_FOUND',
      'launch.PROVIDER.REQUIRED',
      'launch.USERCONNECTION.NOT_FOUND',
    ]);
    expect(GIT_ERROR_MESSAGES['launch.USERCONNECTION.NOT_FOUND']).toContain('Connect one in the Launch app');
  });
});
