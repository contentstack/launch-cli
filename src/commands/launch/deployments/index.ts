import { RetiredCommand } from '../../../core/retired-command';

export default class DeploymentsRetired extends RetiredCommand {
  static description = 'Removed in v2 - list deployments with launch:deployments:list';

  static retiredName = 'launch:deployments';

  static replacements = ['launch:deployments:list'];
}
