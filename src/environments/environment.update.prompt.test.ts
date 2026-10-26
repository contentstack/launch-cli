import type { ServiceContext } from '../core/service-context';
import type { Environment } from './types';
import { SETTINGS_QUESTION, promptForEnvironmentUpdate } from './environment.update.prompt';

const CURRENT: Environment = {
  uid: 'env1',
  name: 'production',
  description: 'the live site',
  gitBranch: 'main',
  frameworkPreset: 'NEXTJS',
  buildCommand: 'npm run build',
  outputDirectory: './.next',
  autoDeployOnPush: true,
  isContentstackAuthenticationEnabled: false,
  isCachePrimingEnabled: false,
  passwordProtection: { isEnabled: false },
};

const REPOSITORY = { repositoryName: 'octo-user/site', username: 'octo-user', gitProvider: 'GitHub' };

function servicesAnswering(answers: Record<string, unknown>) {
  const asked: { message: string; default?: unknown; choices?: unknown; validate?: (value: string) => true | string }[] = [];
  const lines: string[] = [];
  const branchLookups: unknown[] = [];
  const services = {
    isTTY: true,
    outputIsTTY: false,
    ux: {
      print: (message: string) => {
        lines.push(message);
      },
      inquire: async (payload: { message: string; default?: unknown; choices?: unknown; validate?: (value: string) => true | string }) => {
        asked.push(payload);
        return answers[payload.message];
      },
    },
    api: {
      git: {
        branches: async (params: unknown) => {
          branchLookups.push(params);
          return { pagination: { count: 2 }, branches: [{ name: 'main' }, { name: 'release' }] };
        },
      },
    },
  } as unknown as ServiceContext;

  return { services, asked, lines, branchLookups };
}

function githubContext(current: Environment = CURRENT) {
  return { org: 'org1', projectType: 'GITPROVIDER', repository: REPOSITORY, current };
}

describe('promptForEnvironmentUpdate', () => {
  it('offers every setting as a checklist, in a fixed order', async () => {
    const { services, asked } = servicesAnswering({ [SETTINGS_QUESTION]: [] });

    await promptForEnvironmentUpdate(services, githubContext());

    expect(SETTINGS_QUESTION).toBe('Select the fields to update:');
    expect(asked[0]).toEqual({
      type: 'checkbox',
      name: 'value',
      message: SETTINGS_QUESTION,
      choices: [
        { name: 'Name', value: 'name' },
        { name: 'Description', value: 'description' },
        { name: 'Branch', value: 'branch' },
        { name: 'Framework preset', value: 'framework' },
        { name: 'Build command', value: 'buildCmd' },
        { name: 'Server command', value: 'serverCmd' },
        { name: 'Output directory', value: 'outputDir' },
        { name: 'Response mode', value: 'resMode' },
        { name: 'Auto deploy', value: 'autoDeploy' },
        { name: 'Contentstack Authentication', value: 'csAuth' },
        { name: 'Cache priming', value: 'cachePriming' },
        { name: 'Password protection', value: 'passwordProtection' },
      ],
      loop: false,
      pageSize: 5,
      validate: expect.any(Function),
    });
  });

  it('leaves Branch and Auto deploy off the checklist for a FileUpload project', async () => {
    const { services, asked } = servicesAnswering({ [SETTINGS_QUESTION]: [] });

    await promptForEnvironmentUpdate(services, { org: 'org1', projectType: 'FILEUPLOAD', current: CURRENT });

    const offered = (asked[0].choices as { value: string }[]).map((choice) => choice.value);
    expect(offered).not.toContain('branch');
    expect(offered).not.toContain('autoDeploy');
    expect(offered).toHaveLength(10);
  });

  it('asks nothing more and changes nothing when no setting is ticked', async () => {
    const { services, asked } = servicesAnswering({ [SETTINGS_QUESTION]: [] });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({});
    expect(asked).toHaveLength(1);
  });

  it('asks only the ticked settings, each offering its current value, and keeps only what changed', async () => {
    const { services, asked } = servicesAnswering({
      [SETTINGS_QUESTION]: ['cachePriming', 'name', 'buildCmd', 'description'],
      Name: 'production',
      Description: '  pre-release  ',
      'Build command': 'npm run build:prod',
      'Cache priming': 'enable',
    });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({
      description: 'pre-release',
      buildCmd: 'npm run build:prod',
      cachePriming: 'enable',
    });
    expect(asked.slice(1).map((question) => [question.message, question.default])).toEqual([
      ['Name', 'production'],
      ['Description', 'the live site'],
      ['Build command', 'npm run build'],
      ['Cache priming', 'disable'],
    ]);
  });

  it('keeps a toggle answered with its current state out of the update', async () => {
    const { services } = servicesAnswering({
      [SETTINGS_QUESTION]: ['autoDeploy', 'csAuth', 'passwordProtection'],
      'Auto deploy': 'enable',
      'Contentstack Authentication': 'enable',
      'Password protection': 'disable',
    });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({ csAuth: 'enable' });
  });

  it('sends a toggle whose current state the API did not report, whatever was answered', async () => {
    const { services } = servicesAnswering({ [SETTINGS_QUESTION]: ['cachePriming'], 'Cache priming': 'disable' });

    await expect(
      promptForEnvironmentUpdate(services, githubContext({ ...CURRENT, isCachePrimingEnabled: undefined })),
    ).resolves.toEqual({ cachePriming: 'disable' });
  });

  it('picks the branch from the repository, pre-selecting the current one', async () => {
    const { services, asked, branchLookups } = servicesAnswering({
      [SETTINGS_QUESTION]: ['branch'],
      'Choose a branch': 'release',
    });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({ branch: 'release' });
    expect(branchLookups).toEqual([
      { org: 'org1', provider: 'GitHub', namespace: 'octo-user', repoName: 'octo-user/site', limit: 100, skip: 0 },
    ]);
    expect(asked[1].default).toBe('main');
  });

  it('pre-selects the current framework and maps the label picked onto its preset', async () => {
    const { services, asked } = servicesAnswering({ [SETTINGS_QUESTION]: ['framework'], 'Framework preset': 'Nuxt' });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({ framework: 'NUXT' });
    expect(asked[1].default).toBe('NextJs');
  });

  it('asks the response mode and always sends it, since the API never reports the current one', async () => {
    const { services, asked } = servicesAnswering({ [SETTINGS_QUESTION]: ['resMode'], 'Response mode': 'buffered' });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({ resMode: 'buffered' });
    expect(asked[1].default).toBe('buffered');
  });

  it('skips the server command, saying why, when the framework it would run under takes none', async () => {
    const { services, asked, lines } = servicesAnswering({ [SETTINGS_QUESTION]: ['serverCmd'] });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({});
    expect(asked).toHaveLength(1);
    expect(lines).toEqual(['Server command skipped: the NEXTJS framework runs no server command.']);
  });

  it('asks the server command when the framework chosen in the same session takes one', async () => {
    const { services } = servicesAnswering({
      [SETTINGS_QUESTION]: ['framework', 'serverCmd'],
      'Framework preset': 'Nuxt',
      'Server command': 'node .output/server/index.mjs',
    });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({
      framework: 'NUXT',
      serverCmd: 'node .output/server/index.mjs',
    });
  });

  it('leaves out a blank answer to an optional text setting', async () => {
    const { services } = servicesAnswering({ [SETTINGS_QUESTION]: ['description', 'buildCmd'], Description: '  ' });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({});
  });

  it('skips the server command when the environment reports no framework at all', async () => {
    const { services, lines } = servicesAnswering({ [SETTINGS_QUESTION]: ['serverCmd'] });

    await expect(
      promptForEnvironmentUpdate(services, githubContext({ ...CURRENT, frameworkPreset: undefined })),
    ).resolves.toEqual({});
    expect(lines).toEqual(['Server command skipped: this environment has no framework that runs a server command.']);
  });

  it('asks the output directory offering the current one and keeps a new answer', async () => {
    const { services, asked } = servicesAnswering({ [SETTINGS_QUESTION]: ['outputDir'], 'Output directory': './out' });

    await expect(promptForEnvironmentUpdate(services, githubContext())).resolves.toEqual({ outputDir: './out' });
    expect(asked[1].default).toBe('./.next');
  });

  it('keeps enable for password protection that is already on, so the credentials can be changed', async () => {
    const { services } = servicesAnswering({
      [SETTINGS_QUESTION]: ['passwordProtection'],
      'Password protection': 'enable',
    });

    await expect(
      promptForEnvironmentUpdate(services, githubContext({ ...CURRENT, passwordProtection: { isEnabled: true } })),
    ).resolves.toEqual({ passwordProtection: 'enable' });
  });

  it('offers password protection with nothing pre-selected, and keeps the answer, when the API reports no state', async () => {
    const { services, asked } = servicesAnswering({
      [SETTINGS_QUESTION]: ['passwordProtection'],
      'Password protection': 'disable',
    });

    await expect(
      promptForEnvironmentUpdate(services, githubContext({ ...CURRENT, passwordProtection: undefined })),
    ).resolves.toEqual({ passwordProtection: 'disable' });
    expect(asked[1].default).toBeUndefined();
  });

  it('refuses a description over 255 characters at the prompt, so it is asked again rather than sent', async () => {
    const { services, asked } = servicesAnswering({ [SETTINGS_QUESTION]: ['description'], Description: 'short' });

    await promptForEnvironmentUpdate(services, githubContext());

    const validate = asked[1].validate as (value: string) => true | string;
    expect(validate('d'.repeat(255))).toBe(true);
    expect(validate('d'.repeat(256))).toBe('Description must be 255 characters or fewer; that value is 256 characters.');
  });
});
