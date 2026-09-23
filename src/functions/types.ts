import {
  ExistingDynamicRouteAtSameLevelError,
  IndistinctDynamicRouteNamesInPathError,
  InvalidFilepathNamingError,
  TopLevelDynamicRouteError,
} from './function.errors';

export type CloudFunctionResource = {
  cloudFunctionFilePath: string,
  apiResourceURI: string
  handler: (...args: unknown[]) => unknown
};

export type CloudFunctionValidationError = TopLevelDynamicRouteError |
  InvalidFilepathNamingError |
  IndistinctDynamicRouteNamesInPathError |
  ExistingDynamicRouteAtSameLevelError;