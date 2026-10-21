import { LaunchApiError } from '../transport/errors';
import { ENVIRONMENT_ERROR_MESSAGES } from './environment.errors';

const VARIABLE_CODES: Record<string, string> = {
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.BYTE_SIZE_LIMIT_REACHED':
    'The environment variables are larger than Launch allows. Remove some variables or shorten their values.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.MAX_COUNT_REACHED':
    'This environment has reached its limit on the number of variables.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.DUPLICATE_KEYS': 'The same variable key appears more than once.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_EMPTY': 'A variable key cannot be empty.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.NOT_STRING': 'A variable key must be text.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.KEY.TOO_LONG': 'A variable key is too long.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.NOT_EMPTY': 'A variable value cannot be empty.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.NOT_STRING': 'A variable value must be text.',
  'launch.ENVIRONMENT.ENVIRONMENT_VARIABLES.VALUE.TOO_LONG': 'A variable value is too long.',
};

describe('environment errors', () => {
  it.each(Object.entries(VARIABLE_CODES))('rewords %s without echoing anything from the request', (code, message) => {
    const error = new LaunchApiError(400, [{ code, message: 'API_KEY=never-printed-value rejected' }], ENVIRONMENT_ERROR_MESSAGES);

    expect(error.message).toBe(message);
    expect(error.message).not.toContain('never-printed-value');
  });
});
