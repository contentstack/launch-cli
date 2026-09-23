import { RetiredCommand } from '../../../core/retired-command';

export default class EnvironmentsRetired extends RetiredCommand {
  static description = 'Removed in v2 - list environments with launch:environments:list';

  static retiredName = 'launch:environments';

  static replacements = ['launch:environments:list'];
}
