import { DEPLOYMENT_WAIT_TIMEOUT_MS } from '../../../deployments/deployment.watcher';
import { ProjectCreator } from '../../../projects/project.create';
import { serverCommandFrameworkGate } from '../../../environments/environment.inputs';
import ProjectsCreate from './create';

function commandUnderTest(resolved: Record<string, unknown>, dataDir = '/tmp/site') {
  const command = Object.create(ProjectsCreate.prototype) as ProjectsCreate;

  Object.assign(command, {
    resolved: { org: 'org1', ...resolved },
    services: { api: {}, ux: { print: () => undefined, inquire: async () => undefined }, isTTY: false },
    dataDir,
  });

  return command;
}

describe('launch:projects:create', () => {
  it('hands every resolved flag to the creator under its request name', async () => {
    const requests: unknown[] = [];
    jest.spyOn(ProjectCreator.prototype, 'create').mockImplementation(async (request) => {
      requests.push(request);
    });

    await commandUnderTest({
      type: 'GitHub',
      name: 'My Site',
      description: 'A site',
      'env-name': 'Default',
      namespace: 'my-org',
      repo: 'my-org/my-repo',
      branch: 'main',
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
        dataDir: '/tmp/site',
        type: 'GitHub',
        name: 'My Site',
        description: 'A site',
        envName: 'Default',
        namespace: 'my-org',
        repo: 'my-org/my-repo',
        branch: 'main',
        framework: 'NEXTJS',
        buildCmd: 'npm run build',
        outputDir: '.next',
        serverCmd: undefined,
        resMode: 'buffered',
        autoDeploy: 'enable',
        csAuth: 'disable',
      },
    ]);
  });

  it('passes the data directory the base command resolved rather than reading argv itself', async () => {
    const requests: { dataDir: string }[] = [];
    jest.spyOn(ProjectCreator.prototype, 'create').mockImplementation(async (request) => {
      requests.push(request as { dataDir: string });
    });

    await commandUnderTest({}, '/elsewhere/project').run();

    expect(requests[0].dataDir).toBe('/elsewhere/project');
  });

  it('propagates a failure from the creator rather than swallowing it', async () => {
    const boom = new Error('The Launch API could not create that project.');
    jest.spyOn(ProjectCreator.prototype, 'create').mockRejectedValue(boom);

    await expect(commandUnderTest({}).run()).rejects.toBe(boom);
  });

  it('declares the framework gate as a rule, so a bad pairing costs no API call', () => {
    expect(ProjectsCreate.rules).toEqual([serverCommandFrameworkGate]);
  });

  it('declares every flag it reads and requires only the organization', () => {
    expect(Object.keys(ProjectsCreate.inputs)).toEqual([
      'org',
      'type',
      'name',
      'description',
      'env-name',
      'namespace',
      'repo',
      'branch',
      'framework',
      'build-cmd',
      'server-cmd',
      'output-dir',
      'res-mode',
      'auto-deploy',
      'cs-auth',
    ]);
    expect(Object.keys(ProjectsCreate.flags).sort()).toEqual(Object.keys(ProjectsCreate.inputs).sort());
    expect(
      Object.entries(ProjectsCreate.inputs as Record<string, { required?: boolean }>).filter(
        ([, spec]) => spec.required,
      ),
    ).toEqual([
      ['org', { required: true }],
    ]);
  });

  it('sets no oclif flag as required, leaving required-ness to the resolution chain', () => {
    for (const flag of Object.values(ProjectsCreate.flags)) {
      expect((flag as { required?: boolean }).required).toBeFalsy();
    }
  });

  it('waits on a real clock bounded by the declared deployment timeout', () => {
    expect(DEPLOYMENT_WAIT_TIMEOUT_MS).toBe(20 * 60 * 1000);
  });

  it('describes itself and shows both paths in its examples', () => {
    expect(ProjectsCreate.description).toBe(
      'Create a Launch project, its first environment, and its first deployment',
    );
    expect(ProjectsCreate.examples[0]).toContain('--type GitHub');
    expect(ProjectsCreate.examples[1]).toContain('--type FileUpload');
  });
});
