import { MAX_PAGES } from '../core/constants';
import type { CmaCollection, CmaSession } from '../transport/cma-client';
import { OrganizationLookupError } from './organization.errors';

export interface Organization {
  uid: string;
  name?: string;
}

export interface AvailableOrganizations {
  organizations: Organization[];
  scoped: boolean;
}

export const ORGANIZATION_PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function organizationOf(value: unknown): Organization[] {
  if (!isRecord(value)) {
    return [];
  }

  const uid = textOf(value.uid);

  return uid === undefined ? [] : [{ uid, name: textOf(value.name) }];
}

function reasonOf(error: unknown): string {
  if (isRecord(error)) {
    const reason = textOf(error.errorMessage) ?? textOf(error.message);

    if (reason !== undefined) {
      return reason;
    }
  }

  return textOf(error) ?? 'the Contentstack Management API gave no reason';
}

export class OrganizationsApi {
  constructor(private readonly cma: CmaSession) {}

  async available(): Promise<AvailableOrganizations> {
    const scoped = this.cma.scopedOrganizationUid();

    if (scoped === undefined) {
      return { organizations: await this.all(), scoped: false };
    }

    const found = await this.lookup(() => this.cma.fetchOrganization(scoped));
    const name = isRecord(found) ? textOf(found.name) : undefined;

    return { organizations: [{ uid: scoped, name }], scoped: true };
  }

  private async all(): Promise<Organization[]> {
    const organizations: Organization[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const skip = page * ORGANIZATION_PAGE_SIZE;
      const response = await this.lookup<CmaCollection>(() =>
        this.cma.fetchOrganizations({ limit: ORGANIZATION_PAGE_SIZE, asc: 'name', include_count: true, skip }),
      );
      const items = response.items ?? [];

      organizations.push(...items.flatMap(organizationOf));

      const counted = typeof response.count === 'number' && skip + items.length >= response.count;

      if (items.length < ORGANIZATION_PAGE_SIZE || counted) {
        return organizations;
      }
    }

    throw new OrganizationLookupError(
      `stopped after ${MAX_PAGES * ORGANIZATION_PAGE_SIZE} organizations without reaching the end of the list`,
    );
  }

  private async lookup<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw new OrganizationLookupError(reasonOf(error));
    }
  }
}
