import { projectDeleteQuestion, projectDeletedLine } from './project.presenter';

describe('projectDeleteQuestion', () => {
  it('names the project it is about to delete and says the change is permanent', () => {
    expect(projectDeleteQuestion('a1b2c3d4e5f60718293a4b5c')).toBe(
      'Delete project "a1b2c3d4e5f60718293a4b5c"? This cannot be undone.',
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
