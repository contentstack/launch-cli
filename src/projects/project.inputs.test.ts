import { UsageError } from '../core/errors';
import type { UxLike } from '../core/render';
import type { ApiSurface } from '../resources';
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_TYPE_BY_CHOICE,
  PROJECT_TYPE_CHOICES,
  askProjectType,
  projectFlags,
  projectResolution,
  projectTypeChoiceOf,
} from './project.inputs';

describe('project value-field limits', () => {
  it('matches the limits UpdateProjectInput declares in the management service', () => {
    expect(PROJECT_NAME_MAX_LENGTH).toBe(200);
    expect(PROJECT_DESCRIPTION_MAX_LENGTH).toBe(255);
  });
});

describe('projectFlags', () => {
  it('contributes the project value fields under the names the all-flags table gives them', () => {
    expect(Object.keys(projectFlags).sort()).toEqual(['description', 'name', 'project', 'type']);
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

describe('the --type flag', () => {
  it('names the two values the doc gives and maps each to the service project type', () => {
    expect(PROJECT_TYPE_CHOICES).toEqual(['GitHub', 'FileUpload']);
    expect(PROJECT_TYPE_BY_CHOICE).toEqual({ GitHub: 'GITPROVIDER', FileUpload: 'FILEUPLOAD' });
  });

  it('accepts either value however it was cased or padded', () => {
    expect(projectTypeChoiceOf('GitHub')).toBe('GitHub');
    expect(projectTypeChoiceOf('github')).toBe('GitHub');
    expect(projectTypeChoiceOf(' FILEUPLOAD ')).toBe('FileUpload');
  });

  it('refuses a value outside the two, naming both', () => {
    expect(() => projectTypeChoiceOf('Gitlab')).toThrow(UsageError);
    expect(() => projectTypeChoiceOf('Gitlab')).toThrow(
      '--type must be one of GitHub, FileUpload; "Gitlab" is not.',
    );
  });

  it('normalises a type from any source into the doc value', async () => {
    const spec = projectResolution.type as { normalize(value: string, args: unknown): Promise<unknown> };

    await expect(spec.normalize('fileupload', { services: {}, resolved: {}, source: 'config' })).resolves.toBe(
      'FileUpload',
    );
  });

  it('asks for the project type as a choice of the two doc values and returns the one picked', async () => {
    const asked: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        asked.push(payload);
        return 'FileUpload' as never;
      },
    };

    await expect(askProjectType(ux)).resolves.toBe('FileUpload');
    expect(asked).toEqual([
      {
        type: 'search-list',
        name: 'value',
        message: 'Project type',
        choices: [
          { name: 'GitHub', value: 'GitHub' },
          { name: 'FileUpload', value: 'FileUpload' },
        ],
        default: undefined,
      },
    ]);
  });

  it('prompts for the project type through the resolution chain with the command services', async () => {
    const asked: unknown[] = [];
    const ux: UxLike = {
      print: () => undefined,
      inquire: async (payload: unknown) => {
        asked.push((payload as { message: string }).message);
        return 'GitHub' as never;
      },
    };

    await expect(
      projectResolution.type.prompt({ services: { api: {} as ApiSurface, ux, isTTY: true }, resolved: {} }),
    ).resolves.toBe('GitHub');
    expect(asked).toEqual(['Project type']);
  });
});
