import { EXIT_CANCELLED } from '../../../core/constants';
import { MissingInputError } from '../../../core/errors';
import { flagsFor, inputs } from '../../../core/inputs';
import { LaunchCommand } from '../../../core/launch-command';
import { styled } from '../../../core/style';
import { VariableRemover } from '../../../variables/variable.unset';

const unsetInputs = inputs({
  org: { required: true },
  project: { required: true },
  env: { required: true },
  key: {},
  yes: {},
});

export default class VariablesUnset extends LaunchCommand<typeof unsetInputs> {
  static description = 'Remove environment variables from an environment, after asking for confirmation';

  static examples = [
    '$ csdx launch:variables:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> --key API_KEY',
    '$ csdx launch:variables:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> ' +
      '--key API_KEY --key DEBUG --yes',
  ];

  static inputs = unsetInputs;

  static flags = flagsFor(unsetInputs);

  async run(): Promise<void> {
    const keys = this.resolved.key ?? [];

    if (keys.length === 0) {
      throw new MissingInputError('key', { config: false, prompt: false });
    }

    const removed = await new VariableRemover(this.services, (question) => this.confirm(question)).remove({
      org: this.resolved.org,
      project: this.resolved.project,
      environment: this.resolved.env,
      keys,
    });

    if (!removed) {
      this.ux.print(styled('Variables not removed.', 'yellow', this.services.outputIsTTY === true));
      this.exit(EXIT_CANCELLED);
    }
  }
}
