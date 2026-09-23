import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { defaultWatchTiming } from '../../../deployments/deployment.watcher';
import { serverCommandFrameworkGate } from '../../../environments/environment.inputs';
import { ProjectCreator } from '../../../projects/project.create';

const createInputs = inputs({
  org: { required: true },
  type: {},
  name: {},
  description: {},
  'env-name': {},
  namespace: {},
  repo: {},
  branch: {},
  framework: {},
  'build-cmd': {},
  'server-cmd': {},
  'output-dir': {},
  'res-mode': {},
  'auto-deploy': {},
  'cs-auth': {},
});

export default class ProjectsCreate extends LaunchCommand<typeof createInputs> {
  static description = 'Create a Launch project, its first environment, and its first deployment';

  static examples = [
    '$ csdx launch:projects:create --org <org-uid> --type GitHub --name <name> --env-name <environment> ' +
      '--namespace <git-namespace> --repo <namespace/repo> --branch main --framework NextJs ' +
      '--build-cmd "npm run build" --output-dir .next --res-mode buffered',
    '$ csdx launch:projects:create --org <org-uid> --type FileUpload --name <name> --env-name <environment> ' +
      '--data-dir ./site --framework Other --build-cmd "npm run build" --output-dir ./ --res-mode buffered',
  ];

  static inputs = createInputs;

  static flags = flagsFor(createInputs);

  static rules = [serverCommandFrameworkGate];

  async run(): Promise<void> {
    const resolved = this.resolved;

    await new ProjectCreator(this.services, defaultWatchTiming()).create({
      org: resolved.org,
      dataDir: this.dataDir,
      configPath: this.configPath,
      type: resolved.type,
      name: resolved.name,
      description: resolved.description,
      envName: resolved['env-name'],
      namespace: resolved.namespace,
      repo: resolved.repo,
      branch: resolved.branch,
      framework: resolved.framework,
      buildCmd: resolved['build-cmd'],
      outputDir: resolved['output-dir'],
      serverCmd: resolved['server-cmd'],
      resMode: resolved['res-mode'],
      autoDeploy: resolved['auto-deploy'],
      csAuth: resolved['cs-auth'],
    });
  }
}
