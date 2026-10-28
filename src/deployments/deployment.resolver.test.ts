import { UsageError } from '../core/errors';
import { LaunchApiError } from '../transport/errors';
import { fetchDeployment } from './deployment.resolver';
import type { GetDeploymentParams } from './deployments.api';

const PARAMS: GetDeploymentParams = { org: 'org1', project: 'proj1', environment: 'env1', deployment: 'dep1' };

function fakeApi(outcome: () => Promise<unknown>) {
  const asked: GetDeploymentParams[] = [];

  return {
    asked,
    api: {
      get: async (params: GetDeploymentParams) => {
        asked.push(params);
        return outcome();
      },
    } as never,
  };
}

describe('fetchDeployment', () => {
  it('returns the deployment the api found, asking for exactly the scope it was given', async () => {
    const deployment = { uid: 'dep1', status: 'LIVE' };
    const { api, asked } = fakeApi(async () => deployment);

    await expect(fetchDeployment(api, PARAMS)).resolves.toBe(deployment);
    expect(asked).toEqual([PARAMS]);
  });

  it('turns a 404 DEPLOYMENT.NOT_FOUND into the generic usage error naming only the uid and the environment', async () => {
    const { api } = fakeApi(async () => {
      throw new LaunchApiError(404, [{ code: 'launch.DEPLOYMENT.NOT_FOUND', message: 'Deployment not found.' }]);
    });

    const failure = await fetchDeployment(api, PARAMS).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(2);
    expect((failure as Error).message).toBe('No deployment with UID "dep1" found in this environment.');
  });

  it.each([
    [404, 'launch.ENVIRONMENT.NOT_FOUND'],
    [500, 'launch.DEPLOYMENT.NOT_FOUND'],
    [500, 'launch.UNKNOWN'],
  ])('lets a %i %s through as the same api error', async (status, code) => {
    const failure = new LaunchApiError(status, [{ code, message: 'x' }]);
    const { api } = fakeApi(async () => Promise.reject(failure));

    await expect(fetchDeployment(api, PARAMS)).rejects.toBe(failure);
  });

  it('lets a failure that is not an api error through untouched', async () => {
    const failure = new Error('socket');
    const { api } = fakeApi(async () => Promise.reject(failure));

    await expect(fetchDeployment(api, PARAMS)).rejects.toBe(failure);
  });
});
