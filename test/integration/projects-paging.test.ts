import { randomBytes } from 'node:crypto';

import nock from 'nock';

import { buildApi } from '../../src/resources';
import { MAX_LIMIT } from '../../src/core/constants';
import { UsageError } from '../../src/core/errors';
import { RestApiClient } from '../../src/transport/rest-client';
import { UxLike } from '../../src/core/render';
import { ProjectRef } from '../../src/projects/project-ref';
import { ProjectResolver } from '../../src/projects/project.resolver';

const ORIGIN = 'https://launch-api.paging.test';
const BASE_PATH = '/manage';
const ORG_UID = 'blt4d9e2a7c1f6b3085';
const ANALYTICS_INFO = '@contentstack/cli-launch/2.0.0-alpha.0 darwin-arm64 node-v22.0.0';
const TARGET_UID = randomBytes(12).toString('hex');

function buildDeps() {
  const client = new RestApiClient({
    baseUrl: `${ORIGIN}${BASE_PATH}`,
    analyticsInfo: ANALYTICS_INFO,
    auth: { headers: async () => ({}) },
    retryDelayMs: 0,
    sleep: async () => undefined,
  });
  const ux: UxLike = { print: () => undefined, inquire: async () => undefined as never };

  return { api: buildApi(client), ux };
}

function projectsOfSize(size: number, prefix: string) {
  return Array.from({ length: size }, (_, index) => ({
    uid: `${prefix}${index.toString().padStart(23, '0')}`,
    name: `${prefix}-project-${index}`,
  }));
}

function pageOf(projects: { uid: string; name: string }[], count: number) {
  return { pagination: { count, limit: MAX_LIMIT, skip: null }, projects };
}

describe('integration: paging GET /projects for name resolution', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it('resolves a name that only exists beyond the first page', async () => {
    const first = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: '0' })
      .reply(200, pageOf(projectsOfSize(MAX_LIMIT, 'a'), 101));
    const second = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: String(MAX_LIMIT) })
      .reply(200, pageOf([{ uid: TARGET_UID, name: 'docs-site' }], 101));

    await expect(new ProjectResolver(buildDeps().api.projects).toUid(ORG_UID, ProjectRef.parse('docs-site'))).resolves.toBe(TARGET_UID);

    expect(first.isDone()).toBe(true);
    expect(second.isDone()).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('never asks for the second page when the first page already holds the name', async () => {
    const first = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: '0' })
      .reply(200, pageOf([...projectsOfSize(MAX_LIMIT - 1, 'a'), { uid: TARGET_UID, name: 'docs-site' }], 500));
    const second = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: String(MAX_LIMIT) })
      .reply(200, pageOf(projectsOfSize(MAX_LIMIT, 'b'), 500));

    await expect(new ProjectResolver(buildDeps().api.projects).toUid(ORG_UID, ProjectRef.parse('docs-site'))).resolves.toBe(TARGET_UID);

    expect(first.isDone()).toBe(true);
    expect(second.isDone()).toBe(false);
  });

  it('reports a plain not-found after walking every page of the organization', async () => {
    const first = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: '0' })
      .reply(200, pageOf(projectsOfSize(MAX_LIMIT, 'a'), 150));
    const second = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: String(MAX_LIMIT) })
      .reply(200, pageOf(projectsOfSize(50, 'b'), 150));
    const third = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: '150' })
      .reply(200, pageOf([], 150));

    const rejection = await new ProjectResolver(buildDeps().api.projects).toUid(ORG_UID, ProjectRef.parse('ghost')).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(UsageError);
    expect((rejection as UsageError).message).toBe('No project named "ghost" found in this organization.');
    expect(first.isDone()).toBe(true);
    expect(second.isDone()).toBe(true);
    expect(third.isDone()).toBe(false);
  });

  it('stops on an empty page even when the reported count promises more', async () => {
    const first = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: '0' })
      .reply(200, pageOf([], 900));
    const second = nock(ORIGIN)
      .get(`${BASE_PATH}/projects`)
      .query({ limit: String(MAX_LIMIT), skip: '0' })
      .reply(200, pageOf([], 900));

    const rejection = await new ProjectResolver(buildDeps().api.projects).toUid(ORG_UID, ProjectRef.parse('ghost')).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(first.isDone()).toBe(true);
    expect(second.isDone()).toBe(false);
  });
});
