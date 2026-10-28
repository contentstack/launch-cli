import { randomBytes, randomUUID } from 'node:crypto';

import nock from 'nock';

import { DeploymentsApi } from '../../src/deployments/deployments.api';
import { RestApiClient } from '../../src/transport/rest-client';

const ORIGIN = 'https://launch-api.request-bodies.test';
const ORG_UID = `blt${randomBytes(8).toString('hex')}`;
const PROJECT_UID = randomBytes(12).toString('hex');
const ENV_UID = randomBytes(12).toString('hex');
const DEPLOYMENT_UID = randomBytes(12).toString('hex');
const SCOPE = { org: ORG_UID, project: PROJECT_UID, environment: ENV_UID };
const BASE = `/manage/projects/${PROJECT_UID}/environments/${ENV_UID}/deployments`;

const FIELDS_THE_SERVER_ACCEPTS = {
  create: ['commitHash', 'uploadUid'],
  rollback: ['deployment', 'reason'],
};

interface Sent {
  body: unknown;
  contentType: string | string[] | undefined;
}

function buildApi(): DeploymentsApi {
  return new DeploymentsApi(
    new RestApiClient({
      baseUrl: `${ORIGIN}/manage`,
      analyticsInfo: 'cli/2.0.0',
      auth: { headers: async () => ({ authtoken: randomUUID() }) },
      retryDelayMs: 0,
      sleep: async () => undefined,
    }),
  );
}

function captureMutation(path: string, reply: unknown): Sent {
  const sent: Sent = { body: undefined, contentType: undefined };

  nock(ORIGIN)
    .post(path, (body: unknown) => {
      sent.body = body;
      return true;
    })
    .reply(function () {
      sent.contentType = this.req.headers['content-type'];
      return [200, reply as nock.Body];
    });

  return sent;
}

function expectOnlyAcceptedFields(body: unknown, accepted: string[]): void {
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  expect(body).not.toHaveProperty('environment');
  expect(Object.keys(body as object).filter((key) => !accepted.includes(key))).toEqual([]);
}

describe('guard: a deployments mutation sends only fields the management service DTO declares, because its whitelist answers 400 to any other, the environment included', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  it.each([
    ['a redeploy', {}],
    ['a commit', { commitHash: 'abc123' }],
    ['an upload', { uploadUid: 'up-1' }],
    ['a commit and an upload', { commitHash: 'abc123', uploadUid: 'up-1' }],
  ])('sends the create for %s with no environment in the body, the environment staying in the path', async (_label, extra) => {
    const sent = captureMutation(BASE, { deployment: { uid: DEPLOYMENT_UID } });

    await buildApi().create({ ...SCOPE, ...extra });

    expectOnlyAcceptedFields(sent.body, FIELDS_THE_SERVER_ACCEPTS.create);
    expect(sent.body).toEqual(extra);
    expect(sent.contentType).toBe('application/json');
  });

  it.each([
    ['a reason', 'bad release', { deployment: DEPLOYMENT_UID, reason: 'bad release' }],
    ['no reason', undefined, { deployment: DEPLOYMENT_UID }],
    ['a blank reason', '   ', { deployment: DEPLOYMENT_UID }],
  ])('sends the rollback with %s and no environment in the body', async (_label, reason, expected) => {
    const sent = captureMutation(`${BASE}/rollback`, { message: 'Rollback triggered successfully' });

    await buildApi().rollback({ ...SCOPE, deployment: DEPLOYMENT_UID, reason });

    expectOnlyAcceptedFields(sent.body, FIELDS_THE_SERVER_ACCEPTS.rollback);
    expect(sent.body).toEqual(expected);
    expect(sent.contentType).toBe('application/json');
  });

  it('sends the cancel with no body at all and no content type', async () => {
    const sent = captureMutation(`${BASE}/${DEPLOYMENT_UID}/cancel`, {});

    await buildApi().cancel({ ...SCOPE, deployment: DEPLOYMENT_UID });

    expect(sent.body === undefined || sent.body === '').toBe(true);
    expect(sent.contentType).toBeUndefined();
  });
});
