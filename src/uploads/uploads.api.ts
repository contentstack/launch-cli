import { isRecord } from '../core/values';
import { malformed } from '../transport/envelope';
import type { RestApiClient } from '../transport/rest-client';
import { UPLOAD_ERROR_MESSAGES } from './upload.errors';
import type { SignedUploadUrl } from './types';

export * from './types';

export type UploadScope =
  | { org: string; project?: undefined; environment?: undefined }
  | { org: string; project: string; environment?: string };

function signedUploadPath(scope: UploadScope): string {
  if (scope.project === undefined) {
    return '/projects/upload/signed_url';
  }

  if (scope.environment === undefined) {
    return `/projects/${scope.project}/environments/upload/signed_url`;
  }

  return `/projects/${scope.project}/environments/${scope.environment}/deployments/upload/signed_url`;
}

function isSignedUploadUrl(value: unknown): value is SignedUploadUrl {
  return isRecord(value) && typeof value.uploadUrl === 'string' && typeof value.uploadUid === 'string';
}

export class UploadsApi {
  constructor(private readonly client: RestApiClient) {}

  async signedUploadUrl(scope: UploadScope): Promise<SignedUploadUrl> {
    const response = await this.client.request<SignedUploadUrl>(
      { method: 'GET', path: signedUploadPath(scope), orgUid: scope.org, projectUid: scope.project },
      UPLOAD_ERROR_MESSAGES,
    );

    if (!isSignedUploadUrl(response)) {
      throw malformed('The Launch API returned an upload response without an upload URL and uid.');
    }

    return response;
  }
}
