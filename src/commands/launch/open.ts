import { RetiredCommand } from '../../core/retired-command';

export default class OpenRetired extends RetiredCommand {
  static description = 'Removed in v2 - open the site with launch:site:open';

  static retiredName = 'launch:open';

  static replacements = ['launch:site:open'];
}
