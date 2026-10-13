import { randomBytes } from 'node:crypto';

import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { GIT_CONNECTION_NOT_FOUND_CODE, GIT_ERROR_MESSAGES } from './git.errors';
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
  it('lists the connected namespaces of the organization with the paging it was given', async () => {
    const page = { pagination: { count: 1, limit: 100 }, namespaces: [{ name: 'my-org', provider: 'GitHub' }] };
    const { client, requests, messages } = fakeRestClient(page);

    const result = await new GitApi(client).namespaces({ org: ORG, limit: 100, skip: 0 });

    expect(result).toBe(page);
    expect(requests[0]).toEqual({ method: 'GET', path: '/git-namespaces', orgUid: ORG, query: { limit: 100, skip: 0 } });
    expect(messages[0]).toBe(GIT_ERROR_MESSAGES);
  });

  it('refuses a namespace response that carries no namespace list', async () => {
    const { client } = fakeRestClient({ pagination: { count: 0 } });

    await expect(new GitApi(client).namespaces({ org: ORG })).rejects.toThrow('namespaces');
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

  it('raises a malformed-response error when a repositories body has no repositories array', async () => {
    const { client } = fakeRestClient({});

    await expect(new GitApi(client).repositories({ org: ORG, provider: GIT_PROVIDER_GITHUB })).rejects.toThrow(
      LaunchApiError,
    );
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

  /**
   * Each row is a body management-service's http exception filter really sends - its own code and
   * its own terser message - so a code that has drifted from the service shows up as the API's
   * wording surviving instead of the CLI's. Listing the map back at itself could not.
   */
  it.each<[string, string, string]>([
    ['launch.REPOSITORY.NOT_FOUND', 'No repository found.', 'No repository found with that name for this Git connection.'],
    ['launch.BRANCH.NOT_FOUND', 'No branch found.', 'No branch found with that name in that repository.'],
    [
      'launch.GIT_PROVIDER.UNAUTHORIZED_ACCESS',
      'Unauthorized access to git provider.',
      'Launch could not access your GitHub account. Reconnect GitHub in the Launch app, then try again.',
    ],
  ])('answers %s with the CLI wording rather than the API text', (code, apiText, expected) => {
    const failure = parseErrorEnvelope(404, { errors: [{ code, message: apiText }], status: 404 }, GIT_ERROR_MESSAGES);

    expect(failure.code).toBe(code);
    expect(failure.message).toBe(expected);
  });

  it('leaves a code it has no wording for carrying the API text, so nothing is invented', () => {
    const failure = parseErrorEnvelope(
      404,
      { errors: [{ code: 'launch.GIT_PROVIDER.FORBIDDEN', message: 'Access to git provider is forbidden.' }] },
      GIT_ERROR_MESSAGES,
    );

    expect(failure.message).toBe('Access to git provider is forbidden.');
  });

  it('rewords no code the API never sends, since one that matches nothing can only be dead', () => {
    expect(Object.keys(GIT_ERROR_MESSAGES)).not.toContain('launch.GIT_REPOSITORY.NOT_FOUND');
    expect(Object.keys(GIT_ERROR_MESSAGES)).not.toContain('launch.GIT_BRANCH.NOT_FOUND');
    expect(Object.keys(GIT_ERROR_MESSAGES)).not.toContain(GIT_CONNECTION_NOT_FOUND_CODE);
  });
});
