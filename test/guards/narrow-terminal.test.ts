import { randomBytes } from 'node:crypto';

import type { UxLike } from '../../src/core/prompt';
import type { TableColumn } from '../../src/core/render';
import { renderTable } from '../../src/core/render';
import {
  DEPLOYMENT_DETAIL_COLUMNS,
  deploymentColumns,
  deploymentDetailRows,
} from '../../src/deployments/deployment.presenter';
import type { Deployment } from '../../src/deployments/types';
import {
  ENVIRONMENT_DETAIL_COLUMNS,
  environmentColumns,
  environmentDetailRows,
} from '../../src/environments/environment.presenter';
import type { Environment } from '../../src/environments/types';
import { PROJECT_COLUMNS, PROJECT_DETAIL_COLUMNS } from '../../src/projects/project.presenter';
import type { Project } from '../../src/projects/types';

const ENVIRONMENT_UID = randomBytes(12).toString('hex');
const DEPLOYMENT_UID = randomBytes(12).toString('hex');
const PROJECT_UID = randomBytes(12).toString('hex');
const ORG_UID = `blt${randomBytes(8).toString('hex')}`;
const UPDATED = '2026-11-19T10:15:30.123Z';

const environment: Environment = {
  uid: ENVIRONMENT_UID,
  name: 'staging-europe-west',
  gitBranch: 'release/2026-11-candidate',
  domains: [{ url: 'staging-europe-west-a1b2c3.contentstackapps.com' } as never],
  buildCommand: 'npm run build:production -- --profile',
  updatedAt: UPDATED,
};

const deployment: Deployment = {
  uid: DEPLOYMENT_UID,
  status: 'DEPLOYED',
  commitHash: randomBytes(20).toString('hex'),
  gitBranch: 'release/2026-11-candidate',
  updatedAt: UPDATED,
} as Deployment;

const project: Project = {
  uid: PROJECT_UID,
  name: 'marketing-site-for-the-europe-region',
  projectType: 'GITPROVIDER',
  description: 'The public marketing site, built from the monorepo and served in every European region',
} as Project;

interface Case {
  name: string;
  columns: TableColumn<never>[];
  rows: unknown[];
  uids: string[];
}

const CASES: Case[] = [
  { name: 'env:list', columns: environmentColumns(true) as never, rows: [environment], uids: [ENVIRONMENT_UID] },
  {
    name: 'env:get',
    columns: ENVIRONMENT_DETAIL_COLUMNS as never,
    rows: environmentDetailRows(environment),
    uids: [ENVIRONMENT_UID],
  },
  { name: 'deployments:list', columns: deploymentColumns(true) as never, rows: [deployment], uids: [DEPLOYMENT_UID] },
  {
    name: 'deployments:get',
    columns: DEPLOYMENT_DETAIL_COLUMNS as never,
    rows: deploymentDetailRows(deployment, true, { org: ORG_UID, project: PROJECT_UID, environment: ENVIRONMENT_UID }),
    uids: [DEPLOYMENT_UID],
  },
  { name: 'projects:list', columns: PROJECT_COLUMNS as never, rows: [project], uids: [PROJECT_UID] },
  { name: 'projects:get', columns: PROJECT_DETAIL_COLUMNS as never, rows: [project], uids: [PROJECT_UID] },
];

function draw(table: Case, width: number): string[] {
  const lines: string[] = [];
  const ux: UxLike = { print: (line) => lines.push(line), inquire: async () => undefined as never };

  renderTable(ux, table.columns, table.rows as never[], width);

  return lines;
}

const WIDTHS = [30, 40, 45, 50, 60, 80, 100];

const DETAIL_CASES = CASES.filter((table) => (table.columns[0] as { label?: boolean }).label === true);

describe('guard: tables fit a narrow terminal without cutting a UID', () => {
  it.each(CASES.flatMap((table) => WIDTHS.map((width) => [table.name, width, table] as const)))(
    '%s at %i columns draws no line wider than the terminal and prints every UID whole on one line',
    (_name, width, table) => {
      const lines = draw(table, width);
      const tooWide = lines.filter((line) => [...line].length > width);

      expect(tooWide).toEqual([]);
      table.uids.forEach((uid) => expect(lines.some((line) => line.includes(uid))).toBe(true));
      expect(lines.join('\n')).not.toContain('…');
    },
  );

  it.each(DETAIL_CASES.flatMap((table) => WIDTHS.map((width) => [table.name, width, table] as const)))(
    '%s at %i columns prints every field label whole on one line and never as a FIELD/VALUE record',
    (_name, width, table) => {
      const lines = draw(table, width);

      (table.rows as { field: string }[]).forEach((row) =>
        expect(lines.some((line) => line.includes(row.field))).toBe(true),
      );
      expect(lines.some((line) => /^FIELD\s/.test(line))).toBe(false);
    },
  );
});
