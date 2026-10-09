import { isRecord } from '../core/values';
import { malformed } from '../transport/envelope';
import type { RestApiClient } from '../transport/rest-client';
import { UPLOAD_ERROR_MESSAGES } from './upload.errors';
import type { SignedUploadUrl } from './types';

export * from './types';

export interface SignedUploadUrlParams {
  org: string;
}

function isSignedUploadUrl(value: unknown): value is SignedUploadUrl {
  return isRecord(value) && typeof value.uploadUrl === 'string' && typeof value.uploadUid === 'string';
}

export class UploadsApi {
  constructor(private readonly client: RestApiClient) {}

  async signedUploadUrl(params: SignedUploadUrlParams): Promise<SignedUploadUrl> {
    const response = await this.client.request<SignedUploadUrl>(
      { method: 'GET', path: '/projects/upload/signed_url', orgUid: params.org },
      UPLOAD_ERROR_MESSAGES,
    );

    if (!isSignedUploadUrl(response)) {
      throw malformed('The Launch API returned an upload response without an upload URL and uid.');
    }

    return response;
  }
}
