import {
  PREPARING_ARCHIVE,
  PROJECT_DELETE_QUESTION,
  deploymentFailureMessage,
  projectDeletedLine,
  projectNotDeletedLine,
  projectNotUpdatedLine,
  projectUpdatedLine,
} from './project.presenter';

describe('PROJECT_DELETE_QUESTION', () => {
  it('asks for confirmation without naming the project', () => {
    expect(PROJECT_DELETE_QUESTION).toBe('Are you sure you want to delete this project?');
  });
});

describe('PREPARING_ARCHIVE', () => {
  it('announces the step in the present tense, because it is printed before the zip is built', () => {
    expect(PREPARING_ARCHIVE).toBe('Preparing zip file...');
  });
});

describe('projectDeletedLine', () => {
  it('says the project was deleted, in green when output is a terminal', () => {
    expect(projectDeletedLine(true)).toBe('\u001b[32m✔ Project deleted successfully.\u001b[39m');
  });

  it('prints plain text when output is not a terminal', () => {
    expect(projectDeletedLine(false)).toBe('✔ Project deleted successfully.');
  });
});

describe('projectNotDeletedLine', () => {
  it('shows the notice in yellow when output is a terminal and leaves it plain otherwise', () => {
    expect(projectNotDeletedLine(true)).toBe('\u001b[33mProject not deleted.\u001b[39m');
    expect(projectNotDeletedLine(false)).toBe('Project not deleted.');
  });
});

describe('projectUpdatedLine', () => {
  it('says the project was updated, in green when output is a terminal', () => {
    expect(projectUpdatedLine(true)).toBe('\u001b[32m\u2714 Project updated successfully.\u001b[39m');
  });

  it('prints plain text when output is not a terminal', () => {
    expect(projectUpdatedLine(false)).toBe('\u2714 Project updated successfully.');
  });
});

describe('projectNotUpdatedLine', () => {
  it('shows the notice in yellow when output is a terminal and leaves it plain otherwise', () => {
    expect(projectNotUpdatedLine(true)).toBe('\u001b[33mProject not updated. No changes were entered.\u001b[39m');
    expect(projectNotUpdatedLine(false)).toBe('Project not updated. No changes were entered.');
  });
});

describe('project create presentation', () => {
  it('says the project and environment survived a failed deployment and how to retry and inspect it', () => {
    const message = deploymentFailureMessage({
      org: 'org1',
      projectName: 'My Site',
      projectUid: 'p1',
      environmentName: 'Default',
      environmentUid: 'e1',
      deploymentUid: 'd1',
      status: 'FAILED',
    });

    expect(message).toBe(
      'The deployment did not succeed; its last status was FAILED. ' +
        'The project "My Site" (p1) and its environment "Default" were created and have not been rolled back. ' +
        'Run csdx launch:deployments:create --org org1 --project p1 --env e1 to try the deployment again, ' +
        'or csdx launch:logs:get --org org1 --project p1 --env e1 --deployment d1 ' +
        'to see why it did not succeed.',
    );
  });

  it('tells a user whose wait ran out that the deployment may still finish, and never to start another one', () => {
    const message = deploymentFailureMessage({
      org: 'org1',
      projectName: 'My Site',
      projectUid: 'p1',
      environmentName: 'Default',
      environmentUid: 'e1',
      deploymentUid: 'd1',
      status: 'DEPLOYING',
      timedOut: true,
    });

    expect(message).toBe(
      'The deployment was still DEPLOYING when the CLI stopped waiting for it; it may still finish. ' +
        'The project "My Site" (p1) and its environment "Default" were created. Do not start another deployment yet: ' +
        'run csdx launch:deployments:get --org org1 --project p1 --env e1 --deployment d1 to see how it ends, ' +
        'or csdx launch:logs:get --org org1 --project p1 --env e1 --deployment d1 to follow it.',
    );
    expect(message).not.toContain('deployments:create');
  });

  it('leaves out the scope it does not have rather than naming an undefined one', () => {
    const message = deploymentFailureMessage({
      org: 'org1',
      projectName: 'My Site',
      projectUid: 'p1',
      environmentName: 'Default',
      status: 'NONE',
    });

    expect(message).not.toContain('undefined');
    expect(message).toContain('Run csdx launch:deployments:create --org org1 --project p1 to try the deployment again');
    expect(message).toContain('or csdx launch:logs:get --org org1 --project p1 to see why it did not succeed.');
  });
});
