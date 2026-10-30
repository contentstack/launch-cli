import map from 'lodash/map';
import find from 'lodash/find';
import isEmpty from 'lodash/isEmpty';
import includes from 'lodash/includes';
import { Command } from '@contentstack/cli-command';
import { FlagInput, Flags, cliux as ux } from '@contentstack/cli-utilities';

import { BaseCommand } from './base-command';
import { projectsQuery, environmentSecretsQuery } from './graphql';
import { Logger, selectOrg, selectProject, getOrganizations, formatSecretsError, redactFlagValues } from './util';

const GENERIC_PARSE_ERROR_NAMES = [
  'UnexpectedArgsError',
  'NonExistentFlagsError',
  'FlagInvalidOptionError',
  'ArgInvalidOptionError',
];

export const secretsScopeFlags: FlagInput = {
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
  branch: Flags.string({
    hidden: true,
    description: '[Optional] GitHub branch name',
  }),
};

export abstract class SecretsBaseCommand<T extends typeof Command> extends BaseCommand<T> {
  protected scopeRequiredMessage = '--org, --project and --environment are required when not running in a terminal';

  protected get interactive(): boolean {
    return Boolean(process.stdin.isTTY);
  }

  protected async catch(err: Error & { exitCode?: number; parse?: unknown }): Promise<any> {
    if (err?.parse && includes(GENERIC_PARSE_ERROR_NAMES, err.constructor?.name)) {
      err.message = 'Invalid arguments. See --help for the flags this command takes.';
      err.stack = err.message;
    } else {
      err.message = redactFlagValues(err.message);
      err.stack = err.stack && redactFlagValues(err.stack);
    }

    return super.catch(err);
  }

  protected initLogger(): void {
    this.logger = new Logger(this.sharedConfig);
    this.log = this.logger.log.bind(this.logger);
  }

  protected failScope(message = this.scopeRequiredMessage): never {
    this.log(message, 'error');
    return process.exit(1);
  }

  async setupScope(): Promise<void> {
    const interactive = this.interactive;

    if (!interactive && !this.flags.environment) {
      this.failScope();
    }

    await this.getConfig({ interactive });
    await this.prepareApiClients();

    if (interactive) {
      await this.selectScope();
    } else {
      await this.resolveScopeFromFlags();
    }
  }

  private async selectScope(): Promise<void> {
    const { org, project } = this.flags as Record<string, any>;

    if (!org && !project && this.sharedConfig.currentConfig?.uid) return;

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

  private async resolveScopeFromFlags(): Promise<void> {
    const { org, project } = this.flags as Record<string, any>;
    const current = this.sharedConfig.currentConfig;

    if (org) {
      const organizations = await getOrganizations({ log: this.log, managementSdk: this.managementSdk });
      const match = find(organizations, { uid: org });

      if (!match) {
        this.log('Organization UID not found!', 'error');
        process.exit(1);
      }

      current.organizationUid = match.uid;
      await this.prepareApiClients();
    }

    if (project) {
      if (!current.organizationUid) {
        this.failScope();
      }

      const projects = await this.apolloClient
        .query({ query: projectsQuery, variables: { query: {} } })
        .then(({ data }) => map(data.projects.edges, 'node'))
        .catch((error) => {
          this.log(formatSecretsError(error, { operation: 'read' }), 'error');
          process.exit(1);
        });
      const match = find(projects, { uid: project }) || find(projects, { name: project });

      if (!match) {
        this.log('Project not found!', 'error');
        process.exit(1);
      }

      current.uid = match.uid;
      await this.prepareApiClients();
    }

    if (!current.uid) {
      this.failScope();
    }
  }

  async resolveEnvironment(): Promise<any> {
    const environments = await this.apolloClient
      .query({ query: environmentSecretsQuery })
      .then(({ data: { Environments } }) => map(Environments.edges, 'node'))
      .catch((error) => {
        this.log(formatSecretsError(error, { operation: 'read' }), 'error');
        process.exit(1);
      });

    if (!this.flags.environment) {
      if (!this.interactive) {
        this.failScope();
      }

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
