import { UsageError } from '../core/errors';
import { ResolveServices } from '../core/resolution';
import { ApiSurface } from '../resources';
import { UxLike } from '../core/render';
import {
  ENVIRONMENT_NAME_MAX_LENGTH,
  FRAMEWORK_CHOICES,
  FRAMEWORK_PRESET_BY_LABEL,
  RESPONSE_MODES,
  TOGGLE_VALUES,
  environmentFlags,
  environmentResolution,
  frameworkPresetOf,
  serverCommandFrameworkGate,
} from './environment.inputs';
import { FRAMEWORK_PRESETS, SERVER_COMMAND_FRAMEWORKS } from './types';

function services(): ResolveServices {
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

  return { api: {} as ApiSurface, ux, isTTY: false };
}

function normalize(key: keyof typeof environmentResolution, value: string): Promise<unknown> {
  const spec = environmentResolution[key] as { normalize(value: string, args: unknown): Promise<unknown> };

  return spec.normalize(value, { services: services(), resolved: {}, source: 'flag' });
}

describe('environment inputs', () => {
  it('names each flag as the Commands Details "All flags" tables name it', () => {
    expect(Object.keys(environmentFlags)).toEqual([
      'env-name',
      'branch',
      'framework',
      'build-cmd',
      'server-cmd',
      'output-dir',
      'res-mode',
      'auto-deploy',
      'cs-auth',
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
    expect(() => serverCommandFrameworkGate({ 'server-cmd': 'npm start', framework: 'REMIX' })).not.toThrow();
    expect(() => serverCommandFrameworkGate({ 'server-cmd': 'npm start', framework: 'GATSBY' })).toThrow(
      '--server-cmd is only supported when --framework is one of ANALOG, ANGULAR, NUXT, ASTRO, REMIX, OTHER; ' +
        '--framework is GATSBY.',
    );
  });
});
