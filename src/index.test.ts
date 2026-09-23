import * as index from './index';
import { LaunchCommand } from './base/launch-command';

describe('index', () => {
  it('re-exports LaunchCommand', () => {
    expect(index.LaunchCommand).toBe(LaunchCommand);
  });
});
