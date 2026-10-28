import { Parser } from '@oclif/core';

import { inputs } from '../core/inputs';
import { resolveInputs } from '../core/resolve';
import type { ApiSurface } from '../resources';
import { catalog } from '../resources';
import { deploymentFlags, deploymentResolution } from './deployment.inputs';

const getInputs = inputs({ deployment: {} });
const services = { api: {} as ApiSurface, ux: { print: () => undefined, inquire: async () => undefined as never }, isTTY: false };

async function resolvedFrom(argv: string[]) {
  const parsed = await Parser.parse(argv, { flags: { deployment: catalog.deployment } });

  return resolveInputs(getInputs, { parsed: parsed.flags, projectConfig: {}, services });
}

describe('deployment inputs', () => {
  it('names the one flag the deployments commands add and shares it through the catalog', () => {
    expect(Object.keys(deploymentFlags)).toEqual(['deployment']);
    expect(Object.keys(deploymentResolution)).toEqual(['deployment']);
    expect(catalog.deployment).toBe(deploymentFlags.deployment);
    expect(deploymentFlags.deployment.required).toBeFalsy();
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
