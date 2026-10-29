import map from 'lodash/map';
import find from 'lodash/find';
import isEmpty from 'lodash/isEmpty';
import { FlagInput, Flags, cliux as ux } from '@contentstack/cli-utilities';

import { BaseCommand } from '../../../base-command';
import {
  environmentSecretsQuery,
  addEnvironmentSecretMutation,
  refreshEnvironmentSecretMutation,
} from '../../../graphql';
import {
  Logger,
  selectOrg,
  selectProject,
  isClientExposedKey,
  clientExposedWarning,
  formatSecretsError,
  redactFlagValues,
} from '../../../util';

export default class SetSecret extends BaseCommand<typeof SetSecret> {
  static description =
    'Add or refresh a secret of an environment. The value is read from a masked prompt, or from stdin when piped';

  static examples = [
    '$ <%= config.bin %> <%= command.id %> --key=<KEY>',
    '$ printf %s "$TOKEN" | <%= config.bin %> <%= command.id %> --key=<KEY> --yes',
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
      description: 'Secret key',
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip the confirmation prompt (required when the value is piped on stdin)',
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

    await this.setSecret();
  }

  protected async catch(err: Error & { exitCode?: number }): Promise<any> {
    err.message = redactFlagValues(err.message);
    err.stack = err.stack && redactFlagValues(err.stack);
    return super.catch(err);
  }

  async setSecret(): Promise<void> {
    const { key, yes } = this.flags as Record<string, any>;
    const piped = !process.stdin.isTTY;

    if (piped && !yes) {
      this.log('use --yes when piping the value', 'error');
      process.exit(1);
    }

    const environment = await this.resolveEnvironment();
    const exists = !isEmpty(find(environment.secrets, { key }));
    const value = piped ? await this.readStdin() : await this.promptValue(key);

    if (isEmpty(value)) {
      this.log(piped ? 'no value received on stdin' : 'The value cannot be empty.', 'error');
      process.exit(1);
    }

    if (isClientExposedKey(key)) {
      ux.print(clientExposedWarning(key), { color: 'yellow' });
    }

    if (!yes && !(await this.confirm(key, environment.name, exists))) {
      ux.print('Aborted. The secret was not changed.');
      return;
    }

    await this.apolloClient
      .mutate({
        mutation: exists ? refreshEnvironmentSecretMutation : addEnvironmentSecretMutation,
        variables: { environmentUid: environment.uid, secret: { key, value } },
      })
      .catch((error) => {
        this.log(formatSecretsError(error, { key, value }), 'error');
        process.exit(1);
      });

    this.log(`Secret ${key} ${exists ? 'refreshed' : 'added'} in environment ${environment.name}.`);
  }

  async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }

  promptValue(key: string): Promise<string> {
    return ux.inquire<string>({
      type: 'password',
      name: 'value',
      message: `Enter the value for ${key}`,
    });
  }

  confirm(key: string, environmentName: string, exists: boolean): Promise<boolean> {
    return ux.inquire<boolean>({
      type: 'confirm',
      name: 'confirm',
      message: `${exists ? 'Refresh' : 'Add'} secret ${key} in environment ${environmentName}?`,
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
