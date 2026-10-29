import map from 'lodash/map';
import find from 'lodash/find';
import isEmpty from 'lodash/isEmpty';
import { FlagInput, Flags, cliux as ux } from '@contentstack/cli-utilities';

import { BaseCommand } from '../../../base-command';
import { environmentSecretsQuery, deleteEnvironmentSecretMutation } from '../../../graphql';
import { Logger, selectOrg, selectProject, formatSecretsError } from '../../../util';

export default class UnsetSecret extends BaseCommand<typeof UnsetSecret> {
  static description = 'Delete one or more secrets of an environment';

  static examples = [
    '$ <%= config.bin %> <%= command.id %> --key=<KEY>',
    '$ <%= config.bin %> <%= command.id %> --key=<KEY> --key=<ANOTHER KEY> --yes',
    '$ <%= config.bin %> <%= command.id %> --org=<org UID> --project=<Project UID> ' +
      '--environment=<environment name or UID> --key=<KEY>',
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

    await this.unsetSecrets();
  }

  async unsetSecrets(): Promise<void> {
    const { key: keys, yes } = this.flags as Record<string, any>;
    const environment = await this.resolveEnvironment();

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

  async resolveEnvironment(): Promise<any> {
    const environments = await this.apolloClient
      .query({ query: environmentSecretsQuery })
      .then(({ data: { Environments } }) => map(Environments.edges, 'node'))
      .catch((error) => {
        this.log(formatSecretsError(error), 'error');
        process.exit(1);
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
