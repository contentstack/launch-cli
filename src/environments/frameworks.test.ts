import {
  FRAMEWORKS,
  FRAMEWORK_CHOICES,
  FRAMEWORK_PRESETS,
  FRAMEWORK_PRESET_BY_LABEL,
  OUTPUT_DIRECTORY_BY_FRAMEWORK,
  SERVER_COMMAND_FRAMEWORKS,
} from './frameworks';

describe('framework table', () => {
  it('holds exactly the presets the service accepts, with their labels, output directories and server-cmd support', () => {
    expect(
      FRAMEWORKS.map((framework) => [
        framework.label,
        framework.preset,
        framework.outputDirectory,
        framework.serverCommand,
      ]),
    ).toEqual([
      ['Gatsby', 'GATSBY', './public', false],
      ['NextJs', 'NEXTJS', './.next', false],
      ['CRA', 'CRA', './build', false],
      ['CSR', 'CSR', './', false],
      ['Analog', 'ANALOG', './dist/analog/public', true],
      ['Angular', 'ANGULAR', './dist', true],
      ['Nuxt', 'NUXT', './.output', true],
      ['Astro', 'ASTRO', './dist', true],
      ['VueJs', 'VUEJS', './dist', false],
      ['Remix', 'REMIX', './build', true],
      ['Other', 'OTHER', './', true],
    ]);
  });

  it('names each preset and each label once, ignoring case for the label the user types', () => {
    const presets = FRAMEWORKS.map((framework) => framework.preset);
    const labels = FRAMEWORKS.map((framework) => framework.label.toLowerCase());

    expect(new Set(presets).size).toBe(FRAMEWORKS.length);
    expect(new Set(labels).size).toBe(FRAMEWORKS.length);
  });

  it('serves every list from the table, so the lookups agree with it', () => {
    expect(FRAMEWORK_PRESETS).toEqual(['GATSBY', 'NEXTJS', 'CRA', 'CSR', 'ANALOG', 'ANGULAR', 'NUXT', 'ASTRO', 'VUEJS', 'REMIX', 'OTHER']);
    expect(FRAMEWORK_CHOICES).toEqual(['Gatsby', 'NextJs', 'CRA', 'CSR', 'Analog', 'Angular', 'Nuxt', 'Astro', 'VueJs', 'Remix', 'Other']);
    expect(FRAMEWORK_PRESET_BY_LABEL).toEqual({
      gatsby: 'GATSBY',
      nextjs: 'NEXTJS',
      cra: 'CRA',
      csr: 'CSR',
      analog: 'ANALOG',
      angular: 'ANGULAR',
      nuxt: 'NUXT',
      astro: 'ASTRO',
      vuejs: 'VUEJS',
      remix: 'REMIX',
      other: 'OTHER',
    });
    expect(OUTPUT_DIRECTORY_BY_FRAMEWORK).toEqual({
      GATSBY: './public',
      NEXTJS: './.next',
      CRA: './build',
      CSR: './',
      ANALOG: './dist/analog/public',
      ANGULAR: './dist',
      NUXT: './.output',
      ASTRO: './dist',
      VUEJS: './dist',
      REMIX: './build',
      OTHER: './',
    });
    expect(SERVER_COMMAND_FRAMEWORKS).toEqual(['ANALOG', 'ANGULAR', 'NUXT', 'ASTRO', 'REMIX', 'OTHER']);
  });
});
