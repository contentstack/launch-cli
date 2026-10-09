import { MissingInputError, UsageError } from '../core/errors';
import type { ServiceContext } from '../core/service-context';
import type { ApiSurface } from '../resources';
import { EnvironmentBuilder } from './environment.builder';
import type { EnvironmentRequest, EnvironmentSource } from './types';

const ENV_NAME = 'Production';
const GIT_SOURCE: EnvironmentSource = { detected: {}, branch: 'main' };

function builder(options: { isTTY?: boolean; answers?: unknown[] } = {}) {
  const printed: string[] = [];
  const asked: { message: string; default?: unknown }[] = [];
  const answers = [...(options.answers ?? [])];

  const services: ServiceContext = {
    api: {} as ApiSurface,
    ux: {
      print: (message: string) => {
        printed.push(message);
      },
      inquire: async (payload: unknown) => {
        const { message, default: initial } = payload as { message: string; default?: unknown };
        asked.push({ message, default: initial });
        return answers.shift() as never;
      },
    },
    isTTY: options.isTTY ?? false,
    outputIsTTY: false,
  };

  return { environments: new EnvironmentBuilder(services), printed, asked };
}

const EVERY_FLAG: EnvironmentRequest = {
  framework: 'OTHER',
  buildCmd: 'npm run build',
  outputDir: './dist',
  serverCmd: 'node server.js',
  resMode: 'streaming',
  csAuth: 'disable',
};

describe('EnvironmentBuilder', () => {
  it('builds the environment from the flags alone, asking and printing nothing', async () => {
    const { environments, printed, asked } = builder({ isTTY: true });

    const environment = await environments.build(EVERY_FLAG, ENV_NAME, GIT_SOURCE, 'enable');

    expect(environment).toEqual({
      name: ENV_NAME,
      gitBranch: 'main',
      uploadUid: undefined,
      buildCommand: 'npm run build',
      outputDirectory: './dist',
      serverCommand: 'node server.js',
      frameworkPreset: 'OTHER',
      environmentVariables: [],
      isStreamingEnabled: true,
      autoDeployOnPush: true,
      isContentstackAuthenticationEnabled: false,
    });
    expect(asked).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('carries an upload uid and leaves auto-deploy unset when none was given', async () => {
    const { environments } = builder();

    const environment = await environments.build(EVERY_FLAG, ENV_NAME, { detected: {}, uploadUid: 'u1' }, undefined);

    expect(environment.uploadUid).toBe('u1');
    expect(environment.gitBranch).toBeUndefined();
    expect(environment).not.toHaveProperty('autoDeployOnPush');
  });

  it('turns auto-deploy off when it was disabled', async () => {
    const { environments } = builder();

    const environment = await environments.build(EVERY_FLAG, ENV_NAME, GIT_SOURCE, 'disable');

    expect(environment.autoDeployOnPush).toBe(false);
  });

  it('uses what was detected without a terminal and says so for each value', async () => {
    const { environments, printed } = builder();
    const source: EnvironmentSource = {
      detected: { framework: 'nextjs', buildCommand: 'next build', outputDirectory: '.next' },
      branch: 'main',
    };

    const environment = await environments.build({}, ENV_NAME, source, undefined);

    expect(environment).toEqual(
      expect.objectContaining({
        frameworkPreset: 'NEXTJS',
        buildCommand: 'next build',
        outputDirectory: '.next',
        serverCommand: undefined,
        isStreamingEnabled: false,
      }),
    );
    expect(environment).not.toHaveProperty('isContentstackAuthenticationEnabled');
    expect(printed).toEqual([
      'Using the detected framework NEXTJS. Pass --framework to choose another.',
      'Using the detected build command "next build". Pass --build-cmd to change it.',
      'Using the detected output directory ".next". Pass --output-dir to change it.',
      'Using the buffered response mode. Pass --res-mode streaming to stream responses.',
    ]);
  });

  it("falls back to the framework's default output directory without a terminal or a detected one", async () => {
    const { environments, printed } = builder();

    const environment = await environments.build({ framework: 'NEXTJS' }, ENV_NAME, GIT_SOURCE, undefined);

    expect(environment.outputDirectory).toBe('./.next');
    expect(printed).toContain('Using the default output directory "./.next" for NEXTJS. Pass --output-dir to change it.');
  });

  it('refuses to guess a framework it could not detect without a terminal', async () => {
    const { environments } = builder();

    const building = environments.build({}, ENV_NAME, { detected: { framework: 'not-a-framework' } }, undefined);

    await expect(building).rejects.toThrow(MissingInputError);
    await expect(building).rejects.toThrow('--framework');
  });

  it('refuses a server command for a framework that takes none', async () => {
    const { environments } = builder();

    const building = environments.build(
      { framework: 'NEXTJS', serverCmd: 'node server.js' },
      ENV_NAME,
      GIT_SOURCE,
      undefined,
    );

    await expect(building).rejects.toThrow(UsageError);
    await expect(building).rejects.toThrow('--server-cmd is only supported when --framework is one of');
  });

  it('asks for every unset value in a terminal, offering what was detected', async () => {
    const { environments, asked } = builder({
      isTTY: true,
      answers: ['Other', 'npm run build', './out', 'node server.js', 'streaming', 'enable'],
    });
    const source: EnvironmentSource = {
      detected: { framework: 'other', buildCommand: 'make', outputDirectory: './public', serverCommand: 'node .' },
    };

    const environment = await environments.build({}, ENV_NAME, source, undefined);

    expect(asked).toEqual([
      { message: 'Framework preset', default: 'Other' },
      { message: 'Build command', default: 'make' },
      { message: 'Output directory', default: './public' },
      { message: 'Server command', default: 'node .' },
      { message: 'Response mode', default: 'buffered' },
      { message: 'Contentstack Authentication', default: 'enable' },
    ]);
    expect(environment).toEqual(
      expect.objectContaining({
        frameworkPreset: 'OTHER',
        buildCommand: 'npm run build',
        outputDirectory: './out',
        serverCommand: 'node server.js',
        isStreamingEnabled: true,
        isContentstackAuthenticationEnabled: true,
      }),
    );
  });

  it('does not ask for a server command when the framework takes none', async () => {
    const { environments, asked } = builder({ isTTY: true, answers: ['', './.next', 'buffered', 'disable'] });

    const environment = await environments.build({ framework: 'NEXTJS' }, ENV_NAME, GIT_SOURCE, undefined);

    expect(asked.map((question) => question.message)).not.toContain('Server command');
    expect(environment.serverCommand).toBeUndefined();
  });
});
