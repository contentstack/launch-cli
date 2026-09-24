import { Occurrence, SourceFile, describeOccurrence, productionSources } from '../../test/support/sources';

const PLUMBING_FILES = ['core/launch-command.ts', 'core/service-context.ts', 'core/resolution.ts'];
const PLUMBING_LINE = /^isTTY\??:\s*(boolean|args\.isTTY|options\.isTTY|Boolean\(process\.stdin\.isTTY\)),?;?$/;
const PROMPT_DECISION = /\.inquire\b|\bask[A-Z]\w*\(|\bprompt\b|\bthrow new (MissingInputError|UsageError)\b/;
const GATE_WINDOW = 4;

function stdinReads(source: SourceFile): Occurrence[] {
  const lines = source.text.split('\n');

  return lines.flatMap((raw, index) => {
    const text = raw.trim();
    const stdinSide = text.replace(/\bstdout\.isTTY\b/g, '');

    if (!/\bisTTY\b|\bstdin\b/.test(stdinSide)) {
      return [];
    }

    return [{ path: source.path, line: index + 1, text }];
  });
}

function isPlumbing(read: Occurrence): boolean {
  return PLUMBING_FILES.includes(read.path) && PLUMBING_LINE.test(read.text);
}

function isPromptDecision(source: SourceFile, read: Occurrence): boolean {
  const window = source.text
    .split('\n')
    .slice(read.line - 1, read.line - 1 + GATE_WINDOW)
    .join('\n');

  return PROMPT_DECISION.test(window);
}

function outputDecisionsOnStdin(source: SourceFile): string[] {
  return stdinReads(source)
    .filter((read) => !isPlumbing(read) && !isPromptDecision(source, read))
    .map(
      (read) =>
        `${describeOccurrence(read)}  <- reads the stdin terminal flag outside a prompt decision; ` +
        'if this decides what to draw, read outputIsTTY (process.stdout.isTTY) instead',
    );
}

describe('guard: output decisions read stdout; only the decision to prompt reads stdin', () => {
  it('finds no file in src that decides anything but prompting from stdin.isTTY or the isTTY it becomes', () => {
    const violations = productionSources().flatMap(outputDecisionsOnStdin);

    expect(violations).toEqual([]);
  });

  it('finds the prompt gates it claims to be allowing, so the guard cannot go green on an empty scan', () => {
    const reads = productionSources().flatMap((source) =>
      stdinReads(source).map((read) => `${read.path} ${isPlumbing(read) ? 'plumbing' : 'gate'}`),
    );

    expect(reads).toEqual(
      expect.arrayContaining([
        'core/launch-command.ts plumbing',
        'core/launch-command.ts gate',
        'core/resolve.ts gate',
        'projects/project.create.ts gate',
      ]),
    );
  });

  it('names a heartbeat that follows stdin, the defect this guard exists for', () => {
    const source: SourceFile = {
      path: 'deployments/deployment.watcher.ts',
      text: [
        'export interface DeploymentWatchDeps {',
        '  isTTY: boolean;',
        '}',
        '',
        '',
        '',
        'if (deps.isTTY) {',
        '  deps.ux.print(deploymentHeartbeatLine(status));',
        '}',
      ].join('\n'),
    };

    expect(outputDecisionsOnStdin(source)).toEqual([
      'src/deployments/deployment.watcher.ts:2  isTTY: boolean;  <- reads the stdin terminal flag outside a prompt ' +
        'decision; if this decides what to draw, read outputIsTTY (process.stdout.isTTY) instead',
      'src/deployments/deployment.watcher.ts:7  if (deps.isTTY) {  <- reads the stdin terminal flag outside a prompt ' +
        'decision; if this decides what to draw, read outputIsTTY (process.stdout.isTTY) instead',
    ]);
  });

  it('names a render path reading process.stdin directly, and a stdin flag forwarded into a non-prompt dependency', () => {
    const source: SourceFile = {
      path: 'projects/project.create.ts',
      text: [
        'const live = process.stdin.isTTY ? spinner() : undefined;',
        'watchDeployment({',
        '  isTTY: this.services.isTTY,',
        '  poll: () => this.services.api.deployments.get({ org }),',
        '});',
      ].join('\n'),
    };

    expect(outputDecisionsOnStdin(source).map((violation) => violation.split('  <-')[0])).toEqual([
      'src/projects/project.create.ts:1  const live = process.stdin.isTTY ? spinner() : undefined;',
      'src/projects/project.create.ts:3  isTTY: this.services.isTTY,',
    ]);
  });

  it('allows stdout reads anywhere and a stdin read that gates a prompt or refuses to prompt', () => {
    const source: SourceFile = {
      path: 'deployments/deployment.stream.ts',
      text: [
        'const draw = process.stdout.isTTY;',
        'if (!this.services.isTTY) {',
        '  throw new MissingInputError(flag, REMEDIES);',
        '}',
        'return this.services.isTTY ? askChoice(ux, message, choices) : undefined;',
      ].join('\n'),
    };

    expect(outputDecisionsOnStdin(source)).toEqual([]);
  });

  it('treats a plumbing line as plumbing only inside the plumbing files', () => {
    const outside: SourceFile = { path: 'deployments/deployment.watcher.ts', text: 'isTTY: options.isTTY,' };
    const inside: SourceFile = { path: 'core/service-context.ts', text: 'isTTY: options.isTTY,' };

    expect(outputDecisionsOnStdin(outside)).toHaveLength(1);
    expect(outputDecisionsOnStdin(inside)).toEqual([]);
  });
});
