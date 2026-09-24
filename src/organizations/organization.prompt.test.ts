import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/render';
import type { ApiSurface } from '../resources';
import { OrganizationLookupError } from './organization.errors';
import { promptForOrganization } from './organization.prompt';
import type { AvailableOrganizations } from './organizations.api';

const LISTED: AvailableOrganizations = {
  organizations: [
    { uid: 'org1', name: 'Acme Staging' },
    { uid: 'org2', name: 'Acme Production' },
    { uid: 'org3' },
  ],
  scoped: false,
};

function deps(available: AvailableOrganizations | Error, answer?: unknown) {
  const asked: unknown[] = [];
  const printed: string[] = [];
  let listings = 0;

  const ux: UxLike = {
    print: (message: string) => {
      printed.push(message);
    },
    inquire: async (payload: unknown) => {
      asked.push(payload);
      return answer as never;
    },
  };
  const api = {
    organizations: {
      available: async () => {
        listings += 1;

        if (available instanceof Error) {
          throw available;
        }

        return available;
      },
    },
  } as unknown as ApiSurface;

  return { deps: { api, ux }, asked, printed, listings: () => listings };
}

describe('promptForOrganization', () => {
  it('offers every organization by name, falling back to its uid, and returns the uid picked', async () => {
    const { deps: d, asked, printed, listings } = deps(LISTED, 'org2');

    await expect(promptForOrganization(d)).resolves.toBe('org2');
    expect(listings()).toBe(1);
    expect(printed).toEqual([]);
    expect(asked).toEqual([
      {
        type: 'search-list',
        name: 'organization',
        message: 'Choose an organization',
        choices: [
          { name: 'Acme Staging', value: 'org1' },
          { name: 'Acme Production', value: 'org2' },
          { name: 'org3', value: 'org3' },
        ],
      },
    ]);
  });

  it('accepts an organization name typed at the picker and returns its uid', async () => {
    const { deps: d } = deps(LISTED, 'Acme Production');

    await expect(promptForOrganization(d)).resolves.toBe('org2');
  });

  it('refuses text typed at the picker that names no organization offered', async () => {
    const { deps: d } = deps(LISTED, 'Acme');

    const failure = await promptForOrganization(d).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as UsageError).exitCode).toBe(2);
    expect((failure as Error).message).toBe(
      'No organization named "Acme" is available to you. Choose one from the list, or pass --org.',
    );
  });

  it.each([[undefined], [null], ['']])('cancels with exit 3 when %p comes back from the picker', async (answer) => {
    const { deps: d } = deps(LISTED, answer);

    const failure = await promptForOrganization(d).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(CancelledError);
    expect((failure as CancelledError).exitCode).toBe(3);
  });

  it('uses the organization an OAuth session is scoped to without asking, and says so', async () => {
    const { deps: d, asked, printed } = deps({ organizations: [{ uid: 'org7', name: 'Scoped Org' }], scoped: true });

    await expect(promptForOrganization(d)).resolves.toBe('org7');
    expect(asked).toEqual([]);
    expect(printed).toEqual(['Using the organization your OAuth session is scoped to: Scoped Org (org7).']);
  });

  it('names a scoped organization by its uid when it has no name', async () => {
    const { deps: d, printed } = deps({ organizations: [{ uid: 'org7' }], scoped: true });

    await expect(promptForOrganization(d)).resolves.toBe('org7');
    expect(printed).toEqual(['Using the organization your OAuth session is scoped to: org7 (org7).']);
  });

  it('refuses without asking when the account belongs to no organization', async () => {
    const { deps: d, asked } = deps({ organizations: [], scoped: false });

    const failure = await promptForOrganization(d).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(UsageError);
    expect((failure as Error).message).toBe(
      'Your account belongs to no organization, so there is none to choose from.',
    );
    expect(asked).toEqual([]);
  });

  it('propagates a failed lookup without asking', async () => {
    const lookup = new OrganizationLookupError('socket hang up');
    const { deps: d, asked } = deps(lookup);

    await expect(promptForOrganization(d)).rejects.toBe(lookup);
    expect(asked).toEqual([]);
  });
});
