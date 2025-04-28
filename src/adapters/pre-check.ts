import find from 'lodash/find';
import { existsSync } from 'fs';
import isEmpty from 'lodash/isEmpty';
import { cliux as ux } from '@contentstack/cli-utilities';

import BaseClass from './base-class';

export default class PreCheck extends BaseClass {
  public projectBasePath: string = process.cwd();
  /**
   * @method run
   *
   * @param {boolean} [identifyProject=true]
   * @return {*}  {Promise<void>}
   * @memberof PreCheck
   */
  async run(): Promise<void> {
    await this.performValidations();
  }

  /**
   * @method performValidations - Validate if the current project is an existing launch project
   *
   * @return {*}  {(Promise<boolean | void>)}
   * @memberof PreCheck
   */
  async performValidations(): Promise<boolean | void> {
    if (this.config.config && existsSync(this.config.config)) {
      if (this.config.flags.init) {
        // NOTE reinitialize the project
        this.config.provider = undefined;
        this.config.isExistingProject = false;

        if (this.config.flags.type) {
          this.config.provider = this.config.flags.type as any;
        }
      } else {
        this.validateLaunchConfig();

        this.log('Existing launch project identified', 'info');

        await this.displayPreDeploymentDetails();
      }
    }
  }

  /**
   * @method displayPreDeploymentDetails
   *
   * @memberof GitHub
   */
  async displayPreDeploymentDetails() {
    if (this.config.config && !isEmpty(this.config.currentConfig)) {
      this.log(''); // Empty line
      this.log('Current Project details:', { bold: true, color: 'green' });
      this.log(''); // Empty line
      const { name, projectType, repository, environments } = this.config.currentConfig;
      const environment = await this.getEnvironment();

      const detail: Record<string, any> = {
        'Project Name': name,
        'Project Type': (this.config.providerMapper as Record<string, any>)[projectType] || '',
        Environment: environment.name,
        'Framework Preset':
          find(this.config.listOfFrameWorks, {
            value: environment.frameworkPreset,
          })?.name || '',
      };

      const headers = [
        { value: 'Project Name'},
        { value: 'Project Type'},
        { value: 'Environment'},
        { value: 'Framework Preset'},
      ];

      if (repository?.repositoryName) {
        detail['Repository'] = repository.repositoryName;
        headers.push({ value: 'Repository' });
      }

      if(!detail){
        this.exit(1);
      }

      ux.table(headers, [detail]);
    }
  }

  /**
   * @method validateLaunchConfig
   *
   * @memberof PreCheck
   */
  validateLaunchConfig() {
    try {
      // NOTE Perform validations here
      if (isEmpty(require(this.config.config as string))) {
        this.log('Invalid Launch config!', 'warn');
        this.exit(1);
      }
    } catch (error) {}
  }
}
