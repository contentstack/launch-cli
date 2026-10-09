import { PREPARING_ARCHIVE, skippedLinksLine } from './upload.presenter';

describe('PREPARING_ARCHIVE', () => {
  it('announces the step in the present tense, because it is printed before the zip is built', () => {
    expect(PREPARING_ARCHIVE).toBe('Preparing zip file...');
  });
});

describe('skippedLinksLine', () => {
  it('counts and names the symbolic links left out of the upload', () => {
    expect(skippedLinksLine(['a.html', 'docs/b'])).toBe(
      'Skipping 2 symbolic link(s), which are never uploaded: a.html, docs/b',
    );
  });
});
