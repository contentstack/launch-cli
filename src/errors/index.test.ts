import { CancelledError, UsageError } from './index';

describe('UsageError', () => {
  it('is an Error carrying the caller message and its own name', () => {
    const error = new UsageError('Pass --org.');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UsageError');
    expect(error.message).toBe('Pass --org.');
  });
});

describe('CancelledError', () => {
  it('carries a fixed message stating nothing was changed', () => {
    const error = new CancelledError();

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UsageError);
    expect(error.name).toBe('CancelledError');
    expect(error.message).toBe('Cancelled. Nothing was changed.');
  });
});
