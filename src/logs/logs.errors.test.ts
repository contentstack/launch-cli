import { DEPLOYMENT_ERROR_MESSAGES } from '../deployments/deployment.errors';
import { LaunchApiError } from '../transport/errors';
import { LOGS_ERROR_MESSAGES } from './logs.errors';

describe('logs error wording', () => {
  it.each([
    ['launch.SERVERLOGS.NOT_INTEGER', 'The Launch API could not read the time window of the server logs.'],
    [
      'launch.LOGS.QUERY_TIMEOUT',
      'The server logs query took too long. Narrow the window with --since and --until and try again.',
    ],
    [
      'launch.LOGS.REQUEST_TIMEOUT',
      'The Launch API took too long to answer. Try again, or narrow the window with --since and --until.',
    ],
    ['launch.DEPLOYMENT.PROJECT_MISMATCH', 'That deployment does not belong to this project.'],
    ['launch.DEPLOYMENT.ENVIRONMENT_MISMATCH', 'That deployment does not belong to this environment.'],
    ['launch.PROJECT.NOT_FOUND', 'No project found with that UID.'],
    ['launch.DEPLOYMENT.NOT_FOUND', 'No deployment found with that UID.'],
  ])('rewords %s and never shows the raw message', (code, wording) => {
    const error = new LaunchApiError(400, [{ code, message: 'raw server text' }], LOGS_ERROR_MESSAGES);

    expect(error.message).toBe(wording);
  });

  it('carries every deployment entry without copying one of its own', () => {
    for (const [code, wording] of Object.entries(DEPLOYMENT_ERROR_MESSAGES)) {
      expect(LOGS_ERROR_MESSAGES[code]).toBe(wording);
    }
  });

  it('falls back to the API text for a code it does not reword', () => {
    const error = new LaunchApiError(400, [{ code: 'launch.LOGS.SOMETHING_NEW', message: 'raw server text' }], LOGS_ERROR_MESSAGES);

    expect(error.message).toBe('raw server text');
  });
});
