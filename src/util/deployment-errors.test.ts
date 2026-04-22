import {
  collectLaunchDeploymentErrorCodesFromGraphQLError,
  FILE_UPLOAD_SIZE_LIMIT_USER_MESSAGE,
  isLaunchDeploymentFileSizeRelatedError,
} from './deployment-errors';

describe('deployment-errors', () => {
  it('should expose user message aligned with Launch file upload rules', () => {
    expect(FILE_UPLOAD_SIZE_LIMIT_USER_MESSAGE).toBe(
      'Please use a file over the size of 1KB and under the size of 100MB.',
    );
  });

  it('should collect codes from messages, uploadUid errorObject, and cause graphQLErrors in one flow', () => {
    const error = {
      graphQLErrors: [
        {
          extensions: {
            exception: {
              messages: ['launch.DEPLOYMENT.INVALID_FILE_SIZE', 'other'],
              errorObject: {
                uploadUid: [{ code: 'launch.DEPLOYMENT.FILE_UPLOAD_FAILED' }],
              },
            },
          },
        },
      ],
      cause: {
        graphQLErrors: [
          {
            extensions: {
              exception: {
                messages: ['launch.OTHER.CODE'],
              },
            },
          },
        ],
      },
    };

    const codes = collectLaunchDeploymentErrorCodesFromGraphQLError(error);

    expect(codes).toEqual([
      'launch.DEPLOYMENT.INVALID_FILE_SIZE',
      'other',
      'launch.DEPLOYMENT.FILE_UPLOAD_FAILED',
      'launch.OTHER.CODE',
    ]);
    expect(isLaunchDeploymentFileSizeRelatedError(error)).toBe(true);
  });

  it('should return false when graphQL errors have no file size related codes', () => {
    const error = {
      graphQLErrors: [
        {
          extensions: {
            exception: {
              messages: ['launch.PROJECTS.DUPLICATE_NAME'],
            },
          },
        },
      ],
    };

    expect(collectLaunchDeploymentErrorCodesFromGraphQLError(error)).toEqual(['launch.PROJECTS.DUPLICATE_NAME']);
    expect(isLaunchDeploymentFileSizeRelatedError(error)).toBe(false);
  });

  it('should return false for empty or malformed error input', () => {
    expect(collectLaunchDeploymentErrorCodesFromGraphQLError(undefined)).toEqual([]);
    expect(isLaunchDeploymentFileSizeRelatedError(undefined)).toBe(false);
    expect(collectLaunchDeploymentErrorCodesFromGraphQLError({})).toEqual([]);
    expect(isLaunchDeploymentFileSizeRelatedError({})).toBe(false);
    expect(
      collectLaunchDeploymentErrorCodesFromGraphQLError({
        graphQLErrors: [{ extensions: {} }],
      }),
    ).toEqual([]);
    expect(
      isLaunchDeploymentFileSizeRelatedError({
        graphQLErrors: [{ extensions: {} }],
      }),
    ).toBe(false);
  });

  it('should skip non-string entries in messages and still collect string codes', () => {
    const error = {
      graphQLErrors: [
        {
          extensions: {
            exception: {
              messages: [
                null,
                42,
                { nested: 'launch.DEPLOYMENT.INVALID_FILE_SIZE' },
                'launch.DEPLOYMENT.INVALID_FILE_SIZE',
                '',
                '   ',
                '\t',
              ],
            },
          },
        },
      ],
    };

    const codes = collectLaunchDeploymentErrorCodesFromGraphQLError(error);

    expect(codes).toEqual(['launch.DEPLOYMENT.INVALID_FILE_SIZE']);
    expect(isLaunchDeploymentFileSizeRelatedError(error)).toBe(true);
  });

  it('should skip uploadUid entries without a string code and still collect valid codes', () => {
    const error = {
      graphQLErrors: [
        {
          extensions: {
            exception: {
              errorObject: {
                uploadUid: [
                  null,
                  'not-an-object',
                  {},
                  { code: 123 },
                  { notCode: 'launch.DEPLOYMENT.FILE_UPLOAD_FAILED' },
                  { code: 'launch.DEPLOYMENT.FILE_UPLOAD_FAILED' },
                ],
              },
            },
          },
        },
      ],
    };

    const codes = collectLaunchDeploymentErrorCodesFromGraphQLError(error);

    expect(codes).toEqual(['launch.DEPLOYMENT.FILE_UPLOAD_FAILED']);
    expect(isLaunchDeploymentFileSizeRelatedError(error)).toBe(true);
  });

  it('should detect FILE_UPLOAD_FAILED only from uploadUid when messages are absent', () => {
    const error = {
      graphQLErrors: [
        {
          extensions: {
            exception: {
              errorObject: {
                uploadUid: [{ code: 'launch.DEPLOYMENT.FILE_UPLOAD_FAILED' }],
              },
            },
          },
        },
      ],
    };

    expect(isLaunchDeploymentFileSizeRelatedError(error)).toBe(true);
  });
});
