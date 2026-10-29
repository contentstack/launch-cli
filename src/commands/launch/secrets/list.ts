import map from 'lodash/map';
import find from 'lodash/find';
import isEmpty from 'lodash/isEmpty';
import { FlagInput, Flags, cliux as ux } from '@contentstack/cli-utilities';

import { BaseCommand } from '../../../base-command';
import { environmentSecretsQuery } from '../../../graphql';
import { Logger, selectOrg, selectProject } from '../../../util';

export default class ListSecrets extends BaseCommand<typeof ListSecrets> {
  static description = 'List the secrets of an environment (keys only, values are never shown)';

  static examples = [
    '$ <%= config.bin %> <%= command.id %> --environment=<environment name or UID>',
    '$ <%= config.bin %> <%= command.id %> --org=<org UID> --project=<Project UID> ' +
      '--environment=<environment name or UID>',
  ];

  static flags: FlagInput = {
    org: Flags.string({
      description: '[Optional] Provide the organization UID',
    }),
    project: Flags.string({
      description: '[Optional] Provide the project UID',
    }),
    environment: Flags.string({
      char: 'e',
      description: 'Environment name or UID',
    }),
  };

  async run(): Promise<void> {
    this.logger = new Logger(this.sharedConfig);
    this.log = this.logger.log.bind(this.logger);

    await this.getConfig();
    await this.prepareApiClients();

    if (!this.sharedConfig.currentConfig?.uid) {
      await selectOrg({
        log: this.log,
        flags: this.flags,
        config: this.sharedConfig,
        managementSdk: this.managementSdk,
      });
      await this.prepareApiClients();
      await selectProject({
        log: this.log,
        flags: this.flags,
        config: this.sharedConfig,
        apolloClient: this.apolloClient,
      });
      await this.prepareApiClients();
    }

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

  async resolveEnvironment(): Promise<any> {
    const environments = await this.apolloClient
      .query({ query: environmentSecretsQuery })
      .then(({ data: { Environments } }) => map(Environments.edges, 'node'))
      .catch((error) => {
        if (error?.graphQLErrors?.[0]?.extensions?.exception?.status === 403) {
          this.log('You do not have permission to list the secrets of this environment.', 'error');
          process.exit(1);
        }
        throw error;
      });

    if (!this.flags.environment) {
      return ux
        .inquire({
          type: 'search-list',
          name: 'Environment',
          choices: map(environments, (row) => ({ name: row.name, value: row.name })),
          message: 'Choose an environment',
        })
        .then((name: any) => find(environments, { name }) as Record<string, any>);
    }

    const environment = find(
      environments,
      ({ uid, name }) => uid === this.flags.environment || name === this.flags.environment,
    );

    if (isEmpty(environment)) {
      this.log('Environment(s) not found!', 'error');
      process.exit(1);
    }

    return environment;
  }
}
