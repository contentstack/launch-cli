import { Parser } from '@oclif/core';

import { catalog } from '../resources';
import { variableFlags, variableResolution } from './variable.inputs';

describe('variable inputs', () => {
  it('names each flag as the Commands Details "All flags" tables name it', () => {
    expect(Object.keys(variableFlags)).toEqual(['var', 'dotenv', 'key', 'from-stack', 'alias']);
  });

  it.each(['var', 'dotenv', 'key'] as const)('declares %s repeatable so each occurrence and each value is kept', (name) => {
    expect(variableFlags[name].multiple).toBe(true);
  });

  it.each(['var', 'dotenv', 'key', 'from-stack', 'alias'] as const)('never marks %s required at parse time', (name) => {
    expect(variableFlags[name].required).toBeFalsy();
  });

  it('gives every flag a resolution entry that reads no config file, prompts nowhere and defaults to nothing', () => {
    expect(Object.keys(variableResolution)).toEqual(Object.keys(variableFlags));

    for (const spec of Object.values(variableResolution) as object[]) {
      expect(spec).toEqual({});
    }
  });

  it('declares --from-stack as a presence-only flag and --alias as a single value with the short form -a', () => {
    expect(variableFlags['from-stack'].type).toBe('boolean');
    expect(variableFlags.alias.type).toBe('option');
    expect(variableFlags.alias.multiple).toBeFalsy();
    expect(variableFlags.alias.char).toBe('a');
  });

  it('parses --from-stack with no value and --alias -a with one', async () => {
    const parsed = await Parser.parse(['--from-stack', '-a', 'my-prod'], {
      flags: { 'from-stack': variableFlags['from-stack'], alias: variableFlags.alias },
    });

    expect(parsed.flags['from-stack']).toBe(true);
    expect(parsed.flags.alias).toBe('my-prod');
  });

  it('describes --var without showing a value that looks like a secret', () => {
    expect(variableFlags.var.description).toContain('KEY=VALUE');
    expect(variableFlags.var.description).not.toMatch(/sk_|ghp_|password/i);
  });

  it('parses --var A=1 B=2 and --var A=1 --var B=2 to the same values', async () => {
    const spaced = await Parser.parse(['--var', 'A=1', 'B=2'], { flags: { var: variableFlags.var } });
    const repeated = await Parser.parse(['--var', 'A=1', '--var', 'B=2'], { flags: { var: variableFlags.var } });

    expect(spaced.flags.var).toEqual(['A=1', 'B=2']);
    expect(repeated.flags.var).toEqual(spaced.flags.var);
  });

  it('stops --var at the next flag instead of swallowing it', async () => {
    const parsed = await Parser.parse(['--var', 'A=1', 'B=2', '--project', 'x'], {
      flags: { var: variableFlags.var, project: catalog.project },
    });

    expect(parsed.flags.var).toEqual(['A=1', 'B=2']);
    expect(parsed.flags.project).toBe('x');
  });

  it('keeps a quoted value with a space as one value and an equals sign inside a value', async () => {
    const parsed = await Parser.parse(['--var', 'MSG=hello world', 'TOKEN=a=b'], { flags: { var: variableFlags.var } });

    expect(parsed.flags.var).toEqual(['MSG=hello world', 'TOKEN=a=b']);
  });

  it('collects repeated --dotenv and --key occurrences in order', async () => {
    const parsed = await Parser.parse(['--dotenv', 'a.env', '--dotenv', '-', '--key', 'X', 'Y'], {
      flags: { dotenv: variableFlags.dotenv, key: variableFlags.key },
    });

    expect(parsed.flags['dotenv']).toEqual(['a.env', '-']);
    expect(parsed.flags.key).toEqual(['X', 'Y']);
  });
});
