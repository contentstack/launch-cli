import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import { promptForCommit } from '../../../deployments/commit.prompt';
import { DeploymentCreator } from '../../../deployments/deployment.create';
import { withBareCommit } from '../../../deployments/deployment.inputs';
import { defaultWatchTiming } from '../../../deployments/deployment.watcher';

const createInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  commit: {},
  'last-upload': {},
});

export default class DeploymentsCreate extends LaunchCommand<typeof createInputs> {
  static description =
    'Deploy a Launch environment: the branch tip or a chosen commit on a GitHub project, ' +
    'the project directory or the last uploaded bundle on a FileUpload project';

  static examples = [
    '$ csdx launch:deployments:create --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
    '$ csdx launch:deployments:create --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' + '--commit <sha>',
    '$ csdx launch:deployments:create --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' + '--last-upload',
  ];

  static inputs = createInputs;

  static flags = flagsFor(createInputs);

  async init(): Promise<void> {
    this.argv = withBareCommit(this.argv);
    await super.init();
  }

  async run(): Promise<void> {
    const resolved = this.resolved;

    await new DeploymentCreator(this.services, defaultWatchTiming(), {
      pickCommit: (scope) => promptForCommit(this.services, scope),
    }).create({
      org: resolved.org,
      project: resolved.project,
      environment: resolved.env,
      dataDir: this.dataDir,
      configPath: this.configPath,
      commit: resolved.commit,
      lastUpload: resolved['last-upload'],
    });
  }
}
