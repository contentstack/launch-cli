export interface CachePath {
  path: string;
  isPrefix: boolean;
  typed: string;
}

export interface PurgeTarget {
  path?: CachePath;
  tags?: string[];
  hosts?: string[];
}

export interface CacheCriterion {
  cachePath?: { path: string; isPrefix: boolean };
  cacheTags?: string[];
  hostnames?: string[];
}

export interface PurgeCacheParams {
  org: string;
  project: string;
  environment: string;
  criterion: CacheCriterion;
}
