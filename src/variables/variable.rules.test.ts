import { UsageError } from '../core/errors';
import { aliasRequiresFromStack, noVarsAlone } from './variable.rules';

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

  it.each([[{ var: ['A=1'] }], [{ dotenv: ['a.env'] }], [{ 'from-stack': true }]])(
    'refuses --no-vars with a variable source (%p)',
    (source) => {
      expect(() => noVarsAlone({ 'no-vars': true, ...source }, {})).toThrow(UsageError);
      expect(() => noVarsAlone({ 'no-vars': true, ...source }, {})).toThrow(
        '--no-vars cannot be combined with --var, --dotenv or --from-stack.',
      );
    },
  );

  it.each([[{ 'no-vars': true }], [{ 'no-vars': false, var: ['A=1'] }], [{ var: [], dotenv: [], 'from-stack': false, 'no-vars': true }]])(
    'accepts --no-vars alone and the sources without it (%p)',
    (resolved) => {
      expect(() => noVarsAlone(resolved, {})).not.toThrow();
    },
  );
});
