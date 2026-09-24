import { createRequire } from 'node:module';

export interface SearchChoice {
  value: unknown;
}

export interface SearchListPrompt {
  opt: { default?: unknown };
  rl: { line: string };
  pointer: number;
  list: SearchChoice[];
  filterList: SearchChoice[];
  getCurrentValue(): unknown;
}

export type SearchListClass = new (...params: never[]) => SearchListPrompt;

export type ModuleLoader = (id: string) => unknown;

interface PromptRegistry {
  registerPrompt(name: string, prompt: unknown): void;
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
    }

    getCurrentValue(): unknown {
      return this.filterList.length > 0 ? this.filterList[this.pointer].value : this.rl.line;
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
