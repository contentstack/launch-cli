import { RetiredCommand } from '../../../core/retired-command';

export default class LogsRetired extends RetiredCommand {
  static description = 'Removed in v2 - read logs with launch:logs:get';

  static retiredName = 'launch:logs';

  static replacements = ['launch:logs:get'];
}
