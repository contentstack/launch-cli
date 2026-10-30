import { EXIT_CANCELLED } from '../../../core/constants';
import { UsageError } from '../../../core/errors';
import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import { styled } from '../../../core/style';
import { withoutArgumentValues } from '../../../secrets/secrets.redact';
import { SecretSetter } from '../../../secrets/secrets.set';
import { readSecretValue } from '../../../secrets/secrets.value';

const setInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  key: { required: true },
  yes: {},
});

export default class SecretsSet extends LaunchCommand<typeof setInputs> {
  static description =
    'Add a secret to an environment, or refresh it when the key already exists. ' +
    'The value comes from a masked prompt, or from stdin when piped, and is never taken from an argument';

  static examples = [
    '$ csdx launch:secrets:set --org <org-uid> --project <name-or-uid> --env <name-or-uid> --key API_TOKEN',
    '$ printf \'%s\' "$TOKEN" | csdx launch:secrets:set --org <org-uid> --project <name-or-uid> ' +
      '--env <name-or-uid> --key API_TOKEN --yes',
  ];

  static inputs = setInputs;

  static flags = flagsFor(setInputs);

  protected readStdin: () => Promise<string> = () => readSecretValue();

  async run(): Promise<void> {
    const [key, ...others] = this.resolved.key;

    if (key === undefined || others.length > 0) {
      throw new UsageError('Pass exactly one --key.');
    }

    const outcome = await new SecretSetter(
      this.services,
      (question) => this.confirm(question),
      () => this.readStdin(),
    ).set({ org: this.resolved.org, project: this.resolved.project, environment: this.resolved.env, key });

    if (outcome === 'declined') {
      this.ux.print(styled('Secret not changed.', 'yellow', this.services.outputIsTTY === true));
      this.exit(EXIT_CANCELLED);
    }
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    return super.catch(withoutArgumentValues(err));
  }
}
