import { cliux } from '@contentstack/cli-utilities';

function streamReportingTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, isTTY: boolean | undefined): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY');

  Object.defineProperty(stream, 'isTTY', { value: isTTY, configurable: true, writable: true });

  return () => {
    if (descriptor === undefined) {
      delete (stream as unknown as { isTTY?: boolean }).isTTY;
      return;
    }

    Object.defineProperty(stream, 'isTTY', descriptor);
  };
}

export function stdinReportingTTY(isTTY: boolean | undefined): () => void {
  return streamReportingTTY(process.stdin, isTTY);
}

export function stdoutReportingTTY(isTTY: boolean | undefined): () => void {
  return streamReportingTTY(process.stdout, isTTY);
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

export function answerPrompts(answers: Record<string, unknown>): AnsweredPrompts {
  const recorded: AnsweredPrompts = { messages: [], payloads: [] };

  jest.spyOn(cliux, 'inquire').mockImplementation(async (payload: unknown) => {
    const record = payload as Record<string, unknown>;
    const message = String(record.message);
    recorded.messages.push(message);
    recorded.payloads.push(record);

    if (!(message in answers)) {
      throw new Error(`Unexpected prompt: ${message}`);
    }

    if (answers[message] === CTRL_C) {
      setImmediate(() => process.emit('SIGINT'));
      return new Promise<never>(() => undefined);
    }

    return answers[message] as never;
  });

  return recorded;
}
