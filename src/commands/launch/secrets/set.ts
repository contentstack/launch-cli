import { EXIT_CANCELLED } from '../../../core/constants';
import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import { isAbsent } from '../../../core/values';
import { styled } from '../../../core/style';
import { asSafeArgvFailure, singleKeyError } from '../../../secrets/secret.rules';
import { SecretSetter } from '../../../secrets/secret.set';

const setInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  key: {},
  yes: {},
});

export default class SecretsSet extends LaunchCommand<typeof setInputs> {
  static description =
    'Add a secret to an environment, or replace its value when the key exists. Takes one --key. ' +
    'The value is read from a masked prompt, or from standard input when piped, and is never a flag';

  static examples = [
    '$ csdx launch:secrets:set --org <org-uid> --project <name-or-uid> --env <name-or-uid> --key API_TOKEN',
    '$ printf \'%s\' "$TOKEN" | csdx launch:secrets:set --org <org-uid> --project <name-or-uid> ' +
      '--env <name-or-uid> --key API_TOKEN --yes',
  ];

  static inputs = setInputs;

  static flags = flagsFor(setInputs);

  async run(): Promise<void> {
    const keys = (this.resolved.key ?? []).filter((key) => !isAbsent(key));

    if (keys.length !== 1) {
      throw singleKeyError(keys.length);
    }

    const saved = await new SecretSetter(this.services, (question) => this.confirm(question)).set({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
      key: keys[0],
      yes: this.resolved.yes === true,
    });

    if (!saved) {
      this.ux.print(styled('Secret not saved.', 'yellow', this.services.outputIsTTY === true));
      this.exit(EXIT_CANCELLED);
    }
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    return super.catch(asSafeArgvFailure(err) as Error);
  }
}
