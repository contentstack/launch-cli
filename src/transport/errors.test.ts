import { LaunchApiError, messageForCode, parseErrorEnvelope } from './errors';

const MESSAGES = {
  'launch.RESOURCE.DUPLICATE_NAME': 'Something of that name already exists.',
  'launch.RESOURCE.LIMIT_REACHED': 'That limit has been reached.',
};

describe('parseErrorEnvelope', () => {
  it('maps a known code to the supplied wording and keeps status, code and raw errors', () => {
    const error = parseErrorEnvelope(
      409,
      { errors: [{ code: 'launch.RESOURCE.DUPLICATE_NAME', message: 'duplicate' }], status: 409 },
      MESSAGES,
    );

    expect(error).toBeInstanceOf(LaunchApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('launch.RESOURCE.DUPLICATE_NAME');
    expect(error.message).toBe('Something of that name already exists.');
    expect(error.errors).toEqual([{ code: 'launch.RESOURCE.DUPLICATE_NAME', message: 'duplicate' }]);
  });

  it('falls back to the API message when the supplied wording has no entry for the code', () => {
    const error = parseErrorEnvelope(400, { errors: [{ code: 'launch.SOMETHING.ELSE', message: 'bad input' }] }, MESSAGES);

    expect(error.message).toBe('bad input');
    expect(error.code).toBe('launch.SOMETHING.ELSE');
    expect(error.status).toBe(400);
    expect(error.errors).toEqual([{ code: 'launch.SOMETHING.ELSE', message: 'bad input' }]);
  });

  it('falls back to the API message when no wording was supplied at all', () => {
    const error = parseErrorEnvelope(409, { errors: [{ code: 'launch.RESOURCE.DUPLICATE_NAME', message: 'duplicate' }] });

    expect(error.message).toBe('duplicate');
    expect(error.code).toBe('launch.RESOURCE.DUPLICATE_NAME');
    expect(error.status).toBe(409);
  });

  it('falls back to the status when the body carries no errors array', () => {
    const error = parseErrorEnvelope(502, { nope: true }, MESSAGES);

    expect(error.message).toBe('Launch API request failed with status 502.');
    expect(error.code).toBe('launch.UNKNOWN');
    expect(error.status).toBe(502);
    expect(error.errors).toEqual([]);
  });

  it('returns undefined from messageForCode when no code is given', () => {
    expect(messageForCode(MESSAGES, undefined)).toBeUndefined();
  });

  it('returns undefined from messageForCode when the code is not in the dictionary', () => {
    expect(messageForCode(MESSAGES, 'launch.NOT.LISTED')).toBeUndefined();
  });

  it('uses a mapped message for a second listed code', () => {
    const error = parseErrorEnvelope(429, { errors: [{ code: 'launch.RESOURCE.LIMIT_REACHED', message: 'too many' }] }, MESSAGES);

    expect(error.message).toBe('That limit has been reached.');
    expect(error.code).toBe('launch.RESOURCE.LIMIT_REACHED');
    expect(error.status).toBe(429);
    expect(error.errors).toEqual([{ code: 'launch.RESOURCE.LIMIT_REACHED', message: 'too many' }]);
  });

  it('falls back to the status message when the sole error entry carries no code or message', () => {
    const error = parseErrorEnvelope(500, { errors: [{}] }, MESSAGES);

    expect(error.message).toBe('Launch API request failed with status 500.');
    expect(error.code).toBe('launch.UNKNOWN');
    expect(error.status).toBe(500);
    expect(error.errors).toEqual([{}]);
  });

  it.each([[{ errors: 'boom' }], [{ errors: {} }], [{ errors: null }]])(
    'treats a non-array errors field %p as no errors at all',
    (body) => {
      const error = parseErrorEnvelope(400, body, MESSAGES);

      expect(error.errors).toEqual([]);
      expect(error.code).toBe('launch.UNKNOWN');
      expect(error.message).toBe('Launch API request failed with status 400.');
    },
  );

  it('names the error LaunchApiError so it is recognisable once serialised', () => {
    const error = parseErrorEnvelope(404, { errors: [{ code: 'launch.RESOURCE.NOT_FOUND', message: 'x' }] }, MESSAGES);

    expect(error.name).toBe('LaunchApiError');
    expect(error).toBeInstanceOf(Error);
    expect(new LaunchApiError(500, []).name).toBe('LaunchApiError');
  });

  it('falls back to status when body is null or undefined', () => {
    const errorNull = parseErrorEnvelope(500, null, MESSAGES);
    const errorUndefined = parseErrorEnvelope(500, undefined, MESSAGES);

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
