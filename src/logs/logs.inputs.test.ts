import { Parser } from '@oclif/core';

import { InputDependencyError, UsageError } from '../core/errors';
import { inputs } from '../core/inputs';
import { resolveInputs, resolveInputsTraced } from '../core/resolve';
import { projectTypeChoiceOf } from '../projects/project.inputs';
import type { ApiSurface } from '../resources';
import { catalog, resolution } from '../resources';
import { logTypeOf, logsFlags, logsResolution, windowOnlyWithServer } from './logs.inputs';

const logInputs = inputs({ 'log-type': {}, since: {}, until: {} });
const rules = [windowOnlyWithServer('since'), windowOnlyWithServer('until')];
const prompts: unknown[] = [];
const services = {
  api: {} as ApiSurface,
  ux: {
    print: () => undefined,
    inquire: async (question: unknown) => {
      prompts.push(question);

      return undefined as never;
    },
  },
  isTTY: true,
};

function resolve(parsed: Record<string, unknown>) {
  return resolveInputsTraced(logInputs, { parsed, projectConfig: {}, services, rules });
}

async function failureOf(parsed: Record<string, unknown>): Promise<UsageError> {
  return resolve(parsed).then(
    () => {
      throw new Error('resolution did not fail');
    },
    (error: UsageError) => error,
  );
}

beforeEach(() => {
  prompts.length = 0;
});

describe('logs inputs', () => {
  it('shares the log type, since and until through the catalog without touching the project type flag', () => {
    expect(Object.keys(logsFlags).sort()).toEqual(Object.keys(logsResolution).sort());
    expect(Object.keys(logsFlags)).toHaveLength(3);
    expect(catalog['log-type']).toBe(logsFlags['log-type']);
    expect(catalog.since).toBe(logsFlags.since);
    expect(catalog.until).toBe(logsFlags.until);
    expect(resolution['log-type']).toBe(logsResolution['log-type']);
    expect(catalog.type.description).toContain('GitHub | FileUpload');
    expect(logsFlags['log-type'].description).toContain('deployment | server | live');
    expect(logsFlags['log-type'].required).toBeFalsy();
    expect(logsFlags.since.required).toBeFalsy();
    expect(logsFlags.until.required).toBeFalsy();
  });

  it.each([
    [' Server ', 'server'],
    ['LIVE', 'live'],
    ['deployment', 'deployment'],
    ['Deployment', 'deployment'],
  ])('normalises the log type %p to the canonical %p', async (typed, canonical) => {
    const { resolved, sources } = await resolve({ 'log-type': typed });

    expect(resolved['log-type']).toBe(canonical);
    expect(sources['log-type']).toBe('flag');
    expect(logTypeOf(typed)).toBe(canonical);
  });

  it('defaults the log type to deployment and records that it was a default', async () => {
    const { resolved, sources } = await resolve({});

    expect(resolved['log-type']).toBe('deployment');
    expect(sources['log-type']).toBe('default');
  });

  it.each([[''], ['   '], [null], [undefined]])('reads %p as an absent log type and defaults it', async (blank) => {
    const { resolved } = await resolve({ 'log-type': blank });

    expect(resolved['log-type']).toBe('deployment');
  });

  it('refuses an unknown log type with the exact usage message naming --type', async () => {
    const failure = await failureOf({ 'log-type': 'build' });

    expect(failure).toBeInstanceOf(UsageError);
    expect(failure.exitCode).toBe(2);
    expect(failure.message).toBe('--type must be one of deployment, server, live; "build" is not.');
    expect(() => logTypeOf('build')).toThrow('--type must be one of deployment, server, live; "build" is not.');
  });

  it('never prompts for the log type, on a terminal or off it, and never asks the project type question', async () => {
    await resolve({});
    await resolveInputs(logInputs, { parsed: {}, projectConfig: {}, services: { ...services, isTTY: false }, rules });

    expect(prompts).toEqual([]);
    expect(logsResolution['log-type']).not.toHaveProperty('prompt');
    expect(logsResolution['log-type']).not.toHaveProperty('configPath');
  });

  it('leaves the project type spec rejecting server and prompting, so projects:create is unchanged', async () => {
    const projectType = resolution.type;

    await expect(projectType.normalize('server')).rejects.toThrow(
      '--type must be one of GitHub, FileUpload; "server" is not.',
    );
    expect(() => projectTypeChoiceOf('server')).toThrow(UsageError);
    expect(projectType).toHaveProperty('prompt');
    expect(resolution['log-type']).not.toBe(projectType);
    expect(resolution['log-type'].normalize).not.toBe(projectType.normalize);
  });

  it('refuses --since with the default deployment type, closing the default-gate hole', async () => {
    const failure = await failureOf({ since: '2h' });

    expect(failure).toBeInstanceOf(UsageError);
    expect(failure.exitCode).toBe(2);
    expect(failure.message).toBe('--since is only supported when --type is one of server; --type is deployment.');
  });

  it('refuses --since with an explicit deployment type and --until with live', async () => {
    const since = await failureOf({ 'log-type': 'deployment', since: '2h' });
    const until = await failureOf({ 'log-type': 'LIVE', until: '30m' });
    const untilDefault = await failureOf({ until: '30m' });

    expect(since.message).toBe('--since is only supported when --type is one of server; --type is deployment.');
    expect(until.message).toBe('--until is only supported when --type is one of server; --type is live.');
    expect(untilDefault.message).toBe('--until is only supported when --type is one of server; --type is deployment.');
  });

  it('accepts since and until with the server type, and a blank one with any type', async () => {
    const server = await resolve({ 'log-type': 'Server', since: ' 2h ', until: '1h' });
    const blank = await resolve({ since: '   ', until: '' });
    const nulls = await resolve({ 'log-type': 'live', since: null, until: undefined });

    expect(server.resolved).toEqual({ 'log-type': 'server', since: '2h', until: '1h' });
    expect(blank.resolved).toEqual({ 'log-type': 'deployment', since: undefined, until: undefined });
    expect(nulls.resolved['log-type']).toBe('live');
  });

  it('refuses a window flag when the log type is not an input of the command, rather than skipping the check', async () => {
    const bare = inputs({ since: {} });
    const run = resolveInputs(bare, { parsed: { since: '1h' }, projectConfig: {}, services, rules });

    await expect(run).rejects.toBeInstanceOf(InputDependencyError);
    await expect(run).rejects.toThrow('--since cannot be checked without --type');
  });

  it('parses --since and --until as plain strings', async () => {
    const parsed = await Parser.parse(['--since', '12hr', '--until=2025-06-15T10:00:00Z'], {
      flags: { since: catalog.since, until: catalog.until },
    });

    expect(parsed.flags).toEqual({ since: '12hr', until: '2025-06-15T10:00:00Z' });
  });
});
