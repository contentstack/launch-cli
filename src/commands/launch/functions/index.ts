import { RetiredCommand } from '../../../core/retired-command';

export default class FunctionsRetired extends RetiredCommand {
  static description = 'Removed in v2 - serve cloud functions with launch:functions:serve';

  static retiredName = 'launch:functions';

  static replacements = ['launch:functions:serve'];
}
