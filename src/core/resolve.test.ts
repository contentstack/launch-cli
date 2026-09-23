import { ApiSurface } from '../resources';
import { UsageError } from './errors';
import { UxLike } from './render';
import { FlagKey } from '../resources';
import { InputsSpec, inputs } from './inputs';
import * as resolutionModule from '../resources';
import { AnyResolutionSpec } from './resolution';
import { InputDependencyError, MissingInputError, resolveInputs } from './resolve';
import { exactlyOneOf } from './rules';

function withResolution<T>(replacement: Record<string, AnyResolutionSpec>, run: () => Promise<T>): Promise<T> {
  const holder = resolutionModule as unknown as { resolutionTable: Record<string, AnyResolutionSpec> };
  const original = holder.resolutionTable;
  holder.resolutionTable = replacement;

  return run().finally(() => {
    holder.resolutionTable = original;
  });
}

function reversedResolution(): Record<string, AnyResolutionSpec> {
  return Object.fromEntries(Object.entries(resolutionModule.resolutionTable).reverse());
}

function recordingServices(seen: unknown[]) {
  const ux: UxLike = { print: () => undefined, inquire: async () => PROJECT_UID as never };
  const api = {
    projects: {
      list: async (params: { org: string }) => {
        seen.push(params.org);
        return { pagination: { count: 1, limit: 1, skip: null }, projects: [{ uid: PROJECT_UID, name: 'Project One' }] };
      },
      pages: async function* (params: { org: string }) {
        seen.push(params.org);
        yield { pagination: { count: 1, limit: 1, skip: null }, projects: [{ uid: PROJECT_UID, name: 'Project One' }] };
      },
    },
  } as unknown as ApiSurface;

  return { api, ux, isTTY: true };
}

const PROJECT_UID = 'a'.repeat(24);

function services(overrides: Partial<{ isTTY: boolean; answer: unknown }> = {}) {
  const ux: UxLike = {
    print: () => undefined,
    inquire: async () => overrides.answer as never,
  };
  return {
    api: {
      projects: {
        list: async () => ({
          pagination: { count: 1, limit: 1, skip: 0 },
          projects: [{ uid: PROJECT_UID, name: 'Project One' }],
        }),
        pages: async function* () {
          yield {
            pagination: { count: 1, limit: 1, skip: 0 },
            projects: [{ uid: PROJECT_UID, name: 'Project One' }],
          };
        },
      },
    } as unknown as ApiSurface,
    ux,
    isTTY: overrides.isTTY ?? false,
  };
}

describe('resolveInputs', () => {
  it('prefers the flag, then config, then the default', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, limit: {}, skip: {} }), {
      parsed: { org: 'from-flag' },
      projectConfig: { organizationUid: 'from-config' },
      services: services(),
    });

    expect(resolved).toEqual({ org: 'from-flag', limit: 50, skip: 0 });
  });

  it('falls back to config when the flag is absent', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true } }), {
      parsed: {},
      projectConfig: { organizationUid: 'from-config' },
      services: services(),
    });

    expect(resolved.org).toBe('from-config');
  });

  it('prompts when there is a TTY and no earlier source', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: {},
      services: services({ isTTY: true, answer: PROJECT_UID }),
    });

    expect(resolved.project).toBe(PROJECT_UID);
  });

  it('throws a MissingInputError naming the flag when nothing resolves and there is no TTY', async () => {
    const promise = resolveInputs(inputs({ org: { required: true } }), {
      parsed: {},
      projectConfig: {},
      services: services(),
    });

    await expect(promise).rejects.toBeInstanceOf(MissingInputError);
    await expect(promise).rejects.toThrow(
      'Missing required value for --org. Pass --org, set it in .cs-launch.json, or run in an interactive terminal.',
    );
  });

  it('leaves an optional unresolved input undefined instead of throwing', async () => {
    const resolved = await resolveInputs(inputs({ org: {}, project: {} }), {
      parsed: {},
      projectConfig: {},
      services: services(),
    });

    expect(resolved.project).toBeUndefined();
  });

  it('resolves in catalog order so a prompt reads an earlier value even when the inputs literal is reversed', async () => {
    const seen: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async () => PROJECT_UID as never,
    };
    const api = {
      projects: {
        list: async (params: { org: string }) => {
          seen.push(params.org);
          return {
            pagination: { count: 1, limit: 1, skip: 0 },
            projects: [{ uid: PROJECT_UID, name: 'Project One' }],
          };
        },
      },
    } as unknown as ApiSurface;

    const resolved = await resolveInputs(inputs({ project: { required: true }, org: { required: true } }), {
      parsed: { org: 'org-from-flag' },
      projectConfig: {},
      services: { api, ux, isTTY: true },
    });

    expect(seen).toEqual(['org-from-flag']);
    expect(resolved).toEqual({ org: 'org-from-flag', project: PROJECT_UID });
  });

  it('resolves inputs in declaration order so a later prompt can read an earlier value', async () => {
    const seen: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async () => PROJECT_UID as never,
    };
    const api = {
      projects: {
        list: async (params: { org: string }) => {
          seen.push(params.org);
          return {
            pagination: { count: 1, limit: 1, skip: 0 },
            projects: [{ uid: PROJECT_UID, name: 'Project One' }],
          };
        },
      },
    } as unknown as ApiSurface;

    await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org-from-flag' },
      projectConfig: {},
      services: { api, ux, isTTY: true },
    });

    expect(seen).toEqual(['org-from-flag']);
  });

  it('keeps an explicitly passed --skip 0 rather than treating it as absent', async () => {
    const resolved = await resolveInputs(inputs({ skip: {} }), {
      parsed: { skip: 0 },
      projectConfig: {},
      services: services(),
    });

    expect(resolved).toEqual({ skip: 0 });
  });

  it('resolves the MissingInputError flag property to the flag name', async () => {
    const promise = resolveInputs(inputs({ org: { required: true } }), {
      parsed: {},
      projectConfig: {},
      services: services(),
    });

    await expect(promise).rejects.toMatchObject({ flag: 'org', name: 'MissingInputError' });
  });

  it('reads a nested config path such as project uid', async () => {
    const resolved = await resolveInputs(inputs({ org: {}, project: { required: true } }), {
      parsed: {},
      projectConfig: { uid: PROJECT_UID },
      services: services(),
    });

    expect(resolved.project).toBe(PROJECT_UID);
  });

  it('does not prompt for an optional input that is absent and there is a TTY but no prompt rule', async () => {
    const resolved = await resolveInputs(inputs({ config: {} }), {
      parsed: {},
      projectConfig: {},
      services: services({ isTTY: true }),
    });

    expect(resolved.config).toBeUndefined();
  });

  it('normalises a project name supplied by flag into its uid', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1', project: 'Project One' },
      projectConfig: {},
      services: services(),
    });

    expect(resolved.project).toBe(PROJECT_UID);
  });

  it('normalises a project name supplied by the config file into its uid', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: { uid: 'Project One' },
      services: services(),
    });

    expect(resolved.project).toBe(PROJECT_UID);
  });

  it('treats a null organizationUid in the config file as absent and reports the missing input', async () => {
    const promise = resolveInputs(inputs({ org: { required: true } }), {
      parsed: {},
      projectConfig: { organizationUid: null },
      services: services(),
    });

    await expect(promise).rejects.toBeInstanceOf(MissingInputError);
    await expect(promise).rejects.toThrow('Missing required value for --org.');
  });

  it('prompts when the config file holds a null value rather than accepting it', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: { uid: null },
      services: services({ isTTY: true, answer: PROJECT_UID }),
    });

    expect(resolved.project).toBe(PROJECT_UID);
  });

  it('falls through to the default when the flag value is null', async () => {
    const resolved = await resolveInputs(inputs({ limit: {}, skip: {} }), {
      parsed: { limit: null, skip: null },
      projectConfig: {},
      services: services(),
    });

    expect(resolved).toEqual({ limit: 50, skip: 0 });
  });

  it('leaves an optional input resolved from a null config value undefined rather than null', async () => {
    const resolved = await resolveInputs(inputs({ org: {}, project: {} }), {
      parsed: {},
      projectConfig: { uid: null },
      services: services(),
    });

    expect(resolved.project).toBeUndefined();
    expect(resolved.project).not.toBeNull();
  });

  it('does not normalise a project input that resolved to nothing', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, project: {} }), {
      parsed: { org: 'org1' },
      projectConfig: {},
      services: services(),
    });

    expect(resolved.project).toBeUndefined();
  });

  it('throws a MissingInputError when the prompt answers nothing for a required input', async () => {
    const promise = resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: {},
      services: services({ isTTY: true, answer: undefined }),
    });

    await expect(promise).rejects.toBeInstanceOf(MissingInputError);
    await expect(promise).rejects.toThrow('Missing required value for --project.');
  });

  it('does not prompt on a TTY when the flag already carries the value', async () => {
    const inquired: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        inquired.push(payload);
        return undefined as never;
      },
    };
    const api = {
      projects: {
        list: async () => ({
          pagination: { count: 1, limit: 1, skip: 0 },
          projects: [{ uid: PROJECT_UID, name: 'Project One' }],
        }),
        pages: async function* () {
          yield {
            pagination: { count: 1, limit: 1, skip: 0 },
            projects: [{ uid: PROJECT_UID, name: 'Project One' }],
          };
        },
      },
    } as unknown as ApiSurface;

    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1', project: PROJECT_UID },
      projectConfig: {},
      services: { api, ux, isTTY: true },
    });

    expect(resolved.project).toBe(PROJECT_UID);
    expect(inquired).toEqual([]);
  });

  it('does not prompt on a TTY when the config file already carries the value', async () => {
    const inquired: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        inquired.push(payload);
        return undefined as never;
      },
    };
    const api = {
      projects: {
        list: async () => ({
          pagination: { count: 1, limit: 1, skip: 0 },
          projects: [{ uid: PROJECT_UID, name: 'Project One' }],
        }),
        pages: async function* () {
          yield {
            pagination: { count: 1, limit: 1, skip: 0 },
            projects: [{ uid: PROJECT_UID, name: 'Project One' }],
          };
        },
      },
    } as unknown as ApiSurface;

    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: { uid: PROJECT_UID },
      services: { api, ux, isTTY: true },
    });

    expect(resolved.project).toBe(PROJECT_UID);
    expect(inquired).toEqual([]);
  });

  it('propagates a usage error raised while normalising a value', async () => {
    const promise = resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1', project: 'ghost' },
      projectConfig: {},
      services: services(),
    });

    await expect(promise).rejects.toBeInstanceOf(UsageError);
    await expect(promise).rejects.toThrow('No project named "ghost" found in this organization.');
  });

  it('defaults yes to false when the flag was not passed', async () => {
    const resolved = await resolveInputs(inputs({ yes: {} }), {
      parsed: {},
      projectConfig: {},
      services: services(),
    });

    expect(resolved).toEqual({ yes: false });
  });

  it('excludes parsed flags the spec does not declare', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true } }), {
      parsed: { org: 'org1', limit: 10, skip: 5, config: '/tmp/.cs-launch.json' },
      projectConfig: {},
      services: services(),
    });

    expect(resolved).toEqual({ org: 'org1' });
    expect(Object.keys(resolved)).toEqual(['org']);
  });
});

describe('resolveInputs dependency ordering', () => {
  it('normalises project against the resolved org even when the resolution entries are reversed', async () => {
    const seen: unknown[] = [];

    const resolved = await withResolution(reversedResolution(), () =>
      resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
        parsed: { org: 'org-from-flag', project: 'Project One' },
        projectConfig: {},
        services: recordingServices(seen),
      }),
    );

    expect(seen).toEqual(['org-from-flag']);
    expect(resolved).toEqual({ org: 'org-from-flag', project: PROJECT_UID });
  });

  it('prompts project against the resolved org even when the resolution entries are reversed', async () => {
    const seen: unknown[] = [];

    const resolved = await withResolution(reversedResolution(), () =>
      resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
        parsed: { org: 'org-from-flag' },
        projectConfig: {},
        services: recordingServices(seen),
      }),
    );

    expect(seen).toEqual(['org-from-flag']);
    expect(resolved).toEqual({ org: 'org-from-flag', project: PROJECT_UID });
  });

  it('throws naming both flags when a command declares project without org', async () => {
    const spec = { project: { required: true } } as unknown as InputsSpec<'org' | 'project'>;

    const promise = resolveInputs(spec, {
      parsed: { project: 'Project One' },
      projectConfig: {},
      services: recordingServices([]),
    });

    await expect(promise).rejects.toBeInstanceOf(InputDependencyError);
    await expect(promise).rejects.toThrow(
      '--project cannot be resolved without --org: declare org in the command inputs.',
    );
  });

  it('throws naming the cycle rather than looping when two inputs depend on each other', async () => {
    const cyclic = {
      ...resolutionModule.resolution,
      org: { ...resolutionModule.resolution.org, dependsOn: ['project'] as FlagKey[] },
    };

    const promise = withResolution(cyclic, () =>
      resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
        parsed: { org: 'org1', project: 'Project One' },
        projectConfig: {},
        services: recordingServices([]),
      }),
    );

    await expect(promise).rejects.toBeInstanceOf(InputDependencyError);
    await expect(promise).rejects.toThrow('--org -> --project -> --org is a dependency cycle.');
  });

  it('restores the catalog order for inputs that declare no dependency at all', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, limit: {}, skip: {} }), {
      parsed: { org: 'org1' },
      projectConfig: {},
      services: services(),
    });

    expect(Object.keys(resolved)).toEqual(['org', 'limit', 'skip']);
  });
});

describe('resolveInputs cross-flag rules', () => {
  it('evaluates declared rules against the resolved values and returns them when every rule passes', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, limit: {} }), {
      parsed: { org: 'org1', limit: 10 },
      projectConfig: {},
      services: services(),
      rules: [exactlyOneOf('org', 'skip')],
    });

    expect(resolved).toEqual({ org: 'org1', limit: 10 });
  });

  it('throws the rule usage error when a rule fails against the resolved values', async () => {
    const promise = resolveInputs(inputs({ org: { required: true }, limit: {} }), {
      parsed: { org: 'org1', limit: 10 },
      projectConfig: {},
      services: services(),
      rules: [exactlyOneOf('org', 'limit')],
    });

    await expect(promise).rejects.toBeInstanceOf(UsageError);
    await expect(promise).rejects.toThrow('Pass exactly one of --org, --limit; --org, --limit were supplied.');
  });
});

describe('MissingInputError', () => {
  it('is a UsageError so it maps to the usage exit code with every other usage failure', () => {
    const error = new MissingInputError('org');

    expect(error).toBeInstanceOf(UsageError);
    expect(error.name).toBe('MissingInputError');
    expect(error.flag).toBe('org');
  });
});
