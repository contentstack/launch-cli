import { authHandler, configHandler } from '@contentstack/cli-utilities';

beforeEach(() => {
  jest.spyOn(configHandler, 'get').mockImplementation((key: string) => (key === 'authorisationType' ? 'BASIC' : undefined));
  jest.spyOn(authHandler, 'compareOAuthExpiry').mockResolvedValue(undefined);
});
