import { authHandler, configHandler } from '@contentstack/cli-utilities';

import { SessionExpiredError, UnauthenticatedError } from '../core/errors';

export const AUTHORISATION_TYPE_KEY = 'authorisationType';
export const BASIC_AUTHORISATION = 'BASIC';
export const OAUTH_AUTHORISATION = 'OAUTH';

export interface AuthStrategy {
  headers(orgUid?: string): Promise<Record<string, string>>;
  refresh?(): Promise<unknown>;
}

export class BasicAuth implements AuthStrategy {
  async headers(): Promise<Record<string, string>> {
    return { authtoken: configHandler.get('authtoken') };
  }

  async refresh(): Promise<never> {
    throw new SessionExpiredError();
  }
}

export class OAuthAuth implements AuthStrategy {
  async headers(): Promise<Record<string, string>> {
    await authHandler.compareOAuthExpiry();
    return { authorization: `Bearer ${configHandler.get('oauthAccessToken')}` };
  }

  refresh(): Promise<unknown> {
    return authHandler.compareOAuthExpiry(true);
  }
}

export function selectAuthStrategy(): AuthStrategy {
  const authorisationType = configHandler.get(AUTHORISATION_TYPE_KEY);

  if (authorisationType === OAUTH_AUTHORISATION) {
    return new OAuthAuth();
  }

  if (authorisationType === BASIC_AUTHORISATION) {
    return new BasicAuth();
  }

  throw new UnauthenticatedError();
}
