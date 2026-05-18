import { describe, it, beforeEach, afterEach } from 'mocha';
import type { ApolloClient } from '@apollo/client/core';
import Rollback from '../../../src/commands/launch/rollback';
import { cliux } from '@contentstack/cli-utilities';
import { testFlags } from '../mock';
import sinon, { stub } from 'sinon';
import { config } from 'dotenv';
import * as commonUtility from '../../../src/util/common-utility';
import { BaseCommand } from '../../../src/base-command';

config();

const orgUid = process.env.ORG || 'test-org-uid';
const projectUid = process.env.PROJECT || 'test-project-uid';
const environmentName = process.env.ENVIRONMENT || 'Default';
const targetDeploymentUid = process.env.ROLLBACK_DEPLOYMENT || 'target-deployment-uid';

const environmentsResponse = {
  data: {
    Environments: {
      edges: [
        {
          node: {
            uid: 'env-uid',
            name: environmentName,
            deployments: {
              edges: [
                {
                  node: {
                    uid: 'live-uid',
                    status: 'LIVE',
                    deploymentNumber: 3,
                    isRollbackEligible: true,
                  },
                },
                {
                  node: {
                    uid: targetDeploymentUid,
                    status: 'ARCHIVED',
                    deploymentNumber: 2,
                    isRollbackEligible: true,
                  },
                },
              ],
            },
          },
        },
      ],
    },
  },
};

const projectsResponse = {
  data: {
    projects: {
      edges: [{ node: { uid: projectUid, name: 'Test Project' } }],
    },
  },
};

const getFlagValue = (flag: unknown): string | undefined => {
  if (flag === undefined || flag === null) {
    return undefined;
  }
  return String(flag);
};

const createApolloClientStub = () => ({
  query: stub().callsFake(({ query }) => {
    const queryBody = query?.loc?.source?.body ?? '';
    if (queryBody.includes('projects')) {
      return Promise.resolve(projectsResponse);
    }
    if (queryBody.includes('Environments')) {
      return Promise.resolve(environmentsResponse);
    }
    return Promise.resolve({ data: {} });
  }),
  mutate: stub().resolves({
    data: {
      rollbackDeployment: { status: 'PENDING', environmentUid: 'env-uid' },
    },
  }),
});

describe('Rollback', () => {
  let rollbackDeploymentStub: sinon.SinonStub;

  beforeEach(() => {
    stub(commonUtility, 'selectOrg').callsFake(async ({ config, flags }) => {
      const orgFlag = getFlagValue(flags.org);
      if (orgFlag) {
        config.currentConfig.organizationUid =
          orgFlag === testFlags.invalidOrg.uid ? testFlags.invalidOrg.uid : orgUid;
        return;
      }
      config.currentConfig.organizationUid = orgUid;
    });
    stub(commonUtility, 'selectProject').callsFake(async ({ config, flags }) => {
      const projectFlag = getFlagValue(flags?.project) ?? config?.project;
      if (projectFlag && projectFlag !== testFlags.invalidProj) {
        config.currentConfig.uid = projectUid;
        return;
      }
      if (!config.currentConfig.uid) {
        await cliux.inquire({
          type: 'search-list',
          name: 'Project',
          message: 'Choose a project',
        });
        config.currentConfig.uid = projectUid;
      }
    });
    stub(BaseCommand.prototype, 'prepareApiClients').callsFake(async function (this: BaseCommand<typeof Rollback>) {
      this.apolloClient = createApolloClientStub() as unknown as ApolloClient<unknown>;
      this.apolloLogsClient = {} as unknown as ApolloClient<unknown>;
    });
    rollbackDeploymentStub = stub(Rollback.prototype, 'rollbackDeployment').resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('Should run the command when all the flags are passed', async function () {
    const args = [
      '--org',
      orgUid,
      '-e',
      environmentName,
      '--project',
      projectUid,
      '--deployment',
      targetDeploymentUid,
    ];
    const inquireStub = stub(cliux, 'inquire');

    await Rollback.run(args);

    sinon.assert.calledOnce(rollbackDeploymentStub);
    sinon.assert.notCalled(inquireStub);
    inquireStub.restore();
  });

  it('Should ask for org when org flag is not passed', async function () {
    const args = ['-e', environmentName, '--project', projectUid];
    const mock = sinon.mock(Rollback);
    const expectation = mock.expects('run');
    expectation.exactly(1);
    const orgStub = stub(cliux, 'inquire').resolves(orgUid);

    await Rollback.run(args);

    sinon.assert.notCalled(orgStub);
    orgStub.restore();
    mock.verify();
    mock.restore();
  });

  it('Should ask for project when project flag is not passed', async function () {
    const args = ['-e', environmentName, '--org', orgUid];
    const projectStub = stub(cliux, 'inquire').resolves('Test Project');

    await Rollback.run(args);

    sinon.assert.calledOnce(projectStub);
    projectStub.restore();
  });

  it('Should ask for environment when environment flag is not passed', async function () {
    rollbackDeploymentStub.restore();
    rollbackDeploymentStub = stub(Rollback.prototype, 'rollbackDeployment').callsFake(async function (this: Rollback) {
      await this.resolveEnvironment();
    });

    const args = ['--org', orgUid, '--project', projectUid];
    const inquireStub = stub(cliux, 'inquire').resolves(environmentName);

    await Rollback.run(args);

    sinon.assert.called(inquireStub);
    inquireStub.restore();
  });

  it('Should ask for organization with a warning when passed incorrect org uid', async function () {
    const args = ['--org', testFlags.invalidOrg.uid, '--project', projectUid, '-e', environmentName];
    const mock = sinon.mock(Rollback);
    const expectation = mock.expects('run');
    expectation.exactly(1);
    const orgStub = stub(cliux, 'inquire').resolves(orgUid);

    await Rollback.run(args);

    sinon.assert.notCalled(orgStub);
    orgStub.restore();
    mock.verify();
    mock.restore();
  });

  it('Should ask for project when passed incorrect project name', async function () {
    const args = ['--org', orgUid, '--project', testFlags.invalidProj, '-e', environmentName];
    const projectStub = stub(cliux, 'inquire').resolves('Test Project');

    await Rollback.run(args);

    sinon.assert.calledOnce(projectStub);
    projectStub.restore();
  });
});
