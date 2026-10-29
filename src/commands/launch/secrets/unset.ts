import { FlagInput, Flags, cliux as ux } from '@contentstack/cli-utilities';

import { SecretsBaseCommand, secretsScopeFlags } from '../../../base-secrets-command';
import { deleteEnvironmentSecretMutation } from '../../../graphql';
import { formatSecretsError } from '../../../util';

export default class UnsetSecret extends SecretsBaseCommand<typeof UnsetSecret> {
  static description = 'Delete one or more secrets of an environment';

  static examples = [
    '$ <%= config.bin %> <%= command.id %> --key=<KEY>',
    '$ <%= config.bin %> <%= command.id %> --key=<KEY> --key=<ANOTHER KEY> --yes',
    '$ <%= config.bin %> <%= command.id %> --org=<org UID> --project=<Project UID> ' +
      '--environment=<environment name or UID> --key=<KEY>',
  ];

  static flags: FlagInput = {
    ...secretsScopeFlags,
    key: Flags.string({
      char: 'k',
      required: true,
      multiple: true,
      description: 'Secret key to delete. Repeat the flag to delete several secrets',
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip the confirmation prompt',
    }),
  };

  async run(): Promise<void> {
    this.initLogger();
    await this.setupScope();
    await this.unsetSecrets();
  }

  async unsetSecrets(): Promise<void> {
    const { key: keys, yes } = this.flags as Record<string, any>;
    const environment = await this.resolveEnvironment();

    if (!yes && !this.interactive) {
      this.log('use --yes when not running in a terminal', 'error');
      process.exit(1);
    }

    if (!yes && !(await this.confirm(keys, environment.name))) {
      ux.print('Aborted. No secret was deleted.');
      return;
    }

    let failed = false;

    for (const key of keys) {
      try {
        await this.apolloClient.mutate({
          mutation: deleteEnvironmentSecretMutation,
          variables: { environment: { uid: environment.uid }, secret: { key } },
        });
        this.log(`Secret ${key} deleted from environment ${environment.name}.`);
      } catch (error) {
        this.log(formatSecretsError(error, { key }), 'error');
        failed = true;
      }
    }

    if (failed) {
      process.exit(1);
    }
  }

  confirm(keys: string[], environmentName: string): Promise<boolean> {
    return ux.inquire<boolean>({
      type: 'confirm',
      name: 'confirm',
      message: `Delete secret ${keys.join(', ')} from environment ${environmentName}?`,
    });
  }
}
