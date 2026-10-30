import { EXIT_CANCELLED } from '../../../core/constants';
import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import { styled } from '../../../core/style';
import { withoutArgumentValues } from '../../../secrets/secrets.redact';
import { SecretRemover } from '../../../secrets/secrets.unset';

const unsetInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  key: { required: true },
  yes: {},
});

export default class SecretsUnset extends LaunchCommand<typeof unsetInputs> {
  static description =
    'Remove secrets from an environment, after asking for confirmation. ' +
    'Repeat --key to remove several; the first failure stops the run and the keys already removed are listed';

  static examples = [
    '$ csdx launch:secrets:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> --key API_TOKEN',
    '$ csdx launch:secrets:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--key API_TOKEN --key DB_URL --yes',
  ];

  static inputs = unsetInputs;

  static flags = flagsFor(unsetInputs);

  async run(): Promise<void> {
    const removed = await new SecretRemover(this.services, (question) => this.confirm(question)).remove({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
      keys: this.resolved.key,
    });

    if (!removed) {
      this.ux.print(styled('Secrets not removed.', 'yellow', this.services.outputIsTTY === true));
      this.exit(EXIT_CANCELLED);
    }
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    return super.catch(withoutArgumentValues(err));
  }
}
