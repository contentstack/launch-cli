import {
  ENVIRONMENT_COLUMNS,
  ENVIRONMENT_DELETE_QUESTION,
  ENVIRONMENT_DETAIL_COLUMNS,
  environmentColumns,
  environmentDeletedLine,
  environmentAlreadyMatchesLine,
  environmentDetailRows,
  environmentNoChangesLine,
  environmentNotDeletedLine,
} from './environment.presenter';
import { UID_WIDTH } from '../core/render';

const FULL = {
  uid: 'e1',
  name: 'production',
  domains: [{ url: 'https://a.io' }, {}, { url: '  ' }, { url: 'https://b.io' }],
  gitBranch: 'main',
  frameworkPreset: 'NEXTJS',
  buildCommand: 'npm run build',
  outputDirectory: './.next',
  serverCommand: 'npm start',
  autoDeployOnPush: true,
  isContentstackAuthenticationEnabled: false,
  isCachePrimingEnabled: true,
  passwordProtection: { isEnabled: false },
  environmentVariables: [
    { key: 'API_KEY', value: 'never-shown' },
    { key: 'REGION', value: 'eu' },
  ],
  organizationUid: 'blt0rg',
  project: 'p1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('ENVIRONMENT_COLUMNS', () => {
  it('labels the uid column as the environment uid', () => {
    expect(ENVIRONMENT_COLUMNS.map((column) => column.header)).toEqual(['NAME', 'BRANCH', 'URL', 'UPDATED', 'ENVIRONMENT UID']);
  });

  it('renders every list column of a full environment', () => {
    expect(ENVIRONMENT_COLUMNS.map((column) => column.value(FULL))).toEqual([
      'production',
      'main',
      'https://a.io',
      '2026-09-01T00:00:00.000Z',
      'e1',
    ]);
  });

  it('renders a placeholder for a list column that is missing, empty or blank', () => {
    const blank = { uid: ' ', name: '', gitBranch: '  ', updatedAt: '', domains: [{ url: '' }] };

    expect(ENVIRONMENT_COLUMNS.map((column) => column.value({}))).toEqual(['-', '-', '-', '-', '-']);
    expect(ENVIRONMENT_COLUMNS.map((column) => column.value(blank))).toEqual(['-', '-', '-', '-', '-']);
  });
});

describe('environmentColumns', () => {
  it('keeps every list column when the branch is shown', () => {
    expect(environmentColumns(true)).toEqual(ENVIRONMENT_COLUMNS);
  });

  it('drops the branch column when the branch is not shown', () => {
    expect(environmentColumns(false).map((column) => column.header)).toEqual([
      'NAME',
      'URL',
      'UPDATED',
      'ENVIRONMENT UID',
    ]);
  });
});

describe('environmentDetailRows', () => {
  it('lists every field in the agreed order, booleans as enabled or disabled and variables as a bare count', () => {
    expect(environmentDetailRows(FULL)).toEqual([
      { field: 'ENVIRONMENT UID', value: 'e1' },
      { field: 'NAME', value: 'production' },
      { field: 'BRANCH', value: 'main' },
      { field: 'FRAMEWORK', value: 'NEXTJS' },
      { field: 'BUILD COMMAND', value: 'npm run build' },
      { field: 'OUTPUT DIRECTORY', value: './.next' },
      { field: 'SERVER COMMAND', value: 'npm start' },
      { field: 'AUTO DEPLOY', value: 'enabled' },
      { field: 'VARIABLES', value: '2' },
      { field: 'CACHE PRIMING', value: 'enabled' },
      { field: 'CONTENTSTACK AUTHENTICATION', value: 'disabled' },
      { field: 'PASSWORD PROTECTION', value: 'disabled' },
      { field: 'URL', value: 'https://a.io, https://b.io' },
      { field: 'ORGANIZATION UID', value: 'blt0rg' },
      { field: 'PROJECT UID', value: 'p1' },
      { field: 'CREATED AT', value: '2026-08-01T00:00:00.000Z' },
      { field: 'UPDATED AT', value: '2026-09-01T00:00:00.000Z' },
    ]);
  });

  it('renders a placeholder, not "disabled", for a toggle or server command the API reports as null', () => {
    const rows = environmentDetailRows({
      serverCommand: null,
      autoDeployOnPush: null,
      isCachePrimingEnabled: null,
      isContentstackAuthenticationEnabled: null,
    });
    const valueOf = (field: string) => rows.find((row) => row.field === field)?.value;

    expect(['SERVER COMMAND', 'AUTO DEPLOY', 'CACHE PRIMING', 'CONTENTSTACK AUTHENTICATION'].map(valueOf)).toEqual([
      '-',
      '-',
      '-',
      '-',
    ]);
  });

  it('renders a placeholder for every field an environment arrives without, and a zero variable count', () => {
    expect(environmentDetailRows({}).map((row) => row.value)).toEqual([
      '-',
      '-',
      '-',
      '-',
      '-',
      '-',
      '-',
      '-',
      '0',
      '-',
      '-',
      '-',
      '-',
      '-',
      '-',
      '-',
      '-',
    ]);
  });

  it.each([
    [{ domains: [] }, 'URL', '-'],
    [{ domains: [{ url: '' }] }, 'URL', '-'],
    [{ passwordProtection: {} }, 'PASSWORD PROTECTION', '-'],
    [{ passwordProtection: { isEnabled: true } }, 'PASSWORD PROTECTION', 'enabled'],
    [{ environmentVariables: [] }, 'VARIABLES', '0'],
    [{ name: '  ' }, 'NAME', '-'],
  ])('renders %p as %s = %p', (environment, field, value) => {
    expect(environmentDetailRows(environment).find((row) => row.field === field)?.value).toBe(value);
  });

  it('leaves the branch out when asked not to show it', () => {
    const fields = environmentDetailRows(FULL, false).map((row) => row.field);

    expect(fields).not.toContain('BRANCH');
    expect(fields).toContain('ENVIRONMENT UID');
  });

  it('never renders a variable key or value', () => {
    const rendered = JSON.stringify(environmentDetailRows(FULL));

    expect(rendered).not.toContain('API_KEY');
    expect(rendered).not.toContain('never-shown');
  });
});

describe('ENVIRONMENT_DETAIL_COLUMNS', () => {
  it('draws a FIELD label column and a VALUE column wide enough for a whole UID', () => {
    expect(ENVIRONMENT_DETAIL_COLUMNS.map((column) => column.header)).toEqual(['FIELD', 'VALUE']);
    expect(ENVIRONMENT_DETAIL_COLUMNS.map((column) => column.value({ field: 'NAME', value: 'production' }))).toEqual([
      'NAME',
      'production',
    ]);
    expect(ENVIRONMENT_DETAIL_COLUMNS.map((column) => column.minWidth)).toEqual([undefined, UID_WIDTH]);
    expect(ENVIRONMENT_DETAIL_COLUMNS.map((column) => column.label)).toEqual([true, undefined]);
  });
});

describe('environment delete wording', () => {
  it('asks the question the Contentstack CLI asks for its own deletes', () => {
    expect(ENVIRONMENT_DELETE_QUESTION).toBe('Are you sure you want to delete this environment?');
  });

  it('says the environment was deleted in green on a terminal and plain otherwise', () => {
    expect(environmentDeletedLine(true)).toBe('\u001b[32m\u2714 Environment deleted successfully.\u001b[39m');
    expect(environmentDeletedLine(false)).toBe('\u2714 Environment deleted successfully.');
  });

  it('says the environment was not deleted in yellow on a terminal and plain otherwise', () => {
    expect(environmentNotDeletedLine(true)).toBe('\u001b[33mEnvironment not deleted.\u001b[39m');
    expect(environmentNotDeletedLine(false)).toBe('Environment not deleted.');
  });
});

describe('environmentAlreadyMatchesLine', () => {
  it('names one matching flag in the singular, in yellow on a terminal and plain otherwise', () => {
    expect(environmentAlreadyMatchesLine(['cs-auth'], true)).toBe(
      '\u001b[33mEnvironment not updated: --cs-auth already matches the current settings.\u001b[39m',
    );
    expect(environmentAlreadyMatchesLine(['cs-auth'], false)).toBe(
      'Environment not updated: --cs-auth already matches the current settings.',
    );
  });

  it('names several matching flags in the plural, in the order given', () => {
    expect(environmentAlreadyMatchesLine(['cs-auth', 'cache-priming'], false)).toBe(
      'Environment not updated: --cs-auth, --cache-priming already match the current settings.',
    );
  });
});

describe('environmentNoChangesLine', () => {
  it('says nothing was changed in yellow on a terminal and plain otherwise', () => {
    expect(environmentNoChangesLine(true)).toBe('\u001b[33mEnvironment not updated. No changes were entered.\u001b[39m');
    expect(environmentNoChangesLine(false)).toBe('Environment not updated. No changes were entered.');
  });
});
