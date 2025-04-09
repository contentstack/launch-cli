import { FlagInput } from '@contentstack/cli-utilities';
import Contentfly from '../../util/cloud-function';
import { Flags, Command } from '@oclif/core';
import { Logger } from '../../util';

export default class Functions extends Command {
  static description = 'Serve cloud functions';
  private sharedConfig!: { projectBasePath: string; port: number };

  static examples = [
    '$ csdx launch:functions',
    '$ csdx launch:functions --port=port',
    '$ csdx launch:functions --data-dir <path/of/current/working/dir>',
    '$ csdx launch:functions --data-dir <path/of/current/working/dir> -p "port number"',
  ];

  static flags: FlagInput = {
    port: Flags.string({
      char: 'p',
      default: '3000',
      description: 'Port number',
    }),
    'data-dir': Flags.string({
      char: 'd',
      default: process.cwd(),
      description: 'Current working directory',
    }),
  };

  private isValidPort(input: string): boolean {
    const port = Number(input);
    return Number.isInteger(port) && port >= 0 && port <= 65535;
  }

  async init(): Promise<void> {
    const { flags } = await this.parse(Functions);
    const projectBasePath = flags['data-dir'];
    
    const logger = new Logger({ projectBasePath });
    this.log = logger.log.bind(logger);
    
    const port = process.env.PORT || flags.port;
    if (!this.isValidPort(port)) {
      this.log('Invalid port number. Please provide a valid port number between 0 and 65535.', 'error');
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
