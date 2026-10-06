import { createRequire } from 'node:module';

export interface SearchChoice {
  name?: string;
  value: unknown;
}

export type Validator = (value: unknown, answers?: unknown) => unknown;

export interface SearchListPrompt {
  opt: { default?: unknown; validate: Validator };
  rl: { line: string };
  pointer: number;
  list: SearchChoice[];
  filterList: SearchChoice[];
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

export function launchSearchList(SearchList: SearchListClass): SearchListClass {
  return class LaunchSearchList extends SearchList {
    constructor(...params: never[]) {
      super(...params);
      this.pointer = startingPointer(this.list, this.opt.default);
      this.opt.validate = refuseUnlisted(this.opt.validate);
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
}
