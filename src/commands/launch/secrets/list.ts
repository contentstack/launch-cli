import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderTable } from '../../../core/render';
import { secretColumns } from '../../../secrets/secrets.presenter';

const listInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
});

export default class SecretsList extends LaunchCommand<typeof listInputs> {
  static description = 'List the secrets of an environment, with their keys and update times and never their values';

  static examples = ['$ csdx launch:secrets:list --org <org-uid> --project <name-or-uid> --env <name-or-uid>'];

  static inputs = listInputs;

  static flags = flagsFor(listInputs);

  async run(): Promise<void> {
    const secrets = await this.services.api.secrets.list({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
    });

    renderTable(this.ux, secretColumns(), secrets, process.stdout.columns, undefined, this.services.outputIsTTY);
  }
}
