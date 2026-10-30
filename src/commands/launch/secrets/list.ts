import { LaunchCommand } from '../../../core/launch-command';
import { flagsFor, inputs } from '../../../core/inputs';
import { renderTable } from '../../../core/render';
import { styled } from '../../../core/style';
import { EMPTY_LIST_MESSAGE, secretColumns } from '../../../secrets/secret.presenter';

const listInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
});

export default class SecretsList extends LaunchCommand<typeof listInputs> {
  static description = 'List the secrets of an environment by key and update time; values are never shown';

  static examples = [
    '$ csdx launch:secrets:list --org <org-uid> --project <name-or-uid> --env <name-or-uid>',
  ];

  static inputs = listInputs;

  static flags = flagsFor(listInputs);

  async run(): Promise<void> {
    const secrets = await this.services.api.secrets.list({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
    });

    if (secrets.length === 0) {
      this.ux.print(styled(EMPTY_LIST_MESSAGE, 'yellow', this.services.outputIsTTY === true));
      return;
    }

    renderTable(
      this.ux,
      secretColumns(),
      secrets,
      process.stdout.columns,
      undefined,
      this.services.outputIsTTY === true,
    );
  }
}
