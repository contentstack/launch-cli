import { CancelledError, UsageError } from '../core/errors';
import type { UxLike } from '../core/render';
import type { ApiSurface } from '../resources';
import type { Organization } from './organizations.api';

export interface OrganizationPromptDeps {
  api: ApiSurface;
  ux: UxLike;
}

function labelOf(organization: Organization): string {
  return organization.name ?? organization.uid;
}

export async function promptForOrganization(deps: OrganizationPromptDeps): Promise<string> {
  const { organizations, scoped } = await deps.api.organizations.available();

  if (scoped) {
    const [organization] = organizations;
    deps.ux.print(
      `Using the organization your OAuth session is scoped to: ${labelOf(organization)} (${organization.uid}).`,
    );

    return organization.uid;
  }

  if (organizations.length === 0) {
    throw new UsageError('Your account belongs to no organization, so there is none to choose from.');
  }

  const chosen = await deps.ux.inquire<string | null | undefined>({
    type: 'search-list',
    name: 'organization',
    message: 'Choose an organization',
    choices: organizations.map((organization) => ({ name: labelOf(organization), value: organization.uid })),
  });

  if (chosen === undefined || chosen === null || chosen === '') {
    throw new CancelledError();
  }

  const match = organizations.find((organization) => organization.uid === chosen || organization.name === chosen);

  if (match === undefined) {
    throw new UsageError(
      `No organization named "${chosen}" is available to you. Choose one from the list, or pass --org.`,
    );
  }

  return match.uid;
}
