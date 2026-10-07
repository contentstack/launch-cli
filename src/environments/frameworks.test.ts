import {
  FRAMEWORKS,
  FRAMEWORK_CHOICES,
  FRAMEWORK_PRESETS,
  FRAMEWORK_PRESET_BY_LABEL,
  OUTPUT_DIRECTORY_BY_FRAMEWORK,
  SERVER_COMMAND_FRAMEWORKS,
} from './frameworks';

describe('framework table', () => {
  it('names each preset and each label once, ignoring case for the label the user types', () => {
    const presets = FRAMEWORKS.map((framework) => framework.preset);
    const labels = FRAMEWORKS.map((framework) => framework.label.toLowerCase());

    expect(new Set(presets).size).toBe(FRAMEWORKS.length);
    expect(new Set(labels).size).toBe(FRAMEWORKS.length);
  });

  it('gives every preset exactly one output directory, so the lookup is total', () => {
    expect(Object.keys(OUTPUT_DIRECTORY_BY_FRAMEWORK).sort()).toEqual([...FRAMEWORK_PRESETS].sort());
    expect(OUTPUT_DIRECTORY_BY_FRAMEWORK.NEXTJS).toBe('./.next');
    expect(OUTPUT_DIRECTORY_BY_FRAMEWORK.ANALOG).toBe('./dist/analog/public');
  });

  it('builds every list from the same rows, in table order', () => {
    expect(FRAMEWORK_PRESETS).toEqual(FRAMEWORKS.map((framework) => framework.preset));
    expect(FRAMEWORK_CHOICES).toEqual(FRAMEWORKS.map((framework) => framework.label));
    expect(FRAMEWORK_PRESET_BY_LABEL.nextjs).toBe('NEXTJS');
    expect(SERVER_COMMAND_FRAMEWORKS).toEqual(
      FRAMEWORKS.filter((framework) => framework.serverCommand).map((framework) => framework.preset),
    );
  });
});
