import { FlagInput } from '@contentstack/cli-utilities';
import Contentfly from '../../util/cloud-function';
import { Flags, Command } from '@oclif/core';

export default class Functions extends Command {
  static description = 'Serve cloud functions';

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
      description: 'Current working directory',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Functions);
    const currentWorkingDirectory = process.cwd();
    const projectBasePath = flags['data-dir'] || currentWorkingDirectory;

    await new Contentfly(projectBasePath).serveCloudFunctions(+flags.port);
  }
}
