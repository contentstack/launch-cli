import {
  API_VERSION,
  DEFAULT_LIMIT,
  EXIT_CANCELLED,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
  MAX_LIMIT,
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
    expect(DEFAULT_LIMIT).toBe(50);
    expect(MAX_LIMIT).toBe(100);
  });
});
