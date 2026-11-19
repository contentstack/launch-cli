import { LaunchCommand } from '../../../src/core/launch-command';
import type { UxLike } from '../../../src/core/prompt';
import { registerSearchList } from '../../../src/core/search-list';

class PromptingCommand extends LaunchCommand {
  static flags = {};
  static inputs = {};

  async run(): Promise<void> {
    return undefined;
  }
}

registerSearchList();
const ux = (new PromptingCommand([], {} as never) as unknown as { ux: UxLike }).ux;
const choices = [
  { name: 'Default', value: 'default' },
  { name: 'Staging', value: 'staging' },
];

ux.inquire({ type: process.argv[2], name: 'value', message: 'Choose an environment', choices }).then(
  () => {
    process.exitCode = 0;
  },
  (error: { exitCode?: number }) => {
    process.exitCode = error.exitCode ?? 1;
  },
);
