export const FILE_UPLOAD_SIZE_LIMIT_USER_MESSAGE =
  'Please use a file over the size of 1KB and under the size of 100MB.';

const DEPLOYMENT_FILE_SIZE_RELATED_CODES: readonly string[] = [
  'launch.DEPLOYMENT.INVALID_FILE_SIZE',
  'launch.DEPLOYMENT.FILE_UPLOAD_FAILED',
];

function appendCodesFromException(codes: string[], exception: Record<string, unknown> | undefined | null): void {
  if (!exception || typeof exception !== 'object') {
    return;
  }
  const messages = exception.messages;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (typeof m === 'string' && m.trim() !== '') {
        codes.push(m);
      }
    }
  }
  const errorObject = exception.errorObject as Record<string, unknown> | undefined;
  const uploadUid = errorObject?.uploadUid;
  if (Array.isArray(uploadUid)) {
    for (const item of uploadUid) {
      if (item && typeof item === 'object' && typeof (item as { code?: unknown }).code === 'string') {
        codes.push((item as { code: string }).code);
      }
    }
  }
}

export function collectLaunchDeploymentErrorCodesFromGraphQLError(error: unknown): string[] {
  const codes: string[] = [];
  const err = error as {
    graphQLErrors?: unknown[];
    cause?: { graphQLErrors?: unknown[] };
  };
  const buckets = [err?.graphQLErrors, err?.cause?.graphQLErrors];
  for (const gqlErrors of buckets) {
    if (!Array.isArray(gqlErrors)) {
      continue;
    }
    for (const gqlError of gqlErrors) {
      const ext = (gqlError as { extensions?: { exception?: Record<string, unknown> } })?.extensions?.exception;
      appendCodesFromException(codes, ext);
    }
  }
  return codes;
}

export function isLaunchDeploymentFileSizeRelatedError(error: unknown): boolean {
  const codes = collectLaunchDeploymentErrorCodesFromGraphQLError(error);
  return DEPLOYMENT_FILE_SIZE_RELATED_CODES.some((code) => codes.includes(code));
}
