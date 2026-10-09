import type { RestApiClient, RestRequest } from '../transport/rest-client';
import { LaunchApiError, parseErrorEnvelope } from '../transport/errors';
import { UPLOAD_ERROR_MESSAGES } from './upload.errors';
import { UploadsApi } from './uploads.api';

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

const SIGNED = { uploadUrl: 'https://uploads.example.test/x', uploadUid: 'upload-uid' };

describe('UploadsApi', () => {
  it('asks for a signed upload url as an org-scoped GET', async () => {
    const signed = {
      uploadUrl: 'https://uploads.example.test/x',
      expiresIn: 600,
      uploadUid: 'upload-uid',
      method: 'POST',
      fields: [{ formFieldKey: 'bucket', formFieldValue: 'launch-uploads' }],
    };
    const { client, requests } = fakeRestClient(signed);

    const result = await new UploadsApi(client).signedUploadUrl({ org: 'org1' });

    expect(result).toBe(signed);
    expect(requests[0]).toEqual({ method: 'GET', path: '/projects/upload/signed_url', orgUid: 'org1' });
  });

  it('asks the environment upload url, scoped to the project, for a new environment', async () => {
    const { client, requests } = fakeRestClient(SIGNED);

    await new UploadsApi(client).signedUploadUrl({ org: 'org1', project: 'p1' });

    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/projects/p1/environments/upload/signed_url',
      orgUid: 'org1',
      projectUid: 'p1',
    });
  });

  it('asks the deployment upload url, scoped to the project, for a redeploy of an environment', async () => {
    const { client, requests } = fakeRestClient(SIGNED);

    await new UploadsApi(client).signedUploadUrl({ org: 'org1', project: 'p1', environment: 'e1' });

    expect(requests[0]).toEqual({
      method: 'GET',
      path: '/projects/p1/environments/e1/deployments/upload/signed_url',
      orgUid: 'org1',
      projectUid: 'p1',
    });
  });

  it('raises a malformed-response error when the signed url response is unusable', async () => {
    for (const body of [
      undefined,
      {},
      { uploadUrl: 'https://x' },
      { uploadUid: 'u' },
      { uploadUrl: 1, uploadUid: 'u' },
    ]) {
      const { client } = fakeRestClient(body);

      await expect(new UploadsApi(client).signedUploadUrl({ org: 'org1' })).rejects.toThrow(
        'The Launch API returned an upload response without an upload URL and uid.',
      );
    }
  });

  it.each([
    ['launch.PROJECT.FILE_UPLOAD_SIGNED_URL.GET_FAILED', 'The Launch API could not prepare an upload for your project files.'],
    [
      'launch.ENVIRONMENT.FILE_UPLOAD_SIGNED_URL.GET_FAILED',
      'The Launch API could not prepare an upload for your environment files.',
    ],
    [
      'launch.DEPLOYMENT.FILE_UPLOAD_SIGNED_URL.GET_FAILED',
      'The Launch API could not prepare an upload for your deployment files.',
    ],
  ])('rewords the refused signed url %s in the upload wording', async (code, wording) => {
    const client = {
      request: async (_req: RestRequest, messages?: Record<string, string>) => {
        throw parseErrorEnvelope(500, { errors: [{ code }] }, messages);
      },
    } as unknown as RestApiClient;

    const error = (await new UploadsApi(client).signedUploadUrl({ org: 'org1' }).catch((e) => e)) as LaunchApiError;

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.message).toBe(wording);
  });
});

describe('UPLOAD_ERROR_MESSAGES', () => {
  it('maps every upload code the CLI rewords and nothing else', () => {
    expect(UPLOAD_ERROR_MESSAGES).toEqual({
      'launch.PROJECT.FILE_UPLOAD_SIGNED_URL.GET_FAILED':
        'The Launch API could not prepare an upload for your project files.',
      'launch.ENVIRONMENT.FILE_UPLOAD_SIGNED_URL.GET_FAILED':
        'The Launch API could not prepare an upload for your environment files.',
      'launch.DEPLOYMENT.FILE_UPLOAD_SIGNED_URL.GET_FAILED':
        'The Launch API could not prepare an upload for your deployment files.',
    });
  });
});
