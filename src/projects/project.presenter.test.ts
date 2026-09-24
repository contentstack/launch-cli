import type { Project } from './types';
import {
  deploymentFailureMessage,
  projectCreatedFields,
  projectDeleteQuestion,
  projectDeletedLine,
  projectUpdatedLines,
} from './project.presenter';

describe('projectDeleteQuestion', () => {
  it('names the project by its name and the resolved uid and says the change is permanent', () => {
    expect(projectDeleteQuestion({ name: 'marketing-site' } as Project, 'a1b2c3d4e5f60718293a4b5c')).toBe(
      'Delete project "marketing-site" (a1b2c3d4e5f60718293a4b5c)? This cannot be undone.',
    );
  });

  it.each([[undefined], ['']])('falls back to the reference given when the name is %p', (name) => {
    expect(projectDeleteQuestion({ uid: 'p1', name: name as string }, 'p1')).toBe(
      'Delete project "p1"? This cannot be undone.',
    );
  });
});

describe('projectDeletedLine', () => {
  it('names the project by the name the API returned', () => {
    expect(projectDeletedLine({ uid: 'p1', name: 'Renamed Site' }, 'p1')).toBe('✔ Project "Renamed Site" deleted.');
  });

  it.each([[undefined], ['']])('falls back to the reference given when the name is %p', (name) => {
    expect(projectDeletedLine({ uid: 'p1', name: name as string }, 'p1')).toBe('✔ Project "p1" deleted.');
  });
});

describe('projectUpdatedLines', () => {
  it('prints one line per requested field, carrying the value the API confirmed', () => {
    expect(
      projectUpdatedLines(
        { name: 'Renamed Site', description: 'A new blurb' },
        { uid: 'p1', name: 'Renamed Site', description: 'A new blurb' },
      ),
    ).toEqual(['\u2714 name updated to "Renamed Site"', '\u2714 description updated to "A new blurb"']);
  });

  it.each([
    [{ name: 'Renamed Site' }, ['\u2714 name updated to "Renamed Site"']],
    [{ description: 'A new blurb' }, ['\u2714 description updated to "A new blurb"']],
  ])('prints only the field that was requested for %p', (requested, expected) => {
    expect(projectUpdatedLines(requested, { uid: 'p1', name: 'Renamed Site', description: 'A new blurb' })).toEqual(
      expected,
    );
  });

  it('prints no line for a field left undefined', () => {
    expect(
      projectUpdatedLines({ name: 'Renamed Site', description: undefined }, { uid: 'p1', name: 'Renamed Site' }),
    ).toEqual(['\u2714 name updated to "Renamed Site"']);
  });

  it('falls back to the requested value when the response omitted the field', () => {
    expect(projectUpdatedLines({ name: 'Renamed Site' }, { uid: 'p1', name: undefined as unknown as string })).toEqual([
      '\u2714 name updated to "Renamed Site"',
    ]);
  });

  it('prints nothing when no field was requested', () => {
    expect(projectUpdatedLines({}, { uid: 'p1', name: 'Renamed Site' })).toEqual([]);
  });
});

describe('project create presentation', () => {
  it('reports uid, name, type and the site url of a created project', () => {
    expect(
      projectCreatedFields(
        { uid: 'p1', name: 'My Site', projectType: 'GITPROVIDER' },
        'https://my-site.example.test',
      ),
    ).toEqual([
      ['uid', 'p1'],
      ['name', 'My Site'],
      ['type', 'GITPROVIDER'],
      ['url', 'https://my-site.example.test'],
    ]);
  });

  it('falls back to an empty cell for every field the API left out, including the url', () => {
    expect(projectCreatedFields({ uid: 'p1' } as never)).toEqual([
      ['uid', 'p1'],
      ['name', ''],
      ['type', ''],
      ['url', ''],
    ]);
  });

  it('falls back to an empty cell when even the uid is missing', () => {
    expect(projectCreatedFields({} as never, undefined)).toEqual([
      ['uid', ''],
      ['name', ''],
      ['type', ''],
      ['url', ''],
    ]);
  });

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
        'Run csdx launch:deployments:create --org org1 --project p1 --environment e1 to try the deployment again, ' +
        'or csdx launch:logs:get --org org1 --project p1 --environment e1 --deployment d1 ' +
        'to see why it did not succeed.',
    );
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
