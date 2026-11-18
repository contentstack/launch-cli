import { terminalUx } from '../../src/core/terminal-ux';

type Stream = NodeJS.ReadStream | NodeJS.WriteStream;

function pinned(stream: Stream, property: 'isTTY' | 'columns', value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, property);

  Object.defineProperty(stream, property, { value, configurable: true, writable: true });

  return () => {
    if (descriptor === undefined) {
      delete (stream as unknown as Record<string, unknown>)[property];
      return;
    }

    Object.defineProperty(stream, property, descriptor);
  };
}

export function stdinReportingTTY(isTTY: boolean | undefined): () => void {
  return pinned(process.stdin, 'isTTY', isTTY);
}

export function stdoutReportingTTY(isTTY: boolean | undefined): () => void {
  return pinned(process.stdout, 'isTTY', isTTY);
}

export function stdoutOfWidth(columns: number | undefined): () => void {
  return pinned(process.stdout, 'columns', columns);
}

export function pretendTerminal(): () => void {
  return stdinReportingTTY(true);
}

export async function onTerminal<T>(run: () => Promise<T>): Promise<T> {
  const restore = pretendTerminal();

  try {
    return await run();
  } finally {
    restore();
  }
}

export const CTRL_C = Symbol('Ctrl-C');

export interface AnsweredPrompts {
  messages: string[];
  payloads: Record<string, unknown>[];
}

export type PromptHandler = (payload: Record<string, unknown>) => unknown;

// Stubs the terminal every LaunchCommand prompt reaches, answering each question with what `answer` returns for it.
export function stubPrompts(answer: PromptHandler): jest.SpyInstance {
  return jest
    .spyOn(terminalUx, 'inquire')
    .mockImplementation(async (payload: unknown) => answer(payload as Record<string, unknown>) as never);
}

// What inquirer 12 rejects with when Ctrl-C reaches a prompt in raw mode, where it is a keypress rather than a SIGINT.
export function ctrlC(): Error {
  return Object.assign(new Error('User force closed the prompt with SIGINT'), { name: 'ExitPromptError' });
}

export function answerPrompts(answers: Record<string, unknown>): AnsweredPrompts {
  const recorded: AnsweredPrompts = { messages: [], payloads: [] };

  stubPrompts((payload) => {
    const message = String(payload.message);
    recorded.messages.push(message);
    recorded.payloads.push(payload);

    if (!(message in answers)) {
      throw new Error(`Unexpected prompt: ${message}`);
    }

    if (answers[message] === CTRL_C) {
      throw ctrlC();
    }

    return answers[message];
  });

  return recorded;
}
