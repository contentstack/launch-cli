import { randomBytes } from 'node:crypto';

import { Parser } from '@oclif/core';

import { EXIT_USAGE } from '../core/constants';
import { UsageError } from '../core/errors';
import type { ResolveServices } from '../core/resolution';
import type { ApiSurface } from '../resources';
import type { UxLike } from '../core/prompt';
import { DEPLOYMENT_DEPENDENCIES, deploymentFlags, deploymentResolution } from './deployment.inputs';

const LOWER = randomBytes(12).toString('hex');
const UPPER = LOWER.toUpperCase();

function services(): ResolveServices {
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

  return { api: {} as ApiSurface, ux, isTTY: false };
}

function normalize(value: string): Promise<string> {
  const spec = deploymentResolution.deployment as { normalize(value: string, args: unknown): Promise<string> };

  return spec.normalize(value, {
    services: services(),
    resolved: { org: 'org1', project: 'proj1', env: 'env1' },
    source: 'flag',
  });
}

describe('deployment inputs', () => {
  it('names the one flag it contributes, and declares it optional', () => {
    expect(Object.keys(deploymentFlags)).toEqual(['deployment']);
    expect((deploymentFlags.deployment as { required?: boolean }).required).toBeFalsy();
  });

  it('depends on the organization, project and environment and offers no prompt', () => {
    expect(DEPLOYMENT_DEPENDENCIES).toEqual({ deployment: ['org', 'project', 'env'] });
    expect(deploymentResolution.deployment.dependsOn).toEqual(['org', 'project', 'env']);
    expect('prompt' in deploymentResolution.deployment).toBe(false);
    expect('configPath' in deploymentResolution.deployment).toBe(false);
  });

  it.each([[LOWER], [UPPER]])('accepts the 24-hex uid %s unchanged', async (uid) => {
    await expect(normalize(uid)).resolves.toBe(uid);
  });

  it.each([
    ['a 23-character value', LOWER.slice(0, 23)],
    ['a 25-character value', `${LOWER}d`],
    ['a non-hex value of 24 characters', `g${LOWER.slice(1)}`],
    ['a name', 'my-deploy'],
    ['an empty value', ''],
    ['a uid with surrounding spaces', ` ${LOWER} `],
  ])('refuses %s with a usage error naming --deployment', async (_label, value) => {
    const refusal = (await normalize(value).catch((thrown: unknown) => thrown)) as UsageError;

    expect(refusal).toBeInstanceOf(UsageError);
    expect(refusal.exitCode).toBe(EXIT_USAGE);
    expect(refusal.message).toBe(`--deployment must be a 24-character deployment UID; "${value}" is not one.`);
  });

  it('refuses a value that is not a uid while the arguments are parsed, before anything is resolved', async () => {
    const refusal = (await Parser.parse(['--deployment', 'not-a-uid'], { flags: deploymentFlags }).catch(
      (thrown: unknown) => thrown,
    )) as UsageError;

    expect(refusal).toBeInstanceOf(UsageError);
    expect(refusal.exitCode).toBe(EXIT_USAGE);
    expect(refusal.message).toContain('--deployment');
  });

  it('parses a 24-hex uid from argv untouched', async () => {
    const parsed = await Parser.parse(['--deployment', UPPER], { flags: deploymentFlags });

    expect(parsed.flags.deployment).toBe(UPPER);
  });
});
