import { projectDeleteQuestion, projectDeletedLine, projectUpdatedLines } from './project.presenter';

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
