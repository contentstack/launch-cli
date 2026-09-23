import {
  API_VERSION,
  CLIENT_MAX_LIMIT,
  DEFAULT_LIMIT,
  EXIT_CANCELLED,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
  MAX_PAGES,
  PICKER_PAGE_SIZE,
  PROJECT_CONFIG_FILE,
} from './constants';

describe('constants', () => {
  it('exposes the values the CLI contract depends on', () => {
    expect(PROJECT_CONFIG_FILE).toBe('.cs-launch.json');
    expect(API_VERSION).toBe('1.0');
    expect(EXIT_OK).toBe(0);
    expect(EXIT_RUNTIME).toBe(1);
    expect(EXIT_USAGE).toBe(2);
    expect(EXIT_CANCELLED).toBe(3);
    expect(DEFAULT_LIMIT).toBe(100);
    expect(CLIENT_MAX_LIMIT).toBe(1000);
    expect(PICKER_PAGE_SIZE).toBe(100);
    expect(MAX_PAGES).toBe(100);
  });

  it('keeps the picker page size independent of the client limit guard', () => {
    expect(PICKER_PAGE_SIZE).toBeLessThan(CLIENT_MAX_LIMIT);
  });

  it('fetches a whole default page within the client guard', () => {
    expect(DEFAULT_LIMIT).toBeLessThanOrEqual(CLIENT_MAX_LIMIT);
  });
});
