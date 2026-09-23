import { UsageError } from '../core/errors';
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  projectFlags,
  projectResolution,
} from './project.inputs';

describe('project value-field limits', () => {
  it('matches the limits UpdateProjectInput declares in the management service', () => {
    expect(PROJECT_NAME_MAX_LENGTH).toBe(200);
    expect(PROJECT_DESCRIPTION_MAX_LENGTH).toBe(255);
  });
});

describe('projectFlags', () => {
  it('contributes the project value fields under the names the all-flags table gives them', () => {
    expect(Object.keys(projectFlags).sort()).toEqual(['description', 'name', 'project']);
  });

  it.each([['name'], ['description'], ['project']])('declares %s without oclif required-ness', (flag) => {
    expect((projectFlags[flag as keyof typeof projectFlags] as { required?: boolean }).required).toBeFalsy();
  });
});

describe('projectResolution name', () => {
  it('passes a name at the limit through unchanged', async () => {
    const value = 'n'.repeat(PROJECT_NAME_MAX_LENGTH);

    await expect(projectResolution.name.normalize(value)).resolves.toBe(value);
  });

  it('rejects a name one character over the limit naming the flag and both lengths', async () => {
    const value = 'n'.repeat(PROJECT_NAME_MAX_LENGTH + 1);

    await expect(projectResolution.name.normalize(value)).rejects.toThrow(UsageError);
    await expect(projectResolution.name.normalize(value)).rejects.toThrow(
      '--name must be 200 characters or fewer; that value is 201 characters.',
    );
  });

  it('accepts a single character', async () => {
    await expect(projectResolution.name.normalize('n')).resolves.toBe('n');
  });
});

describe('projectResolution description', () => {
  it('passes a description at the limit through unchanged', async () => {
    const value = 'd'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH);

    await expect(projectResolution.description.normalize(value)).resolves.toBe(value);
  });

  it('rejects a description one character over the limit naming the flag and both lengths', async () => {
    const value = 'd'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1);

    await expect(projectResolution.description.normalize(value)).rejects.toThrow(UsageError);
    await expect(projectResolution.description.normalize(value)).rejects.toThrow(
      '--description must be 255 characters or fewer; that value is 256 characters.',
    );
  });

  it.each([['name'], ['description']])('leaves %s with no configPath, prompt or default', (flag) => {
    const spec = projectResolution[flag as 'name' | 'description'] as Record<string, unknown>;

    expect(spec.configPath).toBeUndefined();
    expect(spec.prompt).toBeUndefined();
    expect(spec.default).toBeUndefined();
  });
});
