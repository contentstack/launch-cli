import { EXIT_CANCELLED } from '../../../core/constants';
import { MissingInputError } from '../../../core/errors';
import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import { styled } from '../../../core/style';
import { isAbsent } from '../../../core/values';
import { catalog } from '../../../resources';
import { UNSET_INVALID_ARGUMENTS_MESSAGE, asSafeArgvFailure } from '../../../secrets/secret.rules';
import { SecretRemover } from '../../../secrets/secret.unset';

const unsetInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  key: {},
  yes: {},
});

export default class SecretsUnset extends LaunchCommand<typeof unsetInputs> {
  static description =
    'Remove secrets from an environment, after asking for confirmation. Pass --key once per secret. ' +
    'A key that cannot be removed is reported and the others are still removed';

  static examples = [
    '$ csdx launch:secrets:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> --key API_TOKEN',
    '$ csdx launch:secrets:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--key API_TOKEN --key DB_PASSWORD --yes',
  ];

  static inputs = unsetInputs;

  static flags = {
    ...flagsFor(unsetInputs),
    key: { ...catalog.key, description: 'Secret key, repeatable' },
  };

  async run(): Promise<void> {
    const keys = (this.resolved.key ?? []).filter((key) => !isAbsent(key));

    if (keys.length === 0) {
      throw new MissingInputError('key', { config: false, prompt: false });
    }

    const removed = await new SecretRemover(this.services, (question) => this.confirm(question)).remove({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
      keys,
    });

    if (!removed) {
      this.ux.print(styled('Secrets not removed.', 'yellow', this.services.outputIsTTY === true));
      this.exit(EXIT_CANCELLED);
    }
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    return super.catch(asSafeArgvFailure(err, UNSET_INVALID_ARGUMENTS_MESSAGE) as Error);
  }
}
