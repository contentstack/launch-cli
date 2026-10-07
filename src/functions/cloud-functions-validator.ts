import { DYNAMIC_ROUTE_SEGMENT } from './constants';
import {
  ExistingDynamicRouteAtSameLevelError,
  IndistinctDynamicRouteNamesInPathError,
  InvalidFilepathNamingError,
  TopLevelDynamicRouteError,
} from './function.errors';
import type { CloudFunctionResource, CloudFunctionValidationError } from './types';

export class CloudFunctionsValidator {
  private cloudFunctionResources: CloudFunctionResource[];
  private dynamicRoutes: Record<string, string>;

  constructor(cloudFunctionResources: CloudFunctionResource[]) {
    this.cloudFunctionResources = cloudFunctionResources;
    this.dynamicRoutes = {};
  }

  validate(): CloudFunctionValidationError | undefined {
    for (const cloudFunctionResource of this.cloudFunctionResources) {
      const filepath = cloudFunctionResource.apiResourceURI;

      if (this.hasTopLevelDynamicRoute(filepath)) {
        return new TopLevelDynamicRouteError(filepath);
      }

      if (this.hasInvalidFilepathNaming(filepath)) {
        return new InvalidFilepathNamingError(filepath);
      }

      if (this.hasIndistinctDynamicRouteNamesInPath(filepath)) {
        return new IndistinctDynamicRouteNamesInPathError(filepath);
      }

      const sameLevelDynamicRoute = this.getDynamicRouteAtSameLevel(filepath);
      if (sameLevelDynamicRoute) {
        return new ExistingDynamicRouteAtSameLevelError(filepath, sameLevelDynamicRoute);
      }
    }

    return undefined;
  }

  private hasTopLevelDynamicRoute(filepath: string): boolean {
    const matchTopLevelDynamicRoute = /^\/\[(.*?)\].*$/;

    const matchResult = filepath.match(matchTopLevelDynamicRoute);
    return matchResult !== null;
  }

  private hasInvalidFilepathNaming(filepath: string): boolean {
    const validFilePathRegex = /^(?:[\w\-/]|\[[\w-]+\])+$/;

    const matchResult = filepath.match(validFilePathRegex);
    return matchResult === null;
  }

  private hasIndistinctDynamicRouteNamesInPath(filepath: string): boolean {
    const dynamicRouteNames = filepath.match(DYNAMIC_ROUTE_SEGMENT);

    if (dynamicRouteNames === null) {
      return false;
    }

    const distinctDynamicRouteNames = Array.from(new Set(dynamicRouteNames));
    return distinctDynamicRouteNames.length !== dynamicRouteNames.length;
  }

  private getDynamicRouteAtSameLevel(filepath: string): string | undefined {
    const dynamicRouteNameReplacer = '[id]';
    const transformedFilePathWithDynamicRoute = filepath.replace(DYNAMIC_ROUTE_SEGMENT, dynamicRouteNameReplacer);

    if (this.dynamicRoutes[transformedFilePathWithDynamicRoute]) {
      return this.dynamicRoutes[transformedFilePathWithDynamicRoute];
    }

    this.dynamicRoutes[transformedFilePathWithDynamicRoute] = filepath;
    return undefined;
  }
}
