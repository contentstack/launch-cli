import { ApiSurface } from '../resources';
import { CancelledError, InputDependencyError, MissingInputError, UsageError } from './errors';
import { UxLike } from './render';
import { FlagKey } from '../resources';
import { InputsSpec, inputs } from './inputs';
import * as resolutionModule from '../resources';
import { AnyResolutionSpec } from './resolution';
import { resolveInputs } from './resolve';
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

    expect(resolved).toEqual({ org: 'from-flag', limit: 100, skip: 0 });
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

  it('reads the project uid straight out of the config block', async () => {
    const resolved = await resolveInputs(inputs({ org: {}, project: { required: true } }), {
      parsed: { org: 'org1' },
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

  it('takes the config file uid field as a uid even when it reads like a name', async () => {
    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: { uid: 'Project One' },
      services: services(),
    });

    expect(resolved.project).toBe('Project One');
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

    expect(resolved).toEqual({ limit: 100, skip: 0 });
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

  it('propagates the cancellation the picker raises when the user chooses nothing', async () => {
    const promise = resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: {},
      services: services({ isTTY: true, answer: undefined }),
    });

    await expect(promise).rejects.toBeInstanceOf(CancelledError);
    await expect(promise).rejects.toThrow('Cancelled. Nothing was changed.');
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

  it.each(['', '   ', '\t\n'])('treats the blank --org %j as absent and reports the missing input', async (blank) => {
    const promise = resolveInputs(inputs({ org: { required: true } }), {
      parsed: { org: blank },
      projectConfig: {},
      services: services(),
    });

    await expect(promise).rejects.toBeInstanceOf(MissingInputError);
    await expect(promise).rejects.toThrow('Missing required value for --org.');
  });

  it.each(['', '   '])('treats the blank organizationUid %j in the config file as absent', async (blank) => {
    const promise = resolveInputs(inputs({ org: { required: true } }), {
      parsed: {},
      projectConfig: { organizationUid: blank },
      services: services(),
    });

    await expect(promise).rejects.toBeInstanceOf(MissingInputError);
    await expect(promise).rejects.toThrow('Missing required value for --org.');
  });

  it.each(['', '   '])('leaves an optional input given the blank value %j undefined rather than blank', async (blank) => {
    const resolved = await resolveInputs(inputs({ org: {} }), {
      parsed: { org: blank },
      projectConfig: {},
      services: services(),
    });

    expect(resolved.org).toBeUndefined();
    expect(resolved).toEqual({ org: undefined });
  });

  it.each(['', '   '])('prompts rather than normalising a blank --project %j', async (blank) => {
    const inquired: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        inquired.push(payload);
        return PROJECT_UID as never;
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
      parsed: { org: 'org1', project: blank },
      projectConfig: {},
      services: { api, ux, isTTY: true },
    });

    expect(resolved.project).toBe(PROJECT_UID);
    expect(inquired).toHaveLength(1);
  });

  it('keeps a numeric zero supplied on argv rather than treating it as absent', async () => {
    const resolved = await resolveInputs(inputs({ limit: {}, skip: {} }), {
      parsed: { limit: 0, skip: 0 },
      projectConfig: {},
      services: services(),
    });

    expect(resolved).toEqual({ limit: 0, skip: 0 });
  });

  it('keeps a false boolean supplied on argv rather than treating it as absent', async () => {
    const resolved = await resolveInputs(inputs({ yes: {} }), {
      parsed: { yes: false },
      projectConfig: {},
      services: services(),
    });

    expect(resolved).toEqual({ yes: false });
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

  it('refuses to normalise a value whose declared dependency resolved to nothing', async () => {
    const seen: unknown[] = [];

    const promise = resolveInputs(inputs({ org: {}, project: {} }), {
      parsed: { project: 'Project One' },
      projectConfig: {},
      services: recordingServices(seen),
    });

    await expect(promise).rejects.toBeInstanceOf(MissingInputError);
    await expect(promise).rejects.toThrow('Missing required value for --org.');
    expect(seen).toEqual([]);
  });

  it('refuses to prompt for a value whose declared dependency resolved to nothing', async () => {
    const seen: unknown[] = [];

    const promise = resolveInputs(inputs({ org: {}, project: {} }), {
      parsed: {},
      projectConfig: {},
      services: { ...recordingServices(seen), isTTY: true },
    });

    await expect(promise).rejects.toBeInstanceOf(MissingInputError);
    await expect(promise).rejects.toThrow('Missing required value for --org.');
    expect(seen).toEqual([]);
  });

  it('leaves both inputs undefined when neither the dependency nor the dependent was supplied', async () => {
    const seen: unknown[] = [];

    const resolved = await resolveInputs(inputs({ org: {}, project: {} }), {
      parsed: {},
      projectConfig: {},
      services: { ...recordingServices(seen), isTTY: false },
    });

    expect(resolved).toEqual({ org: undefined, project: undefined });
    expect(seen).toEqual([]);
  });

  it('normalises as usual once the declared dependency resolved to a value', async () => {
    const seen: unknown[] = [];

    const resolved = await resolveInputs(inputs({ org: {}, project: {} }), {
      parsed: { org: 'org1', project: 'Project One' },
      projectConfig: {},
      services: recordingServices(seen),
    });

    expect(resolved).toEqual({ org: 'org1', project: PROJECT_UID });
    expect(seen).toEqual(['org1']);
  });

  it('takes a config-supplied project uid as a uid rather than sniffing its shape', async () => {
    const seen: unknown[] = [];

    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: { uid: 'blt4d9e2a7c1f6b3085' },
      services: { ...recordingServices(seen), isTTY: false },
    });

    expect(resolved.project).toBe('blt4d9e2a7c1f6b3085');
    expect(seen).toEqual([]);
  });

  it('still looks up a project name supplied on argv, the one place the value is ambiguous', async () => {
    const seen: unknown[] = [];

    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1', project: 'Project One' },
      projectConfig: {},
      services: recordingServices(seen),
    });

    expect(resolved.project).toBe(PROJECT_UID);
    expect(seen).toEqual(['org1']);
  });

  it('takes a picked project uid as a uid rather than sniffing its shape', async () => {
    const seen: unknown[] = [];
    const base = recordingServices(seen);
    const services = {
      ...base,
      ux: { print: () => undefined, inquire: async () => 'blt4d9e2a7c1f6b3085' as never },
      isTTY: true,
    };

    const resolved = await resolveInputs(inputs({ org: { required: true }, project: { required: true } }), {
      parsed: { org: 'org1' },
      projectConfig: {},
      services,
    });

    expect(resolved.project).toBe('blt4d9e2a7c1f6b3085');
    expect(seen).toEqual(['org1']);
  });

  it('runs a normalize that declares no dependency at all without demanding one', async () => {
    const custom = {
      ...resolutionModule.resolution,
      org: { ...resolutionModule.resolution.org, normalize: async (value: unknown) => `${String(value)}-normalised` },
    };

    const resolved = await withResolution(custom, () =>
      resolveInputs(inputs({ org: { required: true } }), {
        parsed: { org: 'org1' },
        projectConfig: {},
        services: recordingServices([]),
      }),
    );

    expect(resolved).toEqual({ org: 'org1-normalised' });
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
