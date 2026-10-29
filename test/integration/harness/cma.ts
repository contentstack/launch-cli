export type MockOrganization = { uid: string; name: string };

export type RecordedCmaCall = {
  method: 'organization.fetch' | 'organization.fetchAll';
  uid?: string;
  params?: Record<string, any>;
};

class CmaMock {
  private organizations: MockOrganization[] = [];
  private pageSize = 100;
  private recorded: RecordedCmaCall[] = [];

  reset(): void {
    this.organizations = [];
    this.pageSize = 100;
    this.recorded = [];
  }

  withOrganizations(organizations: MockOrganization[], pageSize = 100): this {
    this.organizations = organizations;
    this.pageSize = pageSize;
    return this;
  }

  calls(): RecordedCmaCall[] {
    return [...this.recorded];
  }

  client(): Record<string, any> {
    return {
      organization: (uid?: string) => ({
        fetch: async () => {
          this.recorded.push({ method: 'organization.fetch', uid });
          const organization = this.organizations.find((candidate) => candidate.uid === uid);
          if (!organization) throw new Error(`Organization "${uid}" not found`);
          return organization;
        },
        fetchAll: async (params: Record<string, any> = {}) => {
          this.recorded.push({ method: 'organization.fetchAll', params });
          const skip = Number(params.skip ?? 0);
          return {
            items: this.organizations.slice(skip, skip + this.pageSize),
            count: this.organizations.length,
          };
        },
      }),
    };
  }
}

export const cma = new CmaMock();
