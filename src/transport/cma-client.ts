import {
  ContentstackClient,
  configHandler,
  managementSDKClient,
  managementSDKInitiator,
} from '@contentstack/cli-utilities';

export const OAUTH_ORGANIZATION_KEY = 'oauthOrgUid';

export interface CmaCollection {
  items?: unknown[];
  count?: number;
}

export interface CmaSession {
  fetchOrganizations(query: Record<string, unknown>): Promise<CmaCollection>;
  fetchOrganization(uid: string): Promise<unknown>;
  scopedOrganizationUid(): string | undefined;
}

export interface CmaSessionOptions {
  cma?: string;
  analyticsInfo: string;
}

export function cmaHostOf(cma: string): string {
  return cma.startsWith('http') ? new URL(cma).host : cma;
}

async function connect(options: CmaSessionOptions): Promise<ContentstackClient> {
  if (options.cma === undefined || options.cma.trim() === '') {
    throw new Error('No Contentstack Management API host is configured for this region.');
  }

  managementSDKInitiator.init({ analyticsInfo: options.analyticsInfo });

  return managementSDKClient({ host: cmaHostOf(options.cma) });
}

export function createCmaSession(options: CmaSessionOptions): CmaSession {
  let client: Promise<ContentstackClient> | undefined;

  const open = (): Promise<ContentstackClient> => {
    client = client ?? connect(options);

    return client;
  };

  return {
    fetchOrganizations: async (query) => (await open()).organization().fetchAll(query),
    fetchOrganization: async (uid) => (await open()).organization(uid).fetch(),
    scopedOrganizationUid: () => {
      const uid: unknown = configHandler.get(OAUTH_ORGANIZATION_KEY);

      return typeof uid === 'string' && uid.trim() !== '' ? uid : undefined;
    },
  };
}
