import { EXIT_RUNTIME } from '../core/constants';
import { ApiErrorEntry, LaunchApiError } from '../transport/errors';
import { GIT_CONNECTION_NOT_FOUND_CODE, GitConnectionMissingError, isMissingGitConnection } from './git.errors';

function apiError(entries: ApiErrorEntry[]): LaunchApiError {
  return new LaunchApiError(404, entries);
}

describe('isMissingGitConnection', () => {
  it('recognises the code management-service would send if it ever named this one', () => {
    expect(isMissingGitConnection(apiError([{ code: GIT_CONNECTION_NOT_FOUND_CODE }]))).toBe(true);
  });

  it('recognises the bare message the service actually sends, whatever its casing', () => {
    expect(isMissingGitConnection(apiError([{ message: 'No user connection found' }]))).toBe(true);
    expect(isMissingGitConnection(apiError([{ message: 'NO USER CONNECTION FOUND for org' }]))).toBe(true);
  });

  it('looks past the first entry, because the message need not lead the list', () => {
    expect(
      isMissingGitConnection(apiError([{ message: 'Something else' }, { message: 'no user connection found' }])),
    ).toBe(true);
  });

  it('treats an entry carrying no message at all as no match rather than crashing on it', () => {
    expect(isMissingGitConnection(apiError([{ field: 'org' }]))).toBe(false);
    expect(isMissingGitConnection(apiError([{ field: 'org' }, { message: 'no user connection found' }]))).toBe(true);
  });

  it('refuses an API error that is about something else', () => {
    expect(isMissingGitConnection(apiError([{ code: 'launch.REPOSITORY.NOT_FOUND', message: 'No repository.' }]))).toBe(
      false,
    );
  });

  it('refuses an API error carrying no entries at all', () => {
    expect(isMissingGitConnection(apiError([]))).toBe(false);
  });

  it.each([[new Error('no user connection found')], [undefined], [null], ['no user connection found'], [{}]])(
    'refuses anything that is not a LaunchApiError (%p), however much it looks like one',
    (value) => {
      expect(isMissingGitConnection(value)).toBe(false);
    },
  );
});

describe('GitConnectionMissingError', () => {
  it('names the provider, exits 1, and reports itself as already printed', () => {
    const failure = new GitConnectionMissingError('GitHub', 'https://app.example.test/accounts');

    expect(failure.message).toBe('GitHub connection not found!');
    expect(failure.name).toBe('GitConnectionMissingError');
    expect(failure.exitCode).toBe(EXIT_RUNTIME);
    expect(failure.reported).toBe(true);
    expect(failure.connectUrl).toBe('https://app.example.test/accounts');
  });

  it('carries no url when the region gave it none', () => {
    expect(new GitConnectionMissingError('GitHub').connectUrl).toBeUndefined();
  });
});
