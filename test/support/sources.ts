import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SRC = join(__dirname, '..', '..', 'src');

export interface SourceFile {
  path: string;
  text: string;
}

function filesUnder(directory: string): string[] {
  return readdirSync(join(SRC, directory), { withFileTypes: true }).flatMap((entry) => {
    const child = directory === '' ? entry.name : `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      return filesUnder(child);
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [child] : [];
  });
}

export function productionSources(): SourceFile[] {
  return filesUnder('').map((path) => ({ path, text: readFileSync(join(SRC, path), 'utf8') }));
}

export interface Occurrence {
  path: string;
  line: number;
  text: string;
}

export function occurrences(source: SourceFile, pattern: RegExp): Occurrence[] {
  return source.text.split('\n').flatMap((text, index) =>
    new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text)
      ? [{ path: source.path, line: index + 1, text: text.trim() }]
      : [],
  );
}

export function describeOccurrence(occurrence: Occurrence): string {
  return `src/${occurrence.path}:${occurrence.line}  ${occurrence.text}`;
}

export function balancedCall(text: string, openParen: number): string {
  let depth = 0;

  for (let index = openParen; index < text.length; index += 1) {
    const char = text[index];

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;

      if (depth === 0) {
        return text.slice(openParen + 1, index);
      }
    }
  }

  return text.slice(openParen + 1);
}
