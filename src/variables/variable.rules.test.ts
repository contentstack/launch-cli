import { UsageError } from '../core/errors';
import { aliasRequiresFromStack } from './variable.rules';

describe('variable rules', () => {
  it('refuses --alias without --from-stack, naming both', () => {
    expect(() => aliasRequiresFromStack({ alias: 'my-prod' }, { alias: 'flag' })).toThrow(UsageError);
    expect(() => aliasRequiresFromStack({ alias: 'my-prod' }, { alias: 'flag' })).toThrow(
      '--alias is only used with --from-stack.',
    );
  });

  it('refuses --alias when --from-stack is false', () => {
    expect(() => aliasRequiresFromStack({ alias: 'my-prod', 'from-stack': false }, {})).toThrow(
      '--alias is only used with --from-stack.',
    );
  });

  it('accepts --alias together with --from-stack', () => {
    expect(() => aliasRequiresFromStack({ alias: 'my-prod', 'from-stack': true }, {})).not.toThrow();
  });

  it.each([[undefined], [null], [''], ['   ']])('accepts a command that supplied no alias (%p)', (alias) => {
    expect(() => aliasRequiresFromStack({ alias, 'from-stack': undefined }, {})).not.toThrow();
    expect(() => aliasRequiresFromStack({ alias }, {})).not.toThrow();
  });

  it('accepts --from-stack on its own', () => {
    expect(() => aliasRequiresFromStack({ 'from-stack': true }, {})).not.toThrow();
  });
});
