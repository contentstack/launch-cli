import map from 'lodash/map';
import isEmpty from 'lodash/isEmpty';
import { FlagInput, cliux as ux } from '@contentstack/cli-utilities';

import { SecretsBaseCommand, secretsScopeFlags } from '../../../base-secrets-command';

export default class ListSecrets extends SecretsBaseCommand<typeof ListSecrets> {
  static description = 'List the secrets of an environment (keys only, values are never shown)';

  static examples = [
    '$ <%= config.bin %> <%= command.id %> --environment=<environment name or UID>',
    '$ <%= config.bin %> <%= command.id %> --org=<org UID> --project=<Project UID> ' +
      '--environment=<environment name or UID>',
  ];

  static flags: FlagInput = { ...secretsScopeFlags };

  async run(): Promise<void> {
    this.initLogger();
    await this.setupScope();
    await this.listSecrets();
  }

  async listSecrets(): Promise<void> {
    const environment = await this.resolveEnvironment();

    if (isEmpty(environment.secrets)) {
      ux.print(`No secrets found for environment ${environment.name}.`);
      return;
    }

    ux.table(
      [{ value: 'KEY' }, { value: 'UPDATED' }],
      map(environment.secrets, ({ key, updatedAt }) => ({ KEY: key, UPDATED: updatedAt })),
    );
  }
}
