import find from 'lodash/find';
import isEmpty from 'lodash/isEmpty';
import { FlagInput, Flags, cliux as ux } from '@contentstack/cli-utilities';

import { SecretsBaseCommand, secretsScopeFlags } from '../../../base-secrets-command';
import { addEnvironmentSecretMutation, refreshEnvironmentSecretMutation } from '../../../graphql';
import { isClientExposedKey, clientExposedWarning, formatSecretsError } from '../../../util';

const STDIN_TIMEOUT_MS = 30000;

export default class SetSecret extends SecretsBaseCommand<typeof SetSecret> {
  private pipedValue?: string;

  protected scopeRequiredMessage = '--org, --project and --environment are required when the value is piped';

  stdinTimeoutMs = STDIN_TIMEOUT_MS;

  static description =
    'Add or refresh a secret of an environment. The value is read from a masked prompt, or from stdin when piped';

  static examples = [
    '$ <%= config.bin %> <%= command.id %> --key=<KEY>',
    '$ printf %s "$TOKEN" | <%= config.bin %> <%= command.id %> --key=<KEY> --yes',
    '$ <%= config.bin %> <%= command.id %> --org=<org UID> --project=<Project UID> ' +
      '--environment=<environment name or UID> --key=<KEY>',
  ];

  static flags: FlagInput = {
    ...secretsScopeFlags,
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
    this.initLogger();
    await this.preparePipedInput();
    await this.setupScope();
    await this.setSecret();
  }

  async preparePipedInput(): Promise<void> {
    if (this.interactive) return;

    this.requireYesWhenPiped();
    this.pipedValue = await this.readStdin();
  }

  requireYesWhenPiped(): void {
    if (!this.interactive && !this.flags.yes) {
      this.log('use --yes when piping the value', 'error');
      process.exit(1);
    }
  }

  async setSecret(): Promise<void> {
    const { key, yes } = this.flags as Record<string, any>;
    const piped = !this.interactive;

    const environment = await this.resolveEnvironment();
    const exists = !isEmpty(find(environment.secrets, { key }));
    const value = piped ? (this.pipedValue ?? (await this.readStdin())) : await this.promptValue(key);

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
        variables: { environment: { uid: environment.uid }, secret: { key, value } },
      })
      .catch((error) => {
        this.log(formatSecretsError(error, { key, value }), 'error');
        process.exit(1);
      });

    this.log(`Secret ${key} ${exists ? 'refreshed' : 'added'} in environment ${environment.name}.`);
  }

  readStdin(): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        process.stdin.removeAllListeners('data');
        resolve('');
      }, this.stdinTimeoutMs);

      process.stdin.on('data', (chunk) => {
        clearTimeout(timer);
        chunks.push(Buffer.from(chunk));
      });
      process.stdin.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, ''));
      });
    });
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
}
