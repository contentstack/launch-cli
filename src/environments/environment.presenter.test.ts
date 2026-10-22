import {
  ENVIRONMENT_COLUMNS,
  ENVIRONMENT_DELETE_QUESTION,
  ENVIRONMENT_DETAIL_COLUMNS,
  ENVIRONMENT_VALUE_COLUMN,
  environmentColumns,
  environmentDeletedLine,
  environmentDetailRows,
  environmentNoChangesLine,
  environmentNotDeletedLine,
} from './environment.presenter';

const FULL = {
  uid: 'e1',
  name: 'production',
  description: 'the live site',
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
      { field: 'DESCRIPTION', value: 'the live site' },
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
  it('draws a FIELD and a VALUE column and lets the VALUE column flex', () => {
    expect(ENVIRONMENT_DETAIL_COLUMNS.map((column) => column.header)).toEqual(['FIELD', 'VALUE']);
    expect(ENVIRONMENT_DETAIL_COLUMNS.map((column) => column.value({ field: 'NAME', value: 'production' }))).toEqual([
      'NAME',
      'production',
    ]);
    expect(ENVIRONMENT_VALUE_COLUMN).toBe(1);
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

describe('environmentNoChangesLine', () => {
  it('says nothing was changed in yellow on a terminal and plain otherwise', () => {
    expect(environmentNoChangesLine(true)).toBe('\u001b[33mEnvironment not updated. No changes were entered.\u001b[39m');
    expect(environmentNoChangesLine(false)).toBe('Environment not updated. No changes were entered.');
  });
});
