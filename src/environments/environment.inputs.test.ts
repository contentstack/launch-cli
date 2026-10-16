import { randomBytes } from 'node:crypto';

import { UsageError } from '../core/errors';
import type { ResolveServices } from '../core/resolution';
import type { ApiSurface } from '../resources';
import type { UxLike } from '../core/prompt';
import {
  ENVIRONMENT_NAME_MAX_LENGTH,
  RESPONSE_MODES,
  TOGGLE_VALUES,
  environmentFlags,
  environmentResolution,
  frameworkPresetOf,
  serverCommandFrameworkGate,
} from './environment.inputs';
import { FRAMEWORK_CHOICES, FRAMEWORK_PRESETS, FRAMEWORK_PRESET_BY_LABEL, SERVER_COMMAND_FRAMEWORKS } from './frameworks';

function services(): ResolveServices {
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

  return { api: {} as ApiSurface, ux, isTTY: false };
}

function normalize(key: keyof typeof environmentResolution, value: string): Promise<unknown> {
  const spec = environmentResolution[key] as { normalize(value: string, args: unknown): Promise<unknown> };

  return spec.normalize(value, { services: services(), resolved: {}, source: 'flag' });
}

const FROM_FLAGS = { 'server-cmd': 'flag', framework: 'flag' } as const;

describe('environment inputs', () => {
  it('names each flag as the Commands Details "All flags" tables name it', () => {
    expect(Object.keys(environmentFlags)).toEqual([
      'env',
      'env-name',
      'branch',
      'framework',
      'build-cmd',
      'server-cmd',
      'output-dir',
      'res-mode',
      'auto-deploy',
      'cs-auth',
      'cache-priming',
      'password-protection',
      'username',
      'password',
    ]);
  });

  it('declares no flag as required, so the resolution chain can still supply it', () => {
    for (const flag of Object.values(environmentFlags)) {
      expect((flag as { required?: boolean }).required).toBeFalsy();
    }
  });

  it('offers every framework the doc lists and maps each label to the service preset', () => {
    expect(FRAMEWORK_CHOICES).toEqual([
      'Gatsby',
      'NextJs',
      'CRA',
      'CSR',
      'Analog',
      'Angular',
      'Nuxt',
      'Astro',
      'VueJs',
      'Remix',
      'Other',
    ]);
    expect(FRAMEWORK_CHOICES.map((label) => FRAMEWORK_PRESET_BY_LABEL[label.toLowerCase()]).sort()).toEqual(
      [...FRAMEWORK_PRESETS].sort(),
    );
  });

  it('maps a framework label to its preset whatever case it arrived in', () => {
    expect(frameworkPresetOf('NextJs')).toBe('NEXTJS');
    expect(frameworkPresetOf('nextjs')).toBe('NEXTJS');
    expect(frameworkPresetOf(' NEXTJS ')).toBe('NEXTJS');
    expect(frameworkPresetOf('Other')).toBe('OTHER');
  });

  it('refuses a framework outside the set, naming every label it accepts', () => {
    expect(() => frameworkPresetOf('Svelte')).toThrow(UsageError);
    expect(() => frameworkPresetOf('Svelte')).toThrow(
      `--framework must be one of ${FRAMEWORK_CHOICES.join(', ')}; "Svelte" is not.`,
    );
  });

  it('normalises a framework from any source into its preset', async () => {
    await expect(normalize('framework', 'astro')).resolves.toBe('ASTRO');
    await expect(normalize('framework', 'Gatsby')).resolves.toBe('GATSBY');
  });

  it('normalises a response mode and refuses one outside the set', async () => {
    await expect(normalize('res-mode', 'STREAMING')).resolves.toBe('streaming');
    await expect(normalize('res-mode', 'buffered')).resolves.toBe('buffered');
    await expect(normalize('res-mode', 'chunked')).rejects.toThrow(
      `--res-mode must be one of ${RESPONSE_MODES.join(', ')}; "chunked" is not.`,
    );
  });

  it('normalises an auto-deploy toggle and refuses one outside the set', async () => {
    await expect(normalize('auto-deploy', 'Enable')).resolves.toBe('enable');
    await expect(normalize('auto-deploy', 'disable')).resolves.toBe('disable');
    await expect(normalize('auto-deploy', 'true')).rejects.toThrow(
      `--auto-deploy must be one of ${TOGGLE_VALUES.join(', ')}; "true" is not.`,
    );
  });

  it('normalises a cs-auth toggle and refuses one outside the set', async () => {
    await expect(normalize('cs-auth', 'ENABLE')).resolves.toBe('enable');
    await expect(normalize('cs-auth', 'disable')).resolves.toBe('disable');
    await expect(normalize('cs-auth', 'on')).rejects.toThrow(
      `--cs-auth must be one of ${TOGGLE_VALUES.join(', ')}; "on" is not.`,
    );
  });

  it('accepts an environment name at the limit and refuses one over it', async () => {
    const atLimit = 'e'.repeat(ENVIRONMENT_NAME_MAX_LENGTH);

    await expect(normalize('env-name', atLimit)).resolves.toBe(atLimit);
    await expect(normalize('env-name', `${atLimit}e`)).rejects.toThrow(
      `--env-name must be ${ENVIRONMENT_NAME_MAX_LENGTH} characters or fewer; that value is ${
        ENVIRONMENT_NAME_MAX_LENGTH + 1
      } characters.`,
    );
  });

  it('leaves the free-text flags without a normaliser rather than inventing a rule for them', () => {
    for (const key of ['branch', 'build-cmd', 'server-cmd', 'output-dir'] as const) {
      expect(environmentResolution[key]).toEqual({});
    }
  });

  it('gates --server-cmd on exactly the frameworks the service supports it for', () => {
    expect(SERVER_COMMAND_FRAMEWORKS).toEqual(['ANALOG', 'ANGULAR', 'NUXT', 'ASTRO', 'REMIX', 'OTHER']);
    expect(() => serverCommandFrameworkGate({ 'server-cmd': 'npm start', framework: 'REMIX' }, FROM_FLAGS)).not.toThrow();
    expect(() => serverCommandFrameworkGate({ 'server-cmd': 'npm start', framework: 'GATSBY' }, FROM_FLAGS)).toThrow(
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
        '--framework is GATSBY.',
    );
  });
});

const ENV_UID = randomBytes(12).toString('hex');

function envServices(pages: { uid?: string; name?: string }[][]) {
  const scanned: unknown[] = [];
  const listed: unknown[] = [];
  const asked: unknown[] = [];
  const ux: UxLike = {
    print: () => undefined,
    inquire: async (payload: unknown) => {
      asked.push(payload);
      return 'e9' as never;
    },
  };
  const api = {
    environments: {
      pages: async function* (params: unknown) {
        scanned.push(params);
        for (const environments of pages) {
          yield { pagination: { count: 0, limit: 100 }, environments };
        }
      },
      list: async (params: unknown) => {
        listed.push(params);
        return { pagination: { count: 1, limit: 100 }, environments: [{ uid: 'e9', name: 'production' }] };
      },
    },
  } as unknown as ApiSurface;

  return { services: { api, ux, isTTY: true }, scanned, listed, asked };
}

const RESOLVED_SCOPE = { org: 'org1', project: 'proj1' };

describe('the --env input', () => {
  it('describes the flag as taking a name or a uid, with no short form', () => {
    expect(environmentFlags.env.description).toBe('Environment name or UID');
    expect((environmentFlags.env as { char?: string }).char).toBeUndefined();
  });

  it('resolves after the organization and the project and is never read from the config file', () => {
    expect(environmentResolution.env.dependsOn).toEqual(['org', 'project']);
    expect((environmentResolution.env as { configPath?: string }).configPath).toBeUndefined();
  });

  it('resolves a name given on the command line to the uid of the environment with exactly that name', async () => {
    const { services: s, scanned } = envServices([[{ uid: 'e1', name: 'Production' }, { uid: 'e2', name: 'production' }]]);

    await expect(
      environmentResolution.env.normalize('production', { services: s, resolved: RESOLVED_SCOPE, source: 'flag' }),
    ).resolves.toBe('e2');
    expect(scanned).toEqual([RESOLVED_SCOPE]);
  });

  it('takes a 24-character hex value on the command line as a uid without scanning', async () => {
    const { services: s, scanned } = envServices([]);

    await expect(
      environmentResolution.env.normalize(ENV_UID, { services: s, resolved: RESOLVED_SCOPE, source: 'flag' }),
    ).resolves.toBe(ENV_UID);
    expect(scanned).toEqual([]);
  });

  it('takes the picker answer as a uid without scanning, whatever it looks like', async () => {
    const { services: s, scanned } = envServices([[{ uid: 'e2', name: 'e9' }]]);

    await expect(
      environmentResolution.env.normalize('e9', { services: s, resolved: RESOLVED_SCOPE, source: 'prompt' }),
    ).resolves.toBe('e9');
    expect(scanned).toEqual([]);
  });

  it('refuses a name on the command line that no environment in the project carries', async () => {
    const { services: s } = envServices([[{ uid: 'e1', name: 'Production' }]]);

    await expect(
      environmentResolution.env.normalize('production', { services: s, resolved: RESOLVED_SCOPE, source: 'flag' }),
    ).rejects.toThrow(new UsageError('No environment named "production" found in this project.'));
  });

  it('prompts with the environment picker scoped to the resolved organization and project', async () => {
    const { services: s, listed, asked } = envServices([]);

    await expect(environmentResolution.env.prompt({ services: s, resolved: RESOLVED_SCOPE })).resolves.toBe('e9');
    expect(listed).toEqual([{ ...RESOLVED_SCOPE, limit: 100, skip: 0 }]);
    expect((asked[0] as { message: string }).message).toBe('Choose an environment');
  });
});

describe('the update-only toggles and credentials', () => {
  it.each([['cache-priming'], ['password-protection']] as const)(
    'takes --%s as enable or disable however it is cased, and refuses anything else',
    async (flag) => {
      await expect(normalize(flag, ' Disable ')).resolves.toBe('disable');
      await expect(normalize(flag, 'enable')).resolves.toBe('enable');
      await expect(normalize(flag, 'yes')).rejects.toThrow(UsageError);
    },
  );

  it('gives --username the short form -u and --password the short form -p', () => {
    expect(environmentFlags.username.char).toBe('u');
    expect(environmentFlags.password.char).toBe('p');
  });

  it('takes --password as presence only, so a password can never be passed on argv', () => {
    expect(environmentFlags.password.type).toBe('boolean');
    expect(environmentResolution.password.default).toBe(false);
  });

  it('trims a --username', async () => {
    await expect(normalize('username', '  admin  ')).resolves.toBe('admin');
  });

  it('refuses a --username containing a colon, which basic authentication cannot carry', async () => {
    await expect(normalize('username', 'ad:min')).rejects.toThrow(new UsageError('--username must not contain ":".'));
  });
});
