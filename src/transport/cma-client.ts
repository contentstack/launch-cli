import type { ContentstackClient } from '@contentstack/cli-utilities';
import {
  configHandler,
  managementSDKClient,
  managementSDKInitiator,
} from '@contentstack/cli-utilities';

export const OAUTH_ORG_UID_CONFIG_FIELD = 'oauthOrgUid';

export interface CmaCollection {
  items?: unknown[];
  count?: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

async function allPages(fetchPage: (skip: number) => Promise<CmaCollection>): Promise<CmaCollection> {
  const items: unknown[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = (await fetchPage(items.length)).items ?? [];

    if (batch.length === 0) {
      break;
    }

    items.push(...batch);
  }

  return { items };
}

export interface CmaSession {
  fetchOrganizations(query: Record<string, unknown>): Promise<CmaCollection>;
  fetchOrganization(uid: string): Promise<unknown>;
  fetchStacks(organizationUid: string): Promise<CmaCollection>;
  fetchDeliveryTokens(apiKey: string): Promise<CmaCollection>;
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
    fetchStacks: (organizationUid) =>
      allPages(async (skip) =>
        (await open()).stack().query({ organization_uid: organizationUid, limit: PAGE_SIZE, skip }).find(),
      ),
    fetchDeliveryTokens: (apiKey) =>
      allPages(async (skip) =>
        (await open()).stack({ api_key: apiKey }).deliveryToken().query({ limit: PAGE_SIZE, skip }).find(),
      ),
    scopedOrganizationUid: () => {
      const uid: unknown = configHandler.get(OAUTH_ORG_UID_CONFIG_FIELD);

      return typeof uid === 'string' && uid.trim() !== '' ? uid : undefined;
    },
  };
}
