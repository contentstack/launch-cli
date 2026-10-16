import { catalog } from '../../../resources';
import { serverCommandFrameworkGate } from '../../../environments/environment.inputs';
import type { UpdateOutcome } from '../../../environments/environment.update';
import { EnvironmentUpdater } from '../../../environments/environment.update';
import EnvironmentsUpdate from './update';

const RESOLVED = {
  org: 'org1',
  project: 'proj1',
  env: 'env1',
  name: 'renamed',
  description: 'the live site',
  branch: 'release',
  framework: 'NUXT',
  'build-cmd': 'npm run build',
  'server-cmd': 'npm start',
  'output-dir': '.output',
  'res-mode': 'streaming',
  'auto-deploy': 'enable',
  'cs-auth': 'disable',
  'cache-priming': 'disable',
  'password-protection': 'enable',
  username: 'admin',
  password: true,
  yes: true,
};

function commandUnderTest(outcome: UpdateOutcome) {
  const command = Object.create(EnvironmentsUpdate.prototype) as EnvironmentsUpdate;
  const services = { isTTY: false };
  const requests: unknown[] = [];
  let confirmHandedIn: ((question: string) => Promise<boolean>) | undefined;

  Object.assign(command, { resolved: RESOLVED, services });
  jest.spyOn(EnvironmentUpdater.prototype, 'update').mockImplementation(async function (
    this: EnvironmentUpdater,
    request,
  ) {
    requests.push(request);
    confirmHandedIn = (this as unknown as { confirm: (question: string) => Promise<boolean> }).confirm;
    return outcome;
  });

  return { command, requests, confirm: () => confirmHandedIn };
}

describe('launch:env:update', () => {
  it('hands every resolved flag to the EnvironmentUpdater under its request name', async () => {
    const { command, requests } = commandUnderTest('updated');

    await command.run();

    expect(requests).toEqual([
      {
        org: 'org1',
        project: 'proj1',
        environment: 'env1',
        name: 'renamed',
        description: 'the live site',
        branch: 'release',
        framework: 'NUXT',
        buildCmd: 'npm run build',
        serverCmd: 'npm start',
        outputDir: '.output',
        resMode: 'streaming',
        autoDeploy: 'enable',
        csAuth: 'disable',
        cachePriming: 'disable',
        passwordProtection: 'enable',
        username: 'admin',
        password: true,
      },
    ]);
  });

  it('hands the updater the command confirm gate, so --yes answers it', async () => {
    const { command, confirm } = commandUnderTest('updated');

    await command.run();

    await expect(confirm()?.('Disable it?')).resolves.toBe(true);
  });

  it('exits 0 without an error when the updater reports nothing was changed', async () => {
    const { command } = commandUnderTest('unchanged');

    await expect(command.run()).resolves.toBeUndefined();
  });

  it('exits 3 when the updater reports the user declined', async () => {
    const { command } = commandUnderTest('cancelled');

    const error = (await command.run().catch((thrown: unknown) => thrown)) as { oclif?: { exit?: number } };

    expect(error.oclif?.exit).toBe(3);
  });

  it('declares its inputs, the confirm gate and the server-command framework rule', () => {
    expect(Object.keys(EnvironmentsUpdate.inputs).sort()).toEqual(
      [
        'org',
        'project',
        'env',
        'name',
        'description',
        'branch',
        'framework',
        'build-cmd',
        'server-cmd',
        'output-dir',
        'res-mode',
        'auto-deploy',
        'cs-auth',
        'cache-priming',
        'password-protection',
        'username',
        'password',
        'yes',
      ].sort(),
    );
    expect(EnvironmentsUpdate.inputs.org).toEqual({ required: true });
    expect(EnvironmentsUpdate.inputs.project).toEqual({ required: true });
    expect(EnvironmentsUpdate.inputs.env).toEqual({ required: true });
    expect(Object.keys(EnvironmentsUpdate.flags).sort()).toEqual(Object.keys(EnvironmentsUpdate.inputs).sort());
    expect(EnvironmentsUpdate.rules).toEqual([serverCommandFrameworkGate]);
  });

  it('describes --name and --description as the environment its own, leaving the project wording alone', () => {
    expect(EnvironmentsUpdate.flags.name.description).toBe('Environment name (200 characters or fewer)');
    expect(EnvironmentsUpdate.flags.description.description).toBe('Environment description (255 characters or fewer)');
    expect(catalog.name.description).toBe('Project name (200 characters or fewer)');
    expect(catalog.description.description).toBe('Project description (255 characters or fewer)');
    expect(EnvironmentsUpdate.flags.org).toBe(catalog.org);
  });
});
