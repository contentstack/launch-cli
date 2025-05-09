import map from 'lodash/map';

import config from '../../config';
import { BaseCommand } from '../../base-command';
import { AdapterConstructorInputs, Providers } from '../../types';
import { FileUpload, GitHub, PreCheck } from '../../adapters';
import { FlagInput, Flags, cliux } from '@contentstack/cli-utilities';

export default class Launch extends BaseCommand<typeof Launch> {
  public preCheck!: PreCheck;

  static description = 'Launch related operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --data-dir <path/of/current/working/dir>',
    '<%= config.bin %> <%= command.id %> --config <path/to/launch/config/file>',
    '<%= config.bin %> <%= command.id %> --type <options: GitHub|FileUpload>',
    '<%= config.bin %> <%= command.id %> --data-dir <path/of/current/working/dir> --type <options: GitHub|FileUpload>',
    '<%= config.bin %> <%= command.id %> --data-dir <path/of/current/working/dir> --redeploy-latest',
    '<%= config.bin %> <%= command.id %> --data-dir <path/of/current/working/dir> --redeploy-last-upload',
    '<%= config.bin %> <%= command.id %> --config <path/to/launch/config/file> --type <options: GitHub|FileUpload>',
    '<%= config.bin %> <%= command.id %> --environment=<value> --redeploy-latest',
    // eslint-disable-next-line max-len
    '<%= config.bin %> <%= command.id %> --config <path/to/launch/config/file> --type <options: GitHub|FileUpload> --name=<value> --environment=<value> --branch=<value> --build-command=<value> --framework=<option> --org=<value> --out-dir=<value>',
    // eslint-disable-next-line max-len
    '<%= config.bin %> <%= command.id %> --config <path/to/launch/config/file> --type <options: GitHub|FileUpload> --name=<value> --environment=<value> --branch=<value> --build-command=<value> --framework=<option> --org=<value> --out-dir=<value> --server-command=<value>',
    // eslint-disable-next-line max-len
    '<%= config.bin %> <%= command.id %> --config <path/to/launch/config/file> --type <options: GitHub|FileUpload> --name=<value> --environment=<value> --branch=<value> --build-command=<value> --framework=<option> --org=<value> --out-dir=<value> --variable-type="Import variables from a stack" --alias=<value>',
    // eslint-disable-next-line max-len
    '<%= config.bin %> <%= command.id %> --config <path/to/launch/config/file> --type <options: GitHub|FileUpload> --name=<value> --environment=<value> --branch=<value> --build-command=<value> --framework=<option> --org=<value> --out-dir=<value> --variable-type="Manually add custom variables to the list" --env-variables="APP_ENV:prod, TEST_ENV:testVal"',
  ];

  static flags: FlagInput = {
    type: Flags.string({
      options: [...config.supportedAdapters, 'FileUpload'],
      description: '[optional] Type of adapters. <options: GitHub|FileUpload>',
    }),
    framework: Flags.string({
      options: map(config.listOfFrameWorks, 'name'),
      description: '[optional] Type of framework. <options: Gatsby|NextJS|Other>',
    }),
    org: Flags.string({
      description: '[optional] Provide the organization UID to create a new project or deployment.',
    }),
    name: Flags.string({
      char: 'n',
      description: '[optional] Name of the project.',
    }),
    environment: Flags.string({
      char: 'e',
      description: '[optional] Environment name for the Launch project.',
    }),
    branch: Flags.string({
      description: '[optional] GitHub branch name.',
    }),
    'build-command': Flags.string({
      description: '[optional] Build Command.',
    }),
    'out-dir': Flags.string({
      description: '[optional] Output Directory.',
    }),
    'server-command': Flags.string({
      description: '[optional] Server Command.',
    }),
    'variable-type': Flags.string({
      options: [...config.variablePreparationTypeOptions],
      description:
        // eslint-disable-next-line max-len
        '[optional] Provide a variable type. <options: Import variables from a stack|Manually add custom variables to the list|Import variables from the .env.local file|Skip adding environment variables>',
    }),
    'show-variables': Flags.boolean({
      hidden: true,
      default: false,
      description: '[optional, Hidden] Show variable values on the UI.',
    }),
    init: Flags.boolean({
      hidden: true,
      description: '[optional, Hidden] Reinitialize the project if it is an existing Launch project.',
    }),
    alias: Flags.string({
      char: 'a',
      description: '[optional] Alias (name) for the delivery token.',
    }),
    'env-variables': Flags.string({
      description:
        // eslint-disable-next-line max-len
        '[optional] Provide the environment variables in the key:value format, separated by comma. For example: APP_ENV:prod, TEST_ENV:testVal.',
    }),
    'redeploy-latest': Flags.boolean({
      description: '[optional] Redeploy latest commit/code',
      default: false,
    }),
    'redeploy-last-upload': Flags.boolean({
      description: '[optional] Redeploy with last file upload',
      default: false,
    }),
  };

  async run(): Promise<void> {
    if (!this.flags.init) {
      await this.getConfig();
    }
    await this.prepareApiClients();
    this.$event.on('provider-changed', () => {
      this.manageFlowBasedOnProvider();
    });

    // NOTE pre-check: manage flow and set the provider value
    await this.preCheckAndInitConfig();
    if (!this.sharedConfig.isExistingProject) {
      await this.setProviderType();
    }
    await this.manageFlowBasedOnProvider();
  }

  /**
   * @method manageFlowBasedOnProvider - Manage launch flow based on provider (GitHb, FileUpload etc.,)
   *
   * @return {*}  {Promise<void>}
   * @memberof Launch
   */
  async manageFlowBasedOnProvider(): Promise<void> {
    const adapterConstructorInputs: AdapterConstructorInputs = {
      log: this.log,
      exit: process.exit,
      $event: this.$event,
      config: this.sharedConfig,
      apolloClient: this.apolloClient,
      managementSdk: this.managementSdk,
      analyticsInfo: this.context.analyticsInfo,
    };

    switch (this.sharedConfig.provider) {
    case 'GitHub':
      await new GitHub(adapterConstructorInputs).run();
      break;
    case 'FileUpload':
      await new FileUpload(adapterConstructorInputs).run();
      break;
    default:
      await this.preCheck.connectToAdapterOnUi();
      break;
    }
  }

  /**
   * @method preCheckAndInitConfig - prepare and initialize the configurations
   *
   * @return {*}  {Promise<void>}
   * @memberof Launch
   */
  async preCheckAndInitConfig(): Promise<void> {
    this.preCheck = new PreCheck({
      log: this.log,
      exit: process.exit,
      $event: this.$event,
      config: this.sharedConfig,
      apolloClient: this.apolloClient,
      managementSdk: this.managementSdk,
      analyticsInfo: this.context.analyticsInfo,
    });

    await this.preCheck.run();
  }

  /**
   * @method selectProjectType - select project type/provider/adapter
   *
   * @return {*}  {Promise<void>}
   * @memberof BaseClass
   */
  private async selectProjectType(): Promise<void> {
    const choices = [
      ...map(config.supportedAdapters, (provider) => ({
        value: provider,
        name: `Continue with ${provider}`,
      })),
      { value: 'FileUpload', name: 'Continue with FileUpload' },
    ];

    const selectedProvider: Providers = await cliux.inquire({
      choices: choices,
      type: 'search-list',
      name: 'projectType',
      message: 'Choose a project type to proceed',
    });

    this.sharedConfig.provider = selectedProvider;
  }

  private async setProviderType(): Promise<void> {
    const providerTypeFlag = this.flags.type;

    if (providerTypeFlag) {
      this.sharedConfig.provider = providerTypeFlag as Providers;
      return;
    }
    await this.selectProjectType();
  }
}
