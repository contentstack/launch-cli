import { UsageError } from '../../../core/errors';
import {
  ENVIRONMENT_DESCRIPTION_MAX_LENGTH,
  ENVIRONMENT_NAME_MAX_LENGTH,
} from '../../../environments/environment.inputs';
import { catalog, resolution } from '../../../resources';
import { DEPLOYMENT_WAIT_TIMEOUT_MS } from '../../../deployments/deployment.watcher';
import { EnvironmentCreator } from '../../../environments/environment.create';
import { serverCommandFrameworkGate } from '../../../environments/environment.inputs';
import EnvironmentsCreate from './create';

function commandUnderTest(resolved: Record<string, unknown>) {
  const command = Object.create(EnvironmentsCreate.prototype) as EnvironmentsCreate;

  Object.assign(command, {
    resolved: { org: 'org1', project: 'proj1', ...resolved },
    services: { api: {}, ux: { print: () => undefined, inquire: async () => undefined }, isTTY: false },
    dataDir: '/tmp/site',
    configPath: '/tmp/site/.cs-launch.json',
  });

  return command;
}

describe('launch:env:create', () => {
  it('hands every resolved flag to the EnvironmentCreator with the data dir, config path and wait timing', async () => {
    const requests: unknown[] = [];
    const timings: unknown[] = [];
    jest.spyOn(EnvironmentCreator.prototype, 'create').mockImplementation(async function (
      this: EnvironmentCreator,
      request,
    ) {
      requests.push(request);
      timings.push((this as unknown as { timing: { timeoutMs: number } }).timing.timeoutMs);
    });

    await commandUnderTest({
      name: 'staging',
      description: 'pre-release',
      branch: 'develop',
      framework: 'NEXTJS',
      'build-cmd': 'npm run build',
      'server-cmd': undefined,
      'output-dir': '.next',
      'res-mode': 'buffered',
      'auto-deploy': 'enable',
      'cs-auth': 'disable',
    }).run();

    expect(requests).toEqual([
      {
        org: 'org1',
        project: 'proj1',
        dataDir: '/tmp/site',
        configPath: '/tmp/site/.cs-launch.json',
        name: 'staging',
        description: 'pre-release',
        branch: 'develop',
        framework: 'NEXTJS',
        buildCmd: 'npm run build',
        serverCmd: undefined,
        outputDir: '.next',
        resMode: 'buffered',
        autoDeploy: 'enable',
        csAuth: 'disable',
      },
    ]);
    expect(timings).toEqual([DEPLOYMENT_WAIT_TIMEOUT_MS]);
  });

  it('propagates a failed create', async () => {
    const failure = new Error('create failed');
    jest.spyOn(EnvironmentCreator.prototype, 'create').mockRejectedValue(failure);

    await expect(commandUnderTest({}).run()).rejects.toBe(failure);
  });

  it('declares org and project as required, every build setting as optional, and the server-command rule', () => {
    expect(EnvironmentsCreate.inputs).toEqual({
      org: { required: true },
      project: { required: true },
      name: {},
      description: {},
      branch: {},
      framework: {},
      'build-cmd': {},
      'server-cmd': {},
      'output-dir': {},
      'res-mode': {},
      'auto-deploy': {},
      'cs-auth': {},
    });
    expect(Object.keys(EnvironmentsCreate.flags).sort()).toEqual(Object.keys(EnvironmentsCreate.inputs).sort());
    expect(EnvironmentsCreate.rules).toEqual([serverCommandFrameworkGate]);
  });

  it('describes --name and --description as the environment its own, leaving the project wording alone', () => {
    expect(EnvironmentsCreate.flags.name.description).toBe('Environment name (200 characters or fewer)');
    expect(EnvironmentsCreate.flags.description.description).toBe('Environment description (255 characters or fewer)');
    expect(catalog.name.description).toBe('Project name (200 characters or fewer)');
    expect(catalog.description.description).toBe('Project description (255 characters or fewer)');
    expect(EnvironmentsCreate.flags.org).toBe(catalog.org);
  });

  it('states in --help the same limits the shared --name and --description specs enforce', async () => {
    const nameSpec = resolution.name as { normalize(value: string): Promise<string> };
    const descriptionSpec = resolution.description as { normalize(value: string): Promise<string> };

    await expect(nameSpec.normalize('n'.repeat(ENVIRONMENT_NAME_MAX_LENGTH))).resolves.toHaveLength(
      ENVIRONMENT_NAME_MAX_LENGTH,
    );
    await expect(nameSpec.normalize('n'.repeat(ENVIRONMENT_NAME_MAX_LENGTH + 1))).rejects.toThrow(UsageError);
    await expect(descriptionSpec.normalize('d'.repeat(ENVIRONMENT_DESCRIPTION_MAX_LENGTH))).resolves.toHaveLength(
      ENVIRONMENT_DESCRIPTION_MAX_LENGTH,
    );
    await expect(descriptionSpec.normalize('d'.repeat(ENVIRONMENT_DESCRIPTION_MAX_LENGTH + 1))).rejects.toThrow(
      UsageError,
    );
  });
});

