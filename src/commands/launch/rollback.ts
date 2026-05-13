import chalk from 'chalk';
import map from 'lodash/map';
import find from 'lodash/find';
import filter from 'lodash/filter';
import isEmpty from 'lodash/isEmpty';
import { FlagInput, Flags, cliux as ux } from '@contentstack/cli-utilities';

import { BaseCommand } from '../../base-command';
import {
  environmentsQuery,
  latestLiveDeploymentQuery,
  rollbackDeploymentMutation,
} from '../../graphql';
import { Logger, selectOrg, selectProject } from '../../util';

export default class Rollback extends BaseCommand<typeof Rollback> {
  static description = 'Roll back to previous deployment';

  static examples = [
    '$ <%= config.bin %> <%= command.id %>',
    '$ <%= config.bin %> <%= command.id %> -d "current working directory"',
    '$ <%= config.bin %> <%= command.id %> -c "path to the local config file"',
    // eslint-disable-next-line max-len
    '$ <%= config.bin %> <%= command.id %> -e "environment number or uid" --deployment=<deployment UID> --org=<org UID> --project=<Project UID> --reason="restoring previous build"',
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
    deployment: Flags.string({
      description: '[Optional] Deployment UID to roll back to',
    }),
    reason: Flags.string({
      description: '[Optional] Reason for the rollback (saved to audit log)',
    }),
  };

  async run(): Promise<void> {
    this.logger = new Logger(this.sharedConfig);
    this.log = this.logger.log.bind(this.logger);

    if (!this.flags.environment) {
      await this.getConfig();
    }

    await this.prepareApiClients();

    if (!this.sharedConfig.currentConfig?.uid) {
      await selectOrg({
        log: this.log,
        flags: this.flags,
        config: this.sharedConfig,
        managementSdk: this.managementSdk,
      });
      await this.prepareApiClients(); // NOTE update org-id in header
      await selectProject({
        log: this.log,
        flags: this.flags,
        config: this.sharedConfig,
        apolloClient: this.apolloClient,
      });
      await this.prepareApiClients(); // NOTE update project-id in header
    }

    await this.rollbackDeployment();
  }

  /**
   * @method rollbackDeployment - resolve env, run select + review steps, fire mutation
   *
   * @memberof Rollback
   */
  async rollbackDeployment(): Promise<void> {
    const environment = await this.resolveEnvironment();
    const currentLive = await this.fetchCurrentLiveDeployment(environment.uid);
    const eligibleSorted = this.getEligibleSorted(environment, currentLive?.uid);

    if (isEmpty(eligibleSorted)) {
      this.log('No rollback-eligible deployments are available for this environment.', 'error');
      process.exit(1);
    }

    this.printSelectStep(environment, currentLive, eligibleSorted);
    const target = await this.selectDeployment(eligibleSorted);

    this.printReviewStep(currentLive, target, eligibleSorted);
    const reason = await this.promptReason();
    const confirmed = await ux.inquire<boolean>({
      type: 'confirm',
      name: 'confirm',
      message: 'Confirm & Rollback?',
    });

    if (!confirmed) {
      ux.print(chalk.yellow('Rollback aborted.'));
      return;
    }

    await this.apolloClient
      .mutate({
        mutation: rollbackDeploymentMutation,
        variables: {
          input: {
            deployment: target.uid,
            environment: environment.uid,
            ...(reason ? { reason } : {}),
          },
        },
      })
      .then(({ data: { deployment: rolledBack } }) => {
        ux.print('');
        ux.print(chalk.green('✔ Instant rollback to a previous deployment is successful.'));
        ux.print(`  New deployment: ${chalk.cyan(rolledBack.uid)}  status: ${chalk.cyan(rolledBack.status)}`);
        ux.print('');
      })
      .catch((error) => {
        const code = error?.graphQLErrors?.[0]?.extensions?.exception?.name || error?.message;
        this.log(`Rollback failed. Please try again. (${code})`, 'error');
        process.exit(1);
      });
  }

  /**
   * @method resolveEnvironment - resolve environment via flag, config, or prompt
   *
   * @memberof Rollback
   */
  async resolveEnvironment(): Promise<any> {
    const environments = await this.apolloClient
      .query({ query: environmentsQuery })
      .then(({ data: { Environments } }) => map(Environments.edges, 'node'))
      .catch((error) => {
        this.log(error?.message, 'error');
        process.exit(1);
      });

    let environment = find(
      environments,
      ({ uid, name }) =>
        uid === this.flags.environment ||
        name === this.flags.environment ||
        uid === this.sharedConfig.currentConfig?.environments?.[0]?.uid,
    );

    if (isEmpty(environment) && (this.flags.environment || this.sharedConfig.currentConfig?.environments?.[0]?.uid)) {
      this.log('Environment(s) not found!', 'error');
      process.exit(1);
    } else if (isEmpty(environment)) {
      environment = await ux
        .inquire({
          type: 'search-list',
          name: 'Environment',
          choices: map(environments, (row) => ({ ...row, value: row.name })),
          message: 'Choose an environment',
        })
        .then((name: any) => find(environments, { name }) as Record<string, any>);
    }

    this.sharedConfig.environment = environment;
    return environment;
  }

  /**
   * @method fetchCurrentLiveDeployment - fetch the currently live deployment for the environment
   *
   * @memberof Rollback
   */
  async fetchCurrentLiveDeployment(environmentUid: string): Promise<any> {
    return this.apolloClient
      .query({
        query: latestLiveDeploymentQuery,
        variables: { query: { environment: environmentUid } },
      })
      .then(({ data }) => data?.latestLiveDeployment)
      .catch(() => undefined);
  }

  /**
   * @method getEligibleSorted - eligible deployments excluding current live, sorted by number desc
   *
   * @memberof Rollback
   */
  getEligibleSorted(environment: any, currentLiveUid?: string): any[] {
    const deployments = map(environment?.deployments?.edges, 'node');
    const eligible = filter(
      deployments,
      (d) => d.isRollbackEligible && d.uid !== currentLiveUid,
    );
    return [...eligible].sort((a, b) => (b.deploymentNumber || 0) - (a.deploymentNumber || 0));
  }

  /**
   * @method selectDeployment - resolve target via --deployment flag or interactive picker
   *
   * @memberof Rollback
   */
  async selectDeployment(eligibleSorted: any[]): Promise<any> {
    if (this.flags.deployment) {
      const match = find(eligibleSorted, ({ uid }) => uid === this.flags.deployment);
      if (isEmpty(match)) {
        this.log('Provided deployment UID is not rollback-eligible or does not exist.', 'error');
        process.exit(1);
      }
      return match;
    }

    const choices = map(eligibleSorted, (d) => ({
      ...d,
      name: `#${d.deploymentNumber} | ${sourceLabel(d) || '—'} | ${d.createdAt}`,
      value: d.uid,
    }));

    const selectedUid = await ux.inquire<string>({
      type: 'search-list',
      name: 'Deployment',
      choices,
      message: 'Select a version to restore',
    });

    return find(eligibleSorted, { uid: selectedUid }) as Record<string, any>;
  }

  /**
   * @method promptReason - prompt for rollback reason unless provided via --reason flag
   *
   * @memberof Rollback
   */
  async promptReason(): Promise<string | undefined> {
    if (this.flags.reason) {
      return this.flags.reason.trim() || undefined;
    }
    const input = await ux.inquire<string>({
      type: 'input',
      name: 'reason',
      message: 'Reason (saved to audit log) — press enter to skip:',
    });
    const trimmed = (input || '').trim();
    return trimmed ? trimmed : undefined;
  }

  /**
   * @method printSelectStep - mirror the UI "select" step heading and table
   *
   * @memberof Rollback
   */
  printSelectStep(environment: any, currentLive: any, eligibleSorted: any[]): void {
    ux.print('');
    ux.print(chalk.bold.underline('Roll back to previous deployment'));
    ux.print(`${chalk.dim('Environment:')} ${chalk.cyan(environment.name)}`);
    ux.print('');
    ux.print(chalk.bold('Currently live'));
    ux.print(`  ${formatDeployment(currentLive)}`);
    ux.print('');
    ux.print(chalk.bold('Select a version to restore'));
    ux.print(chalk.dim('Choose a previously successful deployment to ensure stability.'));
    const count = eligibleSorted.length;
    ux.print(chalk.dim(`(${count} eligible deployment${count === 1 ? '' : 's'} available)`));
    ux.print('');
  }

  /**
   * @method printReviewStep - mirror the UI "review" step warnings, skips info, and summary
   *
   * @memberof Rollback
   */
  printReviewStep(currentLive: any, target: any, eligibleSorted: any[]): void {
    ux.print('');
    ux.print(chalk.bold.underline('Review rollback'));
    ux.print('');
    ux.print('You are about to replace your live site with the version below.');
    ux.print('This build will be pushed to the edge immediately.');
    ux.print('');
    ux.print(
      `${chalk.yellow.bold('Note:')} The rolled back instance will use the environment variables`,
    );
    ux.print('      associated with the selected deployment.');

    const targetIndex = eligibleSorted.findIndex((d) => d.uid === target.uid);
    const skipped = targetIndex > 0 ? eligibleSorted.slice(0, targetIndex) : [];
    if (skipped.length > 0) {
      const list = skipped.map((d) => `#${d.deploymentNumber}`).join(', ');
      const noun = skipped.length === 1 ? 'good deployment' : 'good deployments';
      const verb = skipped.length === 1 ? 'stays' : 'stay';
      ux.print('');
      ux.print(
        `${chalk.blue('ⓘ')} Selecting #${target.deploymentNumber} skips ${skipped.length} ${noun} — ${list}`,
      );
      ux.print(`  ${verb} in history and can be restored later.`);
    }

    ux.print('');
    ux.print(`  ${chalk.bold('Current Live')}   ${formatDeployment(currentLive)}`);
    ux.print(`  ${chalk.bold('Roll back to')}   ${formatDeployment(target)}`);
    ux.print('');
    ux.print(
      chalk.dim('A new deployment may be initiated if any automations/commits/webhooks are triggered.'),
    );
    ux.print('');
  }
}

function shortHash(hash?: string): string {
  return hash ? hash.substring(0, 7) : '';
}

function sourceLabel(deployment?: any): string {
  if (!deployment) {
    return '';
  }
  const hash = shortHash(deployment.commitHash);
  if (deployment.gitBranch && hash) {
    return `${deployment.gitBranch} - ${hash}`;
  }
  return deployment.gitBranch || hash || '';
}

function formatDeployment(deployment?: any): string {
  if (!deployment) {
    return chalk.dim('(none)');
  }
  const number = deployment.deploymentNumber ? `#${deployment.deploymentNumber}` : deployment.uid;
  const source = sourceLabel(deployment);
  const createdAt = deployment.createdAt || '';
  const numberCol = chalk.green(number.padEnd(6));
  const sourceCol = source ? chalk.cyan(source.padEnd(28)) : ''.padEnd(28);
  return `${numberCol}  ${sourceCol}  ${chalk.dim(createdAt)}`;
}
