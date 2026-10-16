import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { defaultWatchTiming } from '../../../deployments/deployment.watcher';
import { EnvironmentCreator } from '../../../environments/environment.create';
import { serverCommandFrameworkGate, withEnvironmentWording } from '../../../environments/environment.inputs';

const createInputs = inputs({
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

export default class EnvironmentsCreate extends LaunchCommand<typeof createInputs> {
  static description = 'Create an environment in a Launch project and follow its first deployment';

  static examples = [
    '$ csdx launch:env:create --org <org-uid> --project <name-or-uid> --name staging --branch develop ' +
      '--framework NextJs --build-cmd "npm run build" --output-dir .next --res-mode buffered',
    '$ csdx launch:env:create --org <org-uid> --project <name-or-uid> --name staging --data-dir ./site ' +
      '# a FileUpload project uploads the folder',
  ];

  static inputs = createInputs;

  static flags = withEnvironmentWording(flagsFor(createInputs));

  static rules = [serverCommandFrameworkGate];

  async run(): Promise<void> {
    const resolved = this.resolved;

    await new EnvironmentCreator(this.services, defaultWatchTiming()).create({
      org: resolved.org,
      project: resolved.project,
      dataDir: this.dataDir,
      configPath: this.configPath,
      name: resolved.name,
      description: resolved.description,
      branch: resolved.branch,
      framework: resolved.framework,
      buildCmd: resolved['build-cmd'],
      serverCmd: resolved['server-cmd'],
      outputDir: resolved['output-dir'],
      resMode: resolved['res-mode'],
      autoDeploy: resolved['auto-deploy'],
      csAuth: resolved['cs-auth'],
    });
  }
}
