import { RetiredCommand } from '../../core/retired-command';

export default class RollbackRetired extends RetiredCommand {
  static description = 'Removed in v2 - roll back with launch:deployments:rollback';

  static retiredName = 'launch:rollback';

  static replacements = ['launch:deployments:rollback'];
}
