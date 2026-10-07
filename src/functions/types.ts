import type {
  ExistingDynamicRouteAtSameLevelError,
  IndistinctDynamicRouteNamesInPathError,
  InvalidFilepathNamingError,
  TopLevelDynamicRouteError,
} from './function.errors';

export interface CloudFunctionResource {
  cloudFunctionFilePath: string;
  apiResourceURI: string;
  handler: (...args: unknown[]) => unknown;
}

export type CloudFunctionValidationError = TopLevelDynamicRouteError |
  InvalidFilepathNamingError |
  IndistinctDynamicRouteNamesInPathError |
  ExistingDynamicRouteAtSameLevelError;
