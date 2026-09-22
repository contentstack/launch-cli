type InquirerModule = {
  prompt: (questions: any) => Promise<Record<string, any>>;
};

const inquirer: InquirerModule = require('inquirer');

export type PromptQuestion = {
  name: string;
  type?: string;
  message?: string;
  default?: any;
  choices?: any[];
  validate?: (input: any) => string | boolean;
};

type AskedPrompt = {
  name: string;
  type?: string;
  message?: string;
  choices?: string[];
};

export type ScriptedAnswer = {
  name: string;
  answer?: unknown;
  answerFrom?: (question: PromptQuestion) => unknown;
};

const describe = (question: PromptQuestion): string =>
  `name: "${question.name}", type: "${question.type ?? 'input'}", message: "${question.message ?? ''}"`;

const choiceLabels = (question: PromptQuestion): string[] | undefined =>
  question.choices?.map((choice: any) =>
    typeof choice === 'object' && choice !== null ? (choice.name ?? choice.value) : choice,
  );

class PromptHarness {
  private queue: ScriptedAnswer[] = [];
  private asked: AskedPrompt[] = [];
  private original?: InquirerModule['prompt'];

  install(): void {
    if (this.original) return;
    this.original = inquirer.prompt;
    const scripted = (payload: PromptQuestion | PromptQuestion[]) => {
      const questions = Array.isArray(payload) ? payload : [payload];
      const answers: Record<string, any> = {};
      for (const question of questions) {
        answers[question.name] = this.answerFor(question);
      }
      return Promise.resolve(answers);
    };

    inquirer.prompt = Object.assign(scripted, this.original);
  }

  restore(): void {
    if (!this.original) return;
    inquirer.prompt = this.original;
    this.original = undefined;
  }

  reset(): void {
    this.queue = [];
    this.asked = [];
  }

  script(answers: ScriptedAnswer[]): void {
    this.queue = [...answers];
  }

  promptSequence(): string[] {
    return this.asked.map((prompt) => prompt.name);
  }

  assertScriptFullyConsumed(): void {
    if (!this.queue.length) return;
    throw new Error(
      `The CLI stopped prompting before the script was exhausted. Still expected: ` +
        `${this.queue.map((entry) => entry.name).join(', ')}.\n` +
        `Prompts actually asked: ${this.promptSequence().join(' -> ') || '(none)'}`,
    );
  }

  private answerFor(question: PromptQuestion): any {
    this.asked.push({
      name: question.name,
      type: question.type,
      message: question.message,
      choices: choiceLabels(question),
    });

    const expected = this.queue.shift();
    if (!expected) {
      throw new Error(
        `Unexpected prompt - the script had no answer left.\n` +
          `  asked: ${describe(question)}\n` +
          `  prompt sequence so far: ${this.promptSequence().join(' -> ')}`,
      );
    }

    if (expected.name !== question.name) {
      throw new Error(
        `Prompt sequence mismatch at step ${this.asked.length}.\n` +
          `  expected prompt: "${expected.name}"\n` +
          `  actual prompt:   ${describe(question)}\n` +
          `  prompt sequence so far: ${this.promptSequence().join(' -> ')}`,
      );
    }

    const answer = expected.answerFrom ? expected.answerFrom(question) : expected.answer;

    if (question.validate) {
      const verdict = question.validate(answer);
      if (verdict !== true) {
        const reason = typeof verdict === 'string' ? verdict : 'validation returned false';
        throw new Error(`The CLI rejected the scripted answer for prompt "${question.name}": ${reason}`);
      }
    }

    return answer;
  }
}

export const prompts = new PromptHarness();
