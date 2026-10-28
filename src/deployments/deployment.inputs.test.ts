import { Parser } from '@oclif/core';

import { UsageError } from '../core/errors';
import { inputs } from '../core/inputs';
import { resolveInputs } from '../core/resolve';
import type { ApiSurface } from '../resources';
import { catalog } from '../resources';
import {
  BLANK_COMMIT,
  PICK_COMMIT,
  deploymentFlags,
  deploymentResolution,
  withBareCommit,
} from './deployment.inputs';

const getInputs = inputs({ deployment: {} });
const createInputs = inputs({ org: { required: true }, commit: {}, 'last-upload': {} });
const ORG = 'blt4d9e2a7c1f6b3085';
const SHA = '9fceb02d0ae598e95dc970b74767f19372d61af8';
const services = { api: {} as ApiSurface, ux: { print: () => undefined, inquire: async () => undefined as never }, isTTY: false };

async function resolvedFrom(argv: string[]) {
  const parsed = await Parser.parse(argv, { flags: { deployment: catalog.deployment } });

  return resolveInputs(getInputs, { parsed: parsed.flags, projectConfig: {}, services });
}

async function createResolvedFrom(argv: string[]) {
  const parsed = await Parser.parse(withBareCommit(argv), {
    flags: { org: catalog.org, commit: catalog.commit, 'last-upload': catalog['last-upload'] },
  });

  return resolveInputs(createInputs, { parsed: parsed.flags, projectConfig: {}, services });
}

describe('deployment inputs', () => {
  it('names the flags the deployments commands add and shares them through the catalog', () => {
    expect(Object.keys(deploymentFlags)).toEqual(['deployment', 'commit', 'reason', 'last-upload']);
    expect(Object.keys(deploymentResolution)).toEqual(['deployment', 'commit', 'reason', 'last-upload']);
    expect(catalog.deployment).toBe(deploymentFlags.deployment);
    expect(catalog.commit).toBe(deploymentFlags.commit);
    expect(catalog.reason).toBe(deploymentFlags.reason);
    expect(catalog['last-upload']).toBe(deploymentFlags['last-upload']);
    expect(deploymentFlags.reason.required).toBeFalsy();
    expect(deploymentFlags.deployment.required).toBeFalsy();
    expect(deploymentFlags.commit.required).toBeFalsy();
    expect(deploymentFlags['last-upload'].required).toBeFalsy();
  });

  it('declares --commit and --last-upload as mutually exclusive on the flag so --help shows it', () => {
    expect(deploymentFlags.commit.exclusive).toEqual(['last-upload']);
  });

  it('reads a bare --commit as the commit picker and still parses the flags after it', async () => {
    for (const argv of [
      ['--commit', '--org', ORG],
      ['--org', ORG, '--commit'],
    ]) {
      const resolved = await createResolvedFrom(argv);

      expect(resolved.commit).toBe(PICK_COMMIT);
      expect(resolved.org).toBe(ORG);
    }
  });

  it('reads a bare --commit as the picker when it is the only flag, leaving org to its own required check', async () => {
    const parsed = await Parser.parse(withBareCommit(['--commit']), { flags: { commit: catalog.commit } });

    expect(parsed.flags.commit).toBe(PICK_COMMIT);
  });

  it('reads a bare --commit followed by --last-upload as two flags, so the exclusive rule refuses them with exit 2', async () => {
    const failure = await Parser.parse(withBareCommit(['--commit', '--last-upload']), {
      flags: { commit: catalog.commit, 'last-upload': catalog['last-upload'] },
    }).catch((error: Error & { oclif?: { exit?: number } }) => error);

    expect((failure as Error).message).toContain('cannot also be provided when using --commit');
    expect((failure as { oclif?: { exit?: number } }).oclif?.exit).toBe(2);
  });

  it('reads the sha after --commit, trimmed, whichever way it is spelled', async () => {
    for (const argv of [
      ['--commit', SHA, '--org', ORG],
      [`--commit=${SHA}`, '--org', ORG],
      ['--commit', `  ${SHA} `, '--org', ORG],
    ]) {
      const resolved = await createResolvedFrom(argv);

      expect(resolved.commit).toBe(SHA);
      expect(resolved.org).toBe(ORG);
    }
  });

  it.each([[''], ['   '], ['\t']])('refuses --commit %p with exit 2 naming --commit <sha>, never a branch-tip deploy', async (blank) => {
    for (const argv of [
      ['--commit', blank, '--org', ORG],
      [`--commit=${blank}`, '--org', ORG],
    ]) {
      const failure = await createResolvedFrom(argv).catch((error: Error) => error);

      expect(failure).toBeInstanceOf(UsageError);
      expect((failure as UsageError).exitCode).toBe(2);
      expect((failure as Error).message).toContain('--commit <sha>');
    }
  });

  it('leaves --commit absent and --last-upload false when neither is passed', async () => {
    const resolved = await createResolvedFrom(['--org', ORG]);

    expect(resolved.commit).toBeUndefined();
    expect(resolved['last-upload']).toBe(false);
  });

  it('reads --last-upload as true, and the sentinels contain a NUL no user can type on a command line', async () => {
    const resolved = await createResolvedFrom(['--last-upload', '--org', ORG]);

    expect(resolved['last-upload']).toBe(true);
    expect(PICK_COMMIT).toContain('\0');
    expect(BLANK_COMMIT).toContain('\0');
    expect(PICK_COMMIT).not.toBe(BLANK_COMMIT);
  });

  it('stops looking for --commit after the -- terminator and leaves other tokens untouched', () => {
    expect(withBareCommit(['--org', ORG, '--', '--commit'])).toEqual(['--org', ORG, '--', '--commit']);
    expect(withBareCommit(['--org', ORG])).toEqual(['--org', ORG]);
  });

  it('keeps a deployment uid, trimmed of the whitespace around it', async () => {
    const resolved = await resolvedFrom(['--deployment', '  d1e2f3a4b5c6d7e8f9012345 ']);

    expect(resolved.deployment).toBe('d1e2f3a4b5c6d7e8f9012345');
  });

  it.each([[''], ['   '], ['\t']])('reads --deployment %p as absent so the latest lookup applies', async (blank) => {
    const resolved = await resolvedFrom(['--deployment', blank]);

    expect(resolved.deployment).toBeUndefined();
  });

  it('leaves the value absent when the flag is not passed', async () => {
    const resolved = await resolvedFrom([]);

    expect(resolved.deployment).toBeUndefined();
  });
});
