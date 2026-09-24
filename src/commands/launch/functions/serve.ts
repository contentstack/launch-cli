import { Command } from '@oclif/core';

import { EXIT_USAGE } from '../../../core/constants';
import Contentfly from '../../../functions';
import { PortInUseError } from '../../../functions/function.errors';
import { isValidPort, serveFlags } from '../../../functions/function.inputs';
import { Logger } from '../../../functions/function.logger';

export default class Functions extends Command {
  static description = 'Serve cloud functions';
  private sharedConfig!: { projectBasePath: string; port: number };

  static examples = [
    '$ csdx launch:functions:serve',
    '$ csdx launch:functions:serve --port <port-number>',
    '$ csdx launch:functions:serve --data-dir <path/of/current/working/dir>',
    '$ csdx launch:functions:serve --data-dir <path/of/current/working/dir> -p <port-number>',
  ];

  static flags = serveFlags;

  async init(): Promise<void> {
    const { flags } = await this.parse(Functions);
    const currentWorkingDirectory = process.cwd();
    const projectBasePath = flags['data-dir'] || currentWorkingDirectory;

    const logger = new Logger({ projectBasePath });
    this.log = logger.log.bind(logger);

    if (!isValidPort(flags.port)) {
      const message = 'Invalid port number. Please provide a valid port number between 0 and 65535.';
      this.log(message, 'error');
      this.error(message, { exit: EXIT_USAGE });
    }

    this.sharedConfig = {
      projectBasePath,
      port: Number(flags.port),
    };
  }

  async run(): Promise<void> {
    try {
      await new Contentfly(this.sharedConfig.projectBasePath).serveCloudFunctions(this.sharedConfig.port);
    } catch (error) {
      if (error instanceof PortInUseError) {
        this.error(error.message, { exit: EXIT_USAGE });
      }

      throw error;
    }
  }
}
