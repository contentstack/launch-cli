import { RetiredCommand } from '../../core/retired-command';

export default class LaunchRetired extends RetiredCommand {
  static description = 'Removed in v2 - create a project, environment or deployment with its own command';

  static retiredName = 'launch';

  static replacements = ['launch:projects:create', 'launch:environments:create', 'launch:deployments:create'];
}
