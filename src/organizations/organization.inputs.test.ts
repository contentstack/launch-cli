import { UsageError } from '../core/errors';
import type { InputSource, ResolveServices } from '../core/resolution';
import type { UxLike } from '../core/prompt';
import type { ApiSurface } from '../resources';
import { organizationResolution } from './organization.inputs';

const NOT_A_UID = '--org accepts an organization UID, not a name.';

function services(): ResolveServices {
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

  return { api: {} as ApiSurface, ux, isTTY: false };
}

function normalizeOrg(value: string, source: InputSource = 'flag'): Promise<string> {
  const spec = organizationResolution.org as { normalize(value: string, args: unknown): Promise<string> };

  return spec.normalize(value, { services: services(), resolved: {}, source });
}

describe('organization inputs', () => {
  it('refuses an organization name given to --org, saying the flag takes a UID', async () => {
    await expect(normalizeOrg('Acme Marketing')).rejects.toThrow(new UsageError(NOT_A_UID));
  });

  it('accepts an organization UID given to --org unchanged', async () => {
    await expect(normalizeOrg('blt3ec265bf83fbcf0d')).resolves.toBe('blt3ec265bf83fbcf0d');
  });

  it('refuses a one-word organization name given to --org as well', async () => {
    await expect(normalizeOrg('Acme')).rejects.toThrow(new UsageError(NOT_A_UID));
  });

  it('trims whitespace around an organization UID given to --org', async () => {
    await expect(normalizeOrg('  blt3ec265bf83fbcf0d \n')).resolves.toBe('blt3ec265bf83fbcf0d');
  });

  it.each<InputSource>(['config', 'prompt'])(
    'leaves an organization UID that came from the %s unchecked',
    async (source) => {
      await expect(normalizeOrg('org-from-elsewhere', source)).resolves.toBe('org-from-elsewhere');
    },
  );
});
