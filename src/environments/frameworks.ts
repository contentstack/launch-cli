export const FRAMEWORKS = [
  { label: 'Gatsby', preset: 'GATSBY', outputDirectory: './public', serverCommand: false },
  { label: 'NextJs', preset: 'NEXTJS', outputDirectory: './.next', serverCommand: false },
  { label: 'CRA', preset: 'CRA', outputDirectory: './build', serverCommand: false },
  { label: 'CSR', preset: 'CSR', outputDirectory: './', serverCommand: false },
  { label: 'Analog', preset: 'ANALOG', outputDirectory: './dist/analog/public', serverCommand: true },
  { label: 'Angular', preset: 'ANGULAR', outputDirectory: './dist', serverCommand: true },
  { label: 'Nuxt', preset: 'NUXT', outputDirectory: './.output', serverCommand: true },
  { label: 'Astro', preset: 'ASTRO', outputDirectory: './dist', serverCommand: true },
  { label: 'VueJs', preset: 'VUEJS', outputDirectory: './dist', serverCommand: false },
  { label: 'Remix', preset: 'REMIX', outputDirectory: './build', serverCommand: true },
  { label: 'Other', preset: 'OTHER', outputDirectory: './', serverCommand: true },
] as const;

export type Framework = (typeof FRAMEWORKS)[number];

export type FrameworkPreset = Framework['preset'];

export type FrameworkLabel = Framework['label'];

export const FRAMEWORK_PRESETS: readonly FrameworkPreset[] = FRAMEWORKS.map((framework) => framework.preset);

export const FRAMEWORK_CHOICES: readonly FrameworkLabel[] = FRAMEWORKS.map((framework) => framework.label);

export const FRAMEWORK_PRESET_BY_LABEL: Record<string, FrameworkPreset> = Object.fromEntries(
  FRAMEWORKS.map((framework) => [framework.label.toLowerCase(), framework.preset]),
);

export const OUTPUT_DIRECTORY_BY_FRAMEWORK = Object.fromEntries(
  FRAMEWORKS.map((framework) => [framework.preset, framework.outputDirectory]),
) as Record<FrameworkPreset, string>;

export const SERVER_COMMAND_FRAMEWORKS: readonly FrameworkPreset[] = FRAMEWORKS.filter(
  (framework) => framework.serverCommand,
).map((framework) => framework.preset);
