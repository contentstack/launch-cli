import { LaunchApiError, messageForCode, parseErrorEnvelope } from './errors';

describe('parseErrorEnvelope', () => {
  it('maps a known code to its friendly message and keeps status, code and raw errors', () => {
    const error = parseErrorEnvelope(409, {
      errors: [{ code: 'launch.PROJECT.DUPLICATE_NAME', message: 'duplicate' }],
      status: 409,
    });

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('launch.PROJECT.DUPLICATE_NAME');
    expect(error.message).toBe('A project with that name already exists in this organization.');
    expect(error.errors).toEqual([{ code: 'launch.PROJECT.DUPLICATE_NAME', message: 'duplicate' }]);
  });

  it('falls back to the API message when the code is unknown', () => {
    const error = parseErrorEnvelope(400, { errors: [{ code: 'launch.SOMETHING.ELSE', message: 'bad input' }] });

    expect(error.message).toBe('bad input');
    expect(error.code).toBe('launch.SOMETHING.ELSE');
    expect(error.status).toBe(400);
    expect(error.errors).toEqual([{ code: 'launch.SOMETHING.ELSE', message: 'bad input' }]);
  });

  it('falls back to the status when the body carries no errors array', () => {
    const error = parseErrorEnvelope(502, { nope: true });

    expect(error.message).toBe('Launch API request failed with status 502.');
    expect(error.code).toBe('launch.UNKNOWN');
    expect(error.status).toBe(502);
    expect(error.errors).toEqual([]);
  });

  it('returns undefined from messageForCode when no code is given', () => {
    expect(messageForCode(undefined)).toBeUndefined();
  });

  it('uses a mapped message for launch.PROJECT.LIMIT_REACHED', () => {
    const error = parseErrorEnvelope(429, {
      errors: [{ code: 'launch.PROJECT.LIMIT_REACHED', message: 'too many' }],
    });

    expect(error.message).toBe('This organization has reached its project limit.');
    expect(error.code).toBe('launch.PROJECT.LIMIT_REACHED');
    expect(error.status).toBe(429);
    expect(error.errors).toEqual([{ code: 'launch.PROJECT.LIMIT_REACHED', message: 'too many' }]);
  });

  it('falls back to status when body is null or undefined', () => {
    const errorNull = parseErrorEnvelope(500, null);
    const errorUndefined = parseErrorEnvelope(500, undefined);

    expect(errorNull.message).toBe('Launch API request failed with status 500.');
    expect(errorNull.code).toBe('launch.UNKNOWN');
    expect(errorNull.status).toBe(500);
    expect(errorNull.errors).toEqual([]);

    expect(errorUndefined.message).toBe('Launch API request failed with status 500.');
    expect(errorUndefined.code).toBe('launch.UNKNOWN');
    expect(errorUndefined.status).toBe(500);
    expect(errorUndefined.errors).toEqual([]);
  });
});
