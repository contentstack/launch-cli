import { createRequire } from 'node:module';

import { PROMPT_PAGE_SIZE } from './prompt';
import { styled } from './style';

export interface SearchChoice {
  name?: string;
  value: unknown;
}

export type Validator = (value: unknown, answers?: unknown) => unknown;

export interface SearchListPrompt {
  opt: { default?: unknown; validate: Validator; pageSize?: number };
  rl: { line: string };
  pointer: number;
  list: SearchChoice[];
  filterList: SearchChoice[];
  paginator: Paginator;
  render(): void;
  getCurrentValue(line?: unknown): unknown;
}

export type SearchListClass = new (...params: never[]) => SearchListPrompt;

export type ModuleLoader = (id: string) => unknown;

interface PromptRegistry {
  registerPrompt(name: string, prompt: unknown): void;
}

export class UnlistedAnswer {
  constructor(public readonly typed: string) {}
}

export function answerFor(list: SearchChoice[], typed: string): unknown {
  const match = list.find((choice) => choice.name === typed || choice.value === typed);

  return match === undefined ? new UnlistedAnswer(typed) : match.value;
}

export function unlistedMessage(typed: string): string {
  return typed === ''
    ? 'Pick one of the options from the list.'
    : `"${typed}" is not one of the options. Pick one from the list.`;
}

export function refuseUnlisted(validate: Validator): Validator {
  return (value, answers) =>
    value instanceof UnlistedAnswer ? unlistedMessage(value.typed) : validate(value, answers);
}

export function startingPointer(list: SearchChoice[], initial: unknown): number {
  const index = list.findIndex((choice) => initial !== undefined && choice.value === initial);

  return Math.max(index, 0);
}

export const MORE_CHOICES_HINT = '(Use ↑/↓ to see more options)';

const UPSTREAM_HINT = '(Move up and down to reveal more choices)';

interface Paginator {
  paginate(output: string, active: number, pageSize?: number): string;
}

export type PaginatedClass = new (...params: never[]) => { paginator: Paginator };

export function launchPaginated(Prompt: PaginatedClass): PaginatedClass {
  return class LaunchPaginated extends Prompt {
    constructor(...params: never[]) {
      super(...params);
      const paginate = this.paginator.paginate.bind(this.paginator);
      this.paginator.paginate = (output, active, pageSize) =>
        paginate(output, active, pageSize).replace(UPSTREAM_HINT, MORE_CHOICES_HINT);
    }
  };
}

export function scrollWindow(output: string, active: number, pageSize = PROMPT_PAGE_SIZE): string {
  const lines = output.split('\n');

  if (lines.length <= pageSize) {
    return output;
  }

  const top = Math.min(Math.max(active - Math.floor(pageSize / 2), 0), lines.length - pageSize);

  return [...lines.slice(top, top + pageSize), styled(MORE_CHOICES_HINT, 'dim', true)].join(
    '\n',
  );
}

export function launchSearchList(SearchList: SearchListClass): SearchListClass {
  return class LaunchSearchList extends SearchList {
    constructor(...params: never[]) {
      super(...params);
      this.pointer = startingPointer(this.list, this.opt.default);
      this.opt.validate = refuseUnlisted(this.opt.validate);
      this.opt.pageSize = this.opt.pageSize ?? PROMPT_PAGE_SIZE;
      this.paginator = { paginate: scrollWindow };
    }

    onDownKey(): void {
      this.pointer = Math.min(this.pointer + 1, Math.max(this.filterList.length - 1, 0));
      this.render();
    }

    onUpKey(): void {
      this.pointer = Math.max(this.pointer - 1, 0);
      this.render();
    }

    getCurrentValue(line?: unknown): unknown {
      if (this.filterList.length > 0) {
        return this.filterList[this.pointer].value;
      }

      if (line === undefined) {
        return this.accepted;
      }

      const answer = answerFor(this.list, String(line));

      if (!(answer instanceof UnlistedAnswer)) {
        this.accepted = answer;
      }

      return answer;
    }

    private accepted: unknown;

    private echoed: unknown;

    get selected(): unknown {
      return this.echoed;
    }

    set selected(value: unknown) {
      this.echoed = this.list?.find((choice) => choice.value === value)?.name ?? value;
    }
  };
}

export function utilitiesLoader(): ModuleLoader {
  return createRequire(require.resolve('@contentstack/cli-utilities'));
}

export function registerSearchList(load: ModuleLoader = utilitiesLoader()): void {
  const inquirer = load('inquirer') as PromptRegistry;

  inquirer.registerPrompt('search-list', launchSearchList(load('inquirer-search-list') as SearchListClass));

  for (const type of ['list', 'checkbox']) {
    inquirer.registerPrompt(type, launchPaginated(load(`inquirer/lib/prompts/${type}`) as PaginatedClass));
  }
}
