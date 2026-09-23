import { Command } from '@oclif/core';

import Contentfly from '../../../functions';
import { isValidPort, serveFlags } from '../../../functions/function.inputs';

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

    const port = process.env.PORT || flags.port;
    if (!isValidPort(port)) {
      this.log('Invalid port number. Please provide a valid port number between 0 and 65535.');
      this.exit(1);
    }

    this.sharedConfig = {
      projectBasePath,
      port: Number(port),
    };
  }

  async run(): Promise<void> {
    await new Contentfly(this.sharedConfig.projectBasePath).serveCloudFunctions(this.sharedConfig.port);
  }
}
