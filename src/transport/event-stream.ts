import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import type { AuthStrategy } from './auth-strategy';
import type { ErrorMessages } from './errors';
import { LaunchNetworkError, PROXY_ERROR_CODES, diagnoseTransportError, parseErrorEnvelope } from './errors';
import { proxyFailureMessage, proxyRouteFor } from './proxy';
import { buildRequestHeaders, type RequestScope } from './rest-client';

export const EVENT_STREAM_IDLE_TIMEOUT_MS = 30_000;

const MAX_REFUSAL_BODY_BYTES = 64 * 1024;
const FIRST_UNREACHABLE_STATUS = 300;
const FIRST_OPEN_STATUS = 200;

export interface StreamFrame {
  event: string | undefined;
  data: string;
}

const LINE_ENDING = /\r\n|\r|\n/;

export class FrameParser {
  private readonly decoder = new TextDecoder('utf-8');
  private tail = '';
  private skipLineFeed = false;
  private event: string | undefined;
  private data: string[] = [];

  push(chunk: Uint8Array): StreamFrame[] {
    let text = this.decoder.decode(chunk, { stream: true });

    if (text === '') {
      return [];
    }

    if (this.skipLineFeed && text.startsWith('\n')) {
      text = text.slice(1);
    }

    this.skipLineFeed = text.endsWith('\r');

    const lines = (this.tail + text).split(LINE_ENDING);
    this.tail = lines.pop() as string;

    return lines.flatMap((line) => this.read(line));
  }

  private read(line: string): StreamFrame[] {
    if (line === '') {
      return this.dispatch();
    }

    if (line.startsWith(':')) {
      return [];
    }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;

    if (field === 'event') {
      this.event = value;
    }

    if (field === 'data') {
      this.data.push(value);
    }

    return [];
  }

  private dispatch(): StreamFrame[] {
    const frame = { event: this.event, data: this.data.join('\n') };
    const hadData = this.data.length > 0;

    this.event = undefined;
    this.data = [];

    return hadData ? [frame] : [];
  }
}

export interface EventStreamClientOptions {
  baseUrl: string;
  analyticsInfo: string;
  auth: AuthStrategy;
  idleTimeoutMs?: number;
}

export interface EventStreamRequest extends RequestScope {
  path: string;
}

interface Refusal {
  status: number;
  body: unknown;
}

function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function interrupted(): LaunchNetworkError {
  return new LaunchNetworkError(
    'The connection to the Launch API was closed before the stream finished.',
    undefined,
    true,
  );
}

export class EventStreamClient {
  constructor(private readonly options: EventStreamClientOptions) {}

  async open(
    req: EventStreamRequest,
    onFrame: (frame: StreamFrame) => void,
    signal?: AbortSignal,
    errorMessages: ErrorMessages = {},
  ): Promise<void> {
    let refreshed = false;

    for (;;) {
      const headers = { ...(await buildRequestHeaders(this.options, req)), Accept: 'text/event-stream' };
      const refusal = await this.connect(req.path, headers, onFrame, signal);

      if (refusal === undefined) {
        return;
      }

      if (refusal.status === 401 && !refreshed && this.options.auth.refresh) {
        refreshed = true;
        await this.options.auth.refresh();
        continue;
      }

      throw parseErrorEnvelope(refusal.status, refusal.body, errorMessages);
    }
  }

  private connect(
    path: string,
    headers: Record<string, string>,
    onFrame: (frame: StreamFrame) => void,
    signal?: AbortSignal,
  ): Promise<Refusal | undefined> {
    const url = new URL(`${this.options.baseUrl}${path}`);
    const send = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const proxy = proxyRouteFor(url.href);
    const idleMs = this.options.idleTimeoutMs ?? EVENT_STREAM_IDLE_TIMEOUT_MS;

    const watched = signal ?? new AbortController().signal;

    return new Promise<Refusal | undefined>((resolve, reject) => {
      if (watched.aborted) {
        reject(watched.reason);
        return;
      }

      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const settle = (outcome: () => void): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          watched.removeEventListener('abort', onAbort);
          outcome();
        }
      };
      const fail = (error: unknown): void =>
        settle(() => {
          request.destroy();
          reject(error);
        });
      const onAbort = (): void => fail(watched.reason);
      const rearm = (): void => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            fail(
              new LaunchNetworkError(
                `The connection to the Launch API went quiet: nothing was received for ${idleMs / 1000} seconds.`,
                undefined,
                true,
              ),
            ),
          idleMs,
        );
      };
      const read = (response: IncomingMessage): void => {
        const status = Number(response.statusCode);
        const open = status >= FIRST_OPEN_STATUS && status < FIRST_UNREACHABLE_STATUS;
        const parser = new FrameParser();
        const body: Buffer[] = [];
        let bodyBytes = 0;

        rearm();
        response.on('data', (chunk: Buffer) => {
          rearm();

          if (!open) {
            bodyBytes += chunk.length;

            if (bodyBytes <= MAX_REFUSAL_BODY_BYTES) {
              body.push(chunk);
            }

            return;
          }

          try {
            parser.push(chunk).forEach(onFrame);
          } catch (error) {
            fail(error);
          }
        });
        response.on('end', () =>
          settle(() =>
            resolve(open ? undefined : { status, body: jsonOrUndefined(Buffer.concat(body).toString('utf8')) }),
          ),
        );
        response.on('error', (error) => fail(diagnoseTransportError(error)));
        response.on('close', () => fail(interrupted()));
      };

      const request = send(url, { method: 'GET', headers, agent: proxy?.agent ?? false }, read);

      request.on('error', (error: NodeJS.ErrnoException) => {
        if (proxy !== undefined && PROXY_ERROR_CODES.includes(error.code as string)) {
          fail(new LaunchNetworkError(proxyFailureMessage(proxy.address), error));
          return;
        }

        fail(diagnoseTransportError(error));
      });
      watched.addEventListener('abort', onAbort, { once: true });
      rearm();
      request.end();
    });
  }
}
