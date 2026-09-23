import { randomUUID } from 'node:crypto';

import { authHandler, configHandler } from '@contentstack/cli-utilities';

import { UnauthenticatedError } from '../core/errors';
import { AuthStrategy, BasicAuth, OAuthAuth, selectAuthStrategy } from './auth-strategy';

function configReturning(values: Record<string, unknown>) {
  return jest.spyOn(configHandler, 'get').mockImplementation((key: string) => values[key]);
}

describe('selectAuthStrategy', () => {
  it('chooses the oauth strategy for an OAUTH session and reads the authorisation type once', () => {
    const seen: string[] = [];
    const spy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      seen.push(key);
      return key === 'authorisationType' ? 'OAUTH' : undefined;
    });

    const strategy = selectAuthStrategy();

    expect(strategy).toBeInstanceOf(OAuthAuth);
    expect(seen.filter((key) => key === 'authorisationType')).toHaveLength(1);
    spy.mockRestore();
  });

  it('chooses the basic strategy for a BASIC session', () => {
    const spy = configReturning({ authorisationType: 'BASIC' });

    expect(selectAuthStrategy()).toBeInstanceOf(BasicAuth);
    spy.mockRestore();
  });

  it.each([[undefined], [null], [''], [false], [0], ['basic'], ['oauth'], ['SOMETHING']])(
    'refuses to guess a strategy when the authorisation type is %p',
    (authorisationType) => {
      const spy = configReturning({ authorisationType, authtoken: randomUUID() });

      expect(() => selectAuthStrategy()).toThrow(UnauthenticatedError);
      expect(() => selectAuthStrategy()).toThrow(
        'This session carries no Contentstack authorisation type. Run csdx auth:login to continue.',
      );
      spy.mockRestore();
    },
  );
});

describe('BasicAuth', () => {
  it('sends the authtoken and never touches the oauth expiry check', async () => {
    const token = randomUUID();
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
    const spy = configReturning({ authorisationType: 'BASIC', authtoken: token });

    const headers = await new BasicAuth().headers();

    expect(headers).toEqual({ authtoken: token });
    expect(expirySpy).not.toHaveBeenCalled();
    spy.mockRestore();
    expirySpy.mockRestore();
  });

  it('declares no refresh, so a 401 is never retried on a token session', () => {
    const strategy: AuthStrategy = new BasicAuth();

    expect(strategy.refresh).toBeUndefined();
  });
});

describe('OAuthAuth', () => {
  it('awaits the expiry check before reading the access token and sends a bearer header', async () => {
    const order: string[] = [];
    const token = randomUUID();
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockImplementation(async () => {
      await Promise.resolve();
      order.push('expiry-check');
    });
    const spy = jest.spyOn(configHandler, 'get').mockImplementation((key: string) => {
      if (key === 'oauthAccessToken') {
        order.push('read-token');
        return token;
      }
      return undefined;
    });

    const headers = await new OAuthAuth().headers();

    expect(headers).toEqual({ authorization: `Bearer ${token}` });
    expect(order).toEqual(['expiry-check', 'read-token']);
    expect(expirySpy).toHaveBeenCalledWith();
    spy.mockRestore();
    expirySpy.mockRestore();
  });

  it('propagates an expiry check rejection instead of producing a header', async () => {
    const failure = new Error('oauth session expired');
    const expirySpy = jest.spyOn(authHandler, 'compareOAuthExpiry').mockRejectedValue(failure);

    await expect(new OAuthAuth().headers()).rejects.toBe(failure);

    expirySpy.mockRestore();
  });

  it('forces the expiry check when asked to refresh and returns what the handler returned', async () => {
    const outcome = { refreshed: true };
    const expirySpy = jest
      .spyOn(authHandler, 'compareOAuthExpiry')
      .mockResolvedValue(outcome as unknown as undefined);

    await expect(new OAuthAuth().refresh()).resolves.toBe(outcome);

    expect(expirySpy).toHaveBeenCalledWith(true);
    expirySpy.mockRestore();
  });
});
