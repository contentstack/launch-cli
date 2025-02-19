import {
  ExistingDynamicRouteAtSameLevelError,
  IndistinctDynamicRouteNamesInPathError,
  InvalidFilepathNamingError,
  TopLevelDynamicRouteError,
} from './errors/cloud-function.errors';

export type CloudFunctionResource = {
  cloudFunctionFilePath: string,
  apiResourceURI: string
  handler: Function
};

export type CloudFunctionValidationError = TopLevelDynamicRouteError |
  InvalidFilepathNamingError |
  IndistinctDynamicRouteNamesInPathError |
  ExistingDynamicRouteAtSameLevelError;